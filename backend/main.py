import uvicorn
import logging
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from sqlalchemy import text

# lightweight import for DB usage in a helper route
from app.config.session import get_db
from app.config.database import engine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import the routers from the folder structure
from app.api import (
    cameras, 
    employees, 
    organization,
    facial_templates, 
    onvif, 
    attendance, 
    shifts, 
    assignments,
    db_probe,
    pipeline,
    face_enrollment,

)

# lightweight dev-only attendance reader (raw SQL)
from app.api import dev_attendance

# Ensure core model classes are imported so SQLAlchemy mappers initialize in the correct order
import app.organization.models  # registers `Site` and related models

app = FastAPI(title="SMAP Backend API", version="1.0.0-optimized")

# CORS for your Next.js UI (Port 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(cameras.router, prefix="/api/cameras", tags=["Cameras"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(organization.router, prefix="/api/organization", tags=["Organization"])
app.include_router(facial_templates.router, prefix="/api/facial-templates", tags=["Facial Templates"])
app.include_router(assignments.router, prefix="/api/assignments", tags=["Assignments"])
app.include_router(db_probe.router, prefix="/api", tags=["DB"])
app.include_router(onvif.router, prefix="/api/onvif", tags=["ONVIF"])
app.include_router(attendance.router, prefix="/api/attendance", tags=["Attendance"])
app.include_router(dev_attendance.router, prefix="/api/dev/attendance", tags=["DevAttendance"]) 
app.include_router(shifts.router, prefix="/api/shifts", tags=["Shifts"])
app.include_router(pipeline.router, prefix="/api/pipeline", tags=["ML Pipeline"])
app.include_router(face_enrollment.router, prefix="/api/face-enrollment", tags=["Face Enrollment"])


@app.get("/")
def home():
    return {"status": "SMAP Backend Running", "version": "1.0"}

if __name__ == "__main__":
    # Run on port 8081 to match your frontend api.js
    # Use reload=False when running in background to avoid reloader lifecycle issues
    uvicorn.run("main:app", host="0.0.0.0", port=8081, reload=False)

# register employee broadcaster after app created so it starts on startup
try:
    employees.register_broadcaster(app)
except Exception:
    pass


# Fallback recent attendance route in case the API module isn't registered correctly
@app.get("/api/attendance/recent")
def recent_attendance_api(hours: int = 24, limit: int = 200, db=Depends(get_db)):
    """Return recent attendance using a lightweight raw SQL query to avoid importing ORM mappers at module import time."""
    try:
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        sql = (
            "SELECT id, employee_id, camera_id, event_type, event_time "
            "FROM attendance_events "
            "WHERE event_time >= :cutoff "
            "ORDER BY event_time DESC "
            "LIMIT :limit"
        )
        result = db.execute(sql, {"cutoff": cutoff, "limit": limit})
        rows = result.fetchall()

        out = []
        for r in rows:
            # r is a SQLAlchemy Row; access by index or key
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
        logger.error(f"Error fetching recent attendance: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)
@app.on_event("startup")
async def create_performance_indexes():
    """Create critical performance indexes on application startup."""
    try:
        with engine.begin() as conn:
            indexes = [
                "CREATE INDEX IF NOT EXISTS idx_attendance_event_time ON attendance_events(event_time DESC)",
                "CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance_events(employee_id)",
                "CREATE INDEX IF NOT EXISTS idx_attendance_camera_id ON attendance_events(camera_id)",
                "CREATE INDEX IF NOT EXISTS idx_attendance_zone_id ON attendance_events(zone_id)",
                "CREATE INDEX IF NOT EXISTS idx_attendance_time_employee ON attendance_events(event_time DESC, employee_id)",
                "CREATE INDEX IF NOT EXISTS idx_employees_updated_at ON employees(updated_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_cameras_updated_at ON cameras(updated_at DESC)",
                "CREATE INDEX IF NOT EXISTS idx_attendance_event_type ON attendance_events(event_type)",
            ]
            for idx_sql in indexes:
                try:
                    conn.execute(text(idx_sql))
                except Exception as idx_err:
                    logger.debug(f"Index creation: {idx_err}")
            conn.commit()
            logger.info("✓ Performance indexes created/verified")
    except Exception as e:
        logger.warning(f"Startup index creation: {e}")
        logger.warning(f"Startup index creation: {e}")