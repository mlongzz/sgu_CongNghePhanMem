"""Only fixed public provider APIs; a pasted URL is never an HTTP destination."""

import html
import json
import re
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit
import httpx2 as httpx
from fastapi import HTTPException
from app.schemas.place import PlaceCreate
from app.services.place_service import _haversine_km

APIS = {
    f"https://{lang}.wikipedia.org/w/api.php" for lang in ("vi", "en", "fr", "ja")
} | {
    "https://www.wikidata.org/w/api.php",
    "https://commons.wikimedia.org/w/api.php",
    "https://overpass-api.de/api/interpreter",
}
MAX_RESPONSE = 1_000_000


def plain(value, limit=5000):
    text = re.sub(
        r"<(script|style)\b[^>]*>[\s\S]*?</\1>", "", str(value or ""), flags=re.I
    )
    return html.unescape(re.sub(r"<[^>]*>", "", text)).strip()[:limit]


def parse_source_url(raw):
    if not isinstance(raw, str) or len(raw) > 2000 or re.search(r"[\x00-\x20\\]", raw):
        raise HTTPException(
            422, "Use a full HTTPS Wikipedia, Wikidata or OpenStreetMap URL"
        )
    try:
        parts = urlsplit(raw)
        if (
            parts.scheme != "https"
            or parts.username
            or parts.password
            or parts.port
            or "%" in parts.netloc
        ):
            raise ValueError()
        host = parts.hostname or ""
        path = unquote(parts.path, errors="strict")
        if re.search(r"[\x00-\x1f|]", path):
            raise ValueError()
        wiki = re.fullmatch(r"(vi|en|fr|ja)(?:\.m)?\.wikipedia\.org", host)
        if wiki:
            params = parse_qs(parts.query, max_num_fields=10)
            if path.startswith("/wiki/") and 0 < len(path[6:]) <= 512:
                return "wikipedia", wiki[1], path[6:]
            if (
                path in ("/", "/w/index.php")
                and len(params.get("curid", [])) == 1
                and re.fullmatch(r"[1-9][0-9]{0,14}", params["curid"][0])
            ):
                return "wikipedia", wiki[1], int(params["curid"][0])
        if host in ("www.wikidata.org", "wikidata.org") and re.fullmatch(
            r"/wiki/Q[1-9][0-9]{0,14}", path
        ):
            return "wikidata", "", path[6:]
        if host in ("www.openstreetmap.org", "openstreetmap.org"):
            osm = re.fullmatch(r"/(node|way|relation)/([1-9][0-9]{0,14})/?", path)
            if osm:
                return "openstreetmap", "", f"{osm[1]}/{osm[2]}"
    except (ValueError, UnicodeError):
        pass
    raise HTTPException(
        422,
        "Unsupported/shortened URL. Google Maps requires an official configured API; use Wikipedia/OSM/Wikidata or enter a draft manually",
    )


def fetch_json(endpoint, params):
    if endpoint not in APIS:
        raise HTTPException(422, "API destination is not allowed")
    try:
        with httpx.Client(
            timeout=httpx.Timeout(10, connect=4),
            follow_redirects=False,
            trust_env=False,
            headers={
                "User-Agent": "MultilingualGuide/1.0 (administrator metadata preview)",
                "Accept": "application/json",
            },
        ) as client:
            with client.stream("GET", endpoint, params=params) as response:
                if response.status_code in (403, 429):
                    raise HTTPException(502, f"Source API returned HTTP {response.status_code}; provider access policy or rate limit. Retry later or upload a licensed image manually; no draft saved")
                if response.status_code != 200:
                    raise HTTPException(502, f"Source API returned HTTP {response.status_code}; retry later or upload a licensed image manually; no draft saved")
                if (
                    response.status_code != 200
                    or int(response.headers.get("content-length", "0")) > MAX_RESPONSE
                ):
                    raise ValueError()
                body = bytearray()
                deadline = time.monotonic() + 12
                for chunk in response.iter_bytes():
                    if (
                        len(body) + len(chunk) > MAX_RESPONSE
                        or time.monotonic() > deadline
                    ):
                        raise ValueError()
                    body.extend(chunk)
                result = json.loads(body)
                if not isinstance(result, dict):
                    raise ValueError()
                return result
    except httpx.TimeoutException:
        raise HTTPException(504, "Source API timed out; retry later or upload a licensed image manually; no draft saved") from None
    except httpx.ConnectError:
        raise HTTPException(502, "Could not connect to source API; check server DNS and network or upload a licensed image manually; no draft saved") from None
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(
            502, "Source API unavailable or invalid/oversized response; no draft saved"
        ) from None


