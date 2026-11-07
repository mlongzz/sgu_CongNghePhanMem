"""Create the reviewed ten-place demo only in a completely empty local test DB.

Run Alembic migrations first. Preview is the default. --apply is deliberately
restricted to local PostgreSQL databases named mg_demo_* or mg_test_*.
The short vi/en/fr/ja introductions were reviewed against linked sources on
2026-11-02; they do not replace a guide or a full historical research report.
"""
import argparse
import json
import re
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import engine
from app.models.place import Place
from app.models.guide_content import GuideContent
from app.models.admin import Journey, JourneyStop

MANIFEST = Path(__file__).resolve().parents[1] / 'app' / 'data' / 'verified_demo_bootstrap.json'
DEMO_STOPS = ('Dinh Độc Lập', 'Bảo tàng Chứng tích Chiến tranh', 'Bưu điện Trung tâm Sài Gòn', 'Chợ Bến Thành')


def load_manifest(path: Path = MANIFEST) -> list[dict]:
    bundle = json.loads(path.read_text(encoding='utf-8'))
    rows = bundle.get('places')
    if bundle.get('version') != 1 or not isinstance(rows, list) or len(rows) != 10:
        raise ValueError('Expected the reviewed ten-place demo manifest')
    if {r.get('id') for r in rows} != set(range(1, 11)) or len({r.get('name') for r in rows}) != 10:
        raise ValueError('Invalid or duplicate demo identity')
    if not set(DEMO_STOPS).issubset({r['name'] for r in rows}):
        raise ValueError('Missing reviewed demo journey stop')
    for row in rows:
        if not all(isinstance(row.get(k), str) and row[k].strip() for k in ('name', 'description', 'address', 'category')):
            raise ValueError('Missing place details')
        if not isinstance(row.get('latitude'), (int, float)) or not isinstance(row.get('longitude'), (int, float)) or not (-90 <= row['latitude'] <= 90 and -180 <= row['longitude'] <= 180):
            raise ValueError('Invalid coordinates')
        guides = row.get('guides')
        if not isinstance(guides, list) or {g.get('language_code') for g in guides} != {'vi', 'en', 'fr', 'ja'}:
            raise ValueError('Each demo place needs all four reviewed languages')
        if len({g['language_code'] for g in guides}) != len(guides):
            raise ValueError('Duplicate guide language')
        for guide in guides:
            if guide['language_code'] not in ('vi', 'en', 'fr', 'ja') or not guide.get('title') or len(guide.get('content', '').strip()) < 20:
                raise ValueError('Invalid guide')
    return rows


def bootstrap(session: Session, rows: list[dict], *, mutate: bool) -> dict:
    """Refuse every nonempty table; populate only inside caller transaction."""
    connection = session.connection()
    names = inspect(connection).get_table_names()
    if not {'places', 'guide_contents', 'alembic_version'}.issubset(names):
        raise ValueError('Run migrations on an empty demo database first')
    version = connection.execute(text('SELECT version_num FROM alembic_version')).scalar()
    if version not in ('0007', '0008'):
        raise ValueError('Demo bootstrap requires schema migration 0007 or later')
    quote = connection.dialect.identifier_preparer.quote
    if mutate and connection.dialect.name == 'postgresql':
        # This command is permitted only in an explicitly isolated local demo DB.
        connection.exec_driver_sql('LOCK TABLE ' + ', '.join(quote(n) for n in names) + ' IN ACCESS EXCLUSIVE MODE')
    for name in names:
        if name != 'alembic_version' and connection.exec_driver_sql(f'SELECT 1 FROM {quote(name)} LIMIT 1').first():
            raise ValueError(f'Database is not empty: {name}')
    if mutate:
        identities = {}
        for item in rows:
            place = Place(**{k: item[k] for k in ('id', 'name', 'description', 'address', 'category', 'latitude', 'longitude')},
                          publication_status='published', source='manual')
            session.add(place); session.flush()
            identities[place.name] = place.id
            for guide in item['guides']:
                session.add(GuideContent(place_id=place.id, **{k: guide.get(k) for k in ('language_code', 'title', 'content', 'source_url', 'source_license')}, publication_status='published'))
        journey = Journey(name='Dấu Chân trung tâm Sài Gòn', description='Bốn điểm văn hóa và lịch sử ở trung tâm thành phố. Đường nối chỉ minh họa; chỉ đường thực tế mở Google Maps ngoài ứng dụng.')
        session.add(journey); session.flush()
        for position, name in enumerate(DEMO_STOPS):
            session.add(JourneyStop(journey_id=journey.id, place_id=identities[name], position=position))
        session.flush()
        if connection.dialect.name == 'postgresql':
            connection.execute(text("SELECT setval(pg_get_serial_sequence('places','id'), (SELECT max(id) FROM places), true)"))
    return {'places': len(rows), 'guides': sum(len(row['guides']) for row in rows), 'journeys': 1}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    url = engine.url
    if url.get_backend_name() != 'postgresql' or url.host not in ('127.0.0.1', 'localhost', '::1') or not re.fullmatch(r'mg_(?:demo|test)_[a-zA-Z0-9_]+', url.database or ''):
        raise SystemExit('Refusing: use local PostgreSQL mg_demo_* or mg_test_* only')
    rows = load_manifest()
    with Session(engine) as session:
        with session.begin():
            result = bootstrap(session, rows, mutate=args.apply)
    print(json.dumps({'applied': args.apply, **result}))


if __name__ == '__main__':
    main()
