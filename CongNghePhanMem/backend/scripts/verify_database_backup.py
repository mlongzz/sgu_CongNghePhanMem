"""Verify a PostgreSQL backup and migration on a disposable restored database.

The configured application database is read only throughout this command.
Only a generated multilingual_guide_restore_<uuid> database is created/dropped.
No passwords, connection URLs or stored row contents are printed.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import uuid

from alembic import command
from alembic.config import Config
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL

from app.database import Base, engine
from scripts.upgrade_database import find_pg_dump

ROOT = Path(__file__).resolve().parents[1]


class BackupVerificationError(RuntimeError):
    """Expose a bounded diagnostic without rendering SQLAlchemy URLs or params."""
    def __init__(self, phase, error):
        super().__init__("Backup verification failed")
        self.phase = phase
        self.error_type = type(error).__name__
        original = getattr(error, "orig", error)
        self.sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
        self.message_primary = getattr(getattr(original, "diag", None), "message_primary", None)


def failure_report(error):
    result = {"verified": False, "phase": getattr(error, "phase", "backup_creation"),
              "error_type": getattr(error, "error_type", type(error).__name__),
              "application_database_migrated": False}
    if getattr(error, "sqlstate", None):
        result["sqlstate"] = error.sqlstate
    if getattr(error, "message_primary", None):
        result["message_primary"] = error.message_primary[:300].replace("\n", " ")
    return result


def snapshot(database_engine, columns=None):
    """Fingerprint complete original rows without exposing their contents."""
    result = {}
    with database_engine.connect() as connection, connection.begin():
        connection.execute(text("SET TRANSACTION READ ONLY"))
        connection.execute(text("SET LOCAL statement_timeout = 10000"))
        inspector = inspect(connection)
        if columns is None:
            columns = {table: [c["name"] for c in inspector.get_columns(table)]
                       for table in inspector.get_table_names() if table != "alembic_version"}
        quote = database_engine.dialect.identifier_preparer.quote
        for table, names in sorted(columns.items()):
            rows = connection.execute(text("SELECT " + ", ".join(quote(name) for name in names) + " FROM " + quote(table)))
            encoded = sorted(json.dumps(list(row), ensure_ascii=True, default=str, separators=(",", ":")) for row in rows)
            result[table] = {"count": len(encoded), "sha256": hashlib.sha256("\n".join(encoded).encode()).hexdigest()}
    return {"columns": columns, "tables": result}


def pg_command(executable, args, database_engine):
    url = database_engine.url
    environment = {**os.environ, "PGPASSWORD": url.password or ""}
    result = subprocess.run([str(executable), "--no-password", "--host", url.host or "localhost",
                             "--port", str(url.port or 5432), "--username", url.username or "postgres", *args],
                            env=environment, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f"{Path(executable).name} failed; no application migration was applied")
    return result


def create_backup(database_engine):
    if database_engine.dialect.name != "postgresql":
        raise RuntimeError("Backup verification requires PostgreSQL")
    directory = ROOT / ".backups"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = directory / f"verified-before-upgrade-{stamp}.dump"
    pg_command(find_pg_dump(), ["--format=custom", "--file", str(backup), database_engine.url.database], database_engine)
    if not backup.is_file() or not backup.stat().st_size:
        raise RuntimeError("Empty backup; application migration refused")
    return backup


@contextmanager
def disposable_cluster():
    """Own a private local PostgreSQL process; no application DB privileges change."""
    binaries = Path(find_pg_dump()).parent
    suffix = ".exe" if os.name == "nt" else ""
    root = (ROOT / ".test-artifacts" / ("postgres_restore_" + uuid.uuid4().hex)).resolve()
    expected_parent = (ROOT / ".test-artifacts").resolve()
    if root.parent != expected_parent or not re.fullmatch(r"postgres_restore_[a-f0-9]{32}", root.name):
        raise RuntimeError("Unsafe disposable cluster path")
    root.mkdir(parents=True, exist_ok=False)
    password = uuid.uuid4().hex + uuid.uuid4().hex
    password_file = root / "initial-password"
    password_file.write_text(password, encoding="ascii")
    options = {"text": True, "timeout": 120}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW

    def run(program, args):
        # PostgreSQL child processes must not inherit a PIPE that keeps
        # communicate() waiting after pg_ctl itself has already exited.
        with (root / "commands.log").open("a", encoding="utf-8") as log:
            result = subprocess.run([str(binaries / (program + suffix)), *args], stdout=log,
                                    stderr=subprocess.STDOUT, **options)
        if result.returncode:
            raise RuntimeError(f"Disposable PostgreSQL {program} failed")

    started = False
    admin = None
    try:
        run("initdb", ["--pgdata", str(root / "data"), "--username", "backup_verifier",
                       "--auth", "scram-sha-256", "--pwfile", str(password_file), "--encoding", "UTF8", "--no-locale"])
        password_file.unlink()
        with socket.socket() as port_probe:
            port_probe.bind(("127.0.0.1", 0))
            port = port_probe.getsockname()[1]
        started = True
        run("pg_ctl", ["--pgdata", str(root / "data"), "--log", str(root / "server.log"),
                       "--options", f"-h 127.0.0.1 -p {port}", "--wait", "start"])
        admin = create_engine(URL.create(engine.url.drivername, username="backup_verifier", password=password,
                                         host="127.0.0.1", port=port, database="postgres"))
        yield admin
    finally:
        if password_file.exists():
            password_file.unlink()
        if admin is not None:
            admin.dispose()
        if started:
            run("pg_ctl", ["--pgdata", str(root / "data"), "--mode", "fast", "--wait", "stop"])
        # Retain the exact owned directory in ignored test artifacts for review.


def verify_backup(database_engine, backup, restore_admin_engine=None):
    if database_engine.dialect.name != "postgresql":
        raise RuntimeError("Backup verification requires PostgreSQL")
    backup = Path(backup).resolve(strict=True)
    restore = Path(find_pg_dump()).with_name("pg_restore.exe" if os.name == "nt" else "pg_restore")
    # A readable table-of-contents is necessary, but a full restore below is
    # what proves that the stored data can actually be recovered.
    listing = subprocess.run([str(restore), "--list", str(backup)], capture_output=True, text=True, timeout=30)
    if listing.returncode:
        raise RuntimeError("Backup archive is unreadable; no application migration was applied")
    before = snapshot(database_engine)
    name = "multilingual_guide_restore_" + uuid.uuid4().hex
    if not re.fullmatch(r"multilingual_guide_restore_[a-f0-9]{32}", name) or name == database_engine.url.database:
        raise RuntimeError("Unsafe disposable database target")
    restore_url = (restore_admin_engine or database_engine).url
    admin_engine = create_engine(restore_url, isolation_level="AUTOCOMMIT")
    clone_engine = create_engine(restore_url.set(database=name), pool_pre_ping=True)
    created = False
    phase = "create_disposable_database"
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}" TEMPLATE template0'))
            created = True
        phase = "restore_archive"
        pg_command(restore, ["--dbname", name, "--exit-on-error", "--no-owner", "--no-privileges", str(backup)], admin_engine)
        phase = "compare_restored_rows"
        restored = snapshot(clone_engine, before["columns"])
        if restored != before:
            raise RuntimeError("Restored rows differ from the source; stop and review concurrent writes")
        config = Config(str(ROOT / "alembic.ini"))
        phase = "migration_transaction_rollback"
        with clone_engine.connect() as connection:
            baseline_tables = set(inspect(connection).get_table_names())
            baseline_columns = {table: [col['name'] for col in inspect(connection).get_columns(table)] for table in baseline_tables}
            connection.rollback()
            transaction = connection.begin()
            config.attributes["connection"] = connection
            if "alembic_version" not in baseline_tables:
                command.stamp(config, "0001")
            command.upgrade(config, "head")
            transaction.rollback()
            if set(inspect(connection).get_table_names()) != baseline_tables:
                raise RuntimeError("PostgreSQL DDL transaction did not roll back")
            if any([col['name'] for col in inspect(connection).get_columns(table)] != names for table, names in baseline_columns.items()):
                raise RuntimeError("PostgreSQL column additions did not roll back")
        if snapshot(clone_engine, before["columns"]) != before:
            raise RuntimeError("Migration rollback changed original data")
        phase = "migration_apply_and_schema_compare"
        with clone_engine.begin() as connection:
            config.attributes["connection"] = connection
            if "alembic_version" not in inspect(connection).get_table_names():
                command.stamp(config, "0001")
            command.upgrade(config, "head")
            if compare_metadata(MigrationContext.configure(connection), Base.metadata):
                raise RuntimeError("Migrated schema differs from application models")
        if snapshot(clone_engine, before["columns"]) != before:
            raise RuntimeError("Migration changed existing row values")
        phase = "source_preservation"
        if snapshot(database_engine, before["columns"]) != before:
            raise RuntimeError("Source changed while verification ran; review and repeat")
        report = {"verified_at": datetime.now(timezone.utc).isoformat(), "backup": backup.name,
                  "restore_environment": "disposable_local_cluster" if restore_admin_engine is not None else "application_server_disposable_database",
                  "backup_bytes": backup.stat().st_size, "backup_sha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
                  "restore": "PASS", "migration_transaction_rollback": "PASS", "migration_schema": "PASS",
                  "source_unchanged": "PASS", "original_columns": before["columns"], "tables": before["tables"]}
        report_path = backup.with_suffix(".verification.json")
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report
    except Exception as error:
        raise BackupVerificationError(phase, error) from None
    finally:
        clone_engine.dispose()
        if created:
            # The exact generated name above is the only possible DROP target.
            with admin_engine.connect() as connection:
                connection.execute(text(f'DROP DATABASE "{name}"'))
        admin_engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--isolated-cluster", action="store_true", help="Restore into a private localhost PostgreSQL process when the application role lacks CREATEDB")
    args = parser.parse_args()
    backup = args.backup or create_backup(engine)
    if args.isolated_cluster:
        with disposable_cluster() as restore_admin:
            report = verify_backup(engine, backup, restore_admin)
    else:
        report = verify_backup(engine, backup)
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Tool stderr or SQLAlchemy exception strings may contain credentials.
        print(json.dumps(failure_report(error)))
        raise SystemExit(1)
