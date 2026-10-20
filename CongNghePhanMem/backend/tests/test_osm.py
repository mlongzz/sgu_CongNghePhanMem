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
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"}), clock=clock, allow_network=True)


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
    assert "around:3100,10.776000,106.699000" in query and "out center 250" in query
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
    assert "around:20100," in radii[0] and "around:5100," in radii[1]
    assert result.requested_radius_km == 20 and result.searched_radius_km == 5
    assert "Tạm hiển thị dữ liệu trong 5 km" in result.warning and len(result.elements) == 1


@pytest.mark.parametrize("radius", [1, 3, 5, 6])
def test_small_radius_failure_reduces_backup_work_and_reports_actual_coverage(radius):
    requests = []
    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            raise httpx.ReadTimeout("overloaded", request=request)
        return httpx.Response(200, json={"elements": [item(), item(2, "Outside one km", LAT + .02)]})
    result = asyncio.run(service(handler).nearby(LAT, LON, radius))
    assert [str(request.url) for request in requests] == [PRIMARY, BACKUP]
    assert f"around:{radius * 1000 + 100}," in parse_qs(requests[0].content.decode())["data"][0]
    assert "around:1100," in parse_qs(requests[1].content.decode())["data"][0]
    assert result.requested_radius_km == radius and result.searched_radius_km == 1
    assert [row.id for row in result.elements] == [1]
    assert ("Tạm hiển thị dữ liệu trong 1 km" in result.warning) == (radius > 1)


def test_large_search_can_recover_on_backup_after_both_primary_radii_fail():
    requests = []
    def handler(request):
        requests.append(request)
        if len(requests) < 3:
            raise httpx.ReadTimeout("overloaded", request=request)
        return httpx.Response(200, json={"elements": [item()]})
    result = asyncio.run(service(handler).nearby(LAT, LON, 20))
    assert [str(request.url) for request in requests] == [PRIMARY, PRIMARY, BACKUP]
    queries = [parse_qs(request.content.decode())["data"][0] for request in requests]
    assert all(f"around:{radius}," in query for radius, query in zip([20100, 5100, 1100], queries))
    assert result.requested_radius_km == 20 and result.searched_radius_km == 1
    assert "Tạm hiển thị dữ liệu trong 1 km" in result.warning


def test_successful_empty_search_does_not_trigger_smaller_queries_or_other_providers():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"elements": []})
    api = service(handler)
    async def check():
        first = await api.nearby(LAT, LON, 20)
        second = await api.nearby(LAT, LON, 20)
        assert first.elements == [] and first.searched_radius_km == 20 and first.warning == ""
        assert second == first and len(requests) == 1
    asyncio.run(check())


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


def test_cache_groups_close_coordinates_but_keeps_radius_ttl_and_force_refresh():
    calls = []; now = [0]
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"elements": []})
    api = service(handler, clock=lambda: now[0])
    async def check():
        for _ in range(2): await api.nearby(LAT, LON, 3)
        assert len(calls) == 1
        await api.nearby(LAT + .000001, LON, 3)
        assert len(calls) == 1
        await api.nearby(LAT, LON, 5)
        await api.nearby(LAT, LON, 3, force_refresh=True)
        assert len(calls) == 3
        now[0] = 301
        await api.nearby(LAT, LON, 3)
        assert len(calls) == 4
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


