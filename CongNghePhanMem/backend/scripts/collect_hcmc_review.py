"""Read public OSM data into a local review bundle; never imports or connects to a DB.

Coordinates and names are verified against this retrieved primary-source snapshot,
not a field survey. All rows remain pending editorial review and unpublished.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
# A public city bounding box around the historical districts 1, 5, 6 and adjacent areas.
# It is not a user location, nor an assertion of current administrative boundaries.
BBOX = (10.71, 106.61, 10.82, 106.73)
QUERY = """[out:json][timeout:30];
(
  nwr["name"]["tourism"~"^(museum|attraction|gallery)$"](10.71,106.61,10.82,106.73);
  nwr["name"]["historic"](10.71,106.61,10.82,106.73);
  nwr["name"]["amenity"~"^(marketplace|place_of_worship|theatre|arts_centre)$"](10.71,106.61,10.82,106.73);
);
out center tags;"""
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "app/data/hcmc_discovery_review.json"


def finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalize(value: str) -> str:
    return re.sub(r"\W+", " ", unicodedata.normalize("NFKD", value).casefold()).strip()


def km(a: dict, b: dict) -> float:
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat = lat2 - lat1
    dlon = math.radians(b["longitude"] - a["longitude"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(h)))


def category(tags: dict) -> str:
    if tags.get("tourism") in {"museum", "gallery"} or tags.get("amenity") == "arts_centre":
        return "Văn hóa"
    if tags.get("historic"):
        return "Lịch sử"
    if tags.get("amenity") == "place_of_worship":
        return "Kiến trúc"
    return "Khám phá"


def candidate(element: object) -> dict | None:
    if not isinstance(element, dict) or element.get("type") not in {"node", "way", "relation"}:
        return None
    identifier = element.get("id")
    if not isinstance(identifier, int) or isinstance(identifier, bool) or identifier <= 0:
        return None
    tags = element.get("tags")
    if not isinstance(tags, dict) or not isinstance(tags.get("name"), str) or not tags["name"].strip():
        return None
    if len(tags["name"].strip()) > 200 or re.search(r"[\x00-\x1f\x7f]", tags["name"]):
        return None
    if not (tags.get("tourism") in {"museum", "attraction", "gallery"}
            or tags.get("historic") not in {None, "", "no"}
            or tags.get("amenity") in {"marketplace", "place_of_worship", "theatre", "arts_centre"}):
        return None
    if tags.get("disused") == "yes" or tags.get("abandoned") == "yes" or tags.get("historic") == "no":
        return None
    coordinates = element if element["type"] == "node" else element.get("center")
    if not isinstance(coordinates, dict):
        return None
    lat, lon = coordinates.get("lat"), coordinates.get("lon")
    south, west, north, east = BBOX
    if not finite(lat) or not finite(lon) or not south <= lat <= north or not west <= lon <= east:
        return None
    identity = f"{element['type']}/{identifier}"
    return {
        "key": f"osm-{element['type']}-{identifier}",
        "source": "osm",
        "source_id": identity,
        "name": tags["name"].strip(),
        "latitude": lat,
        "longitude": lon,
        "coordinate_role": "mapped_point" if element["type"] == "node" else "geometry_center_not_entrance",
        "category": category(tags),
        "source_url": f"https://www.openstreetmap.org/{identity}",
        "license": "ODbL-1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "© OpenStreetMap contributors",
        "review_status": "pending_admin_review",
        "publication_status": "draft",
        "source_tags": {key: value for key, value in sorted(tags.items()) if isinstance(value, str)},
    }


def priority(row: dict) -> tuple:
    tags = row["source_tags"]
    rank = 0 if tags.get("tourism") == "museum" else 1 if tags.get("amenity") == "marketplace" else 2 if tags.get("historic") else 3
    return rank, 0 if tags.get("wikipedia") or tags.get("wikidata") else 1, normalize(row["name"]), row["source_id"]


def select_places(elements: list, limit: int) -> list[dict]:
    unique: list[dict] = []
    identities: set[str] = set()
    for row in sorted(filter(None, (candidate(element) for element in elements)), key=priority):
        if row["source_id"] in identities:
            continue
        identities.add(row["source_id"])
        if any(normalize(other["name"]) == normalize(row["name"]) and km(other, row) < 0.15 for other in unique):
            continue
        unique.append(row)
    # A balanced review set covers western Cholon as well as central tourist sites.
    # These longitude bands do not assign an administrative district to any POI.
    zones = [[row for row in unique if predicate(row["longitude"])] for predicate in (
        lambda lon: lon < 106.65, lambda lon: 106.65 <= lon < 106.68, lambda lon: lon >= 106.68,
    )]
    selected: list[dict] = []
    while len(selected) < limit and any(zones):
        for zone in zones:
            if zone and len(selected) < limit:
                selected.append(zone.pop(0))
    return selected


def fetch_snapshot() -> tuple[dict, str]:
    errors = []
    for endpoint in ENDPOINTS:
        print(f"Reading public OSM snapshot from {endpoint}", file=sys.stderr, flush=True)
        request = Request(endpoint + "?" + urlencode({"data": QUERY}),
                          headers={"User-Agent": "MultilingualGuide/1.0 (read-only educational POI review)", "Accept": "application/json"})
        try:
            with urlopen(request, timeout=45) as response:
                data = json.load(response)
            if not isinstance(data, dict) or not isinstance(data.get("elements"), list) or data.get("remark"):
                raise ValueError("Overpass returned an incomplete or invalid snapshot")
            return data, endpoint
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            errors.append(f"{endpoint}: {error}")
    raise RuntimeError("; ".join(errors))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--snapshot", type=Path, help="Use an already downloaded Overpass JSON snapshot without networking")
    parser.add_argument("--allow-network", action="store_true", help="Explicitly allow public, read-only Overpass requests")
    parser.add_argument("--limit", type=int, default=45, choices=range(1, 51))
    parser.add_argument("--refresh", action="store_true", help="Explicitly replace an existing local review bundle")
    args = parser.parse_args()
    if not args.snapshot and not args.allow_network:
        print(json.dumps({"mode": "preview", "network_requests": 0, "database_writes": False,
                          "query_bbox": BBOX, "requested_limit": args.limit, "output": str(args.output)}))
        return 0
    raw_output = args.output.with_name(args.output.stem + ".overpass.json")
    if not args.refresh and (args.output.exists() or raw_output.exists()):
        parser.error("Output exists; review changes before explicitly using --refresh")
    if args.snapshot:
        data = json.loads(args.snapshot.read_text(encoding="utf-8"))
        endpoint = "local_snapshot"
    else:
        data, endpoint = fetch_snapshot()
    if not isinstance(data, dict) or not isinstance(data.get("elements"), list) or data.get("remark"):
        raise ValueError("Incomplete or invalid Overpass snapshot; no review bundle written")
    fetched_at = datetime.now(timezone.utc).isoformat()
    places = select_places(data["elements"], args.limit)
    raw_bytes = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    for row in places:
        row["fetched_at"] = fetched_at
    bundle = {
        "bundle_id": "hcmc-osm-primary-review-v1",
        "fetched_at": fetched_at,
        "endpoint": endpoint,
        "query": QUERY,
        "query_bbox": dict(zip(("south", "west", "north", "east"), BBOX)),
        "source_dataset_timestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
        "raw_snapshot": raw_output.name,
        "raw_snapshot_sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "source_count": len(data["elements"]),
        "selected_count": len(places),
        "verification": {
            "method": "Names, stable OSM identities and coordinates checked against the included primary-source response.",
            "limits": "Community mapping is not a field survey. Geometry centers are not entrances. No editorial descriptions or images were invented; no rows are approved or imported.",
            "administrative_areas": "Query covers historical districts 1, 5, 6 and adjacent areas; no administrative district is inferred from coordinates.",
            "database_writes": False,
        },
        "license": "ODbL-1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "© OpenStreetMap contributors",
        "attribution_url": "https://www.openstreetmap.org/copyright",
        "review_status": "pending_admin_review",
        "places": places,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    raw_output.write_bytes(raw_bytes)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "selected": len(places), "source_count": len(data["elements"]),
                      "raw_snapshot_sha256": bundle["raw_snapshot_sha256"], "database_writes": False}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError) as exc:
        print(f"Collection failed: {exc}", file=sys.stderr)
        sys.exit(1)
