from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.config.session import get_db
from app.identity_access import models as id_models
from sqlalchemy import text
from uuid import uuid4
import os
import json
import redis
import asyncio
import threading
import psycopg2
import select
from fastapi import WebSocket, WebSocketDisconnect
from app.config.database import engine, DATABASE_URL

router = APIRouter()

# WebSocket connections set
ws_connections: set = set()


async def broadcast_message(message: dict):
    """Send message to all connected websocket clients."""
    to_remove = []
    for ws in list(ws_connections):
        try:
            await ws.send_json(message)
        except Exception:
            try:
                await ws.close()
            except Exception:
                pass
            to_remove.append(ws)
    for ws in to_remove:
        ws_connections.discard(ws)


# WebSocket endpoint (top-level so FastAPI registers it correctly)
@router.websocket("/ws")
async def employees_ws(websocket: WebSocket):
    await websocket.accept()
    ws_connections.add(websocket)
    try:
        while True:
            # Keep connection open; clients may send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_connections.discard(websocket)
    except Exception:
        ws_connections.discard(websocket)
        try:
            await websocket.close()
        except Exception:
            pass

def _fetch_employee_rows(conn):
    # return list of dicts with id and updated_at
    rows = conn.execute(text("SELECT id, updated_at FROM employees")).mappings().all()
    return [{"id": r.get("id"), "updated_at": (r.get("updated_at") and r.get("updated_at").isoformat())} for r in rows]


def _fetch_full_employee(conn, emp_id):
    r = conn.execute(text(
        "SELECT e.id, e.user_id, e.employee_code, e.department_id, e.site_id, e.zone_id, e.status_flag, e.external_employee_id, e.created_at, e.updated_at, e.name, u.username, u.email, u.phone, r.name as role, d.name as department_name"
        " FROM employees e"
        " LEFT JOIN users u ON u.id = e.user_id"
        " LEFT JOIN roles r ON r.id = u.role_id"
        " LEFT JOIN departments d ON d.id = e.department_id"
        " WHERE e.id = :id"
    ), {"id": emp_id}).mappings().first()
    if not r:
        return None
    return {
        "id": r.get("id"),
        "user_id": r.get("user_id"),
        "name": r.get("name"),
        "employee_code": r.get("employee_code"),
        "department_id": r.get("department_id"),
        "department_name": r.get("department_name"),
        "site_id": r.get("site_id"),
        "zone_id": r.get("zone_id"),
        "external_employee_id": r.get("external_employee_id"),
        "status_flag": r.get("status_flag"),
        "created_at": (r.get("created_at") and r.get("created_at").isoformat()),
        "updated_at": (r.get("updated_at") and r.get("updated_at").isoformat()),
        "username": r.get("username"),
        "email": r.get("email"),
        "phone": r.get("phone"),
        "role": r.get("role"),
    }


async def employee_poll_loop(poll_interval: int = 3):
    """Background task that polls the employees table for changes and broadcasts events."""
    prev = {}
    # initialize prev snapshot
    try:
        with engine.connect() as conn:
            rows = _fetch_employee_rows(conn)
            for r in rows:
                prev[r["id"]] = r["updated_at"]
    except Exception:
        prev = {}

    while True:
        try:
            await asyncio.sleep(poll_interval)
            with engine.connect() as conn:
                rows = _fetch_employee_rows(conn)
                current = {r["id"]: r["updated_at"] for r in rows}

                # detect deletions
                deleted = [eid for eid in prev.keys() if eid not in current]
                for eid in deleted:
                    await broadcast_message({"type": "deleted", "id": eid})

                # detect new or updated
                for eid, updated_at in current.items():
                    if eid not in prev or prev.get(eid) != updated_at:
                        # fetch full row and broadcast
                        emp = _fetch_full_employee(conn, eid)
                        if emp:
                            await broadcast_message({"type": "upsert", "employee": emp})

                prev = current
        except Exception:
            # keep loop alive on errors
            await asyncio.sleep(poll_interval)


