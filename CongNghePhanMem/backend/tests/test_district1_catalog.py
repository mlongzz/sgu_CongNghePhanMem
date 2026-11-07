import copy

import pytest
from sqlalchemy import func, select

from app.models.admin import Journey, JourneyStop
from app.models.favorite import Favorite
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.place_image import PlaceImage
from app.models.user import User
from scripts.apply_district1_catalog import apply, inside, load_manifest, plan


def test_manifest_is_complete_and_inside_district1():
    bundle = load_manifest()
    polygon = bundle['area']['polygon']
    assert len(bundle['places']) == 12
    for row in bundle['places']:
        assert inside(polygon, row['latitude'], row['longitude']), row['name']
        assert {g['language_code'] for g in row['guides']} == {'vi', 'en', 'fr', 'ja'}
        assert row['image']['license'] and row['image']['attribution']
    # Neighbouring districts and well-known out-of-area sites are outside the boundary.
    assert not inside(polygon, 10.7795, 106.6921)   # War Remnants Museum, District 3
    assert not inside(polygon, 10.7681, 106.7068)   # Nha Rong wharf, District 4
    assert not inside(polygon, 11.1414, 106.4623)   # Cu Chi tunnels
    assert inside(polygon, 10.7771, 106.6954)       # Independence Palace


def small_bundle():
    bundle = copy.deepcopy(load_manifest())
    keep = {'Nhà thờ Đức Bà Sài Gòn', 'Bảo tàng Lịch sử Thành phố Hồ Chí Minh'}
    bundle['places'] = [row for row in bundle['places'] if row['name'] in keep]
    bundle['journey'] = {**bundle['journey'], 'stops': ['Dinh Độc Lập', 'Nhà thờ Đức Bà Sài Gòn', 'Bảo tàng Lịch sử Thành phố Hồ Chí Minh']}
    bundle['content'] = [entry for entry in bundle['content'] if entry['name'] in keep | {'Dinh Độc Lập'}]
    return bundle


def test_apply_deletes_outside_upgrades_drafts_adds_places_and_rebuilds_journey(db_session, tmp_path):
    palace = Place(name='Dinh Độc Lập', latitude=10.777108, longitude=106.695441, publication_status='published')
    cu_chi = Place(name='Địa đạo Củ Chi', latitude=11.1414, longitude=106.4623, publication_status='published', image_url='/media/old.jpg')
    draft = Place(name='Nhà thờ chính tòa Đức Bà Sài Gòn', latitude=10.7797, longitude=106.6990, publication_status='draft', source='wikipedia', source_id='vi:123')
    db_session.add_all([palace, cu_chi, draft]); db_session.flush()
    user = User(full_name='T', email='t@example.com', password_hash='x'); db_session.add(user); db_session.flush()
    db_session.add_all([GuideContent(place_id=cu_chi.id, language_code='vi', title='Củ Chi', content='x' * 50),
                        PlaceImage(place_id=cu_chi.id, url='/media/old.jpg', status='approved'),
                        Favorite(user_id=user.id, place_id=cu_chi.id)])
    journey = Journey(name='Old', description='old'); db_session.add(journey); db_session.flush()
    db_session.add_all([JourneyStop(journey_id=journey.id, place_id=cu_chi.id, position=0), JourneyStop(journey_id=journey.id, place_id=palace.id, position=1)])
    db_session.commit()
    (tmp_path / 'old.jpg').write_bytes(b'old')
    cu_chi_id, draft_id, journey_id = cu_chi.id, draft.id, journey.id

    bundle = small_bundle()
    preview = plan(db_session, bundle)
    assert preview['delete'] == [(cu_chi_id, 'Địa đạo Củ Chi')]
    assert preview['upgrade'] == [(draft_id, 'Nhà thờ chính tòa Đức Bà Sài Gòn', 'Nhà thờ Đức Bà Sài Gòn')]
    assert preview['add'] == ['Bảo tàng Lịch sử Thành phố Hồ Chí Minh']

    result, created, obsolete = apply(db_session, bundle, tmp_path)
    db_session.commit()
    # 2 new covers (cover + thumbnail each) and 2 extra photos for each of the 3 enriched places.
    assert tmp_path / 'old.jpg' in obsolete and len(created) == 2 * 2 + 3 * 2 * 2
    assert result['photos_added'] == 6
    names = set(db_session.scalars(select(Place.name)))
    assert names == {'Dinh Độc Lập', 'Nhà thờ Đức Bà Sài Gòn', 'Bảo tàng Lịch sử Thành phố Hồ Chí Minh'}
    for model in (GuideContent, PlaceImage, Favorite):
        assert db_session.scalar(select(func.count()).select_from(model).where(model.place_id == cu_chi_id)) == 0
    upgraded = db_session.get(Place, draft_id)
    assert upgraded.publication_status == 'published' and upgraded.source_id == 'vi:123'
    assert upgraded.image_url.startswith('/media/') and upgraded.image_license and upgraded.image_attribution
    assert db_session.scalar(select(func.count()).select_from(GuideContent).where(GuideContent.place_id == draft_id)) == 4
    assert (tmp_path / upgraded.image_url.removeprefix('/media/')).is_file()
    stops = list(db_session.scalars(select(JourneyStop).where(JourneyStop.journey_id == journey_id).order_by(JourneyStop.position)))
    assert [db_session.get(Place, s.place_id).name for s in stops] == bundle['journey']['stops']
    assert db_session.get(Journey, journey_id).name == bundle['journey']['name']

    # Long guides replace the short ones; every photo of an enriched place tells its own story.
    guide = db_session.scalars(select(GuideContent).where(GuideContent.place_id == draft_id, GuideContent.language_code == 'vi')).one()
    assert len(guide.content.split()) > 200
    photos = list(db_session.scalars(select(PlaceImage).where(PlaceImage.place_id == draft_id).order_by(PlaceImage.position)))
    assert len(photos) == 3 and all(set(photo.story) == {'vi', 'en', 'fr', 'ja'} for photo in photos)
    palace = db_session.scalars(select(Place).where(Place.name == 'Dinh Độc Lập')).one()
    assert db_session.scalar(select(func.count()).select_from(GuideContent).where(GuideContent.place_id == palace.id)) == 4

    # Running again is a no-op apart from rebuilding the same journey.
    again = plan(db_session, bundle)
    assert again['delete'] == [] and again['add'] == [] and again['upgrade'] == []
    second, created_again, _ = apply(db_session, bundle, tmp_path)
    assert created_again == [] and second['photos_added'] == 0 and second['guides_updated'] == 0 and second['cover_stories'] == 0


def test_apply_rejects_tampered_photo(db_session, tmp_path):
    db_session.add(Place(name='Dinh Độc Lập', latitude=10.777108, longitude=106.695441, publication_status='published')); db_session.commit()
    bundle = small_bundle()
    bundle['places'][0]['image']['sha256'] = '0' * 64
    with pytest.raises(ValueError, match='checksum'):
        apply(db_session, bundle, tmp_path)
