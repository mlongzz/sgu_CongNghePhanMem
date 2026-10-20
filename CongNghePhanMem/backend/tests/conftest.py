import os

if os.getenv("TEST_POSTGRES") == "1":
    from dotenv import load_dotenv
    load_dotenv(".env")

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
    if os.getenv("TEST_POSTGRES") == "1":
        # Every test owns an uncommitted schema. Outer rollback removes only its test data.
        import uuid
        from sqlalchemy import text
        from app.database import engine as configured_engine
        if configured_engine.dialect.name != "postgresql":
            pytest.fail("TEST_POSTGRES requires PostgreSQL")
        with configured_engine.connect() as connection:
            transaction = connection.begin()
            schema = "test_admin_" + uuid.uuid4().hex
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            Base.metadata.create_all(connection)
            session = sessionmaker(bind=connection, join_transaction_mode="create_savepoint")()
            try:
                yield session
            finally:
                session.close()
                transaction.rollback()
        return
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
