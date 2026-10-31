from pathlib import Path
from types import SimpleNamespace
from sqlalchemy.engine import make_url
from scripts import verify_database_backup as backup


def test_backup_honours_tls_and_never_places_credentials_in_process_arguments(monkeypatch):
    calls=[]
    def run(command,**kwargs):
        calls.append((command,kwargs))
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(backup.subprocess,'run',run)
    engine=SimpleNamespace(url=make_url('postgresql://fixture:private-fixture@db.example.org/guide?sslmode=verify-full&sslrootcert=fixture-ca.pem'))
    backup.pg_command(Path('pg_dump'),['--format=custom','guide'],engine)
    command,options=calls[0]
    assert not any('private-fixture' in value or 'postgresql://' in value for value in command)
    assert options['env']['PGSSLMODE']=='verify-full'
    assert options['env']['PGSSLROOTCERT']=='fixture-ca.pem'
    assert options['env']['PGPASSWORD']=='private-fixture'
    assert options['env']['PGCONNECT_TIMEOUT']=='15'
