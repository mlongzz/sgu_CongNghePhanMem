from pydantic import BaseModel, Field


class GuideTranslationRequest(BaseModel):
    target_language: str = Field(
        min_length=2,
        max_length=10,
        pattern=r"^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$",
    )
    overwrite: bool = False
