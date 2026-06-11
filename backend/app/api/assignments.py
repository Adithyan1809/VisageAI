from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import InvalidRequestError
from app.config.session import get_db
from app.attendance import models as attendance_models
from app.identity_access import models as identity_models
from pydantic import BaseModel

router = APIRouter()


@router.get("/")
def list_assignments(db: Session = Depends(get_db)):
    """Return simplified assignment objects for the UI.
    Try ORM first; fall back to raw SQL if mappers haven't been configured.
    """
    try:
        rows = db.query(attendance_models.ShiftAssignment).all()
    except InvalidRequestError:
        sql = text(
            "SELECT id, employee_id, shift_id, department_id, site_id, zone_id, assigned_from, assigned_to, is_active FROM shift_assignments"
        )
        res = db.execute(sql)
        rows = res.fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r[0],
                "employeeId": r[1],
                "shiftId": r[2],
                "departmentId": r[3],
                "siteId": r[4],
                "zoneId": r[5],
                "date": r[6].isoformat() if r[6] else None,
                "assigned_from": r[6].isoformat() if r[6] else None,
                "assigned_to": r[7].isoformat() if r[7] else None,
                "is_active": bool(r[8]) if r[8] is not None else None,
            })
        return out

    # ORM path: map objects to simplified dicts
    out = []
    for r in rows:
        out.append({
            "id": r.id,
            "employeeId": r.employee_id,
            "shiftId": r.shift_id,
            "departmentId": r.department_id,
            "siteId": r.site_id,
            "zoneId": r.zone_id,
            "date": r.assigned_from.isoformat() if getattr(r, 'assigned_from', None) else None,
            "assigned_from": r.assigned_from.isoformat() if getattr(r, 'assigned_from', None) else None,
            "assigned_to": r.assigned_to.isoformat() if getattr(r, 'assigned_to', None) else None,
            "is_active": bool(r.is_active) if r.is_active is not None else None,
        })
    return out


class AssignmentCreate(BaseModel):
    id: str | None = None
    employeeId: str
    shiftId: str
    departmentId: str | None = None
    siteId: str | None = None
    zoneId: str | None = None
    assigned_from: str | None = None
    assigned_to: str | None = None
    is_active: bool | None = True


class AssignmentUpdate(BaseModel):
    employeeId: str | None = None
    shiftId: str | None = None
    departmentId: str | None = None
    siteId: str | None = None
    zoneId: str | None = None
    assigned_from: str | None = None
    assigned_to: str | None = None
    is_active: bool | None = None


@router.post("/")
def create_assignment(data: AssignmentCreate, db: Session = Depends(get_db)):
    try:
        # If department/site/zone not provided, try to infer from employee record
        dept = data.departmentId
        site = data.siteId
        zone = data.zoneId
        if not (dept and site and zone):
            emp = db.query(identity_models.Employee).filter(identity_models.Employee.id == data.employeeId).one_or_none()
            if emp:
                if not dept:
                    dept = emp.department_id
                if not site:
                    site = emp.site_id
                if not zone:
                    zone = emp.zone_id

        a = attendance_models.ShiftAssignment(
            id=data.id,
            employee_id=data.employeeId,
            shift_id=data.shiftId,
            department_id=dept,
            site_id=site,
            zone_id=zone,
            assigned_from=data.assigned_from,
            assigned_to=data.assigned_to,
            is_active=data.is_active,
        )
        db.add(a)
        db.commit()
        return {"created": True}
    except InvalidRequestError:
        # Raw-SQL fallback: try to infer department/site/zone from employees table if missing
        dept = data.departmentId
        site = data.siteId
        zone = data.zoneId
        if not (dept and site and zone):
            emp_sql = text("SELECT department_id, site_id, zone_id FROM employees WHERE id = :id LIMIT 1")
            emp_res = db.execute(emp_sql, {"id": data.employeeId}).fetchone()
            if emp_res:
                if not dept:
                    dept = emp_res[0]
                if not site:
                    site = emp_res[1]
                if not zone:
                    zone = emp_res[2]

        sql = text(
            "INSERT INTO shift_assignments (id, employee_id, shift_id, department_id, site_id, zone_id, assigned_from, assigned_to, is_active) VALUES (:id, :employee_id, :shift_id, :department_id, :site_id, :zone_id, :assigned_from, :assigned_to, :is_active)"
        )
        params = {
            "id": data.id,
            "employee_id": data.employeeId,
            "shift_id": data.shiftId,
            "department_id": dept,
            "site_id": site,
            "zone_id": zone,
            "assigned_from": data.assigned_from,
            "assigned_to": data.assigned_to,
            "is_active": data.is_active,
        }
        db.execute(sql, params)
        db.commit()
        return {"created": True}


