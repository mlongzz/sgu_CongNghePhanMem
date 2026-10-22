"""Collect exact Wikipedia page identities and coordinates for local Admin review.

Candidate titles are lookup hints, never asserted POI. Only returned main-namespace,
non-disambiguation pages with real primary Earth coordinates in the city bbox enter
the bundle. The script never connects to a database or publishes a place.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ENDPOINT = "https://vi.wikipedia.org/w/api.php"
BBOX = (10.71, 106.61, 10.82, 106.73)
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "app/data/hcmc_discovery_review.json"
TITLES = (
    "Chợ Bình Tây", "Chợ Bình Điền", "Chợ Kim Biên", "Chợ An Đông", "Chợ Hòa Bình",
    "Chùa Giác Lâm", "Chùa Giác Viên", "Chùa Phụng Sơn", "Chùa Vạn Phật",
    "Chùa Bà Thiên Hậu (Thành phố Hồ Chí Minh)", "Chùa Thiên Hậu (Thành phố Hồ Chí Minh)",
    "Hội quán Nghĩa An", "Hội quán Hà Chương", "Hội quán Ôn Lăng", "Hội quán Quỳnh Phủ",
    "Nhà thờ Cha Tam", "Nhà thờ Chợ Quán", "Nhà thờ Jeanne d'Arc", "Nhà thờ Ngã Sáu",
    "Đình Bình Đông", "Đình Minh Hương Gia Thạnh", "Chùa Nam Phổ Đà", "Chùa Từ Ân",
    "Chùa Huê Lâm", "Chùa Sùng Đức", "Chùa Tuyền Lâm", "Chùa Bửu Sơn (Thành phố Hồ Chí Minh)",
    "Dinh Độc Lập", "Bưu điện trung tâm Sài Gòn", "Nhà thờ chính tòa Đức Bà Sài Gòn",
    "Chợ Bến Thành", "Bảo tàng Mỹ thuật Thành phố Hồ Chí Minh", "Nhà hát Thành phố Hồ Chí Minh",
    "Trụ sở Ủy ban nhân dân Thành phố Hồ Chí Minh", "Thảo Cầm Viên Sài Gòn",
    "Bảo tàng Lịch sử Thành phố Hồ Chí Minh", "Bảo tàng Thành phố Hồ Chí Minh",
    "Bảo tàng Chứng tích chiến tranh", "Chùa Ngọc Hoàng", "Công viên Tao Đàn", "Công viên 23 tháng 9",
    "Đền thờ Vua Hùng (Thành phố Hồ Chí Minh)", "Đường sách Thành phố Hồ Chí Minh",
    "Thư viện Khoa học Tổng hợp Thành phố Hồ Chí Minh", "Bảo tàng Tôn Đức Thắng", "Bến Nhà Rồng",
    "Chùa Xá Lợi", "Chùa Vĩnh Nghiêm", "Chùa Ấn Quang", "Việt Nam Quốc Tự", "Lăng Ông Bà Chiểu",
    "Nhà thờ Tân Định", "Nhà thờ Huyện Sĩ", "Nhà thờ Hạnh Thông Tây", "Chợ Tân Định",
    "Chùa Bà Ấn", "Đền Sri Thenday Yuttha Panin", "Tháp Bitexco Financial",
    "Bến Bạch Đằng", "Đường đi bộ Nguyễn Huệ", "Cầu Mống", "Cầu Khánh Hội", "Cầu Ba Son",
    "Địa đạo Phú Thọ Hòa", "Công viên Lê Văn Tám", "Hồ Con Rùa", "Bảo tàng Phụ nữ Nam Bộ",
    "Bảo tàng Chiến dịch Hồ Chí Minh", "Bảo tàng Lực lượng vũ trang miền Đông Nam Bộ",
    "Bảo tàng Áo dài", "Tu viện Khánh An", "Chùa Hoằng Pháp", "Chùa Phước Hải",
)
ENGLISH_TITLES = (
    "Thien Hau Temple (Ho Chi Minh City)", "Nghia An Hoi Quan", "Phuoc An Hoi Quan",
    "Huyen Sy Church", "Cha Tam Church", "Cho Quan Church", "Giac Vien Pagoda",
    "Phung Son Temple", "Xa Loi Pagoda", "Vinh Nghiem Pagoda", "An Quang Pagoda",
    "Jade Emperor Pagoda", "War Remnants Museum", "Ho Chi Minh City Museum of Fine Arts",
    "Museum of Vietnamese History", "Ton Duc Thang Museum", "Ho Chi Minh Museum (Ho Chi Minh City)",
    "Mariamman Temple, Ho Chi Minh City", "Sri Thendayuthapani Temple, Ho Chi Minh City",
    "Ho Chi Minh City Book Street", "Nguyen Hue Boulevard", "Bitexco Financial Tower",
    "Mong Bridge", "Vietnam Quoc Tu Pagoda", "Ba Thien Hau Temple", "Quan Am Pagoda",
)
TITLE_SETS = {"vi": TITLES, "en": ENGLISH_TITLES}


def category(title: str) -> str:
    if title.startswith(("Chùa", "Nhà thờ", "Hội quán", "Đình", "Đền", "Tu viện", "Tháp", "Bưu điện")):
        return "Kiến trúc"
    if title.startswith(("Bảo tàng", "Chợ", "Nhà hát", "Thư viện", "Đường sách")):
        return "Văn hóa"
    if title.startswith(("Dinh", "Lăng", "Địa đạo")):
        return "Lịch sử"
    # These are editorial suggestions, never a claim retrieved from an article.
    if "Museum" in title or "Market" in title:
        return "Văn hóa"
    if any(word in title for word in ("Temple", "Pagoda", "Church", "Tower", "Hoi Quan")):
        return "Kiến trúc"
    return "Khám phá"


def row_from_page(page: object, fetched_at: str, language: str = "vi") -> dict | None:
    if language not in TITLE_SETS:
        raise ValueError("Only configured Wikipedia language endpoints are allowed")
    if not isinstance(page, dict) or "missing" in page or "invalid" in page or page.get("ns") != 0:
        return None
    identifier = page.get("pageid")
    title = page.get("title")
    if not isinstance(identifier, int) or isinstance(identifier, bool) or identifier <= 0:
        return None
    if not isinstance(title, str) or not title.strip() or len(title) > 200 or any(ord(char) < 32 for char in title):
        return None
    properties = page.get("pageprops", {})
    if not isinstance(properties, dict) or "disambiguation" in properties:
        return None
    revision = page.get("lastrevid")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision <= 0:
        return None
    coordinates = page.get("coordinates")
    if not isinstance(coordinates, list):
        return None
    coordinate = next((point for point in coordinates if isinstance(point, dict)
                       and point.get("globe") == "earth" and point.get("primary") is True), None)
    if not coordinate:
        return None
    lat, lon = coordinate.get("lat"), coordinate.get("lon")
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in (lat, lon)):
        return None
    south, west, north, east = BBOX
    if not south <= lat <= north or not west <= lon <= east:
        return None
    row = {
        "key": f"wiki-{language}-{identifier}", "source": "wikipedia", "source_id": f"{language}:{identifier}",
        "source_language": language,
        "name": title, "latitude": lat, "longitude": lon,
        "coordinate_role": "Wikipedia_primary_article_coordinate_not_verified_entrance",
        "category": category(title), "category_status": "editorial_suggestion_pending_review",
        "source_url": f"https://{language}.wikipedia.org/?curid={identifier}",
        "license": "CC-BY-SA-4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "attribution": f"Wikipedia contributors — {title}",
        "review_status": "pending_admin_review", "publication_status": "draft", "fetched_at": fetched_at,
    }
    row["source_revision_id"] = revision
    row["source_revision_url"] = f"https://{language}.wikipedia.org/w/index.php?oldid={revision}"
    wikidata = properties.get("wikibase_item")
    if isinstance(wikidata, str) and wikidata.startswith("Q") and wikidata[1:].isdigit():
        row["wikidata_id"] = wikidata
    return row


def fetch_pages(languages: tuple[str, ...] = ("vi", "en")) -> list[dict]:
    snapshots = []
    for language in languages:
        if language not in TITLE_SETS:
            raise ValueError("Unsupported Wikipedia language")
        endpoint = f"https://{language}.wikipedia.org/w/api.php"
        candidates = TITLE_SETS[language]
        for offset in range(0, len(candidates), 24):
            titles = candidates[offset:offset + 24]
            params = {"action": "query", "format": "json", "formatversion": "2", "redirects": "1",
                      "prop": "coordinates|info|pageprops", "colimit": "max", "coprimary": "primary", "inprop": "url",
                      "ppprop": "disambiguation|wikibase_item", "titles": "|".join(titles)}
            print(f"Reading exact {language} Wikipedia page batch {offset // 24 + 1}", file=sys.stderr, flush=True)
            request = Request(endpoint + "?" + urlencode(params), headers={
                "User-Agent": "MultilingualGuide/1.0 (read-only educational POI review)", "Accept": "application/json"})
            with urlopen(request, timeout=30) as response:
                data = json.load(response)
            if not isinstance(data, dict) or data.get("error") or not isinstance(data.get("query", {}).get("pages"), list):
                raise ValueError("Wikipedia returned an invalid/error response; no review bundle written")
            snapshots.append({"language": language, "endpoint": endpoint,
                              "fetched_at": datetime.now(timezone.utc).isoformat(),
                              "requested_titles": list(titles), "query_parameters": params, "response": data})
    return snapshots


def verified_rows(raw: list[dict]) -> tuple[list[dict], list[str], list[dict]]:
    """Prefer Vietnamese records and deduplicate cross-language Wikidata identity."""
    rows, missing, duplicates = {}, [], []
    identities: dict[str, str] = {}
    for batch in sorted(raw, key=lambda item: item.get("language", "vi") != "vi"):
        language = batch.get("language", "vi")
        fetched_at = batch.get("fetched_at")
        if not isinstance(fetched_at, str) or not fetched_at.strip():
            raise ValueError("Snapshot batch needs original fetched_at; replay must not invent a retrieval time")
        try:
            timestamp = datetime.fromisoformat(fetched_at)
        except ValueError as error:
            raise ValueError("Snapshot fetched_at must be an ISO timestamp") from error
        if timestamp.tzinfo is None:
            raise ValueError("Snapshot fetched_at must include a timezone")
        if batch.get("endpoint", ENDPOINT) != f"https://{language}.wikipedia.org/w/api.php":
            raise ValueError("Snapshot endpoint must match its configured Wikipedia language")
        for page in batch["response"]["query"]["pages"]:
            row = row_from_page(page, fetched_at, language)
            if not row:
                missing.append(f"{language}:{page.get('title', 'unknown')}")
                continue
            identity = row.get("wikidata_id", row["source_id"])
            if identity in identities and identities[identity] != row["source_id"]:
                duplicates.append({"retained_source_id": identities[identity], "excluded_source_id": row["source_id"],
                                   "wikidata_id": identity})
                continue
            identities[identity] = row["source_id"]
            rows[row["source_id"]] = row
    return list(rows.values()), missing, duplicates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-network", action="store_true")
    parser.add_argument("--snapshot", type=Path, help="Use a saved raw snapshot without networking")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=45, choices=range(1, 51))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if not args.snapshot and not args.allow_network:
        print(json.dumps({"mode": "preview", "candidate_titles": sum(map(len, TITLE_SETS.values())), "network_requests": 0,
                          "database_writes": False, "output": str(args.output)}))
        return 0
    raw_output = args.output.with_name(args.output.stem + ".wikipedia.json")
    if not args.refresh and (args.output.exists() or raw_output.exists()):
        parser.error("Output exists; review changes before explicitly using --refresh")
    raw = json.loads(args.snapshot.read_text(encoding="utf-8")) if args.snapshot else fetch_pages()
    if not isinstance(raw, list):
        raise ValueError("Raw snapshot must be an array of Wikipedia query responses")
    fetched_at = datetime.now(timezone.utc).isoformat()
    rows, missing, duplicates = verified_rows(raw)
    if not rows:
        raise ValueError("No source-verified POI found; existing review bundle was not overwritten")
    # Alternate western and central records so the limited set does not omit Cholon.
    ordered = sorted(rows, key=lambda row: (row["longitude"], row["name"]))
    selected = []
    while ordered and len(selected) < args.limit:
        selected.append(ordered.pop(0))
        if ordered and len(selected) < args.limit:
            selected.append(ordered.pop())
    raw_bytes = (json.dumps(raw, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    bundle = {
        "bundle_id": "hcmc-wikipedia-primary-review-v1", "compiled_at": fetched_at,
        "fetched_at": max(batch["fetched_at"] for batch in raw),
        "endpoint": ENDPOINT, "endpoints": sorted({batch.get("endpoint", ENDPOINT) for batch in raw}),
        "query_bbox": dict(zip(("south", "west", "north", "east"), BBOX)),
        "candidate_title_count": sum(len(batch.get("requested_titles", [])) for batch in raw),
        "verified_source_record_count": len(rows), "selected_count": len(selected), "excluded_titles": sorted(set(missing)),
        "cross_language_duplicates": duplicates,
        "raw_snapshot": raw_output.name, "raw_snapshot_sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "verification": {
            "method": "Exact names, page IDs, revision IDs and primary Earth coordinates retrieved from the included Wikipedia Action API response.",
            "limits": "Verified against source metadata, not a field survey or independent editorial fact check. Coordinates do not assert an entrance; categories are pending editorial suggestions. No descriptions or images were invented.",
            "administrative_areas": "Public bbox covers historical districts 1, 5, 6 and adjacent areas. No current administrative district is inferred.",
            "database_writes": False,
        },
        "license": "CC-BY-SA-4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "attribution": "Wikipedia contributors; per-page source and revision links retained.",
        "review_status": "pending_admin_review", "places": selected,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    raw_output.write_bytes(raw_bytes)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "selected": len(selected), "verified_source_records": len(rows),
                      "raw_snapshot_sha256": bundle["raw_snapshot_sha256"], "database_writes": False}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as error:
        print(f"Collection failed: {error}", file=sys.stderr)
        sys.exit(1)
