"""Pydantic schemas for Place endpoints."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PlaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    address: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    image_url: str | None = Field(default=None, max_length=500)


class PlaceUpdate(BaseModel):
    """All fields are optional — only provided fields are updated."""
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    address: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    image_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reject_null_for_required_columns(self):
        for field in ("name", "latitude", "longitude"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class PlaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    latitude: float
    longitude: float
    address: str | None
    category: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime


class NearbyPlaceResponse(PlaceResponse):
    """PlaceResponse with an extra distance_km field."""
    distance_km: float