def register_broadcaster(app):
    import asyncio as _asyncio

    @app.on_event("startup")
    async def _start_poll():
        # start background task
        _asyncio.create_task(employee_poll_loop())
        # start a thread to listen for Postgres NOTIFY messages (instant)
        def _start_listener():
            # Get a reference to the running event loop from the main thread
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = None

            def _dispatch(coro):
                """Schedule a coroutine on the main event loop from this background thread."""
                if loop and not loop.is_closed():
                    asyncio.run_coroutine_threadsafe(coro, loop)

            try:
                # DATABASE_URL is like postgresql+psycopg2://user:pass@host:port/db
                pg_url = DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://")
                conn = psycopg2.connect(pg_url)
                conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
                cur = conn.cursor()
                cur.execute("LISTEN employees_changes;")
                while True:
                    if select.select([conn], [], [], 5) == ([], [], []):
                        continue
                    conn.poll()
                    while conn.notifies:
                        notify = conn.notifies.pop(0)
                        try:
                            payload = json.loads(notify.payload)
                        except Exception:
                            try:
                                payload = json.loads(notify.payload.replace("'", '"'))
                            except Exception:
                                payload = {"type": "raw", "data": notify.payload}

                        typ = payload.get("type")
                        if typ == "deleted":
                            eid = payload.get("id")
                            if eid:
                                _dispatch(broadcast_message({"type": "deleted", "id": eid}))
                        elif typ in ("upsert", "insert", "update"):
                            eid = payload.get("id")
                            if eid:
                                try:
                                    with engine.connect() as c:
                                        emp = _fetch_full_employee(c, eid)
                                        if emp:
                                            _dispatch(broadcast_message({"type": "upsert", "employee": emp}))
                                except Exception:
                                    pass
                        else:
                            _dispatch(broadcast_message({"type": "raw", "data": payload}))
            except Exception:
                # listener failed — poll loop remains as fallback
                return

        t = threading.Thread(target=_start_listener, daemon=True)
        t.start()

        # Also start a background task to listen for attendance events from Redis
        try:
            from app.services import attendance_broadcaster as _ab

            async def _attendance_listener():
                try:
                    async for ev in _ab.listen():
                        try:
                            # Wrap and broadcast to connected websocket clients
                            await broadcast_message({"type": "attendance", "event": ev})
                        except Exception:
                            pass
                except Exception:
                    return

            _asyncio.create_task(_attendance_listener())
        except Exception:
            # If attendance_broadcaster or Redis isn't available, skip.
            pass


# Redis configuration (optional caching)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
try:
    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
except Exception:
    redis_client = None


class EmployeeCreate(BaseModel):
    id: str | None = None
    user_id: str | None = None
    employee_code: str | None = None
    name: str | None = None
    department_id: str | None = None
    site_id: str | None = None
    zone_id: str | None = None
    status_flag: str | None = None
    external_employee_id: str | None = None
    # optional user fields
    username: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None


def serialize_employee(emp: id_models.Employee) -> dict:
    user = getattr(emp, "user", None)
    role = None
    if user is not None:
        role = getattr(user.role, "name", None)

    return {
        "id": emp.id,
        "user_id": emp.user_id,
        "name": getattr(emp, "name", None) or None,
        "employee_code": emp.employee_code,
        "department_id": getattr(emp, "department_id", None),
        "site_id": getattr(emp, "site_id", None),
        "zone_id": getattr(emp, "zone_id", None),
        "external_employee_id": getattr(emp, "external_employee_id", None),
        "status_flag": emp.status_flag,
        "created_at": emp.created_at.isoformat() if emp.created_at else None,
        "updated_at": emp.updated_at.isoformat() if getattr(emp, "updated_at", None) else None,
        "username": user.username if user else None,
        "email": user.email if user else None,
        "phone": user.phone if user else None,
        "role": role,
    }


@router.get("/")
def get_employees(db: Session = Depends(get_db)):
    """Return list of employees; use Redis cache if available."""
    cache_key = "employees:all"
    try:
        if redis_client:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
    except Exception:
        # Cache read failure should not break the API
        pass

    # Use a lightweight SQL query to avoid triggering SQLAlchemy mapper
    # initialization issues across modules (some relationships refer to classes
    # that may not be imported yet). This returns raw rows and is sufficient
    # for a read-only employees list used by the UI.
    try:
        rows = db.execute(text(
            "SELECT e.id, e.user_id, e.employee_code, e.department_id, e.site_id, e.zone_id, e.status_flag, e.external_employee_id, e.created_at, e.updated_at, e.name, u.username, u.email, u.phone, r.name as role"
            " FROM employees e"
            " LEFT JOIN users u ON u.id = e.user_id"
            " LEFT JOIN roles r ON r.id = u.role_id"
        )).mappings().all()
    except Exception:
        # Fallback to ORM query if raw SQL fails
        emps = db.query(id_models.Employee).all()
        serialized = [serialize_employee(e) for e in emps]
    else:
        serialized = []
        for r in rows:
            serialized.append({
                "id": r.get("id"),
                "user_id": r.get("user_id"),
                "name": r.get("name"),
                "employee_code": r.get("employee_code"),
                "department_id": r.get("department_id"),
                "site_id": r.get("site_id"),
                "zone_id": r.get("zone_id"),
                "external_employee_id": r.get("external_employee_id"),
                "status_flag": r.get("status_flag"),
                "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
                "updated_at": r.get("updated_at").isoformat() if r.get("updated_at") else None,
                "username": r.get("username"),
                "email": r.get("email"),
                "phone": r.get("phone"),
                "role": r.get("role"),
            })

    try:
        if redis_client:
            redis_client.set(cache_key, json.dumps(serialized), ex=60)
    except Exception:
        # Cache write failure is non-fatal
        pass

    return serialized