def commons_image(filename):
    if (
        not isinstance(filename, str)
        or not filename.strip()
        or len(filename) > 512
        or re.search(r"[\x00-\x1f|]", filename)
    ):
        return None
    title = filename if filename.startswith("File:") else "File:" + filename
    result = fetch_json(
        "https://commons.wikimedia.org/w/api.php",
        {
            "action": "query",
            "format": "json",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": 1200,
            "redirects": 1,
        },
    )
    pages = result.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {}) if isinstance(pages, dict) else {}
    info = (page.get("imageinfo") or [{}])[0]
    metadata = info.get("extmetadata", {})
    value = lambda name: plain(metadata.get(name, {}).get("value"), 500)
    license, attribution = value("LicenseShortName"), value("Artist")
    url = info.get("thumburl") or info.get("url") or ""
    if not isinstance(url, str) or len(url) > 500:
        return None
    parts = urlsplit(url)
    allowed = bool(
        re.fullmatch(
            r"CC BY(?:-SA)?(?: [1234](?:\.\d)?)?|CC0(?: 1\.0)?|Public domain",
            license,
            re.I,
        )
    )
    if (
        parts.scheme != "https"
        or parts.hostname not in {"upload.wikimedia.org", "thumb.wikimedia.org"}
        or parts.port
        or parts.username
        or not parts.path.startswith("/wikipedia/commons/")
        or not allowed
        or not attribution
    ):
        return None
    source = "https://commons.wikimedia.org/wiki/" + quote(
        page.get("title", title).replace(" ", "_"), safe=":"
    )
    if len(source) > 1000:
        return None
    return {
        "url": url,
        "source_url": source,
        "attribution": attribution,
        "license": license,
    }


def wikidata_metadata(identity):
    result = fetch_json(
        "https://www.wikidata.org/w/api.php",
        {
            "action": "wbgetentities",
            "format": "json",
            "ids": identity,
            "props": "labels|descriptions|claims",
            "languages": "vi|en|fr|ja",
        },
    )
    entity = result.get("entities", {}).get(identity, {})
    claims = entity.get("claims", {})
    coordinates = [
        v.get("mainsnak", {}).get("datavalue", {}).get("value", {})
        for v in claims.get("P625", [])
        if v.get("rank") != "deprecated"
    ]
    point = next(
        (
            v
            for v in coordinates
            if isinstance(v, dict)
            and v.get("globe")
            in (
                "http://www.wikidata.org/entity/Q2",
                "https://www.wikidata.org/entity/Q2",
            )
        ),
        None,
    )
    labels = entity.get("labels", {})
    label = next(
        (labels[lang]["value"] for lang in ("vi", "en", "fr", "ja") if lang in labels),
        "",
    )
    if not point or not label:
        raise HTTPException(422, "Wikidata entity has no label or Earth coordinate")
    descriptions = entity.get("descriptions", {})
    description = next(
        (
            descriptions[lang]["value"]
            for lang in ("vi", "en", "fr", "ja")
            if lang in descriptions
        ),
        None,
    )
    image = next(
        (
            v.get("mainsnak", {}).get("datavalue", {}).get("value")
            for v in claims.get("P18", [])
            if v.get("rank") != "deprecated"
        ),
        None,
    )
    return {
        "name": plain(label, 200),
        "latitude": point.get("latitude"),
        "longitude": point.get("longitude"),
        "description": plain(description) or None,
        "source": "wikidata",
        "source_id": identity,
        "source_url": f"https://www.wikidata.org/wiki/{identity}",
        "source_license": "CC0",
    }, image


