from datetime import datetime,timedelta,timezone
from uuid import uuid4
import pytest
from test_admin import client,admin_headers  # noqa: F401
from test_media_and_account import headers
from app.models.presence import UserPresenceSession,UserPresencePreference
from app.services import presence_service as presence


@pytest.fixture
def now(monkeypatch):
    value=[datetime(2026,10,26,12,tzinfo=timezone.utc)]
    monkeypatch.setattr(presence,'utcnow',lambda:value[0])
    return value


def start(client,auth,identity=None):
    response=client.post('/presence/start',headers=auth,json={'client_id':identity or str(uuid4()),'device':'web'})
    assert response.status_code==200,response.text
    return response.json()


def test_presence_auth_ownership_and_admin_rbac(client,db_session,now):
    first=headers(db_session,email='first@presence.example')
    other=headers(db_session,email='other@presence.example')
    row=start(client,first)
    assert client.post('/presence/start',json={'client_id':str(uuid4())}).status_code==401
    for path in ('/presence/heartbeat','/presence/end'):
        assert client.post(path,headers=other,json={'session_id':row['id']}).status_code==404
    for path in ('/admin/presence','/admin/presence/summary','/admin/presence/users/1'):
        assert client.get(path,headers=first).status_code==403
        assert client.get(path).status_code==401
    assert client.get('/presence/policy').json()['offline_after_seconds']==90


def test_tabs_devices_deduplicate_online_users_and_start_retries(client,db_session,admin_headers,now):
    auth=headers(db_session,email='tabs@presence.example');identity=str(uuid4())
    first=start(client,auth,identity)
    assert start(client,auth,identity)['id']==first['id']
    second=start(client,auth)
    assert first['id']!=second['id']
    summary=client.get('/admin/presence/summary',headers=admin_headers).json()
    assert summary['online_users']==1 and summary['sessions_today']==2
    user=client.get('/admin/presence?status=online',headers=admin_headers).json()['items'][0]
    assert user['active_sessions']==2 and user['online']
    assert max(point['count'] or 0 for point in summary['series'])==1


def test_expiry_and_offline_estimate_use_server_last_signal(client,db_session,admin_headers,now):
    auth=headers(db_session);row=start(client,auth)
    now[0]+=timedelta(seconds=190)
    assert client.post('/presence/heartbeat',headers=auth,json={'session_id':row['id']}).status_code==409
    offline=client.get('/admin/presence?status=offline',headers=admin_headers).json()['items']
    user=next(user for user in offline if user['email']=='member@example.com')
    assert user['offline_seconds_estimated']==100
    assert client.get('/admin/presence/summary',headers=admin_headers).json()['online_users']==0
    assert start(client,auth)['id']!=row['id']


def test_foreground_and_interaction_are_bounded_and_separate_from_wall_time(client,db_session,now):
    auth=headers(db_session);row=start(client,auth)
    now[0]+=timedelta(seconds=30)
    value=client.post('/presence/heartbeat',headers=auth,json={'session_id':row['id'],'foreground_seconds':20,'interaction_seconds':12}).json()
    assert value['duration_seconds']==30 and value['foreground_seconds']==20 and value['interaction_seconds']==12
    now[0]+=timedelta(seconds=1)
    duplicate=client.post('/presence/heartbeat',headers=auth,json={'session_id':row['id'],'foreground_seconds':20,'interaction_seconds':12}).json()
    assert duplicate['foreground_seconds']==20
    for payload in ({'foreground_seconds':46},{'foreground_seconds':2,'interaction_seconds':3},{'latitude':10},{'user_id':999},{'last_seen_at':'2099-01-01'}):
        assert client.post('/presence/heartbeat',headers=auth,json={'session_id':row['id'],**payload}).status_code==422


def test_logout_one_tab_keeps_other_tab_online_and_end_is_idempotent(client,db_session,admin_headers,now):
    auth=headers(db_session);first=start(client,auth);second=start(client,auth)
    for identifier in (first['id'],first['id']):
        assert client.post('/presence/end',headers=auth,json={'session_id':identifier}).status_code==200
    assert client.get('/admin/presence/summary',headers=admin_headers).json()['online_users']==1
    client.post('/presence/end',headers=auth,json={'session_id':second['id']})
    assert client.get('/admin/presence/summary',headers=admin_headers).json()['online_users']==0


def test_delete_own_activity_disables_tracking_and_preserves_other_users(client,db_session,now):
    first=headers(db_session,email='privacy@presence.example');other=headers(db_session,email='keep@presence.example')
    start(client,first);start(client,first);start(client,other)
    result=client.delete('/presence/me',headers=first).json()
    assert result=={'deleted_sessions':2,'enabled':False}
    assert db_session.query(UserPresenceSession).count()==1
    assert client.post('/presence/start',headers=first,json={'client_id':str(uuid4())}).status_code==403
    assert client.put('/presence/preferences',headers=first,json={'enabled':True}).json()['enabled']
    assert start(client,first)['online']


def test_retention_prunes_activity_but_retains_privacy_preference(client,db_session,now):
    auth=headers(db_session);start(client,auth)
    client.put('/presence/preferences',headers=auth,json={'enabled':False})
    now[0]+=timedelta(days=31)
    assert presence.prune(db_session)==1
    assert db_session.query(UserPresenceSession).count()==0
    assert db_session.query(UserPresencePreference).one().enabled is False


def test_period_filters_and_identifying_detail_are_admin_only(client,db_session,admin_headers,now):
    auth=headers(db_session);row=start(client,auth)
    for period in ('day','week','month'):
        response=client.get('/admin/presence/summary?period='+period,headers=admin_headers)
        assert response.status_code==200 and response.json()['offline_time_is_estimated']
    assert client.get('/admin/presence/summary?day=2099-01-01',headers=admin_headers).status_code==422
    user=db_session.query(UserPresenceSession).filter_by(id=row['id']).one().user_id
    detail=client.get(f'/admin/presence/users/{user}',headers=admin_headers).json()
    assert detail['user']['email']=='member@example.com' and detail['sessions'][0]['id']==row['id']
    assert 'password_hash' not in str(detail) and 'client_id' not in str(detail)
