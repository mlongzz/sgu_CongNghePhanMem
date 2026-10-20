import asyncio
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from urllib.parse import parse_qs

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.place import Place
from app.services.osm_service import BACKUP, PRIMARY, USER_AGENT, OsmNearbyService, OsmUnavailable, get_osm_service

LAT, LON = 10.7764, 106.6993


def item(osm_id=1, name="Community Museum", lat=LAT, lon=LON):
    return {"type": "node", "id": osm_id, "lat": lat, "lon": lon, "tags": {"name": name, "tourism": "museum"}}


def service(handler, clock=lambda: 0):
    return OsmNearbyService(lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler),
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), clock=clock)


def test_fixed_form_query_and_real_element_validation():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"elements": [None, {}, item(0), item(), item(), item(2, "Outside", lat=11),
            {"type": "way", "id": 3, "center": {"lat": LAT + .001, "lon": LON}, "tags": {"name:vi": "Park", "leisure": "park", "bad": 1}}, item(4, "Invalid", lat=91)]})
    result = asyncio.run(service(handler).nearby(LAT, LON, 3))
    assert [row.id for row in result.elements] == [1, 3]
    request = requests[0]
    assert str(request.url) == PRIMARY and request.method == "POST"
    query = parse_qs(request.content.decode())["data"][0]
    assert "around:3000,10.776400,106.699300" in query and "out center 250" in query
    assert request.headers["user-agent"] == USER_AGENT and "authorization" not in request.headers
    assert result.source == "openstreetmap" and result.searched_radius_km == 3


@pytest.mark.parametrize("failure", ["500", "invalid_json", "remark", "shape", "redirect", "network"])
def test_bad_primary_uses_fixed_backup_and_never_fabricates_results(failure):
    requests = []
    def handler(request):
        requests.append(str(request.url))
        if len(requests) > 1:
            return httpx.Response(200, json={"elements": [item()]})
        if failure == "network":
            raise httpx.ConnectError("unavailable", request=request)
        if failure == "invalid_json":
            return httpx.Response(200, content=b"not json")
        if failure == "remark":
            return httpx.Response(200, json={"elements": [], "remark": "runtime error: timeout"})
        if failure == "shape":
            return httpx.Response(200, json={"wrong": []})
        return httpx.Response(302 if failure == "redirect" else 500, headers={"Location": "https://untrusted.invalid"})
    result = asyncio.run(service(handler).nearby(LAT, LON, 3))
    assert requests == [PRIMARY, BACKUP] and len(result.elements) == 1


def test_large_radius_falls_back_to_five_km_with_honest_metadata():
    radii = []
    def handler(request):
        query = parse_qs(request.content.decode())["data"][0]
        radii.append(query)
        if len(radii) == 1:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json={"elements": [item(), item(2, "Outside five", LAT + .06)]})
    result = asyncio.run(service(handler).nearby(LAT, LON, 20))
    assert "around:20000," in radii[0] and "around:5000," in radii[1]
    assert result.requested_radius_km == 20 and result.searched_radius_km == 5
    assert "Tạm hiển thị dữ liệu trong 5 km" in result.warning and len(result.elements) == 1


@pytest.mark.parametrize("timeout", [True, False])
def test_complete_failure_is_gateway_error_and_not_empty_success(timeout):
    def handler(request):
        if timeout:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(504)
    with pytest.raises(OsmUnavailable) as error:
        asyncio.run(service(handler).nearby(LAT, LON, 3))
    assert error.value.status_code == (504 if timeout else 502)


@pytest.mark.parametrize("retry_after", ["60", format_datetime(datetime.now(timezone.utc) + timedelta(seconds=90)), "invalid"])
def test_cooldown_survives_force_refresh_and_radius_change(retry_after):
    calls = []; now = [0]
    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": retry_after})
    api = service(handler, clock=lambda: now[0])
    async def check():
        for radius in (20, 3, 5):
            with pytest.raises(OsmUnavailable) as error:
                await api.nearby(LAT, LON, radius, force_refresh=True)
            assert error.value.status_code == 503 and error.value.retry_after >= 30
        assert len(calls) == 2
        now[0] = 100
        with pytest.raises(OsmUnavailable):
            await api.nearby(LAT, LON, 3)
        assert len(calls) == 4
    asyncio.run(check())


