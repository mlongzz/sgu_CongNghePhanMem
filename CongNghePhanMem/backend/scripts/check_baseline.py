"""Read-only verification before adopting a legacy database into Alembic."""
from pathlib import Path
import importlib.util
from types import SimpleNamespace
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Index, MetaData, Table, inspect
from app.database import engine


def check():
    expected = MetaData()
    path = Path(__file__).resolve().parents[1] / 'alembic/versions/0001_existing_schema.py'
    spec = importlib.util.spec_from_file_location('baseline', path)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    baseline.op = SimpleNamespace(
        create_table=lambda name, *columns: Table(name, expected, *columns),
        create_index=lambda name, table, columns, **kwargs: Index(name, *(expected.tables[table].c[key] for key in columns), **kwargs),
    )
    baseline.upgrade()  # Build metadata only. No DDL is issued to any database.
    with engine.connect() as connection:
        if 'alembic_version' in inspect(connection).get_table_names():
            print('Already has Alembic metadata. Use alembic current; do not stamp again.')
            return 1
        context = MigrationContext.configure(connection, opts={
            'include_object': lambda obj, name, kind, reflected, compare_to: not (
                kind == 'table' and name not in expected.tables) and not (kind == 'column' and name == 'role'),
            'compare_type': True,
        })
        differences = compare_metadata(context, expected)
        if differences:
            print('Baseline differs. No database changes made. Review schema differences:')
            for difference in differences:
                print(difference)
            return 1
    print('Legacy baseline matches. No database changes made. After backup: alembic stamp 0001; alembic upgrade head.')
    return 0


if __name__ == '__main__':
    raise SystemExit(check())
