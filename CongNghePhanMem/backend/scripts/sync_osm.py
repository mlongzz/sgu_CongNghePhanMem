"""Optional hourly snapshot sync; never started by opening the map or API startup.

Preview: python -m scripts.sync_osm
Enable later: python -m scripts.sync_osm --allow-network --apply --once
Scheduled worker: python -m scripts.sync_osm --allow-network --apply --watch --interval-seconds 3600
"""
import argparse
import asyncio
import json

from app.config import OSM_CACHE_PATH
from app.services.osm_service import OsmNearbyService, OsmUnavailable, configured_snapshot_store
from app.services.osm_snapshot_store import PostgresSnapshotStore, SnapshotStoreError

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
    if args.allow_network and getattr(args,'interval_seconds',3600) < 3600:
        raise ValueError('Minimum sync interval is 3600 seconds')
    if not args.allow_network or not getattr(args,'apply',False):
        print(json.dumps({"mode": "preview", "network_requests": 0, "public_targets": TARGETS,
                          "durable_storage": "postgres in production", "requires": "--allow-network --apply"}, ensure_ascii=False))
        return
    if args.interval_seconds < 3600:
        raise ValueError("Minimum sync interval is 3600 seconds")
    store = configured_snapshot_store()
    lease = store or PostgresSnapshotStore()
    service = OsmNearbyService(cache_path=OSM_CACHE_PATH, allow_network=True, snapshot_store=store)
    while True:
        owner, retry = await asyncio.to_thread(lease.acquire_sync, args.interval_seconds)
        if not owner:
            print(json.dumps({"status":"rate_limited_or_running","retry_after_seconds":retry}),flush=True)
        else:
            results=[]
            try:
                results=await sync_once(service)
                print(json.dumps(results,ensure_ascii=False),flush=True)
            except SnapshotStoreError:
                print(json.dumps({"status":"storage_unavailable","previous_snapshot_retained":True}),flush=True)
            finally:
                delay=max([row.get('retry_after') or 0 for row in results] or [0])
                await asyncio.to_thread(lease.finish_sync,owner,'ok' if results and all(row['status']=='updated' for row in results) else 'failed',delay)
        if not args.watch:
            return
        await asyncio.sleep(args.interval_seconds)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-network', action='store_true', help='Explicitly allow Overpass requests')
    parser.add_argument('--apply', action='store_true', help='Explicitly allow writing the snapshot and durable sync lease')
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--once', action='store_true')
    modes.add_argument('--watch', action='store_true')
    parser.add_argument('--interval-seconds', type=int, default=3600)
    args = parser.parse_args()
    try: asyncio.run(run(args))
    except (ValueError, SnapshotStoreError, KeyboardInterrupt) as error:
        if isinstance(error, (ValueError,SnapshotStoreError)): parser.error(str(error))


if __name__ == '__main__':
    main()
