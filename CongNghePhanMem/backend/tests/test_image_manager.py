from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import HTTPException
from PIL import Image
from test_media_and_account import client, headers, png  # noqa: F401
from app.routers import image_manager
from app.services import safe_image_download as safe, r2_storage


def setup_place(client, db_session):
    admin=headers(db_session,'admin')
    pid=client.post('/admin/places',headers=admin,json={'name':'Image manager fixture','latitude':10,'longitude':106}).json()['id']
    return admin,pid


def test_url_import_review_dedup_thumbnails_health_and_missing_filter(client,db_session,monkeypatch,tmp_path):
    admin,pid=setup_place(client,db_session)
    monkeypatch.setattr(image_manager,'download_image',lambda url:png())
    path=f'/admin/places/{pid}/images/url'
    payload={'url':'https://images.example.org/photo.png','attribution':'Fixture photographer','license':'CC0'}
    response=client.post(path,headers=admin,json=payload)
    assert response.status_code==200,response.text
    row=response.json()['image']
    assert response.json()['created'] and row['status']=='pending' and row['thumbnail_url']!=row['url']
    assert (row['width'],row['height'])==(16,16)
    assert client.get(row['thumbnail_url']).status_code==200
    assert not client.post(path,headers=admin,json=payload).json()['created']
    assert len(list(tmp_path.iterdir()))==2
    listed=client.get('/admin/images/places?missing=true',headers=admin).json()
    assert listed['items'][0]['images']=={'pending':1}
    reviewed=client.put(f'/admin/places/{pid}/images/{row["id"]}',headers=admin,json={'status':'approved','as_cover':True})
    assert reviewed.json()['image_thumbnail_url']==row['thumbnail_url']
    assert client.get('/admin/images/places?missing=true',headers=admin).json()['total']==0
    health=client.post('/admin/images/health',headers=admin,json={'ids':[row['id']]}).json()['items'][0]
    assert health['status']=='ok'
    (tmp_path/row['url'].split('/')[-1]).unlink()
    assert client.post('/admin/images/health',headers=admin,json={'ids':[row['id']]}).json()['items'][0]['status']=='broken'
    # Health checks never discard the approved cover or metadata.
    from app.models.place import Place
    assert db_session.get(Place,pid).image_url==row['url']


def test_manager_rbac_invalid_metadata_and_failed_url_do_not_change_cover(client,db_session,monkeypatch):
    admin,pid=setup_place(client,db_session);member=headers(db_session,email='reader@images.example')
    for method,path,data in [('GET','/admin/images/places',None),('POST','/admin/images/health',{'ids':[1]}),('POST',f'/admin/places/{pid}/images/url',{'url':'https://images.example.org/a.jpg'}),('POST',f'/admin/places/{pid}/images/suggestions',{})]:
        kwargs={'json':data} if data else {}
        assert client.request(method,path,**kwargs).status_code==401
        assert client.request(method,path,headers=member,**kwargs).status_code==403
    assert client.post(f'/admin/places/{pid}/images/url',headers=admin,json={'url':'https://images.example.org/a.jpg','source_url':'javascript:alert(1)'}).status_code==422
    def unavailable(url):raise HTTPException(502,'unavailable')
    monkeypatch.setattr(image_manager,'download_image',unavailable)
    assert client.post(f'/admin/places/{pid}/images/url',headers=admin,json={'url':'https://images.example.org/a.jpg'}).status_code==502
    assert client.get(f'/admin/places/{pid}/images',headers=admin).json()==[]
    assert client.post('/admin/images/health',headers=admin,json={'ids':list(range(11))}).status_code==422


def test_identity_first_suggestions_and_explicit_name_search_never_publish(client,db_session,monkeypatch):
    from app.services import source_metadata
    admin,pid=setup_place(client,db_session);calls=[]
    def resolve(url):
        calls.append(url)
        return {'name':'Exact source identity','latitude':10,'longitude':106},{'url':'https://upload.wikimedia.org/wikipedia/commons/a/a1/Photo.jpg','attribution':'Fixture','license':'CC0','source_url':'https://commons.wikimedia.org/wiki/File:Photo.jpg'}
    monkeypatch.setattr(source_metadata,'resolve_metadata',resolve)
    path=f'/admin/places/{pid}/images/suggestions'
    assert client.post(path,headers=admin,json={}).json()['method']=='no_identity'
    exact=client.post(path,headers=admin,json={'wikidata_id':'Q123'}).json()
    assert calls==['https://www.wikidata.org/wiki/Q123'] and exact['items'][0]['identity_matches_coordinates']
    monkeypatch.setattr(source_metadata,'fetch_json',lambda *args:{'query':{'pages':{'1':{'title':'File:Photo.jpg','imageinfo':[{'url':'https://upload.wikimedia.org/wikipedia/commons/a/a1/Photo.jpg','extmetadata':{'Artist':{'value':'Fixture'},'LicenseShortName':{'value':'CC0'}}}]},'2':{'imageinfo':'malformed'},'3':None}}})
    by_name=client.post(path,headers=admin,json={'search_by_name':True}).json()
    assert by_name['method']=='name_search_unverified' and len(by_name['items'])==1
    assert not by_name['items'][0]['identity_matches_coordinates']
    assert client.get(f'/admin/places/{pid}/images',headers=admin).json()==[]


