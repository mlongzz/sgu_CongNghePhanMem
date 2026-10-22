"""Pydantic schemas for History endpoints."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class HistoryCreate(BaseModel):
    place_id: int


class HistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    place_id: int
    visited_at: datetime
