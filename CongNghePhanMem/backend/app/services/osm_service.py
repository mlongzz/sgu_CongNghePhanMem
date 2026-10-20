"""Bounded server-side Overpass search. No database writes or client credentials."""
import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import logging
from pathlib import Path
import tempfile
import time
from typing import Callable
from urllib.parse import urlsplit

import httpx2 as httpx

from app.schemas.osm import OsmCenter, OsmElement, OsmNearbyResponse
from app.config import OSM_CACHE_PATH

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
QUERY_PADDING_KM = 0.1
MAX_CACHE_FILE_BYTES = 16 * 1024 * 1024
logger = logging.getLogger(__name__)


def cache_key(latitude: float, longitude: float, radius: float) -> tuple:
    # A cell is ~111 m north/south and no wider east/west. The maximum
    # distance to its centre is <79 m; queries include a 100 m buffer.
    return (round(latitude, 3), round(longitude, 3), radius)


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
    def __init__(self, client_factory: Callable[[], httpx.AsyncClient] | None = None, clock: Callable[[], float] = time.monotonic,
                 *, allow_network: bool = False, cache_path: str | Path | None = None, wall_clock: Callable[[], float] = time.time):
        self.client_factory = client_factory or (lambda: httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, follow_redirects=False,
        ))
        self.clock = clock
        self.wall_clock = wall_clock
        self.allow_network = allow_network
        self.cache_path = Path(cache_path) if cache_path else None
        self._disk_signature = None
        self.cache: OrderedDict[tuple, tuple[float, OsmNearbyResponse]] = OrderedDict()
        self.in_flight: dict[tuple, asyncio.Task] = {}
        # Only two fixed providers: failure backoff is shared across locations,
        # radii and explicit refreshes, without an unbounded per-query error cache.
        self.cooldowns: dict[str, tuple[float, OsmUnavailable]] = {}

    def _load_snapshot(self):
        if self.cache_path is None:
            return
        try:
            stat = self.cache_path.stat()
            signature = (stat.st_mtime_ns, stat.st_size)
            if signature == self._disk_signature:
                return
            self._disk_signature = signature
            if stat.st_size > MAX_CACHE_FILE_BYTES:
                raise ValueError("Snapshot too large")
            body = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if not isinstance(body, dict) or body.get("version") != 2 or not isinstance(body.get("entries"), list) or len(body["entries"]) > MAX_CACHE_ENTRIES:
                raise ValueError("Invalid snapshot format")
            loaded = []
            for entry in body["entries"]:
                lat, lon, radius = entry["key"]
                if not _coordinate(lat, 90) or not _coordinate(lon, 180) or not _coordinate(radius, 20) or radius < 1:
                    raise ValueError("Invalid snapshot location")
                if [lat, lon, radius] != list(cache_key(lat, lon, radius)):
                    raise ValueError("Invalid snapshot cell")
                age = self.wall_clock() - entry["fetched_at"]
                if not math.isfinite(age) or age < -1:
                    raise ValueError("Invalid snapshot time")
                if age >= STALE_CACHE_SECONDS:
                    continue
                result = OsmNearbyResponse.model_validate(entry["result"])
                if result.stale or result.requested_radius_km != radius or not 1 <= result.searched_radius_km <= radius or len(result.elements) > MAX_ELEMENTS:
                    raise ValueError("Invalid snapshot coverage")
                result.elements = _clean_elements([p.model_dump(exclude_none=True) for p in result.elements], lat, lon, result.searched_radius_km + QUERY_PADDING_KM)
                loaded.append((cache_key(lat, lon, radius), (self.clock() - max(0, age), result)))
            for key, value in loaded:
                current = self.cache.get(key)
                if current is None or current[0] <= value[0]:
                    self.cache[key] = value
            while len(self.cache) > MAX_CACHE_ENTRIES:
                self.cache.popitem(last=False)
        except FileNotFoundError:
            pass
        except (OSError, ValueError, KeyError, TypeError):
            logger.warning("Cannot load OSM snapshot; keeping the current cache.")

    def _persist_snapshot(self):
        if self.cache_path is None:
            return
        temporary = None
        try:
            entries = [{"key": key, "fetched_at": self.wall_clock() - max(0, self.clock() - timestamp),
                        "result": result.model_dump(exclude_none=True)}
                       for key, (timestamp, result) in self.cache.items() if self.clock() - timestamp < STALE_CACHE_SECONDS]
            content = json.dumps({"version": 2, "entries": entries}, ensure_ascii=False, allow_nan=False)
            if len(content.encode("utf-8")) > MAX_CACHE_FILE_BYTES:
                raise ValueError("Snapshot too large")
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.cache_path.parent, delete=False, suffix=".tmp") as stream:
                temporary = Path(stream.name)
                stream.write(content)
            temporary.replace(self.cache_path)
            self._disk_signature = None
        except (OSError, ValueError):
            logger.warning("Cannot save OSM snapshot; keeping the previous file.")
        finally:
            if temporary and temporary.exists():
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Cannot remove an OSM snapshot temporary file.")

    def _project(self, result: OsmNearbyResponse, key: tuple, latitude: float, longitude: float, radius: float) -> OsmNearbyResponse:
        available = result.searched_radius_km + QUERY_PADDING_KM - _distance(latitude, longitude, key[0], key[1])
        searched = min(radius, result.searched_radius_km, math.floor((available + 1e-9) * 1000) / 1000)
        if searched < 1:
            raise OsmUnavailable("Chưa có dữ liệu khám phá đã đồng bộ quanh vị trí này. POI hệ thống vẫn được tải từ PostgreSQL.", 503, 3600)
        prefix = result.warning.split("Chưa hoàn tất tìm OpenStreetMap", 1)[0].strip()
        coverage = f"Chưa hoàn tất tìm OpenStreetMap trong {radius:g} km. Tạm hiển thị dữ liệu trong {searched:g} km gần bạn; hãy thử lại sau để tìm đủ bán kính." if searched < radius else ""
        return result.model_copy(update={"elements": _clean_elements([p.model_dump(exclude_none=True) for p in result.elements], latitude, longitude, searched),
            "requested_radius_km": radius, "searched_radius_km": searched, "warning": " ".join(filter(None, (prefix, coverage)))})

    def _select_saved(self, key: tuple, latitude: float, longitude: float, radius: float) -> tuple:
        if self.allow_network or self._cached(key):
            return key
        # A periodically synced larger circle can serve nearby cells, disclosing
        # a smaller guaranteed radius if the caller is close to its edge.
        candidates = []
        for candidate in list(self.cache):
            cached = self._cached(candidate)
            if cached:
                coverage = min(radius, cached[1].searched_radius_km,
                    cached[1].searched_radius_km + QUERY_PADDING_KM - _distance(latitude, longitude, candidate[0], candidate[1]))
                if coverage >= 1:
                    candidates.append((coverage, cached[0], candidate))
        return max(candidates)[2] if candidates else key

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
        self._load_snapshot()
        key = cache_key(latitude, longitude, radius_km)
        saved_key = self._select_saved(key, latitude, longitude, radius_km)
        cached = self._cached(saved_key)
        if cached and not force_refresh:
            ttl = REDUCED_CACHE_SECONDS if cached[1].searched_radius_km < saved_key[2] else FRESH_CACHE_SECONDS
            if self.clock() - cached[0] < ttl:
                self.cache.move_to_end(saved_key)
                result = cached[1].model_copy(update={"cache_age_seconds": max(0, int(self.clock() - cached[0]))})
                return self._project(result, saved_key, latitude, longitude, radius_km)
        if not self.allow_network:
            error = OsmUnavailable("Nguồn khám phá tùy chọn chưa được đồng bộ. Ứng dụng vẫn dùng địa điểm PostgreSQL; không gọi Overpass khi mở bản đồ.", 503, 3600)
            return self._project(self._saved_result(saved_key, error), saved_key, latitude, longitude, radius_km)
        task = self.in_flight.get(key)
        if task is None:
            if len(self.in_flight) >= MAX_IN_FLIGHT:
                return self._project(self._saved_result(saved_key, OsmUnavailable("Nguồn OpenStreetMap đang bận. Hãy thử lại sau.", 503, 3)), saved_key, latitude, longitude, radius_km)
            task = asyncio.create_task(self._search(key[0], key[1], radius_km))
            self.in_flight[key] = task

            def complete(completed: asyncio.Task):
                if self.in_flight.get(key) is completed:
                    self.in_flight.pop(key, None)
                if not completed.cancelled():
                    completed.exception()  # Retrieve errors even if every waiting client disconnected.

            task.add_done_callback(complete)
        # Disconnecting one client must not cancel another client's shared query.
        try:
            return self._project(await asyncio.shield(task), key, latitude, longitude, radius_km)
        except OsmUnavailable as error:
            return self._project(self._saved_result(saved_key, error), saved_key, latitude, longitude, radius_km)

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
                    rows = await asyncio.wait_for(self._query(client, endpoint, latitude, longitude, searched + QUERY_PADDING_KM, budget), timeout=budget)
                    result = OsmNearbyResponse(elements=_clean_elements(rows, latitude, longitude, searched + QUERY_PADDING_KM),
                        requested_radius_km=radius, searched_radius_km=searched,
                        warning=f"Chưa hoàn tất tìm OpenStreetMap trong {radius:g} km. Tạm hiển thị dữ liệu trong {searched:g} km gần bạn; hãy thử lại sau để tìm đủ bán kính." if searched < radius else "")
                    # A smaller query succeeding on the primary means that
                    # provider is healthy. Pause only providers that stayed down.
                    failed.pop(endpoint, None)
                    self.cooldowns.pop(endpoint, None)
                    for host, error in failed.items():
                        self._pause(host, error)
                    key = cache_key(latitude, longitude, radius)
                    self.cache[key] = (self.clock(), result)
                    self.cache.move_to_end(key)
                    while len(self.cache) > MAX_CACHE_ENTRIES:
                        self.cache.popitem(last=False)
                    self._persist_snapshot()
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


_service = OsmNearbyService(allow_network=False, cache_path=OSM_CACHE_PATH)


def get_osm_service() -> OsmNearbyService:
    return _service
