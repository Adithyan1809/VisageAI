from fastapi import APIRouter, Depends
from sqlalchemy import text
from app.config.session import get_db

router = APIRouter()


@router.get("/departments")
def list_departments(db=Depends(get_db)):
    """Return list of departments (id, name, external_department_code)."""
    try:
        rows = db.execute(text("SELECT id, name, external_department_code FROM departments ORDER BY name")).mappings().all()
    except Exception:
        return []
    return [
        {"id": r.get("id"), "name": r.get("name"), "external_department_code": r.get("external_department_code")} for r in rows
    ]
