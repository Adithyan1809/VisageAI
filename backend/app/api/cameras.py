from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
import time
from app.config.session import get_db

router = APIRouter()


class CameraCreate(BaseModel):
    id: str | None = None
    name: str
    ip_address: str | None = None
    status: str | None = "active"


@router.get("/")
def list_cameras(db: Session = Depends(get_db)):
    """Return a JSON-serializable list of cameras using a raw SQL query to avoid ORM serialization issues."""
    try:
        sql = text("SELECT id, nvr_dvr_id, zone_id, device_config_id, name, camera_type, status, created_at FROM cameras")
        res = db.execute(sql)
        out = []
        for row in res.fetchall():
            # Be defensive about created_at (may be datetime or string/null)
            created = None
            if row[7] is not None:
                try:
                    created = row[7].isoformat() if hasattr(row[7], 'isoformat') else str(row[7])
                except Exception:
                    created = str(row[7])
            out.append({
                "id": row[0],
                "nvr_dvr_id": row[1],
                "zone_id": row[2],
                "device_config_id": row[3],
                "name": row[4],
                "camera_type": row[5],
                "status": row[6],
                "created_at": created,
            })
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
def create_camera(data: CameraCreate, db: Session = Depends(get_db)):
    try:
        cam_id = data.id if data.id else str(int(time.time() * 1000))
        sql = text("INSERT INTO cameras (id, name, ip_address, status) VALUES (:id, :name, :ip_address, :status)")
        db.execute(sql, {"id": cam_id, "name": data.name, "ip_address": data.ip_address, "status": data.status})
        db.commit()
        return {"created": True, "id": cam_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