@pytest.mark.parametrize('payload', [{'error': {'code': 'ratelimited'}}, {'query': None}, {'query': {'pages': []}}])
def test_name_search_reports_invalid_provider_responses(client,db_session,monkeypatch,payload):
    from app.services import source_metadata
    admin,pid=setup_place(client,db_session)
    monkeypatch.setattr(source_metadata,'fetch_json',lambda *args:payload)
    response=client.post(f'/admin/places/{pid}/images/suggestions',headers=admin,json={'search_by_name':True})
    assert response.status_code==502
    assert client.get(f'/admin/places/{pid}/images',headers=admin).json()==[]


def test_name_search_allows_valid_empty_results(client,db_session,monkeypatch):
    from app.services import source_metadata
    admin,pid=setup_place(client,db_session)
    monkeypatch.setattr(source_metadata,'fetch_json',lambda *args:{'batchcomplete': ''})
    response=client.post(f'/admin/places/{pid}/images/suggestions',headers=admin,json={'search_by_name':True})
    assert response.status_code==200 and response.json()['items']==[]


@pytest.mark.parametrize('url',['http://public.example/a','https://localhost/a','https://127.0.0.1/a','https://169.254.169.254/a','https://[::1]/a','https://224.0.0.1/a','https://user:password@public.example/a','https://public.example:8080/a','https://public.example/a#fragment','https://public.example/a\r\nHost:other','https://metadata.google.internal/a'])
def test_ssrf_rejects_unsafe_destinations_before_dns(url,monkeypatch):
    monkeypatch.setattr(safe.socket,'getaddrinfo',lambda *a,**k:pytest.fail('unsafe destination must not resolve'))
    with pytest.raises(HTTPException) as caught:safe.public_destination(url)
    assert caught.value.status_code==422


def test_dns_all_answers_are_checked_and_public_ip_is_pinned(monkeypatch):
    addresses=['93.184.216.34','10.0.0.1']
    monkeypatch.setattr(safe.socket,'getaddrinfo',lambda *a,**k:[(None,None,None,None,(ip,443)) for ip in addresses])
    with pytest.raises(HTTPException):safe.public_destination('https://photos.example/a.jpg')
    addresses.pop()
    assert safe.public_destination('https://photos.example/a.jpg')==('photos.example','93.184.216.34','/a.jpg')
    calls=[];raw=SimpleNamespace(close=lambda:None)
    monkeypatch.setattr(safe.socket,'create_connection',lambda target,**kw:calls.append(target) or raw)
    conn=safe.PinnedHTTPSConnection('photos.example','93.184.216.34')
    conn._context=SimpleNamespace(wrap_socket=lambda sock,server_hostname:calls.append(server_hostname) or sock)
    conn.connect()
    assert calls==[('93.184.216.34',443),'photos.example']


@pytest.mark.parametrize('status,mime,length,chunks,expected',[(302,'image/png','0',[],422),(200,'text/html','1',[b'x'],415),(200,'image/png',str(6*1024*1024),[],413),(200,'image/png','0',[b'x'*6*1024*1024],413),(200,'image/png','0',[b'ok',b''],None)])
def test_download_rejects_redirects_html_and_oversize(monkeypatch,status,mime,length,chunks,expected):
    calls=[];chunks=iter(chunks)
    response=SimpleNamespace(status=status,getheader=lambda name,default='':{'Content-Type':mime,'Content-Length':length}.get(name,default),read1=lambda n:next(chunks,b''))
    class Connection:
        sock=None
        def __init__(self,host,address):calls.append((host,address))
        def request(self,*args,**kwargs):calls.append(kwargs['headers'])
        def getresponse(self):return response
        def close(self):calls.append('closed')
    monkeypatch.setattr(safe,'public_destination',lambda url:('photos.example','93.184.216.34','/a'))
    monkeypatch.setattr(safe,'PinnedHTTPSConnection',Connection)
    if expected:
        with pytest.raises(HTTPException) as error:safe.download_image('https://photos.example/a')
        assert error.value.status_code==expected
    else:assert safe.download_image('https://photos.example/a')==b'ok'
    assert calls[-1]=='closed' and 'Authorization' not in calls[1] and 'Cookie' not in calls[1]