@pytest.mark.parametrize("failure", ["timeout", "network", "invalid_json", "429", "503"])
def test_expired_cache_survives_failure_and_backoff_then_recovers_with_new_data(failure):
    now = [0]; phase = ["initial"]; requests = []
    def handler(request):
        requests.append(request)
        if phase[0] != "down":
            return httpx.Response(200, json={"elements": [item(1 if phase[0] == "initial" else 2)]})
        if failure == "timeout": raise httpx.ReadTimeout("slow", request=request)
        if failure == "network": raise httpx.ConnectError("offline", request=request)
        if failure == "invalid_json": return httpx.Response(200, content=b"bad json")
        return httpx.Response(int(failure), headers={"Retry-After": "30"})
    api = service(handler, clock=lambda: now[0])
    async def check():
        original = await api.nearby(LAT, LON, 3)
        phase[0] = "down"; now[0] = 301
        saved = await api.nearby(LAT, LON, 3)
        assert saved.stale and saved.cache_age_seconds == 301 and saved.retry_after_seconds == 30
        assert saved.elements == original.elements and saved.searched_radius_km == 3
        assert "Đang dùng dữ liệu đã lưu" in saved.warning and len(requests) == 3
        assert not original.stale and original.warning == ""
        now[0] = 302
        again = await api.nearby(LAT, LON, 3, force_refresh=True)
        assert again.cache_age_seconds == 302 and again.retry_after_seconds == 29
        assert again.elements == original.elements and len(requests) == 3
        now[0] = 332; phase[0] = "recovered"
        recovered = await api.nearby(LAT, LON, 3)
        assert not recovered.stale and recovered.cache_age_seconds == 0 and recovered.retry_after_seconds is None
        assert [row.id for row in recovered.elements] == [2] and len(requests) == 4
        now[0] = 342
        assert (await api.nearby(LAT, LON, 3)).cache_age_seconds == 10
        assert len(requests) == 4
    asyncio.run(check())


def test_stale_retention_is_not_extended_by_failures_or_cache_reads():
    now = [0]; requests = []
    def handler(request):
        requests.append(request)
        if len(requests) == 1: return httpx.Response(200, json={"elements": [item()]})
        raise httpx.ReadTimeout("slow", request=request)
    api = service(handler, clock=lambda: now[0])
    async def check():
        await api.nearby(LAT, LON, 3)
        now[0] = 86399
        assert (await api.nearby(LAT, LON, 3)).stale
        now[0] = 86400
        with pytest.raises(OsmUnavailable) as error:
            await api.nearby(LAT, LON, 3)
        assert error.value.status_code == 504 and len(requests) == 3
    asyncio.run(check())


def test_timeout_backoff_blocks_new_coordinates_radii_and_forced_refresh_without_fabricating_data():
    now = [0]; requests = []; healthy = [False]
    def handler(request):
        requests.append(request)
        if healthy[0]: return httpx.Response(200, json={"elements": [item()]})
        raise httpx.ReadTimeout("slow", request=request)
    api = service(handler, clock=lambda: now[0])
    async def check():
        for lat, lon, radius in [(LAT, LON, 3), (LAT, LON, 5), (LAT + .000001, LON, 3), (LAT, LON + .000001, 20)]:
            with pytest.raises(OsmUnavailable) as error:
                await api.nearby(lat, lon, radius, force_refresh=True)
            assert error.value.status_code == 504 and error.value.retry_after == 30
        assert len(requests) == 2
        now[0] = 31; healthy[0] = True
        assert not (await api.nearby(LAT, LON, 3)).stale
        assert len(requests) == 3
    asyncio.run(check())


def test_stale_cache_groups_gps_jitter_but_not_a_different_cell_or_radius():
    now = [0]; requests = []
    def handler(request):
        requests.append(request)
        if len(requests) == 1: return httpx.Response(200, json={"elements": [item()]})
        raise httpx.ReadTimeout("slow", request=request)
    api = service(handler, clock=lambda: now[0])
    async def check():
        await api.nearby(LAT, LON, 3)
        now[0] = 301
        assert (await api.nearby(LAT, LON, 3)).stale
        assert (await api.nearby(LAT + .000001, LON, 3)).stale
        for lat, radius in [(LAT, 5), (LAT + .01, 3)]:
            with pytest.raises(OsmUnavailable): await api.nearby(lat, LON, radius)
        assert len(requests) == 3
    asyncio.run(check())


def test_previously_valid_empty_cache_is_stale_and_never_presented_as_a_new_empty_search():
    now = [0]; requests = []
    def handler(request):
        requests.append(request)
        if len(requests) == 1: return httpx.Response(200, json={"elements": []})
        raise httpx.ReadTimeout("slow", request=request)
    api = service(handler, clock=lambda: now[0])
    async def check():
        await api.nearby(LAT, LON, 3)
        now[0] = 301
        saved = await api.nearby(LAT, LON, 3)
        assert saved.elements == [] and saved.stale and saved.cache_age_seconds == 301
        assert "Đang dùng dữ liệu đã lưu" in saved.warning and len(requests) == 3
    asyncio.run(check())


