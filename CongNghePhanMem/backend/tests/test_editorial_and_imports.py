"""Publication and import regressions use isolated test databases only."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.user import User
from app.routers.auth import create_access_token
from app.services.place_service import _haversine_km, get_nearby_places


@pytest.fixture
def client(db_session):
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


@pytest.fixture
def admin_headers(db_session):
    admin = User(email="editor@example.test", full_name="Editor", password_hash="unused", role="admin")
    db_session.add(admin)
    db_session.commit()
    return {"Authorization": "Bearer " + create_access_token(admin.id)}


def test_draft_published_unpublished_archived_restored_lifecycle(client, admin_headers, db_session):
    h = admin_headers
    created = client.post('/admin/places', headers=h, json={'name': 'Museum', 'latitude': 10, 'longitude': 106}).json()
    pid = created['id']
    assert created['publication_status'] == 'draft'
    assert client.get(f'/places/{pid}').status_code == 404
    assert client.get('/places/search?q=Museum').json() == []
    assert client.get('/places/nearby?latitude=10&longitude=106').json() == []
    assert client.put(f'/admin/places/{pid}', headers=h, json={'publication_status': 'published'}).status_code == 200
    assert client.get(f'/places/{pid}').status_code == 200
    guide = {'title': 'Story', 'content': 'Reviewed narration', 'language_code': 'vi'}
    assert client.put(f'/admin/places/{pid}/guide-content/vi', headers=h, json=guide).json()['publication_status'] == 'draft'
    assert client.get(f'/places/{pid}/guide-content/languages').json() == []
    url = f'/admin/places/{pid}/guide-content/vi'
    published = client.put(url, headers=h, json={'publication_status': 'published'}).json()
    assert published['title'] == 'Story' and published['content'] == 'Reviewed narration'
    assert client.get(f'/places/{pid}/guide-content?language=vi').status_code == 200
    assert client.put(url, headers=h, json={'content': 'Edited narration'}).json()['publication_status'] == 'draft'
    assert client.get(f'/places/{pid}/guide-content?language=vi').status_code == 404
    assert client.put(f'/admin/places/{pid}/guide-content/en', headers=h, json={'publication_status': 'published'}).status_code == 422
    assert client.delete(f'/admin/places/{pid}', headers=h).status_code == 204
    assert client.get(f'/places/{pid}').status_code == 404
    assert client.get('/admin/places', headers=h).json()['total'] == 0
    assert client.get('/admin/places?include_deleted=true', headers=h).json()['total'] == 1
    assert db_session.query(Place).count() == 1 and db_session.query(GuideContent).count() == 1
    assert client.put(f'/admin/places/{pid}', headers=h, json={'publication_status': 'published'}).status_code == 409
    assert client.post(f'/admin/places/{pid}/restore', headers=h).json()['publication_status'] == 'draft'
    assert db_session.get(Place, pid).deleted_at is None
    assert client.get(f'/places/{pid}').status_code == 404


@pytest.mark.parametrize('parameter,value', [('latitude', 'nan'), ('longitude', 'inf'), ('latitude', '91'), ('longitude', '-181'), ('radius_km', 'nan'), ('radius_km', '0'), ('radius_km', '501'), ('limit', '0'), ('limit', '101')])
def test_nearby_rejects_invalid_query_values(client, parameter, value):
    params = {'latitude': 10, 'longitude': 106, parameter: value}
    assert client.get('/places/nearby', params=params).status_code == 422


@pytest.mark.parametrize('latitude,longitude,poi_lat,poi_lon,radius', [
    (89, 0, 89, 180, 250), (90, 100, 89.9, -90, 20),
    (-89, 0, -89, 180, 250), (85, 0, 85.65, 21, 220),
    (0, 179.99, 0, -179.99, 3), (10.75, 106.65, 10.75, 106.65, .001),
])
def test_nearby_spherical_bounds_do_not_drop_valid_points(db_session, latitude, longitude, poi_lat, poi_lon, radius):
    point = Place(name='Spherical edge', latitude=poi_lat, longitude=poi_lon)
    db_session.add(point)
    db_session.commit()
    assert _haversine_km(latitude, longitude, poi_lat, poi_lon) < radius
    assert [place.id for place, _ in get_nearby_places(db_session, latitude, longitude, radius)] == [point.id]


def test_nearby_deduplicates_stably_and_filters_invalid_or_unpublished_data(db_session):
    db_session.add_all([
        Place(name='Museum', latitude=10, longitude=106),
        Place(name=' MUSEUM ', latitude=10, longitude=106),
        Place(name='Other', latitude=10.001, longitude=106),
        Place(name='Draft', latitude=10, longitude=106, publication_status='draft'),
        Place(name='Deleted', latitude=10, longitude=106, deleted_at=datetime.now(timezone.utc)),
        Place(name='Invalid longitude', latitude=10, longitude=200),
    ])
    db_session.commit()
    result = get_nearby_places(db_session, 10, 106, radius_km=500)
    assert [place.name for place, _ in result] == ['Museum', 'Other']
    assert result[0][1] == 0 and result[1][1] > 0


def osm_payload():
    # Synthetic fixtures exercise importer contracts; they are never a live POI catalog.
    return {'places': [{'source_id': 'node/123', 'name': 'Test OSM museum', 'latitude': 10, 'longitude': 106,
                        'category': 'museum'}]}


def test_osm_preview_approval_atomic_import_idempotence_and_provenance(client, admin_headers, db_session):
    h, data = admin_headers, osm_payload()
    assert client.post('/admin/imports/osm/preview', json=data).status_code == 401
    preview = client.post('/admin/imports/osm/preview', headers=h, json=data).json()
    assert preview['places_to_create'] == 1 and preview['conflicts'] == 0
    assert db_session.query(Place).count() == 0
    assert client.post('/admin/imports/osm', headers=h, json=data).status_code == 422
    assert client.post('/admin/imports/osm', headers=h, json={**data, 'preview_token': '0' * 64}).status_code == 409
    result = client.post('/admin/imports/osm', headers=h, json={**data, 'preview_token': preview['preview_token']})
    assert result.status_code == 200
    row = db_session.query(Place).one()
    assert row.source == 'osm' and row.source_id == 'node/123' and row.publication_status == 'draft'
    assert row.source_url == 'https://www.openstreetmap.org/node/123' and 'ODbL' in row.source_license
    assert client.get('/places').json() == []
    repeat_preview = client.post('/admin/imports/osm/preview', headers=h, json=data).json()
    assert repeat_preview['existing'] == 1
    assert client.post('/admin/imports/osm', headers=h, json={**data, 'preview_token': repeat_preview['preview_token']}).status_code == 200
    assert db_session.query(Place).count() == 1


def test_osm_conflict_prevents_partial_import_and_stale_preview_is_rejected(client, admin_headers, db_session):
    h, data = admin_headers, osm_payload()
    preview = client.post('/admin/imports/osm/preview', headers=h, json=data).json()
    db_session.add(Place(name='Test OSM museum', latitude=10, longitude=106))
    db_session.commit()
    assert client.post('/admin/imports/osm', headers=h, json={**data, 'preview_token': preview['preview_token']}).status_code == 409
    data['places'].append({'source_id': 'way/234', 'name': 'Another test POI', 'latitude': 11, 'longitude': 106})
    conflict = client.post('/admin/imports/osm/preview', headers=h, json=data).json()
    assert conflict['conflicts'] == 1 and conflict['places_to_create'] == 1
    assert client.post('/admin/imports/osm', headers=h, json={**data, 'preview_token': conflict['preview_token']}).status_code == 409
    assert db_session.query(Place).count() == 1


def test_osm_import_cannot_publish_or_reuse_invalid_source_ids(client, admin_headers):
    data = osm_payload()
    data['places'][0]['publication_status'] = 'published'
    assert client.post('/admin/imports/osm/preview', headers=admin_headers, json=data).status_code == 422
    data['places'][0].pop('publication_status')
    data['places'][0]['source_id'] = 'https://attacker.example'
    assert client.post('/admin/imports/osm/preview', headers=admin_headers, json=data).status_code == 422


def test_osm_snapshot_converter_accepts_points_and_rejects_unlocated_polygons():
    from scripts.prepare_osm_import import convert
    payload, rejected = convert({'elements': [
        {'type': 'node', 'id': 11, 'lat': 10, 'lon': 106, 'tags': {'name': 'Test temple', 'amenity': 'place_of_worship'}},
        {'type': 'way', 'id': 22, 'center': {'lat': 10, 'lon': 106}, 'tags': {'name': 'Test hall', 'historic': 'building'}},
        {'type': 'way', 'id': 33, 'tags': {'name': 'Missing centre', 'tourism': 'museum'}},
        {'type': 'node', 'id': 44, 'lat': 10, 'lon': 106, 'tags': {'name': 'Not a POI', 'shop': 'convenience'}},
    ]})
    assert [p['source_id'] for p in payload['places']] == ['node/11', 'way/22']
    assert len(rejected) == 2


def test_osmium_point_ids_and_geojson_coordinate_order_are_preserved():
    from scripts.prepare_osm_import import convert
    payload, rejected = convert({'features': [
        {'type': 'Feature', 'id': 'n123', 'properties': {'name': 'Fixture museum', 'tourism': 'museum'},
         'geometry': {'type': 'Point', 'coordinates': [106, 10]}},
        {'type': 'Feature', 'id': 'a456', 'properties': {'name': 'Polygon fixture', 'tourism': 'museum'},
         'geometry': {'type': 'Polygon', 'coordinates': []}},
    ]})
    assert payload['places'][0]['source_id'] == 'node/123'
    assert payload['places'][0]['latitude'] == 10 and payload['places'][0]['longitude'] == 106
    assert rejected[0]['reason'] == 'point_geometry_required'
