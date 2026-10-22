"""Public community POI endpoint, separate from /places/nearby (PostgreSQL)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.osm import OsmNearbyResponse
from app.services.osm_service import OsmNearbyService, OsmUnavailable, get_osm_service

router = APIRouter(prefix="/osm", tags=["OpenStreetMap"])


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
