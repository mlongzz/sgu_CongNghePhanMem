"""Review a checked-in primary-source snapshot; never fetch or publish on import."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.models.admin import AdminSetting, AuditLog
from app.models.place import Place
from app.services.catalog_service import load_catalog, normalized
from app.services.place_service import _haversine_km

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "hcmc_discovery_review.json"
BUNDLE_ID = "hcmc-wikipedia-primary-review-v1"


class WikipediaReviewPlace(BaseModel):
    # Extra source evidence is retained in the ledger, never mapped blindly to Place.
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True, allow_inf_nan=False)
    source: str = Field(pattern="^wikipedia$")
    source_id: str = Field(pattern=r"^(vi|en):[1-9][0-9]*$", max_length=100)
    name: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    category: str = Field(min_length=1, max_length=100)
    source_url: str
    source_revision_id: int = Field(gt=0)
    source_revision_url: str
    wikidata_id: str | None = Field(default=None, pattern=r"^Q[1-9][0-9]*$")
    license: str = Field(pattern="^CC-BY-SA-4.0$")
    license_url: str = Field(pattern=r"^https://creativecommons\.org/licenses/by-sa/4\.0/$")
    attribution: str = Field(min_length=1, max_length=500)
    fetched_at: str = Field(min_length=1, max_length=100)
    review_status: str = Field(pattern="^pending_admin_review$")
    publication_status: str = Field(pattern="^draft$")

    @model_validator(mode="after")
    def source_links_match_identity(self):
        language, page_id = self.source_id.split(":")
        origin = f"https://{language}.wikipedia.org"
        if self.source_url != f"{origin}/?curid={page_id}":
            raise ValueError("Source page URL must match its Wikipedia identity")
        if self.source_revision_url != f"{origin}/w/index.php?oldid={self.source_revision_id}":
            raise ValueError("Source revision URL must match its revision ID")
        return self


def load_review_catalog():
    bundle = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if bundle.get("bundle_id") != BUNDLE_ID or not 1 <= len(bundle.get("places", [])) <= 500:
        raise ValueError("Invalid Wikipedia review bundle")
    places = [WikipediaReviewPlace.model_validate(row) for row in bundle["places"]]
    identities = [row.source_id for row in places]
    wikidata = [row.wikidata_id for row in places if row.wikidata_id]
    if len(set(identities)) != len(identities) or len(set(wikidata)) != len(wikidata):
        raise ValueError("Duplicate source identity in Wikipedia review bundle")
    return bundle, places


def _name_key(value):
    return normalized(re.sub(r"\s*\([^)]*\)", "", value))


def _name_keys(value):
    keys = {_name_key(value)}
    # Existing reviewed aliases and source article titles provide evidenced
    # bilingual matches; never guess a translation to merge catalog records.
    for entry in load_catalog()["places"]:
        names = [entry["place"]["name"], *entry["aliases"]]
        for source in entry["sources"]:
            url = urlsplit(source)
            if url.hostname in {"vi.wikipedia.org", "en.wikipedia.org"} and url.path.startswith("/wiki/"):
                names.append(unquote(url.path[6:]).replace("_", " "))
        aliases = {_name_key(name) for name in names}
        if keys & aliases:
            keys |= aliases
    return keys


def discovery_plan(db, source_ids=None):
    bundle, places = load_review_catalog()
    if source_ids is not None:
        requested = set(source_ids)
        if not requested <= {place.source_id for place in places}:
            raise HTTPException(422, "Selection includes a source identity outside the review bundle")
        places = [place for place in places if place.source_id in requested]
    existing = db.query(Place).all()
    rows, accepted = [], []
    for item in places:
        identity = next((row for row in existing if row.source == "wikipedia" and row.source_id == item.source_id), None)
        names = _name_keys(item.name)
        duplicate = next((row for row in existing if _name_keys(row.name) & names and
                          _haversine_km(row.latitude, row.longitude, item.latitude, item.longitude) <= .15), None)
        batch_duplicate = next((row for row in accepted if _name_keys(row.name) & names and
                                _haversine_km(row.latitude, row.longitude, item.latitude, item.longitude) <= .15), None)
        status, reason, match = "create", None, None
        if identity:
            status, match = "existing", identity
            reason = "Preserve existing content and provenance; archived entries are not restored"
        elif duplicate:
            status, match = "conflict", duplicate
            reason = "Matching name within 150 m; review the existing place before importing"
        elif batch_duplicate:
            status, reason = "conflict", "Matching name within 150 m in this selection"
        else:
            accepted.append(item)
        rows.append({**item.model_dump(), "status": status, "reason": reason,
                     "place_id": match.id if match else None, "deleted": bool(match and match.deleted_at),
                     "existing_publication_status": match.publication_status if match else None})
    token = hashlib.sha256(json.dumps({"bundle": bundle, "rows": rows}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {"bundle_id": BUNDLE_ID, "fetched_at": bundle.get("fetched_at"), "verification": bundle.get("verification", {}),
            "rows": rows, "places_to_create": sum(row["status"] == "create" for row in rows),
            "existing": sum(row["status"] == "existing" for row in rows),
            "conflicts": sum(row["status"] == "conflict" for row in rows), "preview_token": token,
            "guides_to_create": 0, "publication_status": "draft"}


def import_discovery(db, actor_id, source_ids, preview_token):
    ledger = db.execute(select(AdminSetting).where(AdminSetting.key == BUNDLE_ID).with_for_update()).scalar_one_or_none()
    if ledger is None:
        ledger = AdminSetting(key=BUNDLE_ID, value={})
        db.add(ledger)
        db.flush()
    plan = discovery_plan(db, source_ids)
    if preview_token != plan["preview_token"]:
        raise HTTPException(409, "Review bundle or database changed after preview; preview again")
    if plan["conflicts"]:
        raise HTTPException(409, "Resolve all selected conflicts before importing")
    provenance = dict(ledger.value)
    for row in plan["rows"]:
        if row["status"] != "create":
            continue
        place = Place(name=row["name"], latitude=row["latitude"], longitude=row["longitude"], category=row["category"],
                      source="wikipedia", source_id=row["source_id"], source_url=row["source_url"],
                      source_license=row["license"], publication_status="draft")
        db.add(place)
        db.flush()
        row["place_id"] = place.id
        provenance[row["source_id"]] = {"place_id": place.id, "snapshot": {key: value for key, value in row.items()
                                            if key not in {"status", "reason", "place_id", "deleted", "existing_publication_status"}}}
        db.add(AuditLog(actor_id=actor_id, action="import", resource="wikipedia", resource_id=place.id))
    ledger.value = provenance
    return {**plan, "applied": True}
