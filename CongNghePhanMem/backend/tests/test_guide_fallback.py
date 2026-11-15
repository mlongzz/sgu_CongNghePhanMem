import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.guide_content import GuideContent
from app.models.place import Place


@pytest.fixture
def client(db_session):
    def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def make_place(db_session):
    def build(**languages):
        place = Place(name="Museum", latitude=10.77, longitude=106.7, publication_status="published")
        db_session.add(place)
        db_session.flush()
        for code, status in languages.items():
            db_session.add(GuideContent(place_id=place.id, language_code=code, title=code, content=f"text {code}", publication_status=status))
        db_session.commit()
        return place.id
    return build


def test_missing_language_falls_back_to_vietnamese(client, make_place):
    pid = make_place(vi="published", en="published")
    body = client.get(f"/places/{pid}/guide-content?language=JA").json()
    assert body["language_code"] == "vi"
    assert body["requested_language"] == "ja"
    assert body["fallback_language"] == "vi"
    assert body["content"] == "text vi"


def test_exact_language_has_no_fallback(client, make_place):
    pid = make_place(vi="published", ja="published")
    body = client.get(f"/places/{pid}/guide-content?language=ja").json()
    assert body["language_code"] == "ja"
    assert body["requested_language"] == "ja"
    assert body["fallback_language"] is None


def test_fallback_prefers_english_then_any_published(client, make_place):
    assert client.get(f"/places/{make_place(en='published', fr='published')}/guide-content?language=ja").json()["fallback_language"] == "en"
    assert client.get(f"/places/{make_place(fr='published')}/guide-content?language=ja").json()["fallback_language"] == "fr"


def test_fallback_ignores_drafts(client, make_place):
    pid = make_place(vi="draft", en="published")
    assert client.get(f"/places/{pid}/guide-content?language=ja").json()["fallback_language"] == "en"


def test_no_published_guide_is_not_found(client, make_place):
    assert client.get(f"/places/{make_place(vi='draft')}/guide-content?language=vi").status_code == 404
    assert client.get(f"/places/{make_place()}/guide-content?language=vi").status_code == 404
