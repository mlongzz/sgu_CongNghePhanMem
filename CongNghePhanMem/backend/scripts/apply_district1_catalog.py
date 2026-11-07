"""Turn the catalogue into a District 1 (Quận 1, Ho Chi Minh City) audio guide.

Default is a read-only preview. ``--apply --backup <pg_dump file>`` then, in one transaction:

1. permanently deletes every place outside the District 1 boundary (guides, images,
   favourites, history, reviews and journey stops cascade with it);
2. adds the reviewed District 1 places from ``app/data/district1_catalog.json`` with their
   vi/en/fr/ja guides and the bundled, checksum-verified Wikimedia Commons cover photo;
3. rebuilds the first journey as the District 1 walking route;
4. enriches every place listed under ``content``: long vi/en/fr/ja guides, a story for the cover
   photo and extra credited photos, each with its own story (matched by checksum, never duplicated).

Places already present (same name) are kept, so running it twice changes nothing. An earlier
draft import of the same landmark (listed in ``aliases``) is upgraded in place instead of duplicated.
Local upload files that belonged to deleted places are removed only after the commit.
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR
from app.models.admin import Journey, JourneyStop
from app.models.audio_session import AudioGuideSession
from app.models.favorite import Favorite
from app.models.history import History
from app.models.review import Review
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.place_image import PlaceImage
from app.services.image_processing import normalize, thumbnail

DATA = Path(__file__).resolve().parents[1] / 'app' / 'data'
MANIFEST = DATA / 'district1_catalog.json'
ASSETS = DATA / 'district1_images'
LANGUAGES = {'vi', 'en', 'fr', 'ja'}


def load_manifest(path: Path = MANIFEST) -> dict:
    bundle = json.loads(path.read_text(encoding='utf-8'))
    if bundle.get('version') != 1:
        raise ValueError('Unsupported District 1 manifest version')
    polygon = bundle.get('area', {}).get('polygon')
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise ValueError('District 1 boundary is missing')
    names = set()
    for row in bundle.get('places', []):
        name = row.get('name')
        if not isinstance(name, str) or not name.strip() or name in names:
            raise ValueError(f'Invalid or duplicate place name: {name!r}')
        names.add(name)
        if not inside(polygon, row['latitude'], row['longitude']):
            raise ValueError(f'{name} is outside District 1')
        if {g.get('language_code') for g in row.get('guides', [])} != LANGUAGES or any(len(g.get('content', '').strip()) < 40 for g in row['guides']):
            raise ValueError(f'{name} needs a guide in each of vi, en, fr and ja')
        image = row.get('image') or {}
        if not image.get('path') or not image.get('sha256') or not image.get('license') or not image.get('attribution'):
            raise ValueError(f'{name} needs a credited cover photo')
    return bundle


def inside(polygon: list, latitude: float, longitude: float) -> bool:
    """Ray casting; vertices are [latitude, longitude]."""
    result, j = False, len(polygon) - 1
    for i in range(len(polygon)):
        yi, xi = polygon[i]
        yj, xj = polygon[j]
        if (yi > latitude) != (yj > latitude) and longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi:
            result = not result
        j = i
    return result


def read_asset(image: dict, asset_dir: Path) -> bytes:
    path = (asset_dir / image['path']).resolve()
    if path.parent != asset_dir.resolve() or path.is_symlink():
        raise ValueError(f'Unsafe asset path: {image["path"]}')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != image['sha256']:
        raise ValueError(f'Asset checksum mismatch: {image["path"]}')
    return data


def store_photo(image: dict, asset_dir: Path, upload_dir: Path, created: list[Path]) -> tuple[str, str, str, int, int]:
    """Normalise a bundled photo, write cover + thumbnail files, return (url, thumb_url, sha256, width, height)."""
    normalized = normalize(read_asset(image, asset_dir))
    small, width, height = thumbnail(normalized)
    identity = uuid4().hex
    cover, thumb = upload_dir / f'{identity}.jpg', upload_dir / f'{identity}-thumb.jpg'
    for path, content in ((cover, normalized), (thumb, small)):
        with path.open('xb') as handle:
            created.append(path)
            handle.write(content)
    return f'/media/{cover.name}', f'/media/{thumb.name}', hashlib.sha256(normalized).hexdigest(), width, height


def enrich(session: Session, bundle: dict, upload_dir: Path, asset_dir: Path, created: list[Path]) -> dict:
    """Long guides, cover stories and extra photos with stories for the places listed under ``content``."""
    counts = {'guides_updated': 0, 'cover_stories': 0, 'photos_added': 0, 'photo_stories_updated': 0}
    for entry in bundle.get('content', []):
        place = session.scalars(select(Place).where(Place.name == entry['name'], Place.deleted_at.is_(None))).first()
        if place is None:
            continue
        current = {g.language_code: g for g in session.scalars(select(GuideContent).where(GuideContent.place_id == place.id))}
        for guide in entry['guides']:
            row = current.get(guide['language_code'])
            if row is None:
                session.add(GuideContent(place_id=place.id, language_code=guide['language_code'], title=guide['title'], content=guide['content'],
                                         source_url=guide.get('source_url'), source_license=guide.get('source_license'), publication_status='published'))
                counts['guides_updated'] += 1
            elif row.content != guide['content'] or row.publication_status != 'published':
                row.title, row.content, row.publication_status = guide['title'], guide['content'], 'published'
                row.source_url, row.source_license = guide.get('source_url') or row.source_url, guide.get('source_license')
                counts['guides_updated'] += 1
        images = list(session.scalars(select(PlaceImage).where(PlaceImage.place_id == place.id)))
        cover = next((i for i in images if i.url == place.image_url), None)
        if cover is not None and entry.get('cover_story') and cover.story != entry['cover_story']:
            cover.story = dict(entry['cover_story'])
            counts['cover_stories'] += 1
        position = max([i.position or 0 for i in images] + [0])
        by_hash = {i.sha256: i for i in images if i.sha256}
        for image in entry.get('gallery', []):
            normalized_hash = hashlib.sha256(normalize(read_asset(image, asset_dir))).hexdigest()
            existing = by_hash.get(normalized_hash)
            if existing is not None:
                if existing.story != image['story']:
                    existing.story = dict(image['story'])
                    counts['photo_stories_updated'] += 1
                continue
            url, thumb_url, digest, width, height = store_photo(image, asset_dir, upload_dir, created)
            position += 1
            row = PlaceImage(place_id=place.id, url=url, thumbnail_url=thumb_url, sha256=digest, width=width, height=height,
                             storage_backend='local', health_status='ok', status='approved', position=position,
                             reviewed_at=datetime.now(timezone.utc), source_url=image['source_url'],
                             attribution=image['attribution'], license=image['license'], story=dict(image['story']))
            session.add(row)
            by_hash[digest] = row
            counts['photos_added'] += 1
    session.flush()
    return counts


def plan(session: Session, bundle: dict) -> dict:
    polygon = bundle['area']['polygon']
    places = list(session.scalars(select(Place)))
    outside = [p for p in places if not inside(polygon, p.latitude, p.longitude)]
    kept = [p for p in places if p not in outside and p.deleted_at is None]
    add, upgrade, done = [], [], set()
    for row in bundle['places']:
        names = [row['name'], *row.get('aliases', [])]
        match = next((p for name in names for p in kept if p.name == name and p.id not in done), None)
        if match and match.publication_status == 'published':
            done.add(match.id)  # already curated and public: leave it untouched
        elif match:
            done.add(match.id)
            upgrade.append((match.id, match.name, row['name']))
        else:
            add.append(row['name'])
    upgraded = {place_id for place_id, _, _ in upgrade}
    return {
        'delete': [(p.id, p.name) for p in outside],
        'upgrade': upgrade,
        'add': add,
        'keep': sorted(p.name for p in kept if p.id not in upgraded),
        'journey': bundle['journey']['stops'],
    }


def apply(session: Session, bundle: dict, upload_dir: Path, asset_dir: Path = ASSETS) -> tuple[dict, list[Path], list[Path]]:
    """Mutate inside the caller's transaction. Returns (plan, files created, files to delete after commit)."""
    result = plan(session, bundle)
    created: list[Path] = []
    obsolete: list[Path] = []
    delete_ids = [place_id for place_id, _ in result['delete']]
    if delete_ids:
        for image in session.scalars(select(PlaceImage).where(PlaceImage.place_id.in_(delete_ids))):
            obsolete += [upload_dir / u.removeprefix('/media/') for u in (image.url, image.thumbnail_url) if u and u.startswith('/media/')]
        for place in session.scalars(select(Place).where(Place.id.in_(delete_ids))):
            obsolete += [upload_dir / u.removeprefix('/media/') for u in (place.image_url, place.image_thumbnail_url) if u and u.startswith('/media/')]
        # Delete children explicitly so the result is identical with or without FK cascades.
        for model in (JourneyStop, GuideContent, PlaceImage, Favorite, History, Review, AudioGuideSession):
            session.query(model).filter(model.place_id.in_(delete_ids)).delete(synchronize_session=False)
        session.query(Place).filter(Place.id.in_(delete_ids)).delete(synchronize_session=False)
        session.flush()

    upload_dir.mkdir(parents=True, exist_ok=True)
    by_name = {row['name']: row for row in bundle['places']}
    targets = [(None, name) for name in result['add']] + [(place_id, name) for place_id, _, name in result['upgrade']]
    for place_id, name in targets:
        row = by_name[name]
        fields = dict(name=name, description=row['description'], address=row['address'], category=row['category'],
                      latitude=row['latitude'], longitude=row['longitude'], publication_status='published')
        if place_id is None:
            place = Place(**fields, source='manual', source_url=row.get('source_url'))
            session.add(place)
        else:
            # Keep the draft's provider identity (source/source_id/source_url); replace its editorial content.
            place = session.get(Place, place_id)
            for key, value in fields.items():
                setattr(place, key, value)
            session.query(GuideContent).filter(GuideContent.place_id == place_id).delete(synchronize_session=False)
            session.query(PlaceImage).filter(PlaceImage.place_id == place_id).update({PlaceImage.position: PlaceImage.position + 1}, synchronize_session=False)
        session.flush()
        for guide in row['guides']:
            session.add(GuideContent(place_id=place.id, language_code=guide['language_code'], title=guide['title'],
                                     content=guide['content'], source_url=guide.get('source_url'),
                                     source_license=guide.get('source_license'), publication_status='published'))
        image = row['image']
        url, thumb_url, digest, width, height = store_photo(image, asset_dir, upload_dir, created)
        session.add(PlaceImage(place_id=place.id, url=url, thumbnail_url=thumb_url, sha256=digest,
                               width=width, height=height, storage_backend='local', health_status='ok', status='approved',
                               reviewed_at=datetime.now(timezone.utc), source_url=image['source_url'],
                               attribution=image['attribution'], license=image['license']))
        place.image_url, place.image_thumbnail_url = url, thumb_url
        place.image_source_url, place.image_attribution, place.image_license = image['source_url'], image['attribution'], image['license']
    session.flush()

    ids = {p.name: p.id for p in session.scalars(select(Place).where(Place.deleted_at.is_(None)))}
    missing = [name for name in bundle['journey']['stops'] if name not in ids]
    if missing:
        raise ValueError(f'Journey stops not found: {missing}')
    journey = session.scalars(select(Journey).order_by(Journey.id)).first()
    if journey is None:
        journey = Journey(name=bundle['journey']['name'], description=bundle['journey']['description'])
        session.add(journey)
        session.flush()
    journey.name, journey.description = bundle['journey']['name'], bundle['journey']['description']
    session.query(JourneyStop).filter(JourneyStop.journey_id == journey.id).delete(synchronize_session=False)
    session.flush()
    for position, name in enumerate(bundle['journey']['stops']):
        session.add(JourneyStop(journey_id=journey.id, place_id=ids[name], position=position))
    session.flush()
    result = {**result, **enrich(session, bundle, upload_dir, asset_dir, created)}
    return result, created, obsolete


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup', type=Path, help='pg_dump file taken just before --apply')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')  # Vietnamese names on Windows consoles
    from app.database import engine
    bundle = load_manifest()
    upload_dir = Path(UPLOAD_DIR)
    if args.apply and (not args.backup or not args.backup.is_file() or args.backup.stat().st_size < 1024):
        raise SystemExit('Refusing --apply without --backup pointing to a fresh database dump')
    created: list[Path] = []
    try:
        with Session(engine) as session:
            with session.begin():
                if args.apply:
                    result, created, obsolete = apply(session, bundle, upload_dir)
                else:
                    result, obsolete = plan(session, bundle), []
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    removed = 0
    for path in obsolete:
        if path.is_file() and path.resolve().parent == upload_dir.resolve():
            path.unlink()
            removed += 1
    print(json.dumps({'applied': args.apply, **result, 'removed_upload_files': removed}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
