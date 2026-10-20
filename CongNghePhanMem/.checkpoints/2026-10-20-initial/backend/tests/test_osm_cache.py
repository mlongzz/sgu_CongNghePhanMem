import argparse
import asyncio
import json

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.place import Place
from app.services.osm_service import OsmNearbyService, OsmUnavailable, get_osm_service
from scripts import sync_osm

LAT, LON = 10.7764, 106.6993


def node(identifier=1, lat=LAT, lon=LON):
    return {'type': 'node', 'id': identifier, 'lat': lat, 'lon': lon, 'tags': {'name': f'Saved {identifier}', 'tourism': 'museum'}}


def service(handler, *, now=None, path=None, network=True):
    now = now if now is not None else [0]
    return OsmNearbyService(lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        clock=lambda: now[0], wall_clock=lambda: 100000 + now[0], allow_network=network, cache_path=path)


def no_network(*args, **kwargs):
    pytest.fail('HTTP map requests must never contact Overpass')


def test_public_endpoint_is_cache_only_even_with_forced_refresh(tmp_path, db_session):
    api = service(no_network, path=tmp_path / 'cache.json', network=False)
    old = app.dependency_overrides.copy()
    app.dependency_overrides[get_osm_service] = lambda: api
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        client = TestClient(app)
        for force in ['', '&force_refresh=true']:
            response = client.get(f'/osm/nearby?latitude={LAT}&longitude={LON}&radius_km=3' + force)
            assert response.status_code == 503 and response.headers['retry-after'] == '3600'
            assert 'PostgreSQL' in response.json()['detail']
        assert client.get(f'/places/nearby?latitude={LAT}&longitude={LON}&radius_km=3').json() == []
        assert db_session.query(Place).count() == 0
    finally:
        app.dependency_overrides.clear(); app.dependency_overrides.update(old)


def test_close_gps_fixes_share_query_but_each_response_is_filtered_from_actual_position():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'elements': [node(lat=.0273, lon=0)]})
    api = service(handler)
    async def check():
        north = await api.nearby(.00049, 0, 3)
        south = await api.nearby(-.00049, 0, 3)
        assert [p.id for p in north.elements] == [1] and south.elements == []
        assert north.searched_radius_km == south.searched_radius_km == 3
        assert len(calls) == 1
        await api.nearby(.00051, 0, 3)
        assert len(calls) == 2
    asyncio.run(check())


def test_concurrent_gps_jitter_is_coalesced_before_the_first_response():
    async def check():
        seen = asyncio.Event(); released = asyncio.Event(); calls = []
        async def handler(request):
            calls.append(request); seen.set(); await released.wait()
            return httpx.Response(200, json={'elements': [node()]})
        api = service(handler)
        first = asyncio.create_task(api.nearby(LAT, LON, 3))
        second = asyncio.create_task(api.nearby(LAT + .000001, LON, 3))
        await seen.wait(); released.set()
        results = await asyncio.gather(first, second)
        assert all(len(result.elements) == 1 for result in results) and len(calls) == 1
    asyncio.run(check())


def test_snapshot_survives_service_restart_and_retains_real_age_and_way_centres(tmp_path):
    now = [0]; path = tmp_path / 'cache.json'
    writer = service(lambda _: httpx.Response(200, json={'elements': [node(),
        {'type': 'way', 'id': 2, 'center': {'lat': LAT + .001, 'lon': LON}, 'tags': {'name': 'Park'}}]}), now=now, path=path)
    async def check():
        await writer.nearby(LAT, LON, 3)
        now[0] = 50
        reader = service(no_network, now=now, path=path, network=False)
        result = await reader.nearby(LAT + .000001, LON, 3)
        assert [p.id for p in result.elements] == [1, 2]
        assert result.cache_age_seconds == 50 and not result.stale
        now[0] = 301
        saved = await reader.nearby(LAT, LON, 3, force_refresh=True)
        assert saved.stale and saved.cache_age_seconds == 301
        assert saved.elements == result.elements
    asyncio.run(check())