@pytest.fixture
def r2env(monkeypatch):
    for key,value in {'R2_ACCOUNT_ID':'a'*32,'R2_ACCESS_KEY_ID':'fixture-access','R2_SECRET_ACCESS_KEY':'fixture-private','R2_BUCKET_NAME':'guide-images','R2_PUBLIC_BASE_URL':'https://images.example.org'}.items():monkeypatch.setenv(key,value)


def test_r2_server_adapter_writes_both_assets_and_deletes_only_its_keys(monkeypatch,r2env):
    calls=[]
    fake=SimpleNamespace(put_object=lambda **kw:calls.append(('put',kw)),delete_object=lambda **kw:calls.append(('delete',kw)))
    monkeypatch.setattr(r2_storage,'client',lambda config:fake)
    identity=uuid4().hex
    url=r2_storage.save(b'normalized',identity)
    assert url==f'https://images.example.org/places/{identity}.jpg'
    assert calls[0][1]['ContentType']=='image/jpeg' and 'immutable' in calls[0][1]['CacheControl']
    r2_storage.discard_unreferenced('https://other.example/places/'+identity+'.jpg')
    r2_storage.discard_unreferenced('https://images.example.org/places/../bad.jpg')
    assert len(calls)==1
    r2_storage.discard_unreferenced(url)
    assert calls[-1][0]=='delete'


def test_r2_fixed_endpoint_credentials_and_failure_are_not_exposed(monkeypatch,r2env):
    import boto3
    recorded={}
    def factory(service,**kwargs):recorded.update(kwargs);return object()
    monkeypatch.setattr(boto3,'client',factory)
    r2_storage.client(r2_storage.configuration())
    assert recorded['endpoint_url']=='https://'+'a'*32+'.r2.cloudflarestorage.com'
    assert recorded['aws_secret_access_key']=='fixture-private' and recorded['region_name']=='auto'
    def unavailable(config):raise RuntimeError('fixture-private')
    monkeypatch.setattr(r2_storage,'client',unavailable)
    with pytest.raises(HTTPException) as error:r2_storage.save(b'fixture',uuid4().hex)
    assert error.value.status_code==502 and 'fixture-private' not in error.value.detail
    monkeypatch.setenv('R2_PUBLIC_BASE_URL','http://localhost')
    with pytest.raises(RuntimeError):r2_storage.configuration()


def test_storage_migration_is_explicit_preserves_local_files_and_shared_references(client,db_session,tmp_path):
    from scripts.migrate_images_to_r2 import migrate
    from app.models.place import Place
    from app.models.place_image import PlaceImage
    admin,pid=setup_place(client,db_session)
    client.post(f'/admin/places/{pid}/image',headers=admin,content=png())
    row=db_session.query(PlaceImage).one()
    place=db_session.get(Place,pid);place.image_url=row.url;place.image_thumbnail_url=row.thumbnail_url;db_session.commit()
    assert migrate(db_session,tmp_path)=={'referenced_files':2,'updated_references':0,'applied':False}
    calls=[]
    def save(data,identity):calls.append(data);return f'https://images.example.org/places/{identity}.jpg'
    result=migrate(db_session,tmp_path,True,save)
    assert result['updated_references']==4 and len(calls)==2 and len(list(tmp_path.iterdir()))==2
    assert place.image_url==row.url and place.image_thumbnail_url==row.thumbnail_url and row.storage_backend=='r2'
    assert migrate(db_session,tmp_path)['referenced_files']==0


def test_storage_copy_failure_never_changes_database_urls(client,db_session,tmp_path):
    from scripts.migrate_images_to_r2 import migrate
    from app.models.place_image import PlaceImage
    admin,pid=setup_place(client,db_session)
    client.post(f'/admin/places/{pid}/image',headers=admin,content=png())
    row=db_session.query(PlaceImage).one();original=(row.url,row.thumbnail_url)
    def fail(data,identity):raise RuntimeError('storage unavailable')
    with pytest.raises(RuntimeError):migrate(db_session,tmp_path,True,fail)
    assert (row.url,row.thumbnail_url)==original
