from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid, datetime

from app.config.session import get_db
from app.attendance import models as attendance_models
from app.services.attendance_broadcaster import publish

router = APIRouter()

class RecognitionEvent(BaseModel):
    employee_id: str
    camera_id: str
    similarity: float
    track_id: int | None = None
    frame_path: str | None = None

@router.post("/recognition-event")
async def receive_event(event: RecognitionEvent, db: Session = Depends(get_db)):

    now = datetime.datetime.utcnow()
    att_id = str(uuid.uuid4())

    att = attendance_models.AttendanceEvent(
        id=att_id,
        employee_id=event.employee_id,
        camera_id=event.camera_id,
        event_type="face_recognized",
        event_time=now,
        created_at=now,
    )

    db.add(att)
    db.commit()

    # Broadcast through SSE
    await publish({
        "attendance_id": att_id,
        "employee_id": event.employee_id,
        "camera_id": event.camera_id,
        "similarity": event.similarity,
        "track_id": event.track_id,
        "time": now.isoformat()
    })

    return {"status": "ok", "attendance_id": att_id}
