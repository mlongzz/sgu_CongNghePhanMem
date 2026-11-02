import pytest
import httpx2
from fastapi import HTTPException
from sqlalchemy import event
from test_admin import client, admin_headers  # noqa: F401
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.user import User
from app.routers.auth import create_access_token
from app.services import source_metadata


def test_noop_place_and_guide_preserve_publication(client, admin_headers):
    place = client.post('/admin/places', headers=admin_headers, json={'name':'Published no-op', 'latitude':10,'longitude':106,'publication_status':'published'}).json()
    path = f"/admin/places/{place['id']}"
    assert client.put(path, headers=admin_headers, json={'name':place['name'], 'description':None, 'latitude':10,'longitude':106}).json()['publication_status'] == 'published'
    guide_path = path + '/guide-content/vi'
    guide = {'title':'Reviewed fixture','content':'Same reviewed content','publication_status':'published'}
    assert client.put(guide_path, headers=admin_headers,json=guide).status_code == 200
    assert client.put(guide_path, headers=admin_headers,json=guide).json()['publication_status'] == 'published'
    assert client.get(f"/places/{place['id']}/guide-content?language=vi").status_code == 200


def test_effective_admin_source_is_distinct_from_database_role(client, db_session, monkeypatch):
    from app import dependencies
    from app.routers import admin
    member = User(email='configured@example.test',full_name='Configured admin',password_hash='unused',role='user')
    db_session.add(member); db_session.commit()
    monkeypatch.setattr(dependencies,'ADMIN_USER_IDS',{member.id})
    monkeypatch.setattr(admin,'ADMIN_USER_IDS',{member.id})
    headers={'Authorization':'Bearer '+create_access_token(member.id)}
    me=client.get('/admin/me',headers=headers).json()
    assert me['database_role']=='user' and me['access_source']=='configuration'
    row=client.get('/admin/users',headers=headers).json()['items'][0]
    assert row['role']=='user' and row['effective_admin'] and row['admin_access_source']=='configuration'
    assert client.patch(f'/admin/users/{member.id}/role',headers=headers,json={'role':'admin'}).status_code==409
    monkeypatch.setattr(dependencies,'ADMIN_USER_IDS',set())
    assert client.get('/admin/users',headers=headers).status_code==403


def test_published_summaries_use_two_queries_and_never_leak_draft_languages(client, db_session):
    for i in range(10):
        p=Place(name=f'Summary {i}',latitude=10,longitude=106,publication_status='published')
        db_session.add(p); db_session.flush()
        for lang,status in [('ja','published'),('fr','draft')]:
            db_session.add(GuideContent(place_id=p.id,language_code=lang,title='Fixture',content='日本語の概要です。続きです。' if lang=='ja' else 'Unpublished French fixture',publication_status=status))
    db_session.commit()
    queries=[]
    def capture(conn,cursor,statement,parameters,context,executemany):
        if statement.lstrip().upper().startswith('SELECT'): queries.append(statement)
    bind=db_session.get_bind()
    event.listen(bind,'before_cursor_execute',capture)
    try: response=client.get('/places?limit=100')
    finally: event.remove(bind,'before_cursor_execute',capture)
    assert response.status_code==200 and len(response.json())==10
    assert len(queries)==2
    assert all(row['description_translations']=={'ja':'日本語の概要です。'} for row in response.json())


@pytest.mark.parametrize('status',[403,429,503])
def test_provider_http_error_is_specific_and_never_follows_redirects(monkeypatch,status):
    real=source_metadata.httpx.Client
    seen=[]
    def handler(request):
        seen.append(request)
        return httpx2.Response(status,text='private provider response must not leak')
    monkeypatch.setattr(source_metadata.httpx,'Client',lambda **options:real(transport=httpx2.MockTransport(handler),**options))
    with pytest.raises(HTTPException) as exc:
        source_metadata.fetch_json('https://commons.wikimedia.org/w/api.php',{'action':'query'})
    assert exc.value.status_code==502 and f'HTTP {status}' in exc.value.detail
    assert 'private' not in exc.value.detail and len(seen)==1


@pytest.mark.parametrize('error,status,word',[(httpx2.ConnectError('private'),502,'DNS'),(httpx2.ReadTimeout('private'),504,'timed out')])
def test_provider_connection_and_timeout_errors_are_bounded(monkeypatch,error,status,word):
    real=source_metadata.httpx.Client
    def handler(request): raise error
    monkeypatch.setattr(source_metadata.httpx,'Client',lambda **options:real(transport=httpx2.MockTransport(handler),**options))
    with pytest.raises(HTTPException) as exc:
        source_metadata.fetch_json('https://commons.wikimedia.org/w/api.php',{})
    assert exc.value.status_code==status and word in exc.value.detail and 'private' not in exc.value.detail