@router.post("/")
def create_employee(data: EmployeeCreate, db: Session = Depends(get_db)):
    # Basic server-side validation
    errors = {}
    if not data.name or (isinstance(data.name, str) and data.name.strip() == ""):
        errors["name"] = "Name is required"
    if data.email and ("@" not in data.email or "." not in data.email):
        errors["email"] = "Invalid email format"
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    # If user-related fields present, create a users row and use its id
    user_id = data.user_id
    try:
        if (not user_id) and (data.username or data.email or data.phone or data.role):
            new_user_id = str(uuid4())
            role_id = None
            if data.role:
                role_row = db.execute(text("SELECT id FROM roles WHERE name = :name LIMIT 1"), {"name": data.role}).mappings().first()
                if role_row:
                    role_id = role_row.get("id")
                else:
                    # create a new role entry
                    new_role_id = str(uuid4())
                    db.execute(text("INSERT INTO roles (id, name) VALUES (:id, :name)"), {"id": new_role_id, "name": data.role})
                    role_id = new_role_id

            user_insert = text(
                "INSERT INTO users (id, username, email, phone, role_id, created_at, updated_at)"
                " VALUES (:id, :username, :email, :phone, :role_id, NOW(), NOW())"
            )
            db.execute(user_insert, {"id": new_user_id, "username": data.username, "email": data.email, "phone": data.phone, "role_id": role_id})
            user_id = new_user_id

        # Insert employee row
        insert_sql = text(
            "INSERT INTO employees (id, user_id, employee_code, name, department_id, site_id, zone_id, status_flag, external_employee_id, created_at, updated_at)"
            " VALUES (:id, :user_id, :employee_code, :name, :department_id, :site_id, :zone_id, :status_flag, :external_employee_id, NOW(), NOW())"
        )
        params = {
            "id": data.id or data.employee_code or str(uuid4()),
            "user_id": user_id,
            "employee_code": data.employee_code,
            "name": data.name,
            "department_id": data.department_id,
            "site_id": data.site_id,
            "zone_id": data.zone_id,
            "status_flag": data.status_flag or "active",
            "external_employee_id": data.external_employee_id,
        }
        db.execute(insert_sql, params)
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Invalidate cache when employees change
    try:
        if redis_client:
            redis_client.delete("employees:all")
    except Exception:
        pass

    return {"created": True, "id": params["id"]}


@router.get("/{emp_id}")
def get_employee(emp_id: str, db: Session = Depends(get_db)):
    # Return full employee including linked user info (email, phone, role)
    full = _fetch_full_employee(db, emp_id)
    if not full:
        return {}
    return full


