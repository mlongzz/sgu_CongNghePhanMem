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
        self.retry_at: dict[str, float] = {}

    async def nearby(self, latitude: float, longitude: float, radius_km: float, force_refresh: bool = False) -> OsmNearbyResponse:
        key = (latitude, longitude, radius_km)
        cached = self.cache.get(key)
        if cached and not force_refresh:
            ttl = 45 if cached[1].searched_radius_km < radius_km else 300
            if self.clock() - cached[0] < ttl:
                self.cache.move_to_end(key)
                return cached[1]
            self.cache.pop(key, None)
        task = self.in_flight.get(key)
        if task is None:
            if len(self.in_flight) >= MAX_IN_FLIGHT:
                raise OsmUnavailable("Nguồn OpenStreetMap đang bận. Hãy thử lại sau.", 503, 3)
            task = asyncio.create_task(self._search(latitude, longitude, radius_km))
            self.in_flight[key] = task

            def complete(completed: asyncio.Task):
                if self.in_flight.get(key) is completed:
                    self.in_flight.pop(key, None)
                if not completed.cancelled():
                    completed.exception()  # Retrieve errors even if every waiting client disconnected.

            task.add_done_callback(complete)
        # Disconnecting one client must not cancel another client's shared query.
        return await asyncio.shield(task)

    async def _query(self, client: httpx.AsyncClient, endpoint: str, latitude: float, longitude: float, radius: float, budget: float) -> list:
        around = f"(around:{round(radius * 1000)},{latitude:.6f},{longitude:.6f})"
        query = (f"[out:json][timeout:{max(5, int(budget) - 2)}];("
                 f'nwr{around}["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|artwork)$"];'
                 f'nwr{around}["name"]["historic"];nwr{around}["name"]["leisure"="park"];);out center {MAX_ELEMENTS};')
        host = urlsplit(endpoint).hostname
        async with client.stream("POST", endpoint, data={"data": query}, timeout=httpx.Timeout(budget, connect=min(5, budget))) as response:
            if response.status_code in (429, 406):
                delay = _retry_seconds(response.headers.get("Retry-After"))
                self.retry_at[endpoint] = self.clock() + delay
                raise OsmUnavailable(f"{host} đang giới hạn truy cập, thử lại sau {math.ceil(delay)} giây.", 503, math.ceil(delay))
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
        attempts = [(PRIMARY, radius, 14), (BACKUP, radius, 12)] if radius <= 6 else [
            (PRIMARY, radius, 14), (PRIMARY, 5, 10), (BACKUP, 5, 12),
        ]
        errors: list[OsmUnavailable] = []
        async with self.client_factory() as client:
            for endpoint, searched, budget in attempts:
                until = self.retry_at.get(endpoint, 0)
                if until > self.clock():
                    delay = math.ceil(until - self.clock())
                    errors.append(OsmUnavailable(f"{urlsplit(endpoint).hostname} đang giới hạn truy cập, thử lại sau {delay} giây.", 503, delay))
                    continue
                try:
                    # HTTP timeouts cover inactivity; wait_for also bounds the whole streamed request.
                    rows = await asyncio.wait_for(self._query(client, endpoint, latitude, longitude, searched, budget), timeout=budget)
                    result = OsmNearbyResponse(elements=_clean_elements(rows, latitude, longitude, searched),
                        requested_radius_km=radius, searched_radius_km=searched,
                        warning=f"Chưa hoàn tất tìm OpenStreetMap trong {radius:g} km. Tạm hiển thị dữ liệu trong {searched:g} km gần bạn; hãy thử lại sau để tìm đủ bán kính." if searched < radius else "")
                    key = (latitude, longitude, radius)
                    self.cache[key] = (self.clock(), result)
                    self.cache.move_to_end(key)
                    while len(self.cache) > MAX_CACHE_ENTRIES:
                        self.cache.popitem(last=False)
                    return result
                except (TimeoutError, httpx.TimeoutException):
                    errors.append(OsmUnavailable(f"{urlsplit(endpoint).hostname} phản hồi quá {budget} giây.", 504))
                except httpx.HTTPError:
                    errors.append(OsmUnavailable(f"Không kết nối được {urlsplit(endpoint).hostname}."))
                except OsmUnavailable as exc:
                    errors.append(exc)
        all_throttled = all(error.status_code == 503 for error in errors)
        status = 503 if all_throttled else 504 if all(error.status_code == 504 for error in errors) else 502
        retry = min(error.retry_after for error in errors if error.retry_after is not None) if all_throttled else None
        raise OsmUnavailable("Không tải được địa điểm OpenStreetMap. " + " | ".join(str(error) for error in errors), status, retry)


_service = OsmNearbyService()


def get_osm_service() -> OsmNearbyService:
    return _service
