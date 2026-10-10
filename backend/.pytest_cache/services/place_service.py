"""Place service layer with pagination, update, delete and optimised nearby search."""
from math import atan2, cos, radians, sin, sqrt

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.place import Place


# ─── Read ─────────────────────────────────────────────────────────────────────

def get_places(db: Session, limit: int = 20, offset: int = 0) -> list[Place]:
    """Return a paginated list of all places."""
    return db.query(Place).order_by(Place.id).offset(offset).limit(limit).all()


def count_places(db: Session) -> int:
    return db.query(Place).count()


def get_place_by_id(db: Session, place_id: int) -> Place | None:
    return db.query(Place).filter(Place.id == place_id).first()


def search_places(db: Session, keyword: str, limit: int = 20, offset: int = 0) -> list[Place]:
    """Case-insensitive search by name or category with pagination."""
    return (
        db.query(Place)
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
    return 6371 * 2 * atan2(sqrt(a), sqrt(1 - a))


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
    lat_delta = radius_km / 111.0
    lat_min = max(-90.0, latitude - lat_delta)
    lat_max = min(90.0, latitude + lat_delta)
    cos_latitude = abs(cos(radians(latitude)))
    lon_delta = 180.0 if cos_latitude < 1e-12 else min(180.0, radius_km / (111.0 * cos_latitude))

    query = db.query(Place).filter(Place.latitude.between(lat_min, lat_max))
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
        dist = _haversine_km(latitude, longitude, place.latitude, place.longitude)
        if dist <= radius_km:
            nearby.append((place, dist))

    nearby.sort(key=lambda x: (x[1], x[0].id))
    return nearby[:limit]


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
) -> Place:
    place = Place(
        name=name,
        description=description,
        latitude=latitude,
        longitude=longitude,
        address=address,
        category=category,
        image_url=image_url,
    )
    db.add(place)
    db.commit()
    db.refresh(place)
    return place


def update_place(db: Session, place: Place, changes: dict) -> Place:
    for field, value in changes.items():
        setattr(place, field, value)
    db.commit()
    db.refresh(place)
    return place


def delete_place(db: Session, place: Place) -> None:
    db.delete(place)
    db.commit()
