"""Upgrade tests use isolated schemas/connections, never the application schema."""
import os
import uuid

from sqlalchemy import create_engine, inspect, text
from alembic import command
from alembic.config import Config
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from app.database import Base


def test_upgrade_fresh_database():
    if os.getenv("TEST_POSTGRES") == "1":
        from app.database import engine
    else:
        engine = create_engine("sqlite://")
    with engine.connect() as connection:
        transaction = connection.begin()
        if engine.dialect.name == "postgresql":
            schema = "test_migration_" + uuid.uuid4().hex
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        config = Config("alembic.ini")
        config.attributes['connection'] = connection
        try:
            command.upgrade(config, 'head')
            inspector = inspect(connection)
            assert {'users', 'places', 'journeys', 'journey_stops', 'audit_logs', 'admin_settings'} <= set(inspector.get_table_names())
            assert 'role' in {c['name'] for c in inspector.get_columns('users')}
            assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar() == '0003'
            command.upgrade(config, 'head')  # idempotent
            assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        finally:
            transaction.rollback()


def test_upgrade_existing_baseline_preserves_data():
    engine = create_engine('sqlite://')
    with engine.connect() as connection:
        config = Config('alembic.ini')
        config.attributes['connection'] = connection
        command.upgrade(config, '0001')
        connection.execute(text("INSERT INTO users (email, password_hash, full_name) VALUES ('keep@example.com', 'hash', 'Keep')"))
        connection.execute(text("INSERT INTO places (name, latitude, longitude, image_url) VALUES ('Keep place', 10, 106, '/media/existing.jpg')"))
        connection.execute(text("INSERT INTO guide_contents (place_id, language_code, title, content) VALUES (1, 'vi', 'Keep title', 'Keep narration')"))
        command.upgrade(config, 'head')
        assert connection.execute(text('SELECT full_name, role FROM users')).one() == ('Keep', 'user')
        assert connection.execute(text('SELECT name, latitude, longitude, image_url, publication_status, deleted_at FROM places')).one() == ('Keep place', 10, 106, '/media/existing.jpg', 'published', None)
        assert connection.execute(text('SELECT title, content, publication_status FROM guide_contents')).one() == ('Keep title', 'Keep narration', 'published')


def test_adopt_existing_admin_tables_preserves_data():
    from app.models.admin import AdminSetting, AuditLog, Journey, JourneyStop
    engine = create_engine('sqlite://')
    with engine.connect() as connection:
        config = Config('alembic.ini')
        config.attributes['connection'] = connection
        command.upgrade(config, '0001')
        for model in (Journey, JourneyStop, AuditLog, AdminSetting):
            model.__table__.create(connection)
        connection.execute(text("INSERT INTO journeys (name, description) VALUES ('Keep journey', 'Existing')"))
        command.upgrade(config, 'head')
        assert connection.execute(text('SELECT name FROM journeys')).scalar() == 'Keep journey'
