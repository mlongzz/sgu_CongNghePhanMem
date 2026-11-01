from contextlib import contextmanager
import asyncio
import pytest
from test_admin import client,admin_headers  # noqa: F401
from test_media_and_account import headers
from app.models.admin import AdminSetting
from app.services.osm_snapshot_store import PostgresSnapshotStore,SnapshotStoreError,SNAPSHOT_KEY
from app.services.osm_service import OsmNearbyService,OsmUnavailable

def factory(session):
    @contextmanager
    def scoped():yield session
    return scoped

def snapshot(now):
    return {'version':2,'entries':[{'key':[10,106,3],'fetched_at':now,'result':{'source':'openstreetmap','elements':[{'type':'node','id':1,'lat':10,'lon':106,'tags':{'name':'Explicit fixture'}}],'requested_radius_km':3,'searched_radius_km':3}}]}

def test_durable_snapshot_survives_reader_restart_and_only_updates_its_reserved_key(db_session):
    clock=[10000.0];sessions=factory(db_session)
    db_session.add(AdminSetting(key='general',value={'site_name':'Preserved'}));db_session.commit()
    writer=PostgresSnapshotStore(sessions,clock=lambda:clock[0]);writer.write(snapshot(clock[0]))
    reader=PostgresSnapshotStore(sessions,clock=lambda:clock[0])
    revision,data=reader.read();assert data['entries'][0]['result']['elements'][0]['id']==1
    service=OsmNearbyService(snapshot_store=reader,clock=lambda:100,wall_clock=lambda:clock[0])
    result=asyncio.run(service.nearby(10,106,3));assert len(result.elements)==1 and not result.stale
    assert db_session.get(AdminSetting,'general').value=={'site_name':'Preserved'}
    assert writer.read()[0]==revision

def test_sync_lease_and_retry_after_survive_process_restart(db_session):
    clock=[10000.0];sessions=factory(db_session)
    first=PostgresSnapshotStore(sessions,clock=lambda:clock[0]);owner,retry=first.acquire_sync();assert owner and retry==0
    other=PostgresSnapshotStore(sessions,clock=lambda:clock[0]);assert other.acquire_sync()[0] is None
    first.finish_sync(owner,'failed',86400)
    clock[0]+=3601;assert other.acquire_sync()[0] is None
    clock[0]+=86400;assert other.acquire_sync()[0]
    with pytest.raises(ValueError):other.acquire_sync(60)

def test_expired_or_corrupt_durable_snapshot_cannot_be_reported_as_fresh(db_session):
    clock=[10000.0];sessions=factory(db_session);store=PostgresSnapshotStore(sessions,clock=lambda:clock[0],read_interval=0)
    store.write(snapshot(clock[0]));clock[0]+=86401
    service=OsmNearbyService(snapshot_store=store,clock=lambda:100,wall_clock=lambda:clock[0])
    with pytest.raises(OsmUnavailable):asyncio.run(service.nearby(10,106,3))
    db_session.get(AdminSetting,SNAPSHOT_KEY).value={'unexpected':'corruption'};db_session.commit()
    with pytest.raises(SnapshotStoreError):store.read()

def test_osm_sync_status_is_admin_only_and_public_settings_do_not_expose_snapshot(client,db_session,admin_headers):
    member=headers(db_session,email='osm-reader@example.test')
    assert client.get('/admin/osm/status').status_code==401
    assert client.get('/admin/osm/status',headers=member).status_code==403
    assert client.get('/admin/osm/status',headers=admin_headers).status_code==200
    db_session.add(AdminSetting(key=SNAPSHOT_KEY,value={'private_internal':'snapshot-only'}));db_session.commit()
    assert 'private_internal' not in client.get('/settings').text


def test_database_failure_labels_retained_snapshot_stale_and_never_renews_its_age(db_session,monkeypatch):
    clock=[10000.0];mono=[100.0]
    store=PostgresSnapshotStore(factory(db_session),clock=lambda:clock[0],read_interval=0)
    store.write(snapshot(clock[0]))
    service=OsmNearbyService(snapshot_store=store,clock=lambda:mono[0],wall_clock=lambda:clock[0],client_factory=lambda:pytest.fail('Public read must never call Overpass'))
    assert not asyncio.run(service.nearby(10,106,3)).stale
    def unavailable():raise SnapshotStoreError('Storage unavailable')
    monkeypatch.setattr(store,'read',unavailable)
    mono[0]+=10;clock[0]+=10
    retained=asyncio.run(service.nearby(10,106,3))
    assert retained.stale and retained.cache_age_seconds==10 and len(retained.elements)==1
    mono[0]+=86400;clock[0]+=86400
    with pytest.raises(OsmUnavailable):asyncio.run(service.nearby(10,106,3))


def test_production_snapshot_configuration_never_allows_ephemeral_files(monkeypatch):
    from app.services.osm_service import configured_snapshot_store
    monkeypatch.setenv('APP_ENV','production');monkeypatch.delenv('OSM_SNAPSHOT_STORAGE',raising=False)
    assert isinstance(configured_snapshot_store(),PostgresSnapshotStore)
    monkeypatch.setenv('OSM_SNAPSHOT_STORAGE','local')
    with pytest.raises(RuntimeError,match='durable'):configured_snapshot_store()
