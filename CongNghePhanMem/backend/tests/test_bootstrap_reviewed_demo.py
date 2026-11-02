import pytest
from sqlalchemy import func, select, text

from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.admin import Journey, JourneyStop
from scripts.bootstrap_reviewed_demo import bootstrap, load_manifest


def empty_migrated_db(db):
    db.execute(text('CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)'))
    db.execute(text("INSERT INTO alembic_version (version_num) VALUES ('0007')"))
    db.commit()


def test_bootstrap_previews_then_creates_only_demo_public_data(db_session):
    empty_migrated_db(db_session); rows = load_manifest()
    assert bootstrap(db_session, rows, mutate=False) == {'places': 10, 'guides': 40, 'journeys': 1}
    assert db_session.scalar(select(func.count()).select_from(Place)) == 0
    db_session.rollback()
    assert bootstrap(db_session, rows, mutate=True) == {'places': 10, 'guides': 40, 'journeys': 1}
    db_session.commit()
    assert db_session.scalar(select(func.count()).select_from(Place)) == 10
    assert db_session.scalar(select(func.count()).select_from(GuideContent)) == 40
    assert all(p.publication_status == 'published' and not p.image_url for p in db_session.scalars(select(Place)))
    assert db_session.scalar(select(func.count()).select_from(Journey)) == 1
    stops = list(db_session.scalars(select(JourneyStop).order_by(JourneyStop.position)))
    assert [db_session.get(Place, s.place_id).name for s in stops] == ['Dinh Độc Lập', 'Bảo tàng Chứng tích Chiến tranh', 'Bưu điện Trung tâm Sài Gòn', 'Chợ Bến Thành']
    with pytest.raises(ValueError, match='not empty'):
        bootstrap(db_session, rows, mutate=True)


def test_bootstrap_rejects_any_existing_data_without_overwrite(db_session):
    empty_migrated_db(db_session)
    original = Place(name='Existing unrelated place', latitude=1, longitude=1, publication_status='draft')
    db_session.add(original); db_session.commit()
    with pytest.raises(ValueError, match='not empty'):
        bootstrap(db_session, load_manifest(), mutate=True)
    assert db_session.scalar(select(func.count()).select_from(Place)) == 1
    assert original.name == 'Existing unrelated place' and original.publication_status == 'draft'
