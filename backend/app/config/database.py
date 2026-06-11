from sqlalchemy.orm import declarative_base
from sqlalchemy import create_engine
from sqlalchemy.pool import QueuePool
import datetime

# Adjust to your actual DB credentials
DB_USER = "postgres"
DB_PASSWORD = "root"
DB_HOST = "localhost"
DB_PORT = "5432"
DB_NAME = "SMAP_DB"

DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(
    DATABASE_URL,
    echo=False,  # Optimized: disable verbose logging for performance
    poolclass=QueuePool,
    pool_size=20,  # Connection pool size
    max_overflow=10,  # Max overflow connections
    pool_recycle=3600,  # Recycle stale connections
    pool_pre_ping=True,  # Test connections before use
    connect_args={'connect_timeout': 10}
)

Base = declarative_base()

def get_current_utc():
    return datetime.datetime.utcnow()
