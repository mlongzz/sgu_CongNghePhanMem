"""
Database engine and session factory.
DATABASE_URL is loaded from the .env file via app.config.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
import os

from app.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1),
    pool_pre_ping=True,   # detect stale connections automatically
    pool_size=max(1,min(20,int(os.getenv('DB_POOL_SIZE','5')))),
    max_overflow=max(0,min(20,int(os.getenv('DB_MAX_OVERFLOW','5')))),
    pool_timeout=15,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a DB session and closes it when done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
