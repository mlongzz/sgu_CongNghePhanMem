"""Offline OSM snapshots enter the official catalog as drafts after review."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.admin import AuditLog
from app.models.place import Place
from app.schemas.imports import OsmImportPreview
from app.services.catalog_service import normalized
from app.services.place_service import _haversine_km

ATTRIBUTION = "© OpenStreetMap contributors"
LICENSE = "Open Database License (ODbL) 1.0"


def preview_osm_import(db: Session, payload: OsmImportPreview) -> dict:
    existing = db.query(Place).all()
    rows, accepted = [], []
    for item in payload.places:
        identity = next((p for p in existing if p.source == "osm" and p.source_id == item.source_id), None)
        duplicate = next((p for p in existing if normalized(p.name) == normalized(item.name) and
                          _haversine_km(p.latitude, p.longitude, item.latitude, item.longitude) <= .15), None)
        batch_duplicate = any(normalized(other.name) == normalized(item.name) and
                              _haversine_km(other.latitude, other.longitude, item.latitude, item.longitude) <= .15
                              for other in accepted)
        status, reason, match = "create", None, None
        if identity:
            status, match = "existing", identity
            reason = "Preserve existing content; archived entries are not restored"
        elif duplicate:
            status, match = "conflict", duplicate
            reason = "Matching name within 150 m; review source identity before importing"
        elif batch_duplicate:
            status, reason = "conflict", "Matching name within 150 m in this batch"
        else:
            accepted.append(item)
        rows.append({"source_id": item.source_id, "name": item.name, "status": status,
                     "place_id": match.id if match else None, "reason": reason,
                     "latitude": item.latitude, "longitude": item.longitude,
                     "publication_status": match.publication_status if match else "draft",
                     "deleted": bool(match and match.deleted_at)})
    token = hashlib.sha256(json.dumps({"input": payload.model_dump(include={"places"}), "rows": rows},
                                     sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {"rows": rows, "places_to_create": sum(r["status"] == "create" for r in rows),
            "existing": sum(r["status"] == "existing" for r in rows),
            "conflicts": sum(r["status"] == "conflict" for r in rows), "preview_token": token,
            "attribution": ATTRIBUTION, "license": LICENSE,
            "license_url": "https://opendatacommons.org/licenses/odbl/1-0/"}


def apply_osm_import(db: Session, payload, actor_id: int) -> dict:
    plan = preview_osm_import(db, payload)
    if payload.preview_token != plan["preview_token"]:
        raise HTTPException(409, "Import changed after preview; review the latest preview")
    if plan["conflicts"]:
        raise HTTPException(409, "Resolve all preview conflicts before importing")
    for item, row in zip(payload.places, plan["rows"]):
        if row["status"] != "create":
            continue
        place = Place(**item.model_dump(), source="osm", source_url="https://www.openstreetmap.org/" + item.source_id,
                      source_license=LICENSE, publication_status="draft")
        db.add(place)
        db.flush()
        row["place_id"] = place.id
        db.add(AuditLog(actor_id=actor_id, action="import", resource="osm", resource_id=place.id))
    return {**plan, "applied": True}
