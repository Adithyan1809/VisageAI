from fastapi import APIRouter, HTTPException
import psycopg2

router = APIRouter()


@router.post("/connect-db")
def connect_db(payload: dict):
    """Try to connect to a Postgres instance with provided config (for UI diagnostics).
    Payload: { host, port, database, user, password }
    Note: this does not change the server's main DB connection settings.
    """
    host = payload.get("host")
    port = payload.get("port")
    database = payload.get("database")
    user = payload.get("user")
    password = payload.get("password")

    if not host or not port or not database or not user:
        raise HTTPException(status_code=400, detail={"message": "Missing connection parameters"})

    dsn = f"host={host} port={port} dbname={database} user={user} password={password}"
    try:
        conn = psycopg2.connect(dsn, connect_timeout=5)
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail={"message": str(e)})

    return {"connected": True}