def test_reader_reloads_new_snapshot_without_backend_restart_and_corruption_keeps_old_cache(tmp_path):
    now = [0]; path = tmp_path / 'cache.json'; value = [1]
    writer = service(lambda _: httpx.Response(200, json={'elements': [node(value[0])]}), now=now, path=path)
    reader = service(no_network, now=now, path=path, network=False)
    async def check():
        with pytest.raises(OsmUnavailable): await reader.nearby(LAT, LON, 3)
        await writer.nearby(LAT, LON, 3)
        assert (await reader.nearby(LAT, LON, 3)).elements[0].id == 1
        value[0] = 2; now[0] = 10
        await writer.nearby(LAT, LON, 3, force_refresh=True)
        assert (await reader.nearby(LAT, LON, 3)).elements[0].id == 2
        path.write_text('{broken', encoding='utf-8')
        assert (await reader.nearby(LAT, LON, 3)).elements[0].id == 2
    asyncio.run(check())


@pytest.mark.parametrize('corruption', ['expired', 'future', 'bad_shape'])
def test_invalid_or_expired_disk_cache_cannot_supply_fake_fresh_results(tmp_path, corruption):
    now = [0]; path = tmp_path / 'cache.json'
    writer = service(lambda _: httpx.Response(200, json={'elements': [node()]}), now=now, path=path)
    asyncio.run(writer.nearby(LAT, LON, 3))
    if corruption == 'expired': now[0] = 86400
    elif corruption == 'future':
        data = json.loads(path.read_text(encoding='utf-8')); data['entries'][0]['fetched_at'] += 100
        path.write_text(json.dumps(data), encoding='utf-8')
    else: path.write_text('null', encoding='utf-8')
    with pytest.raises(OsmUnavailable):
        asyncio.run(service(no_network, now=now, path=path, network=False).nearby(LAT, LON, 3))


def test_synced_region_serves_other_cells_with_honest_coverage_and_no_network(tmp_path):
    path = tmp_path / 'cache.json'
    writer = service(lambda _: httpx.Response(200, json={'elements': [node(1, 0, 0), node(2, .035, 0)]}), path=path)
    async def check():
        await writer.nearby(0, 0, 5)
        reader = service(no_network, path=path, network=False)
        full = await reader.nearby(.01, 0, 3)
        assert full.requested_radius_km == full.searched_radius_km == 3
        edge = await reader.nearby(-.01, 0, 5)
        assert 3.9 < edge.searched_radius_km < 4.1
        assert 'Tạm hiển thị' in edge.warning and [p.id for p in edge.elements] == [1]
        with pytest.raises(OsmUnavailable): await reader.nearby(.1, 0, 3)
    asyncio.run(check())


def test_sync_failure_keeps_the_previous_snapshot_and_is_backed_off(tmp_path, monkeypatch):
    now = [0]; down = [False]; calls = []; path = tmp_path / 'cache.json'
    def handler(request):
        calls.append(request)
        if down[0]: raise httpx.ReadTimeout('down', request=request)
        return httpx.Response(200, json={'elements': [node()]})
    api = service(handler, now=now, path=path)
    monkeypatch.setattr(sync_osm, 'TARGETS', [(LAT, LON, 3)])
    async def check():
        await api.nearby(LAT, LON, 3)
        snapshot = path.read_bytes(); now[0] = 301; down[0] = True
        assert (await sync_osm.sync_once(api))[0]['status'] == 'retained'
        assert (await sync_osm.sync_once(api))[0]['status'] == 'retained'
        assert path.read_bytes() == snapshot and len(calls) == 3
    asyncio.run(check())


def test_sync_requires_explicit_opt_in_and_refuses_frequent_network_runs(monkeypatch, capsys):
    monkeypatch.setattr(sync_osm, 'OsmNearbyService', no_network)
    asyncio.run(sync_osm.run(argparse.Namespace(allow_network=False)))
    assert json.loads(capsys.readouterr().out)['network_requests'] == 0
    with pytest.raises(ValueError):
        asyncio.run(sync_osm.run(argparse.Namespace(allow_network=True, interval_seconds=10)))
