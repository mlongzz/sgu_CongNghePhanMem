"""Places router with pagination, search, nearby, CRUD + PlaceUpdate."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import AuditLog
from app.models.user import User
from app.schemas.place import NearbyPlaceResponse, PlaceCreate, PlaceResponse, PlaceUpdate
from app.services.place_service import (
    count_places,
    create_place,
    delete_place,
    get_nearby_places,
    get_place_by_id,
    get_places,
    search_places,
    update_place,
)

router = APIRouter(prefix="/places", tags=["Places"])


# ─── NOTE: static sub-paths (/search, /nearby) must come before /{place_id} ──

@router.get("/search", response_model=list[PlaceResponse])
def search_places_api(
    q: str = Query(min_length=1, description="Search keyword"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Full-text search on place name and category."""
    return search_places(db, q, limit, offset)


@router.get("/nearby", response_model=list[NearbyPlaceResponse])
def get_nearby_places_api(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=10, gt=0, le=500),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Return places within *radius_km* kilometres, sorted by distance."""
    nearby = get_nearby_places(db, latitude, longitude, radius_km, limit)
    return [
        {
            "id": place.id,
            "name": place.name,
            "description": place.description,
            "latitude": place.latitude,
            "longitude": place.longitude,
            "address": place.address,
            "category": place.category,
            "image_url": place.image_url,
            "distance_km": round(distance, 2),
            "created_at": place.created_at,
            "updated_at": place.updated_at,
        }
        for place, distance in nearby
    ]


# ─── Collection endpoints ─────────────────────────────────────────────────────

@router.get("", response_model=list[PlaceResponse])
def get_places_api(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Return a paginated list of all places."""
    return get_places(db, limit, offset)


@router.post("", response_model=PlaceResponse, status_code=status.HTTP_201_CREATED)
def create_place_api(
    place_data: PlaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Create a new place (authentication required)."""
    db.add(AuditLog(actor_id=current_user.id, action="create", resource="places"))
    return create_place(
        db=db,
        name=place_data.name,
        description=place_data.description,
        latitude=place_data.latitude,
        longitude=place_data.longitude,
        address=place_data.address,
        category=place_data.category,
        image_url=place_data.image_url,
    )


# ─── Item endpoints ───────────────────────────────────────────────────────────

@router.get("/{place_id}", response_model=PlaceResponse)
def get_place_api(place_id: int, db: Session = Depends(get_db)):
    """Return a single place by ID."""
    place = get_place_by_id(db, place_id)
    if not place:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    return place


@router.put("/{place_id}", response_model=PlaceResponse)
def update_place_api(
    place_id: int,
    place_data: PlaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Update an existing place (authentication required)."""
    place = get_place_by_id(db, place_id)
    if not place:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    db.add(AuditLog(actor_id=current_user.id, action="update", resource="places", resource_id=place_id))
    return update_place(db, place, place_data.model_dump(exclude_unset=True))


@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_place_api(
    place_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Delete a place (authentication required)."""
    place = get_place_by_id(db, place_id)
    if not place:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    db.add(AuditLog(actor_id=current_user.id, action="delete", resource="places", resource_id=place_id))
    delete_place(db, place)
