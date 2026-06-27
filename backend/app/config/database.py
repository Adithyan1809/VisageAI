import os
import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import QueuePool
from dotenv import load_dotenv

load_dotenv()

DB_USER     = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST     = os.getenv("DB_HOST", "localhost")
DB_PORT     = os.getenv("DB_PORT", "5432")
DB_NAME     = os.getenv("DB_NAME", "SMAP_DB")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_engine(
    DATABASE_URL,
    echo=False,
    poolclass=QueuePool,
    pool_size=20,
    max_overflow=10,
    pool_recycle=3600,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 10},
)

Base = declarative_base()


def get_current_utc():
    return datetime.datetime.utcnow()
