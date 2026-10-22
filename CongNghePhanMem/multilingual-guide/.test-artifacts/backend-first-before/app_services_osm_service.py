"""Bounded server-side Overpass search. No database writes or client credentials."""
import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import time
from typing import Callable
from urllib.parse import urlsplit

import httpx2 as httpx

from app.schemas.osm import OsmCenter, OsmElement, OsmNearbyResponse

PRIMARY = "https://overpass.private.coffee/api/interpreter"
BACKUP = "https://overpass-api.de/api/interpreter"
MAX_ELEMENTS = 250
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_CACHE_ENTRIES = 32
MAX_IN_FLIGHT = 8
FRESH_CACHE_SECONDS = 300
REDUCED_CACHE_SECONDS = 45
STALE_CACHE_SECONDS = 24 * 60 * 60
FAILURE_RETRY_SECONDS = 30
USER_AGENT = "MultilingualGuide/1.0 (OpenStreetMap nearby POI lookup)"


class OsmUnavailable(Exception):
    def __init__(self, message: str, status_code: int = 502, retry_after: int | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


def _retry_seconds(value: str | None) -> float:
    try:
        delay = float(value) if value else 0
    except ValueError:
        try:
            delay = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            delay = 0
    return max(30, delay if math.isfinite(delay) else 0)


def _distance(lat: float, lon: float, other_lat: float, other_lon: float) -> float:
    a, b = math.radians(lat), math.radians(other_lat)
    h = math.sin((b - a) / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(math.radians(other_lon - lon) / 2) ** 2
    return 12742 * math.asin(math.sqrt(min(1, max(0, h))))


def _coordinate(value: object, maximum: int) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= maximum


def _clean_elements(rows: list, latitude: float, longitude: float, radius: float) -> list[OsmElement]:
    found = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or row.get("type") not in ("node", "way", "relation"):
            continue
        osm_id = row.get("id")
        if type(osm_id) is not int or osm_id <= 0 or not isinstance(row.get("tags"), dict):
            continue
        tags = {key: value for key, value in row["tags"].items() if isinstance(key, str) and isinstance(value, str)}
        title = tags.get("name:vi") or tags.get("name") or tags.get("name:en") or ""
        center = row.get("center") if isinstance(row.get("center"), dict) else {}
        lat, lon = row.get("lat", center.get("lat")), row.get("lon", center.get("lon"))
        if not title.strip() or not _coordinate(lat, 90) or not _coordinate(lon, 180):
            continue
        distance = _distance(latitude, longitude, lat, lon)
        identity = (row["type"], osm_id)
        if identity in seen or distance > radius + 0.03:
            continue
        seen.add(identity)
        element = OsmElement(type=row["type"], id=osm_id, tags=tags,
                             **({"lat": lat, "lon": lon} if row["type"] == "node" else {"center": OsmCenter(lat=lat, lon=lon)}))
        found.append((distance, osm_id, element))
    found.sort(key=lambda value: (value[0], value[1]))
    return [value[2] for value in found[:MAX_ELEMENTS]]


class OsmNearbyService:
    def __init__(self, client_factory: Callable[[], httpx.AsyncClient] | None = None, clock: Callable[[], float] = time.monotonic):
        self.client_factory = client_factory or (lambda: httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, follow_redirects=False,
        ))
        self.clock = clock
        self.cache: OrderedDict[tuple, tuple[float, OsmNearbyResponse]] = OrderedDict()
        self.in_flight: dict[tuple, asyncio.Task] = {}
        # Only two fixed providers: failure backoff is shared across locations,
        # radii and explicit refreshes, without an unbounded per-query error cache.
        self.cooldowns: dict[str, tuple[float, OsmUnavailable]] = {}

    def _cached(self, key: tuple) -> tuple[float, OsmNearbyResponse] | None:
        cached = self.cache.get(key)
        if cached and self.clock() - cached[0] >= STALE_CACHE_SECONDS:
            self.cache.pop(key, None)
            return None
        return cached

    def _saved_result(self, key: tuple, error: OsmUnavailable) -> OsmNearbyResponse:
        cached = self._cached(key)
        if cached is None:
            raise error
        self.cache.move_to_end(key)
        age = max(0, int(self.clock() - cached[0]))
        retry = error.retry_after or FAILURE_RETRY_SECONDS
        warning = (f"Chưa cập nhật được OpenStreetMap. Đang dùng dữ liệu đã lưu cách đây {age} giây; "
                   f"thử lại sau {retry} giây. Dữ liệu có thể đã thay đổi.")
        # Never store this copy or renew the original fetch timestamp. Reduced
        # coverage and the original POI are preserved even after repeated failures.
        return cached[1].model_copy(update={"stale": True, "cache_age_seconds": age,
            "retry_after_seconds": retry, "warning": " ".join(filter(None, (warning, cached[1].warning)))})

    def _pause(self, endpoint: str, error: OsmUnavailable):
        until = self.clock() + (error.retry_after or FAILURE_RETRY_SECONDS)
        current = self.cooldowns.get(endpoint)
        if current is None or current[0] <= until:
            # Store the reason without retaining HTTP response tracebacks.
            self.cooldowns[endpoint] = (until, OsmUnavailable(str(error), error.status_code, error.retry_after))

    async def nearby(self, latitude: float, longitude: float, radius_km: float, force_refresh: bool = False) -> OsmNearbyResponse:
        key = (latitude, longitude, radius_km)
        cached = self._cached(key)
        if cached and not force_refresh:
            ttl = REDUCED_CACHE_SECONDS if cached[1].searched_radius_km < radius_km else FRESH_CACHE_SECONDS
            if self.clock() - cached[0] < ttl:
                self.cache.move_to_end(key)
                return cached[1].model_copy(update={"cache_age_seconds": max(0, int(self.clock() - cached[0]))})
        task = self.in_flight.get(key)
        if task is None:
            if len(self.in_flight) >= MAX_IN_FLIGHT:
                return self._saved_result(key, OsmUnavailable("Nguồn OpenStreetMap đang bận. Hãy thử lại sau.", 503, 3))
            task = asyncio.create_task(self._search(latitude, longitude, radius_km))
            self.in_flight[key] = task

            def complete(completed: asyncio.Task):
                if self.in_flight.get(key) is completed:
                    self.in_flight.pop(key, None)
                if not completed.cancelled():
                    completed.exception()  # Retrieve errors even if every waiting client disconnected.

            task.add_done_callback(complete)
        # Disconnecting one client must not cancel another client's shared query.
        try:
            return await asyncio.shield(task)
        except OsmUnavailable as error:
            return self._saved_result(key, error)

    async def _query(self, client: httpx.AsyncClient, endpoint: str, latitude: float, longitude: float, radius: float, budget: float) -> list:
        around = f"(around:{round(radius * 1000)},{latitude:.6f},{longitude:.6f})"
        query = (f"[out:json][timeout:{max(5, int(budget) - 2)}];("
                 f'nwr{around}["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|artwork)$"];'
                 f'nwr{around}["name"]["historic"];nwr{around}["name"]["leisure"="park"];);out center {MAX_ELEMENTS};')
        host = urlsplit(endpoint).hostname
        async with client.stream("POST", endpoint, data={"data": query}, timeout=httpx.Timeout(budget, connect=min(5, budget))) as response:
            if response.status_code in (429, 406, 503):
                delay = _retry_seconds(response.headers.get("Retry-After"))
                error = OsmUnavailable(f"{host} đang bận hoặc giới hạn truy cập, thử lại sau {math.ceil(delay)} giây.", 503, math.ceil(delay))
                self._pause(endpoint, error)
                raise error
            if response.status_code != 200:
                raise OsmUnavailable(f"{host} trả HTTP {response.status_code}.")
            data = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                data.extend(chunk)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise OsmUnavailable(f"Dữ liệu OpenStreetMap từ {host} vượt giới hạn.")
        try:
            body = json.loads(data)
        except (ValueError, UnicodeError) as exc:
            raise OsmUnavailable(f"{host} trả JSON không hợp lệ.") from exc
        if not isinstance(body, dict) or not isinstance(body.get("elements"), list) or body.get("remark"):
            raise OsmUnavailable(f"{host} chưa trả dữ liệu OpenStreetMap hoàn chỉnh.")
        return body["elements"]

    async def _search(self, latitude: float, longitude: float, radius: float) -> OsmNearbyResponse:
        # A backup must do less work after an upstream failure, even for the
        # common 3–5 km searches. Keep all POI categories and disclose coverage.
        # At the minimum 1 km radius, only switch providers. Never retry a
        # successful empty response or exceed the existing 26/36 second budget.
        attempts = [(PRIMARY, radius, 14), (BACKUP, 1, 12)] if radius <= 6 else [
            (PRIMARY, radius, 14), (PRIMARY, 5, 10), (BACKUP, 1, 12),
        ]
        errors: list[OsmUnavailable] = []
        failed: dict[str, OsmUnavailable] = {}
        async with self.client_factory() as client:
            for endpoint, searched, budget in attempts:
                paused = self.cooldowns.get(endpoint)
                if paused and paused[0] > self.clock():
                    delay = math.ceil(paused[0] - self.clock())
                    reason = "đang bận hoặc giới hạn truy cập" if paused[1].status_code == 503 else "tạm ngừng truy vấn sau lỗi kết nối hoặc phản hồi"
                    errors.append(OsmUnavailable(f"{urlsplit(endpoint).hostname} {reason}; thử lại sau {delay} giây.", paused[1].status_code, delay))
                    continue
                try:
                    # HTTP timeouts cover inactivity; wait_for also bounds the whole streamed request.
                    rows = await asyncio.wait_for(self._query(client, endpoint, latitude, longitude, searched, budget), timeout=budget)
                    result = OsmNearbyResponse(elements=_clean_elements(rows, latitude, longitude, searched),
                        requested_radius_km=radius, searched_radius_km=searched,
                        warning=f"Chưa hoàn tất tìm OpenStreetMap trong {radius:g} km. Tạm hiển thị dữ liệu trong {searched:g} km gần bạn; hãy thử lại sau để tìm đủ bán kính." if searched < radius else "")
                    # A smaller query succeeding on the primary means that
                    # provider is healthy. Pause only providers that stayed down.
                    failed.pop(endpoint, None)
                    self.cooldowns.pop(endpoint, None)
                    for host, error in failed.items():
                        self._pause(host, error)
                    key = (latitude, longitude, radius)
                    self.cache[key] = (self.clock(), result)
                    self.cache.move_to_end(key)
                    while len(self.cache) > MAX_CACHE_ENTRIES:
                        self.cache.popitem(last=False)
                    return result
                except (TimeoutError, httpx.TimeoutException):
                    error = OsmUnavailable(f"{urlsplit(endpoint).hostname} phản hồi quá {budget} giây.", 504)
                except httpx.HTTPError:
                    error = OsmUnavailable(f"Không kết nối được {urlsplit(endpoint).hostname}.")
                except OsmUnavailable as exc:
                    error = exc
                errors.append(error)
                failed[endpoint] = error
        for endpoint, error in failed.items():
            self._pause(endpoint, error)
        all_throttled = all(error.status_code == 503 for error in errors)
        status = 503 if all_throttled else 504 if all(error.status_code == 504 for error in errors) else 502
        retry = max(1, math.ceil(min(until for until, _ in self.cooldowns.values()) - self.clock()))
        raise OsmUnavailable("Không tải được địa điểm OpenStreetMap. " + " | ".join(str(error) for error in errors), status, retry)


_service = OsmNearbyService()


def get_osm_service() -> OsmNearbyService:
    return _service