def _resolve_metadata(url):
    source, language, identity = parse_source_url(url)
    filename = None
    if source == "wikipedia":
        result = fetch_json(
            f"https://{language}.wikipedia.org/w/api.php",
            {
                "action": "query",
                "format": "json",
                "prop": "coordinates|extracts|pageimages|revisions",
                "exintro": 1,
                "explaintext": 1,
                "piprop": "name",
                "rvprop": "ids",
                "coprimary": "primary",
                "colimit": 1,
                "redirects": 1,
                **(
                    {"pageids": identity}
                    if isinstance(identity, int)
                    else {"titles": identity}
                ),
            },
        )
        pages = result.get("query", {}).get("pages", {})
        page = next(iter(pages.values()), {}) if isinstance(pages, dict) else {}
        point = next(
            (
                p
                for p in page.get("coordinates", [])
                if p.get("globe") in ("earth", None)
                and p.get("primary", True) is not False
            ),
            None,
        )
        if (
            not isinstance(page.get("pageid"), int)
            or page["pageid"] <= 0
            or page.get("ns") != 0
            or not point
        ):
            raise HTTPException(
                422, "Wikipedia article has no primary place coordinate"
            )
        metadata = {
            "name": plain(page.get("title"), 200),
            "latitude": point.get("lat"),
            "longitude": point.get("lon"),
            "description": plain(page.get("extract")) or None,
            "source": source,
            "source_id": f"{language}:{page['pageid']}",
            "source_url": f"https://{language}.wikipedia.org/?curid={page['pageid']}",
            "source_license": "CC-BY-SA-4.0",
        }
        filename = page.get("pageimage")
    elif source == "wikidata":
        metadata, filename = wikidata_metadata(identity)
    else:
        kind, identifier = identity.split("/")
        data = fetch_json(
            "https://overpass-api.de/api/interpreter",
            {"data": f"[out:json][timeout:8];{kind}({identifier});out center tags;"},
        )
        row = next(
            (
                v
                for v in data.get("elements", [])
                if str(v.get("id")) == identifier and v.get("type") == kind
            ),
            {},
        )
        tags = row.get("tags", {})
        point = row.get("center", row)
        if not tags.get("name") or "lat" not in point or "lon" not in point:
            raise HTTPException(422, "OSM object has no verified name/point/center")
        metadata = {
            "name": plain(tags["name"], 200),
            "latitude": point["lat"],
            "longitude": point["lon"],
            "description": plain(tags.get("description")) or None,
            "address": plain(tags.get("addr:full"), 255) or None,
            "category": plain(
                tags.get("tourism") or tags.get("historic") or tags.get("amenity"), 100
            )
            or None,
            "source": "openstreetmap",
            "source_id": identity,
            "source_url": f"https://www.openstreetmap.org/{identity}",
            "source_license": "ODbL-1.0",
        }
        qid = tags.get("wikidata", "")
        if re.fullmatch(r"Q[1-9][0-9]*", qid):
            try:
                linked, linked_file = wikidata_metadata(qid)
                if (
                    _haversine_km(
                        metadata["latitude"],
                        metadata["longitude"],
                        linked["latitude"],
                        linked["longitude"],
                    )
                    < 0.2
                ):
                    filename = linked_file
            except HTTPException:
                pass
    try:
        metadata = PlaceCreate.model_validate(
            {**metadata, "publication_status": "draft"}
        ).model_dump()
    except ValueError:
        raise HTTPException(
            422, "Source metadata is missing valid coordinates/name"
        ) from None
    image = None
    if filename:
        try:
            image = commons_image(filename)
        except HTTPException:
            pass
    return metadata, image


def resolve_metadata(url):
    try:
        return _resolve_metadata(url)
    except (TypeError, AttributeError, KeyError, IndexError, ValueError, OverflowError):
        raise HTTPException(
            502, "Source metadata has an unexpected structure; no draft saved"
        ) from None
