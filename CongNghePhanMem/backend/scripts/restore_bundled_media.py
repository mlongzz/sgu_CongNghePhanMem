"""Restore missing local District 1 photos without changing database records.

Preview by default; --apply writes only absent files. A photo is restored only
when its normalized SHA-256 matches the existing gallery record exactly.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.place_image import PlaceImage
from app.services.image_processing import normalize, thumbnail
from scripts.apply_district1_catalog import ASSETS, MANIFEST, read_asset

MEDIA_NAME = re.compile(r"^[a-f0-9]{32}(?:-thumb)?\.jpg$")


def bundled_photos() -> dict[str, bytes]:
    bundle = json.loads(MANIFEST.read_text(encoding="utf-8"))
    images = [row["image"] for row in bundle["places"]]
    images += [image for row in bundle.get("content", []) for image in row.get("gallery", [])]
    photos = {}
    for image in images:
        data = normalize(read_asset(image, ASSETS))
        photos[hashlib.sha256(data).hexdigest()] = data
    return photos


def restore(session: Session, directory: Path, photos: dict[str, bytes], *, apply: bool = False) -> dict:
    directory = directory.resolve()
    pending: dict[Path, bytes] = {}
    unmatched = []
    existing = 0
    for row in session.scalars(select(PlaceImage)):
        urls = [(row.url, False), (row.thumbnail_url, True)]
        local = [(url, small) for url, small in urls if url and url.startswith("/media/")]
        if not local:
            continue
        data = photos.get(row.sha256)
        small_data = None
        for url, small in local:
            name = url.removeprefix("/media/")
            target = directory / name
            if not MEDIA_NAME.fullmatch(name) or target.is_symlink():
                raise ValueError(f"Unsafe local media path for image {row.id}")
            if target.exists():
                existing += 1
                continue
            if data is None:
                unmatched.append(row.id)
                continue
            if small and small_data is None:
                small_data = thumbnail(data)[0]
            content = small_data if small else data
            if target in pending and pending[target] != content:
                raise ValueError(f"Conflicting local media path for image {row.id}")
            pending[target] = content
    if apply and pending:
        directory.mkdir(parents=True, exist_ok=True)
        for target, content in pending.items():
            # Exclusive creation preserves existing uploads, even during a race.
            with target.open("xb") as handle:
                handle.write(content)
    return {"files_missing": len(pending), "files_restored": len(pending) if apply else 0,
            "files_existing": existing, "unmatched_image_ids": sorted(set(unmatched))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    from app.config import UPLOAD_DIR
    from app.database import engine
    if os.getenv("APP_ENV") == "production" or engine.url.host not in (None, "localhost", "127.0.0.1", "::1"):
        parser.error("This recovery tool is for local development databases only")
    with Session(engine) as session:
        result = restore(session, Path(UPLOAD_DIR), bundled_photos(), apply=args.apply)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
