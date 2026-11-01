import pytest
from fastapi.testclient import TestClient
from app.database import get_db
from app.main import app
from app.models.admin import AdminSetting
from app.models.place import Place
from app.models.user import User
from app.routers.auth import create_access_token
from app.services.demo_catalog_service import load_demo_catalog, DemoPlace, DEMO_ID

def test_demo_has_verified_unique_coordinates_and_free_exact_file_images():
    bundle, rows = load_demo_catalog()
    assert 15 <= len(rows) <= 30 and bundle['verification']['database_writes'] == 0
    assert len({row.source_id for row in rows}) == len(rows)
    for row in rows:
        assert 10.65 < row.latitude < 10.95 and 106.5 < row.longitude < 106.95
        assert row.image.identity_evidence and row.description
        assert row.publication_status == 'draft'
        raw=row.model_dump();raw['image']['url']='https://upload.wikimedia.org.attacker.test/a.jpg'
        with pytest.raises(ValueError): DemoPlace.model_validate(raw)

def test_demo_preview_import_repeat_and_photos_remain_pending(db_session, monkeypatch):
    from app.services import source_metadata
    monkeypatch.setattr(source_metadata,'resolve_metadata',lambda *args:pytest.fail('Demo image suggestions must not depend on Wikipedia'))
    actor=User(email='demo-admin@example.test',full_name='Demo Admin',role='admin',password_hash='unused')
    db_session.add(actor);db_session.commit()
    previous=app.dependency_overrides.copy();app.dependency_overrides[get_db]=lambda:db_session
    try:
        client=TestClient(app);headers={'Authorization':'Bearer '+create_access_token(actor.id)};url='/admin/catalog/hcmc-demo'
        assert client.get(url).status_code == 401
        preview=client.get(url,headers=headers).json()
        assert preview['places_to_create']==15 and db_session.query(Place).count()==0
        assert all(row['image']['license'] for row in preview['rows'])
        ids=[row['source_id'] for row in preview['rows']]
        applied=client.post(url+'/import',headers=headers,json={'source_ids':ids,'preview_token':preview['preview_token']})
        assert applied.status_code==200,applied.text
        rows=db_session.query(Place).all()
        assert len(rows)==15 and all(row.publication_status=='draft' and row.description and row.image_url is None for row in rows)
        assert client.get('/places').json()==[]
        row=rows[0]
        images=client.post(f'/admin/places/{row.id}/images/suggestions',headers=headers,json={})
        assert images.status_code==200 and images.json()['method']=='reviewed_demo_identity'
        assert row.image_url is None
        assert db_session.get(AdminSetting,DEMO_ID).value[row.source_id]['snapshot']['image']['license']
        again=client.get(url,headers=headers).json()
        assert again['existing']==15 and again['places_to_create']==0
        row.description='Edited by Admin';db_session.commit()
        current=client.get(url,headers=headers).json()
        assert client.post(url+'/import',headers=headers,json={'source_ids':ids,'preview_token':current['preview_token']}).status_code==200
        assert row.description=='Edited by Admin'
    finally:
        app.dependency_overrides.clear();app.dependency_overrides.update(previous)
