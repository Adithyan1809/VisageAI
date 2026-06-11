from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import InvalidRequestError
from pydantic import BaseModel
from app.config.session import get_db
from app.attendance import models as shift_models

router = APIRouter()


class ShiftCreate(BaseModel):
    id: str | None = None
    name: str
    start_time: str | None = None
    end_time: str | None = None
    site_id: str | None = None


class ShiftUpdate(BaseModel):
    name: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    site_id: str | None = None


@router.get("/")
def get_shifts(db: Session = Depends(get_db)):
    """Try the ORM query; if mappers aren't configured (mapper init errors), use raw SQL fallback."""
    try:
        return db.query(shift_models.Shift).all()
    except InvalidRequestError:
        # Fallback to raw SQL to avoid mapper initialization issues in other modules
        sql = text("SELECT id, name FROM shifts")
        res = db.execute(sql)
        out = []
        for row in res.fetchall():
            out.append({"id": row[0], "name": row[1]})
        return out


@router.post("/")
def create_shift(data: ShiftCreate, db: Session = Depends(get_db)):
    try:
        shift = shift_models.Shift(id=data.id, name=data.name)
        db.add(shift)
        db.commit()
        return {"created": True}
    except InvalidRequestError:
        # Fallback raw insert
        try:
            sql = text("INSERT INTO shifts (id, name) VALUES (:id, :name)")
            db.execute(sql, {"id": data.id, "name": data.name})
            db.commit()
            return {"created": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/{shift_id}")
def get_shift(shift_id: str, db: Session = Depends(get_db)):
    try:
        s = db.query(shift_models.Shift).filter(shift_models.Shift.id == shift_id).one_or_none()
        if not s:
            raise HTTPException(status_code=404, detail="Not found")
        return s
    except InvalidRequestError:
        sql = text("SELECT id, name, start_time, end_time, site_id FROM shifts WHERE id = :id")
        r = db.execute(sql, {"id": shift_id}).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Not found")
        return {"id": r[0], "name": r[1], "start_time": r[2], "end_time": r[3], "site_id": r[4]}


@router.put("/{shift_id}")
def update_shift(shift_id: str, data: ShiftUpdate, db: Session = Depends(get_db)):
    try:
        s = db.query(shift_models.Shift).filter(shift_models.Shift.id == shift_id).one_or_none()
        if not s:
            raise HTTPException(status_code=404, detail="Not found")
        if data.name is not None:
            s.name = data.name
        if data.start_time is not None:
            s.start_time = data.start_time
        if data.end_time is not None:
            s.end_time = data.end_time
        if data.site_id is not None:
            s.site_id = data.site_id
        db.add(s)
        db.commit()
        return {"updated": True}
    except InvalidRequestError:
        # raw SQL update fallback
        sets = []
        params = {"id": shift_id}
        if data.name is not None:
            sets.append("name = :name")
            params["name"] = data.name
        if data.start_time is not None:
            sets.append("start_time = :start_time")
            params["start_time"] = data.start_time
        if data.end_time is not None:
            sets.append("end_time = :end_time")
            params["end_time"] = data.end_time
        if data.site_id is not None:
            sets.append("site_id = :site_id")
            params["site_id"] = data.site_id
        if not sets:
            return {"updated": False}
        sql = text(f"UPDATE shifts SET {', '.join(sets)} WHERE id = :id")
        db.execute(sql, params)
        db.commit()
        return {"updated": True}


@router.delete("/{shift_id}")
def delete_shift(shift_id: str, db: Session = Depends(get_db)):
    try:
        s = db.query(shift_models.Shift).filter(shift_models.Shift.id == shift_id).one_or_none()
        if not s:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(s)
        db.commit()
        return {"deleted": True}
    except InvalidRequestError:
        sql = text("DELETE FROM shifts WHERE id = :id")
        db.execute(sql, {"id": shift_id})
        db.commit()
        return {"deleted": True}