@router.put("/{assignment_id}")
def update_assignment(assignment_id: str, data: AssignmentUpdate, db: Session = Depends(get_db)):
    try:
        a = db.query(attendance_models.ShiftAssignment).filter(attendance_models.ShiftAssignment.id == assignment_id).one_or_none()
        if not a:
            raise HTTPException(status_code=404, detail="Not found")
        if data.employeeId is not None:
            a.employee_id = data.employeeId
            # If department/site/zone were not provided with the update, try to inherit from the employee
            if data.departmentId is None or data.siteId is None or data.zoneId is None:
                emp = db.query(identity_models.Employee).filter(identity_models.Employee.id == data.employeeId).one_or_none()
                if emp:
                    if data.departmentId is None:
                        a.department_id = emp.department_id
                    if data.siteId is None:
                        a.site_id = emp.site_id
                    if data.zoneId is None:
                        a.zone_id = emp.zone_id
        if data.shiftId is not None:
            a.shift_id = data.shiftId
        if data.departmentId is not None:
            a.department_id = data.departmentId
        if data.siteId is not None:
            a.site_id = data.siteId
        if data.zoneId is not None:
            a.zone_id = data.zoneId
        if data.assigned_from is not None:
            a.assigned_from = data.assigned_from
        if data.assigned_to is not None:
            a.assigned_to = data.assigned_to
        if data.is_active is not None:
            a.is_active = data.is_active
        db.add(a)
        db.commit()
        return {"updated": True}
    except InvalidRequestError:
        sets = []
        params = {"id": assignment_id}
        if data.employeeId is not None:
            sets.append("employee_id = :employee_id")
            params["employee_id"] = data.employeeId
        if data.shiftId is not None:
            sets.append("shift_id = :shift_id")
            params["shift_id"] = data.shiftId
        if data.departmentId is not None:
            sets.append("department_id = :department_id")
            params["department_id"] = data.departmentId
        if data.siteId is not None:
            sets.append("site_id = :site_id")
            params["site_id"] = data.siteId
        if data.zoneId is not None:
            sets.append("zone_id = :zone_id")
            params["zone_id"] = data.zoneId
        if data.assigned_from is not None:
            sets.append("assigned_from = :assigned_from")
            params["assigned_from"] = data.assigned_from
        if data.assigned_to is not None:
            sets.append("assigned_to = :assigned_to")
            params["assigned_to"] = data.assigned_to
        if data.is_active is not None:
            sets.append("is_active = :is_active")
            params["is_active"] = data.is_active
        if not sets:
            return {"updated": False}
        sql = text(f"UPDATE shift_assignments SET {', '.join(sets)} WHERE id = :id")
        db.execute(sql, params)
        db.commit()
        return {"updated": True}


@router.delete("/{assignment_id}")
def delete_assignment(assignment_id: str, db: Session = Depends(get_db)):
    try:
        a = db.query(attendance_models.ShiftAssignment).filter(attendance_models.ShiftAssignment.id == assignment_id).one_or_none()
        if not a:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(a)
        db.commit()
        return {"deleted": True}
    except InvalidRequestError:
        sql = text("DELETE FROM shift_assignments WHERE id = :id")
        db.execute(sql, {"id": assignment_id})
        db.commit()
        return {"deleted": True}