def test_stale_reduced_cache_preserves_its_original_coverage_and_warning():
    now = [0]; requests = []
    def handler(request):
        requests.append(request)
        if len(requests) == 2:
            return httpx.Response(200, json={"elements": [item(), item(2, "Within five km", LAT + .02)]})
        raise httpx.ReadTimeout("slow", request=request)
    api = service(handler, clock=lambda: now[0])
    async def check():
        assert (await api.nearby(LAT, LON, 20)).searched_radius_km == 5
        now[0] = 46
        saved = await api.nearby(LAT, LON, 20)
        assert saved.stale and saved.requested_radius_km == 20 and saved.searched_radius_km == 5
        assert [row.id for row in saved.elements] == [1, 2]
        assert "Đang dùng dữ liệu đã lưu" in saved.warning and "trong 5 km" in saved.warning
    asyncio.run(check())


def test_retained_cache_still_evicts_least_recently_used_entries(monkeypatch):
    monkeypatch.setattr("app.services.osm_service.MAX_CACHE_ENTRIES", 2)
    requests = []; now = [0]; down = [False]
    def handler(request):
        requests.append(request)
        if down[0]: raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json={"elements": [item()]})
    api = service(handler, clock=lambda: now[0])
    async def check():
        await api.nearby(LAT, LON, 3); await api.nearby(LAT, LON, 5)
        await api.nearby(LAT, LON, 3)  # Keep this entry when inserting a third.
        await api.nearby(LAT, LON, 10)
        now[0] = 301; down[0] = True
        with pytest.raises(OsmUnavailable): await api.nearby(LAT, LON, 5)
        assert (await api.nearby(LAT, LON, 3)).stale
        assert len(requests) == 5
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


def test_busy_service_can_serve_retained_data_without_starting_another_provider_query(monkeypatch):
    monkeypatch.setattr("app.services.osm_service.MAX_IN_FLIGHT", 1)
    async def check():
        now = [0]; seen = asyncio.Event(); released = asyncio.Event(); requests = []
        async def handler(request):
            requests.append(request)
            if len(requests) > 1:
                seen.set(); await released.wait()
            return httpx.Response(200, json={"elements": [item()]})
        api = service(handler, clock=lambda: now[0])
        await api.nearby(LAT, LON, 3)
        now[0] = 301
        running = asyncio.create_task(api.nearby(LAT + .001, LON, 3))
        await seen.wait()
        saved = await api.nearby(LAT, LON, 3)
        assert saved.stale and saved.retry_after_seconds == 3 and saved.cache_age_seconds == 301
        assert len(requests) == 2
        released.set(); await running
    asyncio.run(check())


def test_endpoint_exposes_stale_metadata_and_retry_after_errors_without_postgres_writes(db_session):
    now = [0]; requests = []; down = [False]
    def handler(request):
        requests.append(request)
        if down[0]: raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json={"elements": [item()]})
    api = service(handler, clock=lambda: now[0])
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_osm_service] = lambda: api
    try:
        client = TestClient(app)
        url = f"/osm/nearby?latitude={LAT}&longitude={LON}&radius_km=3"
        first = client.get(url).json()
        assert not first["stale"] and first["cache_age_seconds"] == 0
        now[0] = 301; down[0] = True
        saved = client.get(url, headers={"Origin": "http://localhost:8081"})
        assert saved.status_code == 200 and saved.json()["elements"] == first["elements"]
        assert saved.json()["stale"] and saved.json()["cache_age_seconds"] == 301
        assert saved.json()["retry_after_seconds"] == 30
        assert saved.headers["access-control-allow-origin"] == "http://localhost:8081"
        assert client.get(url + "&force_refresh=true").json()["stale"]
        cold = client.get(url.replace("radius_km=3", "radius_km=5"))
        assert cold.status_code == 504 and cold.headers["retry-after"] == "30"
        assert "elements" not in cold.json() and len(requests) == 3
        assert db_session.query(Place).count() == 0
    finally:
        app.dependency_overrides.clear(); app.dependency_overrides.update(previous)


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
