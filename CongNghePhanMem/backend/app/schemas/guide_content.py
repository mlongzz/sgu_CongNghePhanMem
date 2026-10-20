from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GuideContentCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    language_code: str = Field(min_length=2, max_length=10, pattern=r"^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    publication_status: Literal["draft", "published"] = "draft"
    source_url: str | None = Field(default=None, max_length=1000)
    source_license: str | None = Field(default=None, max_length=200)


class GuideContentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    language_code: str | None = Field(default=None, min_length=2, max_length=10, pattern=r"^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1)
    publication_status: Literal["draft", "published"] | None = None
    source_url: str | None = Field(default=None, max_length=1000)
    source_license: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def reject_required_nulls(self):
        for key in ("language_code", "title", "content", "publication_status"):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError(f"{key} cannot be null")
        return self


class GuideContentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    place_id: int
    language_code: str
    title: str
    content: str
    created_at: datetime
    updated_at: datetime
    publication_status: Literal["draft", "published"]
    source_url: str | None
    source_license: str | None
