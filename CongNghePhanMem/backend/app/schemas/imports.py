"""Bounded payload for reviewed OSM imports; publication is never accepted here."""
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.admin import ImportApproval


class OsmImportPlace(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid", allow_inf_nan=False)
    source_id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]*$", max_length=100)
    name: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=255)


class OsmImportPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    places: list[OsmImportPlace] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique_source_ids(self):
        identities = [place.source_id for place in self.places]
        if len(identities) != len(set(identities)):
            raise ValueError("Each OSM source identity must occur once per batch")
        return self


class OsmImportApply(OsmImportPreview, ImportApproval):
    pass


class WikipediaSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_ids: list[str] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def unique_source_ids(self):
        if len(set(self.source_ids)) != len(self.source_ids):
            raise ValueError("Each source identity must occur once per selection")
        return self


class WikipediaImportApproval(WikipediaSelection, ImportApproval):
    pass
