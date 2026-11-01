"""Create a disposable LOCAL test database, run tests, and remove only that database.

Use TEST_DATABASE_ADMIN_URL or local backend/.env for the connection credentials.
No URL/password is printed. Application tables are never used by the tests.
"""
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def main():
    backend = Path(__file__).resolve().parents[1]
    root = backend.parent
    raw = os.getenv('TEST_DATABASE_ADMIN_URL') or dotenv_values(backend / '.env').get('DATABASE_URL', '')
    url = make_url(raw)
    if url.get_backend_name() != 'postgresql' or url.host not in {'localhost', '127.0.0.1', '::1'}:
        raise RuntimeError('Refused: test database administrator connection must be local PostgreSQL')
    name = 'mg_test_' + uuid.uuid4().hex
    if not re.fullmatch(r'mg_test_[a-f0-9]{32}', name):
        raise RuntimeError('Invalid generated test database name')
    run_dir = root / '.verification' / name
    run_dir.mkdir(parents=True, exist_ok=False)
    admin = create_engine(url.set(drivername='postgresql+psycopg2', database='postgres'), isolation_level='AUTOCOMMIT')
    created = False
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
            created = True
        test_url = url.set(drivername='postgresql+psycopg2', database=name).render_as_string(hide_password=False)
        env = {**os.environ, 'APP_ENV': 'test', 'TEST_POSTGRES': '1', 'DATABASE_URL': test_url,
               'SECRET_KEY': 'isolated-postgres-acceptance-key-not-for-production', 'ADMIN_USER_IDS': '',
               'TRANSLATION_API_URL': '', 'TRANSLATION_API_KEY': '', 'MEDIA_STORAGE_BACKEND': 'local',
               'UPLOAD_DIR': str(run_dir / 'uploads'), 'E2E_PYTHON': sys.executable}
        args = sys.argv[1:]
        if args and args[0] == '--e2e':
            env['E2E_DATABASE_URL'] = test_url
            command = ['node', 'scripts/run-e2e.cjs', *args[1:]]
            cwd = root / 'multilingual-guide'
        else:
            command = [sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
                       '--basetemp', str(run_dir / 'tmp'), *args]
            cwd = backend
        print('Created isolated local PostgreSQL test database', flush=True)
        return subprocess.run(command, cwd=cwd, env=env).returncode
    finally:
        if created:
            with admin.connect() as connection:
                connection.execute(text('SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
                                        'WHERE datname = :name AND pid <> pg_backend_pid()'), {'name': name})
                connection.execute(text(f'DROP DATABASE "{name}"'))
            print('Removed only this run\'s generated test database', flush=True)
        admin.dispose()


if __name__ == '__main__':
    raise SystemExit(main())
