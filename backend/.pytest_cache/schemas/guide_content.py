from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GuideContentCreate(BaseModel):
    language_code: str = Field(min_length=2, max_length=10, pattern=r"^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


class GuideContentUpdate(BaseModel):
    language_code: str | None = Field(default=None, min_length=2, max_length=10, pattern=r"^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1)


class GuideContentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    place_id: int
    language_code: str
    title: str
    content: str
    created_at: datetime
    updated_at: datetime
