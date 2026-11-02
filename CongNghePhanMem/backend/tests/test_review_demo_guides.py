import pytest
from sqlalchemy import select
from app.models.place import Place
from app.models.guide_content import GuideContent
from scripts.review_demo_guides import load_review, reconcile


def baseline(session):
    rows = load_review()
    for item in rows:
        place = Place(name=item['name'], latitude=item['latitude'], longitude=item['longitude'], publication_status='published')
        session.add(place); session.flush()
        for guide in item['previous_guides']:
            session.add(GuideContent(place_id=place.id, **guide, publication_status='published'))
    session.commit()
    return rows


def test_preview_apply_and_repeat_preserve_places_and_publish_four_reviewed_languages(db_session):
    rows = baseline(db_session)
    preview = reconcile(db_session, rows)
    assert len(preview) == 38  # Cu Chi vi/en remain unchanged.
    assert len(list(db_session.scalars(select(GuideContent)))) == 38
    assert reconcile(db_session, rows, mutate=True) == preview
    db_session.commit()
    guides = list(db_session.scalars(select(GuideContent)))
    assert len(guides) == 40
    assert all(g.source_url and g.publication_status == 'published' for g in guides)
    assert reconcile(db_session, rows, mutate=True) == []
    assert all(p.publication_status == 'published' for p in db_session.scalars(select(Place)))


@pytest.mark.parametrize('change', ['text', 'draft', 'coordinate', 'missing'])
def test_unexpected_content_aborts_and_rolls_back_all_earlier_updates(db_session, change):
    rows = baseline(db_session)
    place = db_session.scalar(select(Place).where(Place.name == rows[-1]['name']))
    guide = db_session.scalar(select(GuideContent).where(GuideContent.place_id == place.id))
    guide_id = guide.id
    if change == 'text': guide.content = 'Team edited content that must be preserved'
    elif change == 'draft': guide.publication_status = 'draft'
    elif change == 'coordinate': place.latitude += 1
    else: db_session.delete(guide)
    db_session.commit()
    with pytest.raises(ValueError):
        with db_session.begin():
            reconcile(db_session, rows, mutate=True)
    assert len(list(db_session.scalars(select(GuideContent)))) == (37 if change == 'missing' else 38)
    if change == 'text':
        assert db_session.get(GuideContent, guide_id).content == 'Team edited content that must be preserved'