@router.put("/{emp_id}")
def update_employee(emp_id: str, data: EmployeeCreate, db: Session = Depends(get_db)):
    # Server-side validation
    errors = {}
    if not data.name or (isinstance(data.name, str) and data.name.strip() == ""):
        errors["name"] = "Name is required"
    if data.email and ("@" not in data.email or "." not in data.email):
        errors["email"] = "Invalid email format"
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})

    # First, fetch current employee to get user_id
    current = db.execute(text("SELECT user_id FROM employees WHERE id = :id"), {"id": emp_id}).mappings().first()
    current_user_id = current.get("user_id") if current else None

    try:
        # If user-related fields are present in payload, update or create user
        if data.username or data.email or data.phone or data.role:
            role_id = None
            if data.role:
                role_row = db.execute(text("SELECT id FROM roles WHERE name = :name LIMIT 1"), {"name": data.role}).mappings().first()
                if role_row:
                    role_id = role_row.get("id")
                else:
                    new_role_id = str(uuid4())
                    db.execute(text("INSERT INTO roles (id, name) VALUES (:id, :name)"), {"id": new_role_id, "name": data.role})
                    role_id = new_role_id

            if current_user_id:
                # Update existing user
                db.execute(text(
                    "UPDATE users SET username = :username, email = :email, phone = :phone, role_id = :role_id, updated_at = NOW() WHERE id = :id"
                ), {"username": data.username, "email": data.email, "phone": data.phone, "role_id": role_id, "id": current_user_id})
            else:
                # Create new user and set user_id on employee
                new_user_id = str(uuid4())
                db.execute(text(
                    "INSERT INTO users (id, username, email, phone, role_id, created_at, updated_at) VALUES (:id, :username, :email, :phone, :role_id, NOW(), NOW())"
                ), {"id": new_user_id, "username": data.username, "email": data.email, "phone": data.phone, "role_id": role_id})
                db.execute(text("UPDATE employees SET user_id = :uid WHERE id = :id"), {"uid": new_user_id, "id": emp_id})

        # Update employee fields
        update_sql = text(
            "UPDATE employees SET user_id = :user_id, employee_code = :employee_code, name = :name, department_id = :department_id, site_id = :site_id, zone_id = :zone_id, status_flag = :status_flag, external_employee_id = :external_employee_id, updated_at = NOW() WHERE id = :id"
        )
        params = {
            "id": emp_id,
            "user_id": data.user_id or current_user_id,
            "employee_code": data.employee_code,
            "name": data.name,
            "department_id": data.department_id,
            "site_id": data.site_id,
            "zone_id": data.zone_id,
            "status_flag": data.status_flag,
            "external_employee_id": data.external_employee_id,
        }
        db.execute(update_sql, params)
        db.commit()
        # After updating an employee, propagate department/site/zone into existing
        # shift_assignments rows for this employee where those fields are NULL.
        try:
            db.execute(text(
                "UPDATE shift_assignments sa SET department_id = e.department_id, site_id = e.site_id, zone_id = e.zone_id"
                " FROM employees e WHERE sa.employee_id = e.id AND e.id = :id AND (sa.department_id IS NULL OR sa.site_id IS NULL OR sa.zone_id IS NULL)"
            ), {"id": emp_id})
            db.commit()
        except Exception:
            # Non-fatal: if update fails, don't block the employee update.
            db.rollback()
    except Exception:
        db.rollback()
        raise

    # Invalidate cache
    try:
        if redis_client:
            redis_client.delete("employees:all")
    except Exception:
        pass

    return {"updated": True}


@router.delete("/{emp_id}")
def delete_employee(emp_id: str, db: Session = Depends(get_db)):
    try:
        # 1. Get the employee to find associated user_id
        emp_result = db.execute(
            text("SELECT user_id FROM employees WHERE id = :id"),
            {"id": emp_id}
        ).first()
        
        if not emp_result:
            raise HTTPException(status_code=404, detail="Employee not found")
        
        user_id = emp_result[0]
        
        # 2. Delete facial templates first (cascade delete by referential integrity)
        db.execute(text("DELETE FROM facial_templates WHERE employee_id = :emp_id"), {"emp_id": emp_id})
        
        # 3. Delete attendance records related to this employee
        db.execute(text("DELETE FROM attendance_events WHERE employee_id = :emp_id"), {"emp_id": emp_id})
        
        # 4. Delete shift assignments for this employee
        db.execute(text("DELETE FROM shift_assignments WHERE employee_id = :emp_id"), {"emp_id": emp_id})
        
        # 5. Delete the employee record
        db.execute(text("DELETE FROM employees WHERE id = :id"), {"id": emp_id})
        
        # 6. Delete the associated user record if it exists
        if user_id:
            db.execute(text("DELETE FROM users WHERE id = :user_id"), {"user_id": user_id})
        
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete employee: {str(e)}")

    try:
        if redis_client:
            redis_client.delete("employees:all")
    except Exception:
        pass

    # Broadcast deletion to all connected WebSocket clients
    try:
        loop = asyncio.get_event_loop()
        if loop and loop.is_running():
            asyncio.ensure_future(broadcast_message({"type": "deleted", "id": emp_id}))
    except Exception:
        pass

    return {"deleted": True, "employee_id": emp_id}
