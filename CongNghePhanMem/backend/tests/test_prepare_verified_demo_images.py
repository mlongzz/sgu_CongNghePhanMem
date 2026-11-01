import hashlib
import json
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import select

from app.models.place import Place
from app.models.place_image import PlaceImage
from scripts.prepare_verified_demo_images import download_assets, read_assets, run


def fixture_asset(tmp_path):
    assets = tmp_path / 'assets'; assets.mkdir()
    buf = BytesIO(); Image.new('RGB', (50, 40), 'blue').save(buf, 'JPEG')
    data = buf.getvalue(); (assets / 'place-02.jpg').write_bytes(data)
    entry = {'place_id': 2, 'place_name': 'Fixture place', 'latitude': 10.0, 'longitude': 106.0,
             'path': 'place-02.jpg', 'status': 'downloaded_verified', 'bytes': len(data),
             'sha256': hashlib.sha256(data).hexdigest(), 'author': 'Fixture author',
             'license': 'CC BY 4.0', 'license_url': 'https://creativecommons.org/licenses/by/4.0',
             'description_url': 'https://commons.wikimedia.org/wiki/File:Fixture.jpg',
             'download_url': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/01/Fixture.jpg/1280px-Fixture.jpg',
             'downloaded_as': 'commons-1280px-derivative'}
    manifest = tmp_path / 'manifest.json'; manifest.write_text(json.dumps([entry]), encoding='utf-8')
    return assets, manifest


def prepare_db(db):
    db.add(Place(id=2, name='Fixture place', latitude=10.0, longitude=106.0, publication_status='published'))
    db.add(PlaceImage(place_id=2, url='/media/old-pending.jpg', status='pending'))
    db.commit()


def test_preview_apply_repeat_and_preserve_pending(db_session, tmp_path):
    assets, manifest = fixture_asset(tmp_path); entries = read_assets(manifest, assets)
    upload = tmp_path / 'uploads'; prepare_db(db_session)
    assert run(db_session, entries, upload, mutate=False) == [2]
    assert not upload.exists()
    assert run(db_session, entries, upload, mutate=True) == [2]
    place = db_session.get(Place, 2)
    assert place.publication_status == 'published' and place.image_url.startswith('/media/')
    assert place.image_source_url == entries[0]['description_url'] and place.image_license == 'CC BY 4.0'
    assert 'thu nhỏ' in place.image_attribution and len(list(upload.iterdir())) == 2
    assert db_session.scalar(select(PlaceImage).where(PlaceImage.url == '/media/old-pending.jpg')).status == 'pending'
    db_session.rollback()  # Close the read transaction before the next run.
    assert run(db_session, entries, upload, mutate=False) == []


def test_corrupt_input_and_unexpected_cover_abort(db_session, tmp_path):
    assets, manifest = fixture_asset(tmp_path)
    entries = read_assets(manifest, assets)
    prepare_db(db_session)
    db_session.get(Place, 2).image_url = 'https://valid.example/previous.jpg'; db_session.commit()
    with pytest.raises(ValueError, match='Existing cover'):
        run(db_session, entries, tmp_path / 'uploads', mutate=True)
    assert not (tmp_path / 'uploads').exists()
    (assets / 'place-02.jpg').write_bytes(b'not the verified image')
    with pytest.raises(ValueError, match='checksum'):
        read_assets(manifest, assets)


def test_failed_transaction_removes_only_new_files(db_session, tmp_path, monkeypatch):
    assets, manifest = fixture_asset(tmp_path); entries = read_assets(manifest, assets)
    upload = tmp_path / 'uploads'; upload.mkdir(); existing = upload / 'unrelated.jpg'; existing.write_bytes(b'keep')
    prepare_db(db_session)
    def fail_flush(*args, **kwargs):
        raise RuntimeError('simulated DB failure')
    monkeypatch.setattr(db_session, 'flush', fail_flush)
    with pytest.raises(RuntimeError, match='simulated'):
        run(db_session, entries, upload, mutate=True)
    assert list(upload.iterdir()) == [existing] and existing.read_bytes() == b'keep'


def test_download_does_not_replace_an_existing_mismatch(tmp_path):
    assets, manifest = fixture_asset(tmp_path)
    existing = assets / 'place-02.jpg'; existing.write_bytes(b'preserve this file')
    with pytest.raises(ValueError, match='refusing to overwrite'):
        download_assets(manifest, assets)
    assert existing.read_bytes() == b'preserve this file'
