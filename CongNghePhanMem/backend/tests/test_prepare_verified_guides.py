import pytest
from sqlalchemy import select

from app.models.guide_content import GuideContent
from app.models.place import Place
from scripts.prepare_verified_guides import (
    BEN_THANH_SOURCE, BEN_THANH_TEXT, CU_CHI_TEXT, OLD_VI_SOURCE, apply_reviewed_guides,
)


def setup_places(db):
    cu = Place(name='Địa đạo Củ Chi', latitude=11.1415, longitude=106.4635, publication_status='published')
    market = Place(name='Chợ Bến Thành', latitude=10.772521, longitude=106.698019, publication_status='published')
    db.add_all([cu, market]); db.flush()
    for language, content in BEN_THANH_TEXT.items():
        db.add(GuideContent(place_id=market.id, language_code=language, title=market.name, content=content,
                            publication_status='draft' if language == 'vi' else 'published',
                            source_url=OLD_VI_SOURCE if language == 'vi' else None))
    db.flush()
    return cu, market


def test_repair_preserves_existing_text_and_is_idempotent(db_session):
    cu, market = setup_places(db_session)
    assert len(apply_reviewed_guides(db_session)) == 4
    rows = db_session.scalars(select(GuideContent)).all()
    cu_rows = {r.language_code: r for r in rows if r.place_id == cu.id}
    market_rows = {r.language_code: r for r in rows if r.place_id == market.id}
    assert {k: v.content for k, v in cu_rows.items()} == CU_CHI_TEXT
    assert {k: v.content for k, v in market_rows.items()} == BEN_THANH_TEXT
    assert all(row.publication_status == 'published' and row.source_url == BEN_THANH_SOURCE for row in market_rows.values())
    assert apply_reviewed_guides(db_session) == []


def test_preview_does_not_insert_or_change_guides(db_session):
    cu, market = setup_places(db_session)
    assert len(apply_reviewed_guides(db_session, mutate=False)) == 4
    assert db_session.scalars(select(GuideContent).where(GuideContent.place_id == cu.id)).all() == []
    vi = db_session.scalar(select(GuideContent).where(GuideContent.place_id == market.id, GuideContent.language_code == 'vi'))
    assert vi.publication_status == 'draft' and vi.source_url == OLD_VI_SOURCE


def test_changed_existing_guide_aborts_without_overwrite(db_session):
    cu, market = setup_places(db_session)
    changed = db_session.scalar(select(GuideContent).where(GuideContent.place_id == market.id, GuideContent.language_code == 'vi'))
    changed.content = 'New editorial content by another member.'
    db_session.flush()
    with pytest.raises(ValueError, match='changed'):
        with db_session.begin_nested():
            apply_reviewed_guides(db_session)
    assert changed.content == 'New editorial content by another member.'
    assert db_session.scalars(select(GuideContent).where(GuideContent.place_id == cu.id)).all() == []
