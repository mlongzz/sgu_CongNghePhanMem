"""Read-only community POI; these IDs never identify PostgreSQL places."""
from typing import Literal

from pydantic import BaseModel, Field


class OsmCenter(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class OsmElement(BaseModel):
    type: Literal["node", "way", "relation"]
    id: int = Field(gt=0)
    lat: float | None = None
    lon: float | None = None
    center: OsmCenter | None = None
    tags: dict[str, str]


class OsmNearbyResponse(BaseModel):
    source: Literal["openstreetmap"] = "openstreetmap"
    elements: list[OsmElement]
    requested_radius_km: float
    searched_radius_km: float
    warning: str = ""
