"""Pydantic schemas for Review endpoints."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReviewCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5, description="Rating from 1 (worst) to 5 (best)")
    comment: str | None = Field(default=None, max_length=2000)


class ReviewUpdate(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def reject_null_rating(self):
        if "rating" in self.model_fields_set and self.rating is None:
            raise ValueError("rating cannot be null")
        return self


class ReviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    place_id: int
    rating: int
    comment: str | None
    created_at: datetime
    updated_at: datetime


class PlaceRatingSummary(BaseModel):
    """Aggregated rating info for a place."""
    place_id: int
    average_rating: float | None
    review_count: int
