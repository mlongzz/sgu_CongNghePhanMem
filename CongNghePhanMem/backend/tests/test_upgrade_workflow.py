import sys

import pytest
from sqlalchemy import create_engine

from scripts import upgrade_database


def test_database_upgrade_is_read_only_without_apply(monkeypatch, capsys):
    engine = create_engine('sqlite://')
    monkeypatch.setattr(upgrade_database, 'engine', engine)
    monkeypatch.setattr(sys, 'argv', ['upgrade_database'])
    monkeypatch.setattr(upgrade_database.command, 'upgrade', lambda *args: pytest.fail('Review must not run migrations'))
    monkeypatch.setattr(upgrade_database.subprocess, 'run', lambda *args, **kwargs: pytest.fail('Review must not create backups'))
    upgrade_database.main()
    assert 'Read-only review complete' in capsys.readouterr().out


def test_pg_dump_not_found_stops_the_upgrade(monkeypatch, tmp_path):
    monkeypatch.setattr(upgrade_database.shutil, 'which', lambda name: None)
    monkeypatch.setenv('ProgramFiles', str(tmp_path))
    with pytest.raises(RuntimeError, match='No schema changes made'):
        upgrade_database.find_pg_dump()
