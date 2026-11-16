import hashlib
from io import BytesIO

import pytest
from PIL import Image

from app.models.place import Place
from app.models.place_image import PlaceImage
from scripts.restore_bundled_media import restore


def fixture_photo(db_session, **changes):
    stream = BytesIO()
    Image.new("RGB", (900, 600), "teal").save(stream, "JPEG")
    data = stream.getvalue()
    place = Place(name="Recovery fixture", latitude=10.77, longitude=106.69)
    db_session.add(place)
    db_session.flush()
    fields = dict(place_id=place.id, url="/media/" + "a" * 32 + ".jpg",
                  thumbnail_url="/media/" + "a" * 32 + "-thumb.jpg",
                  sha256=hashlib.sha256(data).hexdigest(), status="approved")
    row = PlaceImage(**(fields | changes))
    db_session.add(row)
    db_session.commit()
    return row, data


def test_preview_restore_and_repeat_preserve_records(db_session, tmp_path):
    row, data = fixture_photo(db_session)
    photos = {row.sha256: data}
    directory = tmp_path / "uploads"
    before = (row.url, row.thumbnail_url, row.sha256, row.status)
    assert restore(db_session, directory, photos)["files_missing"] == 2
    assert not directory.exists()
    assert restore(db_session, directory, photos, apply=True)["files_restored"] == 2
    assert (directory / row.url.rsplit("/", 1)[1]).read_bytes() == data
    with Image.open(directory / row.thumbnail_url.rsplit("/", 1)[1]) as image:
        assert image.width <= 480 and image.height <= 360
    assert restore(db_session, directory, photos, apply=True)["files_restored"] == 0
    db_session.refresh(row)
    assert (row.url, row.thumbnail_url, row.sha256, row.status) == before


def test_unknown_photos_and_existing_files_are_never_replaced(db_session, tmp_path):
    row, data = fixture_photo(db_session)
    cover = tmp_path / row.url.rsplit("/", 1)[1]
    cover.write_bytes(b"Existing upload")
    result = restore(db_session, tmp_path, {}, apply=True)
    assert result["files_restored"] == 0 and result["unmatched_image_ids"] == [row.id]
    restore(db_session, tmp_path, {row.sha256: data}, apply=True)
    assert cover.read_bytes() == b"Existing upload"


def test_unsafe_media_path_is_rejected_before_writing(db_session, tmp_path):
    row, data = fixture_photo(db_session, thumbnail_url="/media/../outside.jpg")
    with pytest.raises(ValueError, match="Unsafe local media path"):
        restore(db_session, tmp_path, {row.sha256: data}, apply=True)
    assert list(tmp_path.iterdir()) == []
