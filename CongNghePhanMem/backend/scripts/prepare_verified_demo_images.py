"""Prepare reviewed Commons cover images for the local demo database.

Default is a read-only preview. --apply requires a newly restored, verified
backup and an asset directory containing the exact files in the manifest.
No pre-existing image, pending gallery item or publication state is removed.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx2 as httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR
from app.database import engine
from app.models.place import Place
from app.models.place_image import PlaceImage
from app.services.image_processing import normalize, thumbnail
from app.services.image_storage import storage_configuration
from scripts.prepare_verified_guides import verify_backup

MANIFEST = Path(__file__).resolve().parents[1] / 'app' / 'data' / 'verified_demo_images.json'
PLACEHOLDER = 'https://example.com/cu-chi.jpg'


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download_assets(manifest: Path, asset_dir: Path) -> None:
    """Fetch only fixed Commons thumbnail URLs; never replace an existing file."""
    entries = json.loads(manifest.read_text(encoding='utf-8'))
    asset_dir.mkdir(parents=True, exist_ok=True)
    directory = asset_dir.resolve(strict=True)
    with httpx.Client(timeout=httpx.Timeout(45, connect=10), follow_redirects=False,
                      headers={'User-Agent': 'DauChanDemo/1.0 (verified Wikimedia Commons image preparation)'}) as client:
        for row in entries:
            if row.get('status') != 'downloaded_verified':
                continue
            filename = row.get('path', '')
            if not re.fullmatch(r'place-[0-9]{2}\.jpg', filename):
                raise ValueError('Unsafe image filename')
            parts = urlsplit(row.get('download_url', ''))
            if parts.scheme != 'https' or parts.hostname != 'thumb.wikimedia.org' or parts.port or parts.username or parts.password or parts.fragment or not parts.path.startswith('/wikipedia/commons/thumb/'):
                raise ValueError(f'Invalid Commons thumbnail URL for {filename}')
            target = directory / filename
            if target.is_symlink():
                raise ValueError(f'Refusing symbolic-link asset: {filename}')
            if target.exists():
                data = target.read_bytes()
                if len(data) != row.get('bytes') or _digest(data) != row.get('sha256'):
                    raise ValueError(f'Existing asset differs; refusing to overwrite {filename}')
                continue
            data = bytearray()
            with client.stream('GET', row['download_url']) as response:
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    if len(data) + len(chunk) > 5 * 1024 * 1024:
                        raise ValueError(f'Image too large: {filename}')
                    data.extend(chunk)
            if len(data) != row.get('bytes') or _digest(data) != row.get('sha256'):
                raise ValueError(f'Downloaded image differs from reviewed checksum: {filename}')
            created = False
            try:
                with target.open('xb') as f:
                    created = True
                    f.write(data)
            except Exception:
                if created:
                    target.unlink(missing_ok=True)
                raise


def read_assets(manifest: Path, asset_dir: Path) -> list[dict]:
    entries = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(entries, list) or not entries:
        raise ValueError('Image manifest is empty or invalid')
    directory = asset_dir.resolve(strict=True)
    seen_ids, seen_digests = set(), set()
    result = []
    for row in entries:
        if row.get('status') != 'downloaded_verified':
            continue
        place_id, name = row.get('place_id'), row.get('place_name')
        if not isinstance(place_id, int) or place_id < 1 or place_id in seen_ids or not isinstance(name, str) or not name.strip():
            raise ValueError('Invalid or duplicate place identity')
        filename = row.get('path', '')
        if not re.fullmatch(r'place-[0-9]{2}\.jpg', filename):
            raise ValueError(f'Unsafe image filename for {place_id}')
        path = (directory / filename).resolve(strict=True)
        if path.parent != directory or not path.is_file():
            raise ValueError(f'Invalid asset path for {place_id}')
        data = path.read_bytes()
        if len(data) > 5 * 1024 * 1024 or len(data) != row.get('bytes') or _digest(data) != row.get('sha256'):
            raise ValueError(f'Asset size or checksum mismatch for {place_id}')
        source = urlsplit(row.get('description_url', ''))
        license_url = urlsplit(row.get('license_url', ''))
        if source.scheme != 'https' or source.hostname != 'commons.wikimedia.org' or not source.path.startswith('/wiki/File:') or source.username or source.password:
            raise ValueError(f'Invalid Commons source for {place_id}')
        if license_url.scheme != 'https' or license_url.hostname != 'creativecommons.org' or license_url.username or license_url.password:
            raise ValueError(f'Invalid license URL for {place_id}')
        if not row.get('author') or not re.fullmatch(r'CC0|CC BY(?:-SA)? [1-4]\.0', row.get('license', '')):
            raise ValueError(f'Incomplete author or license for {place_id}')
        if row.get('downloaded_as') != 'commons-1280px-derivative':
            raise ValueError(f'Unexpected source derivative for {place_id}')
        if not all(isinstance(row.get(k), (int, float)) for k in ('latitude', 'longitude')):
            raise ValueError(f'Missing coordinates for {place_id}')
        normalized = normalize(data)
        small, width, height = thumbnail(normalized)
        digest = _digest(normalized)
        if digest in seen_digests:
            raise ValueError('The same image cannot be assigned to multiple places')
        seen_ids.add(place_id); seen_digests.add(digest)
        result.append({**row, 'normalized': normalized, 'small': small, 'digest': digest, 'width': width, 'height': height})
    if not result:
        raise ValueError('No verified images in manifest')
    return result


def prepare(session: Session, entries: list[dict], upload_dir: Path) -> list[dict]:
    """Validate and lock all target rows before changing any file or row."""
    plan = []
    for entry in sorted(entries, key=lambda item: item['place_id']):
        place = session.scalar(select(Place).where(Place.id == entry['place_id']).with_for_update())
        if not place or place.name != entry['place_name'] or place.deleted_at is not None or place.publication_status != 'published':
            raise ValueError(f'Place identity/publication changed: {entry["place_id"]}')
        if abs(place.latitude-entry['latitude']) > .001 or abs(place.longitude-entry['longitude']) > .001:
            raise ValueError(f'Place coordinates changed: {place.id}')
        author = entry['author'] + ' · Wikimedia Commons · Ảnh đã thu nhỏ và chuyển JPEG'
        expected = (entry['description_url'], author, entry['license'])
        if place.image_url:
            old_placeholder = place.id == 1 and place.image_url == PLACEHOLDER and not any((place.image_source_url, place.image_attribution, place.image_license, place.image_thumbnail_url))
            existing = session.scalar(select(PlaceImage).where(PlaceImage.place_id == place.id, PlaceImage.url == place.image_url).with_for_update())
            if existing and existing.status == 'approved' and existing.sha256 == entry['digest'] and (place.image_source_url,place.image_attribution,place.image_license) == expected:
                cover = place.image_url.removeprefix('/media/')
                small = (place.image_thumbnail_url or '').removeprefix('/media/')
                if not re.fullmatch(r'[a-f0-9]{32}\.jpg',cover) or not re.fullmatch(r'[a-f0-9]{32}-thumb\.jpg',small):
                    raise ValueError(f'Existing cover paths invalid: {place.id}')
                if _digest((upload_dir / cover).read_bytes()) != entry['digest'] or _digest((upload_dir / small).read_bytes()) != _digest(entry['small']):
                    raise ValueError(f'Existing cover files changed: {place.id}')
                continue
            if not old_placeholder:
                raise ValueError(f'Existing cover requires manual review: {place.id}')
        elif any((place.image_source_url, place.image_attribution, place.image_license, place.image_thumbnail_url)):
            raise ValueError(f'Existing cover metadata requires manual review: {place.id}')
        duplicate = session.scalar(select(PlaceImage).where(PlaceImage.place_id == place.id, PlaceImage.sha256 == entry['digest']).with_for_update())
        if duplicate:
            raise ValueError(f'Existing gallery image requires manual review: {place.id}')
        plan.append({'place':place, 'entry':entry, 'attribution':author})
    return plan


def apply_plan(session: Session, plan: list[dict], upload_dir: Path, created: list[Path]) -> None:
    upload_dir.mkdir(parents=True, exist_ok=True)
    for item in plan:
        place, e = item['place'], item['entry']
        identity = uuid4().hex
        cover, small = upload_dir / f'{identity}.jpg', upload_dir / f'{identity}-thumb.jpg'
        for path, content in ((cover,e['normalized']),(small,e['small'])):
            with path.open('xb') as f:
                created.append(path)
                f.write(content)
        url, thumb_url = f'/media/{cover.name}', f'/media/{small.name}'
        row = PlaceImage(place_id=place.id, url=url, thumbnail_url=thumb_url, sha256=e['digest'],
                         width=e['width'], height=e['height'], storage_backend='local', health_status='ok',
                         status='approved', reviewed_at=datetime.now(timezone.utc),
                         source_url=e['description_url'], attribution=item['attribution'], license=e['license'])
        session.add(row)
        place.image_url, place.image_thumbnail_url = url, thumb_url
        place.image_source_url, place.image_attribution, place.image_license = e['description_url'], item['attribution'], e['license']
    session.flush()


def run(session: Session, entries: list[dict], upload_dir: Path, *, mutate: bool) -> list[int]:
    created: list[Path] = []
    transaction = session.begin()
    try:
        plan = prepare(session, entries, upload_dir)
        if mutate:
            apply_plan(session, plan, upload_dir, created)
        ids = [item['place'].id for item in plan]
    except Exception:
        transaction.rollback()
        # Only files exclusively created by this invocation are eligible for cleanup.
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise
    try:
        transaction.commit()
    except Exception:
        # A lost connection during COMMIT can leave its outcome unknown. Keep
        # files so a possibly committed cover cannot point at deleted images.
        raise RuntimeError('Commit outcome unknown; retain files and inspect the database before retrying') from None
    return ids


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset-dir', type=Path, default=MANIFEST.parent / 'demo_images',
                        help='Directory containing reviewed images; defaults to bundled demo images')
    parser.add_argument('--download', action='store_true', help='Download missing reviewed Commons thumbnails into the asset directory')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--allow-demo-db', action='store_true', help='Also allow an isolated local mg_demo_* database')
    parser.add_argument('--verified-backup', type=Path)
    args = parser.parse_args()
    url = engine.url
    valid_name = url.database == 'multilingual_guide' or (args.allow_demo_db and bool(re.fullmatch(r'mg_demo_[a-zA-Z0-9_]+', url.database or '')))
    if url.get_backend_name() != 'postgresql' or url.host not in ('127.0.0.1', 'localhost', '::1') or not valid_name:
        raise SystemExit('Refusing: use local multilingual_guide or explicitly allow local mg_demo_*')
    uploads = Path(UPLOAD_DIR).resolve()
    if storage_configuration() != 'local' or uploads != (Path(__file__).resolve().parents[1] / 'uploads').resolve():
        raise SystemExit('Refusing: expected the local backend/uploads storage')
    if args.download:
        download_assets(MANIFEST, args.asset_dir)
    entries = read_assets(MANIFEST, args.asset_dir)
    if args.apply:
        if not args.verified_backup:
            raise SystemExit('Provide --verified-backup for --apply')
        verify_backup(args.verified_backup)
    with Session(engine) as session:
        ids = run(session, entries, uploads, mutate=args.apply)
    print(json.dumps({'applied': args.apply, 'place_ids': ids}))


if __name__ == '__main__':
    main()
