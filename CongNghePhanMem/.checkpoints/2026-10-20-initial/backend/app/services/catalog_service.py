"""Reviewed, additive HCMC catalog import through the authenticated Admin API."""
import json
import math
from functools import lru_cache
from pathlib import Path
import unicodedata

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin import AdminSetting, AuditLog
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.schemas.place import PlaceCreate

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "hcmc_catalog.json"
LANGUAGES = {"vi", "en", "fr", "ja"}


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFD", value).lower().replace("đ", "d")
    return " ".join("".join(c for c in value if not unicodedata.combining(c)).split())


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    bundle = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    keys = set()
    for item in bundle["places"]:
        data = PlaceCreate.model_validate(item["place"])
        if not math.isfinite(data.latitude) or not math.isfinite(data.longitude):
            raise ValueError("Invalid catalog coordinates")
        if item["key"] in keys or set(item["guides"]) != LANGUAGES or not item["sources"]:
            raise ValueError("Invalid catalog entry")
        if any(not text.strip() for text in item["guides"].values()):
            raise ValueError("Empty catalog guide")
        keys.add(item["key"])
    return bundle


def catalog_plan(db: Session, ledger: dict | None = None) -> dict:
    bundle = load_catalog()
    if ledger is None:
        row = db.get(AdminSetting, bundle["bundle_id"])
        ledger = row.value if row else {}
    existing = db.query(Place).all()
    rows = []
    for item in bundle["places"]:
        place = db.get(Place, ledger[item["key"]]) if item["key"] in ledger else None
        if place is None:
            names = {normalized(v) for v in [item["place"]["name"], *item["aliases"]]}
            matches = [p for p in existing if normalized(p.name) in names]
            nearby = [p for p in matches if math.hypot(p.latitude - item["place"]["latitude"],
                        p.longitude - item["place"]["longitude"]) < .0015]
            if len(nearby) > 1 or (matches and not nearby):
                raise HTTPException(409, f"Cần kiểm tra địa điểm trùng tên hoặc lệch tọa độ: {item['place']['name']}")
            place = nearby[0] if nearby else None
        present = {row.language_code for row in db.query(GuideContent).filter_by(place_id=place.id).all()} if place else set()
        rows.append({"key": item["key"], "name": item["place"]["name"], "place_id": place.id if place else None,
            "status": "existing" if place else "create", "missing_languages": sorted(LANGUAGES - present),
            "latitude": item["place"]["latitude"], "longitude": item["place"]["longitude"], "sources": item["sources"]})
    return {"bundle_id": bundle["bundle_id"], "reviewed_on": bundle["reviewed_on"], "rows": rows,
        "places_to_create": sum(row["status"] == "create" for row in rows),
        "guides_to_create": sum(len(row["missing_languages"]) for row in rows)}


def import_catalog(db: Session, actor_id: int) -> dict:
    bundle = load_catalog()
    # Lock the ledger if present. A concurrent first insert fails atomically on
    # its primary key instead of committing duplicate places or partial guides.
    ledger = db.execute(select(AdminSetting).where(AdminSetting.key == bundle["bundle_id"]).with_for_update()).scalar_one_or_none()
    if ledger is None:
        ledger = AdminSetting(key=bundle["bundle_id"], value={})
        db.add(ledger)
        db.flush()
    plan = catalog_plan(db, ledger.value)
    identifiers = dict(ledger.value)
    for item, row in zip(bundle["places"], plan["rows"]):
        place_id = row["place_id"]
        if place_id is None:
            place = Place(**PlaceCreate.model_validate(item["place"]).model_dump())
            db.add(place); db.flush()
            place_id = place.id
            db.add(AuditLog(actor_id=actor_id, action="create", resource="places", resource_id=place_id))
        identifiers[item["key"]] = place_id
        row["place_id"] = place_id
        for language in row["missing_languages"]:
            db.add(GuideContent(place_id=place_id, language_code=language,
                title=item["place"]["name"], content=item["guides"][language]))
            db.add(AuditLog(actor_id=actor_id, action="create", resource="guides", resource_id=place_id))
    ledger.value = identifiers
    db.add(AuditLog(actor_id=actor_id, action="import", resource=bundle["bundle_id"]))
    # The router owns commit/rollback for this entire import.
    return {**plan, "applied": True}
