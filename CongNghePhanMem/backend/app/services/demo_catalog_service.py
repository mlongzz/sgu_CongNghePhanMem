"""Local demo review only. Import is explicit, transactional and always draft."""
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit, unquote
from pydantic import BaseModel, Field, model_validator
from app.services.wikipedia_catalog_service import WikipediaReviewPlace, load_review_catalog

DEMO_ID = 'hcmc-demo-licensed-review-v1'
DEMO_PATH = Path(__file__).resolve().parents[1] / 'data/hcmc_demo_review.json'

class DemoImage(BaseModel):
    url: str = Field(max_length=1000)
    thumbnail_url: str = Field(max_length=1000)
    source_url: str = Field(max_length=1000)
    attribution: str = Field(min_length=1, max_length=500)
    license: str = Field(pattern=r'^(CC BY(?:-SA)? [234]\.0|CC0 1\.0|Public domain)$')
    license_url: str
    identity_method: str = Field(min_length=10)
    identity_evidence: str = Field(min_length=30)
    filename: str = Field(min_length=1, max_length=512)
    reviewed_on: str
    download_status: str
    mime: str = Field(pattern=r'^image/jpeg$')

    @model_validator(mode='after')
    def safe_links(self):
        for value in (self.url, self.thumbnail_url):
            parsed = urlsplit(value)
            if parsed.scheme != 'https' or parsed.hostname not in {'upload.wikimedia.org', 'thumb.wikimedia.org'} or parsed.username or parsed.password or parsed.port or not parsed.path.startswith('/wikipedia/commons/'):
                raise ValueError('Expected exact Wikimedia Commons media URL')
        filename = self.filename.replace(' ', '_')
        if not self.source_url.startswith('https://commons.wikimedia.org/wiki/File:') or unquote(self.source_url.split('/wiki/File:', 1)[1]) != filename:
            raise ValueError('Commons source must match exact filename')
        if unquote(urlsplit(self.url).path.rsplit('/', 1)[-1]) != filename or not unquote(urlsplit(self.thumbnail_url).path.rsplit('/', 1)[-1]).endswith(filename):
            raise ValueError('Media URLs must match exact Commons filename')
        expected = {'CC0 1.0':'https://creativecommons.org/publicdomain/zero/1.0/', 'Public domain':'https://creativecommons.org/publicdomain/mark/1.0/'}.get(self.license)
        if expected is None:
            expected = 'https://creativecommons.org/licenses/' + ('by-sa' if 'BY-SA' in self.license else 'by') + '/' + self.license.rsplit(' ', 1)[-1] + '/'
        if self.license_url != expected:
            raise ValueError('License URL must match reviewed license')
        return self

class DemoPlace(WikipediaReviewPlace):
    description: str = Field(min_length=15, max_length=1000)
    image: DemoImage

def load_demo_catalog():
    bundle = json.loads(DEMO_PATH.read_text(encoding='utf-8'))
    if bundle.get('bundle_id') != DEMO_ID or not 15 <= len(bundle.get('places', [])) <= 30:
        raise ValueError('Invalid demo proposal')
    rows = [DemoPlace.model_validate(item) for item in bundle['places']]
    original_bundle, evidence = load_review_catalog()
    raw = DEMO_PATH.parent / original_bundle['raw_snapshot']
    digest = hashlib.sha256(raw.read_bytes()).hexdigest()
    if digest != original_bundle['raw_snapshot_sha256'] or digest != bundle.get('coordinate_raw_sha256'):
        raise ValueError('Original coordinate evidence checksum mismatch')
    reviewed = {item.source_id: item for item in evidence}
    identities = [row.source_id for row in rows]
    if len(set(identities)) != len(identities):
        raise ValueError('Duplicate demo source identity')
    for row in rows:
        original = reviewed.get(row.source_id)
        if not original or (row.latitude, row.longitude, row.source_revision_id) != (original.latitude, original.longitude, original.source_revision_id):
            raise ValueError('Demo coordinate/revision must match checked-in source evidence')
    return bundle, rows
