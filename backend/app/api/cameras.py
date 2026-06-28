from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel, Field
from typing import Optional
import time
import logging

from app.config.session import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

CAMERA_TYPES = ["IP Camera", "PTZ Camera", "Dome Camera", "Bullet Camera", "Fisheye Camera"]


# ──────────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────────
class CameraCreate(BaseModel):
    id: Optional[str] = None
    name: str
    ip_address: Optional[str] = None
    rtsp_url: Optional[str] = None
    camera_type: Optional[str] = "IP Camera"
    status: Optional[str] = "active"
    zone_id: Optional[str] = None
    nvr_dvr_id: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    rtsp_url: Optional[str] = None
    camera_type: Optional[str] = None
    status: Optional[str] = None
    zone_id: Optional[str] = None
    nvr_dvr_id: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class RTSPTestRequest(BaseModel):
    rtsp_url: str
    timeout_seconds: Optional[int] = 5


# ──────────────────────────────────────────────────────────────────────────────
# Camera CRUD
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/")
def list_cameras(db: Session = Depends(get_db)):
    """Return all cameras with their zone and NVR names for display."""
    try:
        sql = text("""
            SELECT
                c.id, c.nvr_dvr_id, c.zone_id, c.device_config_id,
                c.name, c.camera_type, c.status, c.created_at,
                c.ip_address, c.rtsp_url, c.username,
                z.name  AS zone_name,
                n.name  AS nvr_name
            FROM cameras c
            LEFT JOIN zones z ON z.id = c.zone_id
            LEFT JOIN nvr_dvr n ON n.id = c.nvr_dvr_id
            ORDER BY c.created_at DESC
        """)
        res = db.execute(sql)
        out = []
        for row in res.mappings().all():
            created = None
            raw_created = row.get("created_at")
            if raw_created is not None:
                try:
                    created = raw_created.isoformat() if hasattr(raw_created, "isoformat") else str(raw_created)
                except Exception:
                    created = str(raw_created)
            out.append({
                "id":              row["id"],
                "nvr_dvr_id":      row["nvr_dvr_id"],
                "zone_id":         row["zone_id"],
                "device_config_id": row["device_config_id"],
                "name":            row["name"],
                "camera_type":     row["camera_type"] or "IP Camera",
                "status":          row["status"],
                "created_at":      created,
                "ip_address":      row.get("ip_address"),
                "rtsp_url":        row.get("rtsp_url"),
                "username":        row.get("username"),
                "zone_name":       row.get("zone_name"),
                "nvr_name":        row.get("nvr_name"),
            })
        return out
    except Exception as e:
        logger.error(f"list_cameras error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
def create_camera(data: CameraCreate, db: Session = Depends(get_db)):
    """Add a new IP camera with RTSP URL, zone, NVR, and credentials."""
    try:
        cam_id = data.id if data.id else str(int(time.time() * 1000))

        # Ensure the cameras table has the new columns (graceful fallback for older schemas)
        _ensure_camera_columns(db)

        sql = text("""
            INSERT INTO cameras
                (id, name, ip_address, rtsp_url, camera_type, status,
                 zone_id, nvr_dvr_id, username, password)
            VALUES
                (:id, :name, :ip_address, :rtsp_url, :camera_type, :status,
                 :zone_id, :nvr_dvr_id, :username, :password)
        """)
        db.execute(sql, {
            "id":          cam_id,
            "name":        data.name,
            "ip_address":  data.ip_address,
            "rtsp_url":    data.rtsp_url,
            "camera_type": data.camera_type or "IP Camera",
            "status":      data.status or "active",
            "zone_id":     data.zone_id,
            "nvr_dvr_id":  data.nvr_dvr_id,
            "username":    data.username,
            "password":    data.password,
        })
        db.commit()
        logger.info(f"✅ Camera '{data.name}' ({cam_id}) created")
        return {"created": True, "id": cam_id}
    except Exception as e:
        logger.error(f"create_camera error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{camera_id}")
def update_camera(camera_id: str, data: CameraUpdate, db: Session = Depends(get_db)):
    """Update an existing camera's configuration."""
    try:
        _ensure_camera_columns(db)

        fields = {k: v for k, v in data.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")

        set_clause = ", ".join(f"{k} = :{k}" for k in fields)
        fields["camera_id"] = camera_id
        sql = text(f"UPDATE cameras SET {set_clause} WHERE id = :camera_id")
        result = db.execute(sql, fields)
        db.commit()

        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

        logger.info(f"✅ Camera '{camera_id}' updated: {list(fields.keys())}")
        return {"updated": True, "id": camera_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"update_camera error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{camera_id}")
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    """Remove a camera from the system."""
    try:
        sql = text("DELETE FROM cameras WHERE id = :id")
        result = db.execute(sql, {"id": camera_id})
        db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
        logger.info(f"🗑️ Camera '{camera_id}' deleted")
        return {"deleted": True, "id": camera_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Dropdown data
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/zones")
def list_zones(db: Session = Depends(get_db)):
    """Return all zones for the zone picker dropdown."""
    try:
        res = db.execute(text("SELECT id, name, site_id FROM zones ORDER BY name"))
        return [{"id": r[0], "name": r[1], "site_id": r[2]} for r in res.fetchall()]
    except Exception as e:
        logger.warning(f"list_zones: {e}")
        return []


@router.get("/nvr")
def list_nvr(db: Session = Depends(get_db)):
    """Return all NVR/DVR devices for the NVR picker dropdown."""
    try:
        res = db.execute(text("SELECT id, name, ip_address, model FROM nvr_dvr ORDER BY name"))
        return [{"id": r[0], "name": r[1], "ip_address": r[2], "model": r[3]} for r in res.fetchall()]
    except Exception as e:
        logger.warning(f"list_nvr: {e}")
        return []


@router.get("/types")
def list_camera_types():
    """Return supported camera types."""
    return CAMERA_TYPES


# ──────────────────────────────────────────────────────────────────────────────
# RTSP Connection Test
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/test-connection")
def test_rtsp_connection(data: RTSPTestRequest):
    """
    Test whether an RTSP URL is reachable by opening the stream with OpenCV.

    Returns:
        {ok: bool, message: str, resolution?: str, fps?: float}
    """
    try:
        import cv2
        cap = cv2.VideoCapture(data.rtsp_url)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, data.timeout_seconds * 1000)

        if not cap.isOpened():
            return {"ok": False, "message": "Could not open RTSP stream — check URL, credentials, and network."}

        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            return {"ok": False, "message": "Stream opened but no frames received — camera may be offline."}

        h, w = frame.shape[:2]
        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        logger.info(f"✅ RTSP test OK: {data.rtsp_url} → {w}×{h} @ {fps:.1f}fps")
        return {
            "ok": True,
            "message": f"Connection successful — live stream at {w}×{h}",
            "resolution": f"{w}×{h}",
            "fps": round(fps, 1),
        }
    except Exception as e:
        logger.error(f"RTSP test error: {e}")
        return {"ok": False, "message": f"Test failed: {str(e)}"}


# ──────────────────────────────────────────────────────────────────────────────
# Schema helpers
# ──────────────────────────────────────────────────────────────────────────────
def _ensure_camera_columns(db: Session):
    """
    Add rtsp_url / username / password columns if the cameras table was created
    with an older schema that did not include them.  Safe to call repeatedly.
    """
    for col, col_type in [("rtsp_url", "TEXT"), ("username", "VARCHAR(128)"), ("password", "VARCHAR(256)")]:
        try:
            db.execute(text(f"ALTER TABLE cameras ADD COLUMN IF NOT EXISTS {col} {col_type}"))
            db.commit()
        except Exception:
            db.rollback()

