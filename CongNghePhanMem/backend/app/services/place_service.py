"""Place service layer with pagination, update, delete and optimised nearby search."""
from datetime import datetime, timezone
from math import asin, atan2, cos, degrees, isfinite, pi, radians, sin, sqrt

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.place import Place
from app.services.media_service import remove_unused_image

EARTH_RADIUS_KM = 6371.0


def public_places(db: Session):
    return db.query(Place).filter(Place.publication_status == "published", Place.deleted_at.is_(None))


# ─── Read ─────────────────────────────────────────────────────────────────────

def get_places(db: Session, limit: int = 20, offset: int = 0) -> list[Place]:
    """Return a paginated list of all places."""
    return public_places(db).order_by(Place.id).offset(offset).limit(limit).all()


def count_places(db: Session) -> int:
    return public_places(db).count()


def get_place_by_id(db: Session, place_id: int, *, include_unpublished: bool = False) -> Place | None:
    query = db.query(Place) if include_unpublished else public_places(db)
    return query.filter(Place.id == place_id).first()


def search_places(db: Session, keyword: str, limit: int = 20, offset: int = 0) -> list[Place]:
    """Case-insensitive search by name or category with pagination."""
    return (
        public_places(db)
        .filter(
            Place.name.ilike(f"%{keyword}%") | Place.category.ilike(f"%{keyword}%")
        )
        .order_by(Place.name)
        .offset(offset)
        .limit(limit)
        .all()
    )


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in kilometres between two points."""
    r_lat1, r_lon1, r_lat2, r_lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = r_lat2 - r_lat1
    dlon = r_lon2 - r_lon1
    a = sin(dlat / 2) ** 2 + cos(r_lat1) * cos(r_lat2) * sin(dlon / 2) ** 2
    a = min(1.0, max(0.0, a))
    return EARTH_RADIUS_KM * 2 * atan2(sqrt(a), sqrt(1 - a))


def get_nearby_places(
    db: Session,
    latitude: float,
    longitude: float,
    radius_km: float = 10,
    limit: int = 20,
) -> list[tuple[Place, float]]:
    """
    Return (place, distance_km) tuples within *radius_km*, sorted by distance.

    Uses a bounding-box SQL pre-filter to avoid loading the entire table into RAM,
    then applies the accurate Haversine formula on the reduced result set.
    """
    if (not all(isfinite(v) for v in (latitude, longitude, radius_km)) or
            not -90 <= latitude <= 90 or not -180 <= longitude <= 180 or
            not 0 < radius_km <= 500 or not 1 <= limit <= 100):
        raise ValueError("Invalid nearby coordinates, radius or limit")
    angular_radius = radius_km / EARTH_RADIUS_KM
    lat_delta = degrees(angular_radius)
    lat_min = max(-90.0, latitude - lat_delta)
    lat_max = min(90.0, latitude + lat_delta)
    # A search circle that includes either pole spans every longitude. Else,
    # asin gives the exact spherical cap bound; radius / cos(latitude) can
    # silently exclude valid points at high latitudes.
    reaches_pole = abs(radians(latitude)) + angular_radius >= pi / 2
    lon_delta = 180.0 if reaches_pole else degrees(asin(min(1.0, sin(angular_radius) / cos(radians(latitude)))))

    query = public_places(db).filter(Place.latitude.between(lat_min, lat_max), Place.longitude.between(-180, 180))
    if lon_delta < 180:
        west = longitude - lon_delta
        east = longitude + lon_delta
        if west < -180:
            longitude_filter = or_(Place.longitude >= west + 360, Place.longitude <= east)
        elif east > 180:
            longitude_filter = or_(Place.longitude >= west, Place.longitude <= east - 360)
        else:
            longitude_filter = Place.longitude.between(west, east)
        query = query.filter(longitude_filter)
    candidates = query.all()

    nearby: list[tuple[Place, float]] = []
    for place in candidates:
        if not isfinite(place.latitude) or not isfinite(place.longitude):
            continue
        dist = _haversine_km(latitude, longitude, place.latitude, place.longitude)
        if dist <= radius_km:
            nearby.append((place, dist))

    nearby.sort(key=lambda x: (x[1], x[0].id))
    # Source identities are unique in storage. Historical duplicate rows with
    # the same name and coordinates (six decimal degrees) collapse stably.
    seen = set()
    deduplicated = []
    for place, distance in nearby:
        key = (" ".join(place.name.casefold().split()), round(place.latitude, 6), round(place.longitude, 6))
        if key not in seen:
            seen.add(key)
            deduplicated.append((place, distance))
    return deduplicated[:limit]


# ─── Write ────────────────────────────────────────────────────────────────────

def create_place(
    db: Session,
    name: str,
    description: str | None,
    latitude: float,
    longitude: float,
    address: str | None,
    category: str | None,
    image_url: str | None,
    **metadata,
) -> Place:
    place = Place(
        name=name,
        description=description,
        latitude=latitude,
        longitude=longitude,
        address=address,
        category=category,
        image_url=image_url,
        **metadata,
    )
    db.add(place)
    db.commit()
    db.refresh(place)
    return place


def update_place(db: Session, place: Place, changes: dict) -> Place:
    old_image = place.image_url
    for field, value in changes.items():
        setattr(place, field, value)
    db.commit()
    db.refresh(place)
    remove_unused_image(db, old_image)
    return place


def delete_place(db: Session, place: Place) -> None:
    place.deleted_at = datetime.now(timezone.utc)
    place.publication_status = "draft"
    db.commit()
