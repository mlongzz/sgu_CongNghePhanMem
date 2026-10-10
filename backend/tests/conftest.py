import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./pytest_multilingual_guide.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-local-test-suite-only")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:8081")
os.environ.setdefault("ADMIN_USER_IDS", "")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import audio_session, favorite, guide_content, history, place, review, user  # noqa: F401


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
