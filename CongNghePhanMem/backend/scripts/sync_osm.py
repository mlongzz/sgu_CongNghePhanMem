"""Optional hourly snapshot sync; never started by opening the map or API startup.

Preview: python -m scripts.sync_osm
Enable later: python -m scripts.sync_osm --allow-network --once
Scheduled worker: python -m scripts.sync_osm --allow-network --watch --interval-seconds 3600
"""
import argparse
import asyncio
import json

from app.config import OSM_CACHE_PATH
from app.services.osm_service import OsmNearbyService, OsmUnavailable

# Two public landmark anchors cover western and central HCMC. No device GPS.
TARGETS = [(10.749375, 106.651078, 5), (10.777108, 106.695441, 5)]


async def sync_once(service: OsmNearbyService) -> list[dict]:
    results = []
    for lat, lon, radius in TARGETS:
        try:
            result = await service.nearby(lat, lon, radius, force_refresh=True)
            results.append({"status": "retained" if result.stale else "updated", "count": len(result.elements),
                            "searched_radius_km": result.searched_radius_km})
        except OsmUnavailable as error:
            # Failed sync never erases the saved snapshot or PostgreSQL places.
            results.append({"status": "unavailable", "http_status": error.status_code, "retry_after": error.retry_after})
    return results


async def run(args):
    if not args.allow_network:
        print(json.dumps({"mode": "preview", "network_requests": 0, "public_targets": TARGETS,
                          "cache_path": OSM_CACHE_PATH}, ensure_ascii=False))
        return
    if args.interval_seconds < 3600:
        raise ValueError("Minimum sync interval is 3600 seconds")
    service = OsmNearbyService(cache_path=OSM_CACHE_PATH, allow_network=True)
    while True:
        print(json.dumps(await sync_once(service), ensure_ascii=False), flush=True)
        if not args.watch:
            return
        await asyncio.sleep(args.interval_seconds)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-network', action='store_true', help='Explicitly allow Overpass requests')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--once', action='store_true')
    modes.add_argument('--watch', action='store_true')
    parser.add_argument('--interval-seconds', type=int, default=3600)
    args = parser.parse_args()
    try: asyncio.run(run(args))
    except (ValueError, KeyboardInterrupt) as error:
        if isinstance(error, ValueError): parser.error(str(error))


if __name__ == '__main__':
    main()
