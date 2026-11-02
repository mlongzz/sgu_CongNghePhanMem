"""Reconcile only the reviewed ten-place guide baseline; preview by default.

Apply requires explicit local-development confirmation and a fresh backup that
has been restored and fingerprinted. Unexpected text, status, coordinates or
languages abort the transaction. This command is never a general-purpose seed.
"""
import argparse
import hashlib
import json
import os
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import ALLOWED_ORIGINS
from app.database import engine
from app.models.place import Place
from app.models.guide_content import GuideContent
from scripts.prepare_verified_guides import verify_backup

MANIFEST = Path(__file__).resolve().parents[1] / 'app/data/reviewed_guides_20261102.json'
KEYS = ('language_code', 'title', 'content', 'source_url', 'source_license')


def development_origin(origin):
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
        return False
    if parsed.hostname == 'localhost':
        return True
    try:
        address = ipaddress.ip_address(parsed.hostname or '')
        return address.is_loopback or any(address in network for network in (ipaddress.ip_network('10.0.0.0/8'), ipaddress.ip_network('172.16.0.0/12'), ipaddress.ip_network('192.168.0.0/16')) if address.version == network.version)
    except ValueError:
        return False


def fingerprint(guide):
    values = {k: guide.get(k) if isinstance(guide, dict) else getattr(guide, k) for k in KEYS}
    return hashlib.sha256(json.dumps(values, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def load_review():
    data = json.loads(MANIFEST.read_text(encoding='utf8'))
    rows = data['places']
    if data.get('version') != 1 or len(rows) != 10 or len({r['name'] for r in rows}) != 10:
        raise ValueError('Invalid reviewed content manifest')
    for row in rows:
        if {g['language_code'] for g in row['guides']} != {'vi', 'en', 'fr', 'ja'} or len(row['guides']) != 4:
            raise ValueError('Every reviewed place requires exactly four languages')
        if {g['language_code']: fingerprint(g) for g in row['previous_guides']} != row['expected_guides']:
            raise ValueError('Previous-content evidence mismatch')
        for guide in row['guides']:
            if not guide['content'].strip() or not guide['source_url'].startswith('https://'):
                raise ValueError('Missing reviewed text or source')
    return rows


def reconcile(session, rows, *, mutate=False):
    actions = []
    for item in rows:
        places = session.scalars(select(Place).where(Place.name == item['name']).with_for_update()).all()
        if len(places) != 1:
            raise ValueError('Place identity changed; manual review required')
        place = places[0]
        if place.deleted_at is not None or place.publication_status != 'published' or abs(place.latitude-item['latitude']) > .001 or abs(place.longitude-item['longitude']) > .001:
            raise ValueError('Publication or coordinates changed; manual review required')
        existing = {g.language_code: g for g in session.scalars(select(GuideContent).where(GuideContent.place_id == place.id).with_for_update())}
        if set(existing) - {'vi', 'en', 'fr', 'ja'}:
            raise ValueError('Unexpected guide language; manual review required')
        for guide in item['guides']:
            lang = guide['language_code']
            current = existing.get(lang)
            if current is not None:
                if current.publication_status != 'published':
                    raise ValueError('Guide status changed; drafts cannot be published by this repair')
                actual = fingerprint(current)
                if actual == fingerprint(guide):
                    continue
                if actual != item['expected_guides'].get(lang):
                    raise ValueError('Edited guide differs from reviewed baseline; no changes committed')
            elif lang in item['expected_guides']:
                raise ValueError('Existing guide removed; manual review required')
            actions.append({'place': place.name, 'language': lang, 'action': 'update' if current else 'add'})
            if mutate:
                if current is None:
                    current = GuideContent(place_id=place.id, publication_status='published')
                    session.add(current)
                for key in KEYS:
                    setattr(current, key, guide.get(key))
    if mutate:
        session.flush()
    return actions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-local-development', action='store_true')
    parser.add_argument('--verified-backup', type=Path)
    args = parser.parse_args()
    url = engine.url
    local_origins = ALLOWED_ORIGINS and all(development_origin(origin) for origin in ALLOWED_ORIGINS)
    if url.get_backend_name() != 'postgresql' or url.host not in ('localhost', '127.0.0.1', '::1') or url.database != 'multilingual_guide' or os.getenv('APP_ENV', 'development') not in ('development', 'dev', 'local') or not local_origins:
        raise SystemExit('Refusing: this repair requires the reviewed local development environment')
    if args.apply:
        if not args.confirm_local_development or not args.verified_backup:
            raise SystemExit('Apply requires --confirm-local-development and --verified-backup')
        verify_backup(args.verified_backup)
    with Session(engine) as session, session.begin():
        actions = reconcile(session, load_review(), mutate=args.apply)
    print(json.dumps({'applied': args.apply, 'actions': actions}, ensure_ascii=True))


if __name__ == '__main__':
    main()
