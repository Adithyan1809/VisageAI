# backend/app/api/attendance.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
import json
import asyncio
from datetime import datetime, timedelta

from app.services.attendance_broadcaster import listen
from app.config.session import get_db
from app.attendance import models as attendance_models

router = APIRouter()


async def sse_generator():
    # starts listening to the broadcaster
    async for ev in _async_listen():
        yield f"data: {json.dumps(ev)}\n\n"


# Helper to adapt listen() (which yields dicts)
async def _async_listen():
    listener = listen()
    # listen() returns an async generator-like via yield; but our implementation uses await queue.get()
    # So call it repeatedly in a loop
    while True:
        ev = await listener.__anext__() if hasattr(listener, "__anext__") else await listener  # fallback
        yield ev


@router.get("/stream")
def stream():
    # returns an SSE stream
    return StreamingResponse(sse_generator(), media_type="text/event-stream")


@router.get("/recent")
def recent_attendance(hours: int = 24, limit: int = 200, db=Depends(get_db)):
    """Return recent attendance events for the last `hours` hours (default 24).

    This endpoint is used by the UI to initialize the Recent Attendance table.
    OPTIMIZED: Uses eager loading (selectinload) to avoid N+1 queries.
    """
    try:
        from sqlalchemy.orm import selectinload
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        # Eagerly load relationships to avoid N+1 queries
        q = db.query(attendance_models.AttendanceEvent)\
            .options(selectinload(attendance_models.AttendanceEvent.employee),
                     selectinload(attendance_models.AttendanceEvent.camera))\
            .filter(attendance_models.AttendanceEvent.event_time >= cutoff)\
            .order_by(attendance_models.AttendanceEvent.event_time.desc())\
            .limit(limit)
        rows = q.all()

        out = []
        for r in rows:
            out.append({
                "id": r.id,
                "employee_id": r.employee_id,
                "employee_name": r.employee.name if r.employee else None,
                "camera_id": r.camera_id,
                "camera_name": r.camera.name if r.camera else None,
                "time": r.event_time.isoformat() if r.event_time else None,
                "event_type": r.event_type,
            })

        return JSONResponse(out)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
