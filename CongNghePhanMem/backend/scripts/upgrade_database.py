"""Review schema by default. --apply backs up PostgreSQL before upgrading Alembic."""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app.database import engine
from scripts.check_baseline import check


def find_pg_dump() -> str:
    found = shutil.which("pg_dump")
    if found:
        return found
    parent = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "PostgreSQL"
    candidates = sorted(parent.glob("*/bin/pg_dump.exe"), reverse=True)
    if not candidates:
        raise RuntimeError("pg_dump is required for the backup. No schema changes made.")
    return str(candidates[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Back up then apply migrations to the configured PostgreSQL database")
    args = parser.parse_args()
    with engine.connect() as connection:
        tables = inspect(connection).get_table_names()
        legacy = "alembic_version" not in tables
        revision = None if legacy else connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        has_role = "role" in {col["name"] for col in inspect(connection).get_columns("users")} if "users" in tables else False
    print(f"Current revision: {revision or 'legacy/empty'}; users.role present: {has_role}")
    if legacy and tables and check() != 0:
        raise RuntimeError("Baseline mismatch. Review before migration. No schema changes made.")
    print("Plan: backup; " + ("stamp 0001; " if legacy and tables else "") + "upgrade head; verify revision.")
    if not args.apply:
        print("Read-only review complete. Run with --apply only after authorizing this database change.")
        return
    if engine.dialect.name != "postgresql":
        raise RuntimeError("This backup workflow requires PostgreSQL. No schema changes made.")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = Path(__file__).resolve().parents[1] / ".backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"before-upgrade-{timestamp}.dump"
    url = engine.url
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    result = subprocess.run([find_pg_dump(), "--format=custom", "--no-password", "--file", str(backup),
                             "--host", url.host or "localhost", "--port", str(url.port or 5432),
                             "--username", url.username or "postgres", url.database or "postgres"],
                            env=env, capture_output=True, text=True)
    if result.returncode != 0 or not backup.exists() or backup.stat().st_size == 0:
        raise RuntimeError("Database backup failed. No schema changes made. Check pg_dump version and database access.")
    print(f"Backup saved: {backup.name}")
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    head = ScriptDirectory.from_config(config).get_current_head()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        if legacy and tables:
            command.stamp(config, "0001")
        command.upgrade(config, "head")
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        if revision != head:
            raise RuntimeError("Unexpected migration revision; transaction rolled back.")
    print(f"Migration completed and verified: {head}.")


if __name__ == "__main__":
    main()
