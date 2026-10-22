"""Convert local Overpass JSON/OSM GeoJSON into an Admin import preview payload.

No network requests or database writes. Convert regional PBF with an OSM-aware
tool first; polygon centres are never guessed by this converter.
"""
import argparse
import json
from pathlib import Path
import re

from app.schemas.imports import OsmImportPreview


def convert(snapshot: dict) -> tuple[dict, list[dict]]:
    places, rejected, seen = [], [], set()
    elements = snapshot.get("elements", snapshot.get("features", []))
    if not isinstance(elements, list):
        raise ValueError("Expected Overpass elements or GeoJSON features")
    for row in elements:
        if not isinstance(row, dict):
            rejected.append({"source_id": "", "reason": "invalid_element"})
            continue
        properties = row.get("properties", {}) or {}
        tags = row.get("tags", properties.get("tags", properties)) or {}
        identity = str(properties.get("@id", row.get("id", "")))
        if re.fullmatch(r"[nwr][1-9][0-9]*", identity):
            identity = {"n": "node", "w": "way", "r": "relation"}[identity[0]] + "/" + identity[1:]
        elif properties.get("@type") in ("node", "way", "relation"):
            identity = f"{properties['@type']}/{identity}"
        if row.get("type") in ("node", "way", "relation"):
            identity = f"{row['type']}/{row.get('id', '')}"
        reason = None
        if identity in seen:
            reason = "duplicate_source_identity"
        elif not tags.get("name"):
            reason = "missing_name"
        elif not (tags.get("tourism") or tags.get("historic") or tags.get("amenity") in
                  ("place_of_worship", "marketplace", "theatre", "arts_centre")):
            reason = "not_selected_poi_category"
        if reason:
            rejected.append({"source_id": identity, "reason": reason})
            continue
        if "geometry" in row:
            geometry = row.get("geometry") or {}
            if geometry.get("type") != "Point" or len(geometry.get("coordinates", [])) < 2:
                rejected.append({"source_id": identity, "reason": "point_geometry_required"})
                continue
            lon, lat = geometry["coordinates"][:2]
        else:
            point = row.get("center", row)
            lat, lon = point.get("lat"), point.get("lon")
        item = {"source_id": identity, "name": tags["name"], "latitude": lat, "longitude": lon,
                "category": tags.get("tourism") or tags.get("historic") or tags.get("amenity"),
                "description": tags.get("description"), "address": tags.get("addr:full")}
        try:
            validated = OsmImportPreview(places=[item]).places[0]
        except ValueError:
            rejected.append({"source_id": identity, "reason": "invalid_fields_or_coordinates"})
            continue
        seen.add(identity)
        places.append(validated.model_dump())
    if len(places) > 500:
        raise ValueError("Split the snapshot into reviewed batches of at most 500 POI")
    return {"places": places}, rejected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload, rejected = convert(json.loads(args.input.read_text(encoding="utf-8")))
    if args.output.resolve() == args.input.resolve():
        parser.error("Output must not overwrite the source snapshot")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"mode": "preview_only", "accepted": len(payload["places"]), "rejected": rejected,
                      "attribution": "© OpenStreetMap contributors", "license": "ODbL 1.0",
                      "database_writes": 0}, ensure_ascii=True))


if __name__ == "__main__":
    main()
