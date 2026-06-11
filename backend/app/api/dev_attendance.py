from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from sqlalchemy import text
from app.config.database import engine

router = APIRouter()

@router.get("/recent")
def recent_attendance(hours: int = 24, limit: int = 200):
    """Dev-only: return recent attendance using raw engine SQL (avoids importing ORM models)."""
    try:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        sql = text(
            "SELECT id, employee_id, camera_id, event_type, event_time FROM attendance_events "
            "WHERE event_time >= :cutoff ORDER BY event_time DESC LIMIT :limit"
        )
        with engine.connect() as conn:
            result = conn.execute(sql, {"cutoff": cutoff, "limit": limit})
            # get mapping rows so columns can be accessed by name
            rows = result.mappings().fetchall()

        out = []
        for r in rows:
            event_time = r['event_time'] if 'event_time' in r.keys() else r[4]
            out.append({
                "id": r['id'] if 'id' in r.keys() else r[0],
                "employee_id": r['employee_id'] if 'employee_id' in r.keys() else r[1],
                "employee_name": None,
                "camera_id": r['camera_id'] if 'camera_id' in r.keys() else r[2],
                "time": event_time.isoformat() if event_time is not None else None,
                "event_type": r['event_type'] if 'event_type' in r.keys() else r[3],
            })

        return JSONResponse(out)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
