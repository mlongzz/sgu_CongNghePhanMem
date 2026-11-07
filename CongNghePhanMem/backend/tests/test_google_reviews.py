import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.place import Place
from app.services import google_reviews as g


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def place(db):
    row = Place(name='Nhà thờ Đức Bà Sài Gòn', address='01 Công xã Paris, Quận 1', latitude=10.7797, longitude=106.6992, publication_status='published')
    db.add(row); db.commit(); db.refresh(row)
    return row


def test_without_key_returns_google_maps_link_and_no_reviews(client, db_session, monkeypatch):
    monkeypatch.delenv('GOOGLE_MAPS_API_KEY', raising=False)
    row = place(db_session)
    body = client.get(f'/places/{row.id}/google-reviews').json()
    assert body['configured'] is False and body['reviews'] == [] and body['rating'] is None
    assert body['google_maps_uri'].startswith('https://www.google.com/maps/search/?api=1&query=')
    assert client.get('/places/999999/google-reviews').status_code == 404
    assert client.get(f'/places/{row.id}/google-reviews?language=de').status_code == 422


def test_with_key_maps_places_api_reviews_with_attribution_and_caches(monkeypatch):
    monkeypatch.setenv('GOOGLE_MAPS_API_KEY', 'test-key')
    g._cache.clear()
    seen = []

    def handler(request):
        seen.append(request)
        assert request.headers['X-Goog-Api-Key'] == 'test-key'
        assert 'places.reviews' in request.headers['X-Goog-FieldMask']
        return httpx.Response(200, json={'places': [{
            'id': 'abc', 'rating': 4.6, 'userRatingCount': 25000, 'googleMapsUri': 'https://maps.google.com/?cid=1',
            'reviews': [
                {'rating': 5, 'text': {'text': 'Tuyệt đẹp'}, 'relativePublishTimeDescription': '2 tuần trước',
                 'authorAttribution': {'displayName': 'An', 'uri': 'https://www.google.com/maps/contrib/1', 'photoUri': 'https://lh3.googleusercontent.com/a'}},
                {'rating': 4, 'text': {'text': 'no author'}, 'authorAttribution': {}},
            ]}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = g.google_reviews(77, 'Nhà thờ Đức Bà', '01 Công xã Paris', 10.7797, 106.6992, 'vi', client)
    assert result['configured'] and result['rating'] == 4.6 and result['user_rating_count'] == 25000
    assert result['google_maps_uri'] == 'https://maps.google.com/?cid=1'
    assert result['reviews'] == [{'author': 'An', 'author_url': 'https://www.google.com/maps/contrib/1', 'author_photo': 'https://lh3.googleusercontent.com/a',
                                  'rating': 5, 'text': 'Tuyệt đẹp', 'relative_time': '2 tuần trước', 'publish_time': None, 'url': None}]
    g.google_reviews(77, 'Nhà thờ Đức Bà', '01 Công xã Paris', 10.7797, 106.6992, 'vi', client)
    assert len(seen) == 1  # served from the short in-memory cache


def test_provider_error_degrades_to_link(monkeypatch):
    monkeypatch.setenv('GOOGLE_MAPS_API_KEY', 'test-key')
    g._cache.clear()
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(403, json={})))
    result = g.google_reviews(78, 'Chợ Bến Thành', None, 10.77, 106.69, 'en', client)
    assert result['configured'] and result['reviews'] == [] and 'HTTP 403' in result['error']
    assert result['google_maps_uri'].startswith('https://www.google.com/maps/search/')
