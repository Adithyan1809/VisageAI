import logging
from datetime import datetime

import asyncpg
from uuid import uuid4
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
try:
    from sqlalchemy.ext.asyncio import async_sessionmaker
except Exception:
    from sqlalchemy.orm import sessionmaker as _sessionmaker

    def async_sessionmaker(bind=None, **kwargs):
        # Compatibility shim: use regular sessionmaker with AsyncSession
        # Remove 'class_' from kwargs if present to avoid duplicate argument
        kwargs.pop('class_', None)
        return _sessionmaker(bind=bind, class_=AsyncSession, **kwargs)
from sqlalchemy import text as sa_text

from config import DB_URL, MAX_DB_CONNECTIONS

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


class DatabaseManager:
    def __init__(self, db_url=DB_URL, max_connections=MAX_DB_CONNECTIONS):
        self.db_url = db_url
        self.max_connections = max_connections
        self.pool = None
        # SQLAlchemy async engine + session (created on demand)
        self.sa_engine = None
        self.async_session = None

    # ==========================================================
    # DATABASE CONNECTION POOL
    # ==========================================================
    async def create_pool(self):
        if not self.pool:
            try:
                self.pool = await asyncpg.create_pool(
                    self.db_url, min_size=1, max_size=self.max_connections
                )
                logger.info("✅ Database connection pool created.")
            except Exception as e:
                logger.error(f"❌ Failed to create DB pool: {e}")
                raise

    # ==========================================================
    # FACE MATCHING — from facial_templates
    # ==========================================================
    async def query_best_match_unfiltered(self, embedding_str: str):
        if not self.pool:
            await self.create_pool()
        if not embedding_str.startswith('['):
            embedding_str = '[' + embedding_str
        if not embedding_str.endswith(']'):
            embedding_str += ']'

        sql = """
              SELECT employee_id,
                     person_id,
                     person_type,
                     name,
                1 - (template_data::vector <=> $1::vector) AS similarity
              FROM facial_templates
              WHERE is_active = true
              ORDER BY similarity DESC LIMIT 1;
              """

        async with self.pool.acquire() as conn:
            try:
                rec = await conn.fetchrow(sql, embedding_str)
                if rec:
                    return {
                        'empid': rec['employee_id'] or rec['person_id'],
                        'similarity': rec['similarity'],
                        'person_type': rec['person_type'],
                        'name': rec['name']
                    }
                else:
                    return None
            except Exception as e:
                logger.error(f"DB query_best_match_unfiltered() failed: {e}", exc_info=True)
                return None

    async def query_top_k_matches(self, embedding_str: str, k: int = 2):
        """Query top K matches for margin-based verification (prevents false positives)."""
        if not self.pool:
            await self.create_pool()
        if not embedding_str.startswith('['):
            embedding_str = '[' + embedding_str
        if not embedding_str.endswith(']'):
            embedding_str += ']'

        sql = f"""
              SELECT employee_id,
                     person_id,
                     person_type,
                     name,
                1 - (template_data::vector <=> $1::vector) AS similarity
              FROM facial_templates
              WHERE is_active = true
              ORDER BY similarity DESC LIMIT {k};
              """

        async with self.pool.acquire() as conn:
            try:
                recs = await conn.fetch(sql, embedding_str)
                matches = []
                for rec in recs:
                    matches.append({
                        'empid': rec['employee_id'] or rec['person_id'],
                        'similarity': rec['similarity'],
                        'person_type': rec['person_type'],
                        'name': rec['name']
                    })
                return matches if matches else []
            except Exception as e:
                logger.error(f"DB query_top_k_matches() failed: {e}", exc_info=True)
                return []

    # ==========================================================
    # EMPLOYEE CHECK
    # ==========================================================
    async def employee_exists(self, emp_id: str) -> bool:
        """Check if an employee exists in the employees table."""
        async with self.pool.acquire() as conn:
            # Accept either primary id or employee_code for lookups
            sql = "SELECT 1 FROM employees WHERE (id = $1 OR employee_code = $1) LIMIT 1;"

            try:
                record = await conn.fetchval(sql, emp_id)
                return bool(record)
            except Exception as e:
                logger.error(f"❌ Failed to check employee existence for {emp_id}: {e}")
                return False

    async def get_employee_name(self, emp_id: str):
        """Fetch the name of an existing employee."""
        async with self.pool.acquire() as conn:
            sql = "SELECT name FROM employees WHERE (id = $1 OR employee_code = $1) LIMIT 1;"

            try:
                result = await conn.fetchrow(sql, emp_id)
                return result['name'] if result else "NameNotFound"
            except Exception as e:
                logger.error(f"❌ Failed to get employee name for {emp_id}: {e}")
                return "NameLookupError"

    # ==========================================================
    # SQLAlchemy Async Engine / Session bootstrap (on-demand)
    # ==========================================================
    def create_sa_engine(self):
        """Create an async SQLAlchemy engine + session factory.

        This will convert a plain `postgresql://` URL into `postgresql+asyncpg://`
        so SQLAlchemy can use the asyncpg driver.
        """
        if not self.sa_engine:
            async_db_url = self.db_url
            if async_db_url.startswith("postgresql://"):
                async_db_url = async_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

            # create_async_engine is synchronous; it returns an AsyncEngine
            try:
                self.sa_engine = create_async_engine(
                    async_db_url,
                    pool_size=self.max_connections,
                    max_overflow=0,
                    echo=False,
                )
                self.async_session = async_sessionmaker(self.sa_engine, expire_on_commit=False, class_=AsyncSession)
                logger.info("✅ SQLAlchemy async engine + sessionmaker created.")
            except Exception as e:
                logger.error(f"❌ Failed to create SQLAlchemy async engine: {e}")
                raise

    # ==========================================================
    # Example: insert_attendance using SQLAlchemy AsyncSession
    # ==========================================================
    async def insert_attendance_sa(
            self, employee_id: str, employee_name: str, camera_id: str,
            timestamp=None, confidence: float = 0.0
    ) -> bool:
        """Example migrated function using SQLAlchemy AsyncSession.

        This function is provided as a drop-in example so callers can be
        migrated incrementally. The original `insert_attendance` using
        asyncpg is left untouched for compatibility.
        """
        if timestamp is None:
            timestamp = datetime.now()

        if not self.sa_engine or not self.async_session:
            self.create_sa_engine()

        async with self.async_session() as session:
            try:
                # employee exists check
                r = await session.execute(sa_text("SELECT 1 FROM employees WHERE (id = :id OR employee_code = :id) LIMIT 1"), {"id": employee_id})
                if r.scalar_one_or_none() is None:
                    logger.warning(f"⚠️ Skipping attendance for {employee_id}: Not found in 'employees' table.")
                    return False

                # zone lookup
                zone_id = None
                try:
                    zr = await session.execute(sa_text("SELECT zone_id FROM cameras WHERE id = :id"), {"id": camera_id})
                    zrow = zr.fetchone()
                    if zrow and zrow[0]:
                        zone_id = zrow[0]
                        logger.info(f"Found zone_id '{zone_id}' for camera '{camera_id}'")
                    else:
                        logger.warning(f"Could not find zone_id for camera '{camera_id}'. Defaulting to NULL.")
                except Exception as e:
                    logger.error(f"Failed to look up zone_id for camera '{camera_id}': {e}", exc_info=True)

                # canonical employee id
                cres = await session.execute(sa_text("SELECT id FROM employees WHERE (id = :id OR employee_code = :id) LIMIT 1"), {"id": employee_id})
                canonical_emp_id = cres.scalar_one_or_none()
                if not canonical_emp_id:
                    logger.warning(f"⚠️ Could not resolve canonical employee id for '{employee_id}' — skipping attendance.")
                    return False

                # insert attendance
                event_id = str(uuid4())
                insert_sql = sa_text(
                    """
                    INSERT INTO attendance_events (id, employee_id, camera_id, zone_id, shift_id, event_type,
                                                   event_time, verified_by, created_at)
                    VALUES (:id, :employee_id, :camera_id, :zone_id, NULL, 'IN', :event_time, 'face_recognition', NOW())
                    """
                )

                await session.execute(insert_sql, {"id": event_id, "employee_id": canonical_emp_id, "camera_id": camera_id, "zone_id": zone_id, "event_time": timestamp})
                await session.commit()
                logger.info(f"✅ Attendance (SA) marked for {employee_name} ({canonical_emp_id}) in zone {zone_id} (event_id={event_id})")
                return True
            except Exception as e:
                await session.rollback()
                logger.error(f"❌ Failed (SA) to insert attendance for {employee_id}: {e}", exc_info=True)
                return False

    # ==========================================================
    # INSERT / UPDATE EMBEDDINGS → facial_templates (SQLAlchemy)
    # ==========================================================
    async def insert_embedding_sa(self, emp_id, emp_name, camera_id, track_id, score, embedding_str, timestamp):
        """SQLAlchemy Async version of `insert_embedding`.

        Keeps behavior consistent with the asyncpg version but uses
        SQLAlchemy `AsyncSession` so callers can migrate incrementally.
        """
        if not self.sa_engine or not self.async_session:
            self.create_sa_engine()

        if not embedding_str.startswith('['):
            embedding_str = '[' + embedding_str
        if not embedding_str.endswith(']'):
            embedding_str += ']'

        async with self.async_session() as session:
            try:
                # employee exists check
                r = await session.execute(sa_text("SELECT 1 FROM employees WHERE (id = :id OR employee_code = :id) LIMIT 1"), {"id": emp_id})
                if r.scalar_one_or_none() is None:
                    logger.warning(f"⚠️ Skipping embedding update for {emp_id}: Not found in 'employees' table.")
                    return

                # check if existing template exists for this employee
                exists_r = await session.execute(sa_text("SELECT 1 FROM facial_templates WHERE employee_id = :id LIMIT 1"), {"id": emp_id})
                exists = exists_r.scalar_one_or_none() is not None

                if exists:
                    update_sql = sa_text(
                        """
                        UPDATE facial_templates
                        SET template_data = :emb ::vector,
                            name = :name,
                            created_at = NOW(),
                            is_active = true
                        WHERE employee_id = :id
                        """
                    )
                    await session.execute(update_sql, {"id": emp_id, "emb": embedding_str, "name": emp_name})
                    logger.info(f"🔁 (SA) Facial template updated for {emp_name} ({emp_id})")
                else:
                    insert_sql = sa_text(
                        """
                        INSERT INTO facial_templates (person_id, person_type, template_data,
                                                      version, model_version, created_at,
                                                      effective_from, is_active, employee_id, name)
                        VALUES (:id, 'employee', :emb ::vector, 1, 'arcface_r100_v1',
                                NOW(), NOW(), true, :id, :name)
                        """
                    )
                    await session.execute(insert_sql, {"id": emp_id, "emb": embedding_str, "name": emp_name})
                    logger.info(f"✅ (SA) Facial template inserted for {emp_name} ({emp_id})")

                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"❌ (SA) Failed to insert/update embedding for {emp_id}: {e}", exc_info=True)
                return

    # ==========================================================
    # INSERT / UPDATE EMBEDDINGS → facial_templates
    # ==========================================================
    async def insert_embedding(self, emp_id, emp_name, camera_id, track_id, score, embedding_str, timestamp):
        if not self.pool:
            await self.create_pool()

        if not embedding_str.startswith('['):
            embedding_str = '[' + embedding_str
        if not embedding_str.endswith(']'):
            embedding_str += ']'

        # --- FIX: Re-added the employee_exists check ---
        # This is required by your database's foreign key rules
        exists = await self.employee_exists(emp_id)
        if not exists:
            logger.warning(f"⚠️ Skipping embedding update for {emp_id}: Not found in 'employees' table.")
            return

        async with self.pool.acquire() as conn:
            # First attempt to update any existing template for this employee
            update_sql = """
                UPDATE facial_templates
                SET template_data = $2::vector,
                    name = $3,
                    created_at = NOW(),
                    is_active = true
                WHERE employee_id = $1
            """

            insert_sql = """
                INSERT INTO facial_templates (person_id, person_type, template_data,
                                              version, model_version, created_at,
                                              effective_from, is_active, employee_id, name)
                VALUES ($1, 'employee', $2::vector, 1, 'arcface_r100_v1',
                        NOW(), NOW(), true, $1, $3)
            """

            try:
                exists = await conn.fetchval("SELECT 1 FROM facial_templates WHERE employee_id = $1 LIMIT 1", emp_id)
                if exists:
                    await conn.execute(update_sql, emp_id, embedding_str, emp_name)
                    logger.info(f"🔁 Facial template updated for {emp_name} ({emp_id})")
                else:
                    await conn.execute(insert_sql, emp_id, embedding_str, emp_name)
                    logger.info(f"✅ Facial template inserted for {emp_name} ({emp_id})")
            except Exception as e:
                logger.error(f"❌ Failed to insert/update embedding for {emp_id}: {e}", exc_info=True)

    # ==========================================================
    # ATTENDANCE MARKING → attendance_events (FIXED)
    # ==========================================================
    async def insert_attendance(
            self, employee_id: str, employee_name: str, camera_id: str,
            timestamp=None, confidence: float = 0.0
    ) -> bool:
        if timestamp is None:
            timestamp = datetime.now()

        async with self.pool.acquire() as conn:

            # --- FIX 1: Re-add the employee_exists check ---
            # This is required by your database's foreign key rules
            exists = await self.employee_exists(employee_id)
            if not exists:
                logger.warning(f"⚠️ Skipping attendance for {employee_id}: Not found in 'employees' table.")
                return False

            # --- FIX 2: Get the zone_id from the camera ---
            zone_id = None  # Default to NULL
            try:
                # Look up zone_id from the cameras table
                zone_lookup_sql = "SELECT zone_id FROM cameras WHERE id = $1"
                zone_rec = await conn.fetchrow(zone_lookup_sql, camera_id)
                if zone_rec and zone_rec['zone_id']:
                    zone_id = zone_rec['zone_id']
                    logger.info(f"Found zone_id '{zone_id}' for camera '{camera_id}'")
                else:
                    logger.warning(f"Could not find zone_id for camera '{camera_id}'. Defaulting to NULL.")
            except Exception as e:
                logger.error(f"Failed to look up zone_id for camera '{camera_id}': {e}", exc_info=True)
            # --- END FIX 2 ---

            # Resolve canonical employee id (accept either id or employee_code)
            try:
                canonical_emp_id = await conn.fetchval(
                    "SELECT id FROM employees WHERE (id = $1 OR employee_code = $1) LIMIT 1",
                    employee_id,
                )
                if not canonical_emp_id:
                    logger.warning(f"⚠️ Could not resolve canonical employee id for '{employee_id}' — skipping attendance.")
                    return False
            except Exception as e:
                logger.error(f"❌ Failed to resolve canonical employee id for {employee_id}: {e}", exc_info=True)
                return False

            # --- Insert attendance matching the `attendance_events` model ---
            # The table requires an explicit `id` (string PK) so generate a UUID here.
            event_id = str(uuid4())
            sql = """
                  INSERT INTO attendance_events (id, employee_id, camera_id, zone_id, shift_id, event_type,
                                                 event_time, verified_by, created_at)
                  VALUES ($1, $2, $3, $4, NULL, 'IN', $5, 'face_recognition', NOW());
                  """

            try:
                await conn.execute(sql, event_id, canonical_emp_id, camera_id, zone_id, timestamp)
                logger.info(f"✅ Attendance marked for {employee_name} ({canonical_emp_id}) in zone {zone_id} (event_id={event_id})")
                return True
            except Exception as e:
                logger.error(f"❌ Failed to insert attendance for {employee_id}: {e}", exc_info=True)
                return False

    # ==========================================================
    # ALERT INSERTION → alert_actions
    # ==========================================================
    async def insert_alert(
            self, camera_id: str, track_id, timestamp: float,
            reason: str = "Unrecognized face detected"
    ):
        """Inserts an alert record when an unknown face is detected."""
        if not self.pool:
            await self.create_pool()
        async with self.pool.acquire() as conn:
            # Generate a primary key for the alert action row (models expect `id` PK)
            action_id = str(uuid4())
            alert_id = str(uuid4())

            # Create a minimal parent alert row so the FK constraint is satisfied
            alert_sql = """
                INSERT INTO alerts (id, event_type, event_id, severity, status, raised_by, raised_at, comments)
                VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8)
                ON CONFLICT DO NOTHING;
            """

            action_sql = """
                INSERT INTO alert_actions (id, alert_id, user_id, action_type, action_time, comments)
                VALUES ($1, $2, 'system', 'alert', to_timestamp($3), $4);
            """

            try:
                # Ensure the 'system' user exists so raised_by FK does not fail
                system_user_id = 'system'
                user_exists = await conn.fetchval("SELECT 1 FROM users WHERE id = $1 LIMIT 1", system_user_id)
                if not user_exists:
                    try:
                        await conn.execute(
                            "INSERT INTO users (id, username, created_at) VALUES ($1, $2, to_timestamp($3))",
                            system_user_id, 'System', timestamp
                        )
                        logger.info("Created minimal 'system' user for alerting")
                    except Exception:
                        # If creation fails, fall back to NULL raised_by by inserting alert with NULL
                        logger.warning("Failed to create 'system' user; will insert alert with NULL raised_by")
                        await conn.execute(
                            "INSERT INTO alerts (id, event_type, event_id, severity, status, raised_by, raised_at, comments) VALUES ($1, $2, $3, $4, $5, NULL, to_timestamp($6), $7) ON CONFLICT DO NOTHING;",
                            alert_id, 'unrecognized_face', str(track_id), 'low', 'open', timestamp, reason
                        )
                    else:
                        await conn.execute(alert_sql, alert_id, 'unrecognized_face', str(track_id), 'low', 'open', system_user_id, timestamp, reason)
                else:
                    await conn.execute(alert_sql, alert_id, 'unrecognized_face', str(track_id), 'low', 'open', system_user_id, timestamp, reason)
                await conn.execute(action_sql, action_id, alert_id, timestamp, reason)
                logger.info(f"🚨 Created alert {alert_id} and action {action_id} for track {track_id} (camera={camera_id})")
            except Exception as e:
                logger.error(f"❌ Failed to insert alert/action: {e}", exc_info=True)


def get_db_manager():
    return DatabaseManager()