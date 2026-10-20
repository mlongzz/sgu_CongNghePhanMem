"""Pydantic schemas for Place endpoints."""
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PlaceMetadata(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid", allow_inf_nan=False)

    publication_status: Literal["draft", "published"] = "draft"
    source: str = Field(default="manual", min_length=1, max_length=50)
    source_id: str | None = Field(default=None, min_length=1, max_length=200)
    source_url: str | None = Field(default=None, max_length=1000)
    source_license: str | None = Field(default=None, max_length=200)
    image_source_url: str | None = Field(default=None, max_length=1000)
    image_attribution: str | None = Field(default=None, max_length=500)
    image_license: str | None = Field(default=None, max_length=200)

    @field_validator("source_url", "image_source_url")
    @classmethod
    def public_source_url(cls, value):
        if value is not None:
            parts = urlsplit(value)
            if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
                raise ValueError("Source URL must be HTTP(S) without credentials")
        return value


class PlaceCreate(PlaceMetadata):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    address: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    image_url: str | None = Field(default=None, max_length=500)


class PlaceUpdate(PlaceMetadata):
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
        for field in ("name", "latitude", "longitude", "publication_status", "source"):
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
    publication_status: Literal["draft", "published"]
    deleted_at: datetime | None
    source: str
    source_id: str | None
    source_url: str | None
    source_license: str | None
    image_source_url: str | None
    image_attribution: str | None
    image_license: str | None


class NearbyPlaceResponse(PlaceResponse):
    """PlaceResponse with an extra distance_km field."""
    distance_km: float
