import os
import uvicorn
import logging
import asyncio
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv()

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

# Auth router + dependency
from app.auth import router as auth_router_module
from app.auth.dependencies import get_current_user, require_admin

# Dev-only attendance reader — only mounted when APP_ENV=development
from app.api import dev_attendance

# Ensure core model classes are imported so SQLAlchemy mappers initialize correctly
import app.organization.models  # registers `Site` and related models
import app.auth.models          # registers AdminUser + RefreshToken

app = FastAPI(title="SMAP Backend API", version="1.0.0")

# ── CORS ────────────────────────────────────────────────────────────────────
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOW_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Public routes (no auth required) ────────────────────────────────────────
app.include_router(auth_router_module.router, prefix="/api/auth", tags=["Authentication"])

# ── Protected routes (JWT required) ─────────────────────────────────────────
_auth = [Depends(get_current_user)]

app.include_router(cameras.router,          prefix="/api/cameras",          tags=["Cameras"],           dependencies=_auth)
app.include_router(employees.router,        prefix="/api/employees",        tags=["Employees"],         dependencies=_auth)
app.include_router(organization.router,     prefix="/api/organization",     tags=["Organization"],      dependencies=_auth)
app.include_router(facial_templates.router, prefix="/api/facial-templates", tags=["Facial Templates"],  dependencies=_auth)
app.include_router(assignments.router,      prefix="/api/assignments",      tags=["Assignments"],       dependencies=_auth)
app.include_router(onvif.router,            prefix="/api/onvif",            tags=["ONVIF"],             dependencies=_auth)
app.include_router(attendance.router,       prefix="/api/attendance",       tags=["Attendance"],        dependencies=_auth)
app.include_router(shifts.router,           prefix="/api/shifts",           tags=["Shifts"],            dependencies=_auth)
app.include_router(pipeline.router,         prefix="/api/pipeline",         tags=["ML Pipeline"],       dependencies=_auth)
app.include_router(face_enrollment.router,  prefix="/api/face-enrollment",  tags=["Face Enrollment"],   dependencies=_auth)

# ── Admin-only routes ────────────────────────────────────────────────────────
_admin = [Depends(require_admin)]
app.include_router(db_probe.router,         prefix="/api",                  tags=["DB"],                dependencies=_admin)

# ── Dev-only routes (only mounted in development) ────────────────────────────
if os.getenv("APP_ENV", "production") == "development":
    app.include_router(dev_attendance.router, prefix="/api/dev/attendance", tags=["DevAttendance"])
    logger.warning("⚠ Dev attendance routes mounted — do not run in production!")


@app.get("/")
def home():
    return {"status": "SMAP Backend Running", "version": "1.0"}


@app.get("/health")
def health_check(db=Depends(get_db)):
    """Health check — verifies DB and reports Redis status."""
    # DB check
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:
        logger.error(f"Health check DB error: {e}")
        db_ok = False

    # Redis check
    try:
        import redis as _redis
        r = _redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))
        r.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    status = "ok" if db_ok else "degraded"
    return JSONResponse(
        {"status": status, "db": db_ok, "redis": redis_ok},
        status_code=200 if db_ok else 503,
    )


if __name__ == "__main__":
    port = int(os.getenv("BACKEND_PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

# register employee broadcaster after app created so it starts on startup
try:
    employees.register_broadcaster(app)
except Exception as e:
    logger.warning(f"Employee broadcaster registration failed: {e}")


@app.on_event("startup")
async def create_performance_indexes():
    """Create critical performance indexes and auth tables on application startup."""
    # Ensure auth tables exist (admin_users, refresh_tokens)
    try:
        from app.config.database import Base
        import app.auth.models  # noqa: ensure models are registered
        Base.metadata.create_all(bind=engine)
        logger.info("✓ Auth tables created/verified (admin_users, refresh_tokens)")
    except Exception as e:
        logger.warning(f"Auth table creation: {e}")

    # Create performance indexes for attendance data
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