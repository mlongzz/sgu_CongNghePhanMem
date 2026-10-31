"""Public community POI endpoint, separate from /places/nearby (PostgreSQL)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.osm import OsmNearbyResponse
from app.services.osm_service import OsmNearbyService, OsmUnavailable, get_osm_service
from app.dependencies import get_current_admin
from app.services.osm_snapshot_store import SnapshotStoreError
import asyncio

router = APIRouter(prefix="/osm", tags=["OpenStreetMap"])
admin_router = APIRouter(prefix='/admin/osm',tags=['OSM sync'],dependencies=[Depends(get_current_admin)])


@admin_router.get('/status')
async def sync_status(service:OsmNearbyService=Depends(get_osm_service)):
    if service.snapshot_store is None:
        return {'storage':'local','durable':False,'notice':'Use postgres snapshot storage in production; sync is an explicit external job'}
    try:
        return {**await asyncio.to_thread(service.snapshot_store.status),'durable':True,'minimum_interval_seconds':3600,'map_requests_trigger_sync':False}
    except SnapshotStoreError:
        raise HTTPException(503,'Durable OSM status unavailable') from None


@router.get("/nearby", response_model=OsmNearbyResponse, response_model_exclude_none=True)
async def osm_nearby(
    latitude: float = Query(ge=-90, le=90, allow_inf_nan=False),
    longitude: float = Query(ge=-180, le=180, allow_inf_nan=False),
    radius_km: float = Query(default=3, ge=1, le=20, allow_inf_nan=False),
    force_refresh: bool = False,
    service: OsmNearbyService = Depends(get_osm_service),
):
    """Read saved community POI. Overpass sync runs separately, never on a map request.

    force_refresh is accepted for old clients; it does not enable network access.
    """
    try:
        return await service.nearby(latitude, longitude, radius_km, force_refresh)
    except OsmUnavailable as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc),
                            headers={"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None) from exc