def test_cache_uses_exact_coordinates_radius_ttl_and_force_refresh():
    calls = []; now = [0]
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"elements": []})
    api = service(handler, clock=lambda: now[0])
    async def check():
        for _ in range(2): await api.nearby(LAT, LON, 3)
        assert len(calls) == 1
        await api.nearby(LAT + .000001, LON, 3)
        await api.nearby(LAT, LON, 5)
        await api.nearby(LAT, LON, 3, force_refresh=True)
        assert len(calls) == 4
        now[0] = 301
        await api.nearby(LAT, LON, 3)
        assert len(calls) == 5
    asyncio.run(check())


def test_concurrent_requests_share_work_and_one_cancel_does_not_cancel_another():
    async def check():
        released = asyncio.Event(); seen = asyncio.Event(); calls = []
        async def handler(request):
            calls.append(request); seen.set(); await released.wait()
            return httpx.Response(200, json={"elements": [item()]})
        api = service(handler)
        first = asyncio.create_task(api.nearby(LAT, LON, 3))
        second = asyncio.create_task(api.nearby(LAT, LON, 3))
        await seen.wait(); first.cancel()
        with pytest.raises(asyncio.CancelledError): await first
        released.set()
        assert len((await second).elements) == 1 and len(calls) == 1
    asyncio.run(check())


def test_response_size_is_bounded():
    api = service(lambda _: httpx.Response(200, content=b" " * (4 * 1024 * 1024 + 1)))
    with pytest.raises(OsmUnavailable, match="vượt giới hạn"):
        asyncio.run(api.nearby(LAT, LON, 3))


def test_reduced_cache_expires_early_so_full_radius_can_recover():
    calls = []; now = [0]
    def handler(request):
        calls.append(request)
        if len(calls) == 1: raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json={"elements": []})
    api = service(handler, clock=lambda: now[0])
    async def check():
        assert (await api.nearby(LAT, LON, 20)).searched_radius_km == 5
        now[0] = 44
        assert (await api.nearby(LAT, LON, 20)).searched_radius_km == 5
        assert len(calls) == 2
        now[0] = 46
        assert (await api.nearby(LAT, LON, 20)).searched_radius_km == 20
        assert len(calls) == 3
    asyncio.run(check())


def test_busy_service_is_bounded_and_recovers_after_the_running_query(monkeypatch):
    monkeypatch.setattr("app.services.osm_service.MAX_IN_FLIGHT", 1)
    async def check():
        seen = asyncio.Event(); released = asyncio.Event()
        async def handler(request):
            seen.set(); await released.wait()
            return httpx.Response(200, json={"elements": [item()]})
        api = service(handler)
        first = asyncio.create_task(api.nearby(LAT, LON, 3))
        await seen.wait()
        with pytest.raises(OsmUnavailable) as error:
            await api.nearby(LAT + .001, LON, 3)
        assert error.value.status_code == 503 and error.value.retry_after == 3
        released.set(); await first
        assert len((await api.nearby(LAT + .001, LON, 3)).elements) == 1
    asyncio.run(check())


def test_endpoint_is_public_validated_cors_enabled_and_does_not_write_postgres(db_session):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"elements": [item()]})
    api = service(handler)
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_osm_service] = lambda: api
    try:
        client = TestClient(app)
        url = f"/osm/nearby?latitude={LAT}&longitude={LON}&radius_km=3"
        response = client.get(url, headers={"Origin": "http://localhost:8081"})
        assert response.status_code == 200 and response.json()["source"] == "openstreetmap"
        assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
        assert db_session.query(Place).count() == 0
        assert client.get(f"/places/nearby?latitude={LAT}&longitude={LON}&radius_km=3").json() == []
        for invalid in ["latitude=91&longitude=0", "latitude=nan&longitude=0", "latitude=0&longitude=inf", "latitude=0&longitude=0&radius_km=21", "latitude=0&longitude=0&radius_km=0"]:
            assert client.get("/osm/nearby?" + invalid).status_code == 422
        assert len(requests) == 1
        preflight = client.options(url, headers={"Origin": "http://localhost:8081", "Access-Control-Request-Method": "GET"})
        assert preflight.status_code == 200
    finally:
        app.dependency_overrides.clear(); app.dependency_overrides.update(previous)
