from datetime import datetime,timezone
import re
from typing import Literal
from urllib.parse import quote
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,ConfigDict,Field,field_validator
from sqlalchemy import func,or_
from sqlalchemy.orm import Session
from PIL import Image
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.place import Place
from app.models.place_image import PlaceImage
from app.models.user import User
from app.services.safe_image_download import download_image
from app.services.image_manager_service import add_image

router=APIRouter(prefix='/admin',tags=['Image manager'],dependencies=[Depends(get_current_admin)])


class ImageUrl(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    url:str=Field(min_length=1,max_length=1000)
    source_url:str|None=Field(None,max_length=1000)
    attribution:str|None=Field(None,max_length=500)
    license:str|None=Field(None,max_length=200)

    @field_validator('source_url')
    @classmethod
    def valid_source(cls,value):
        from app.routers.media import ImageReview
        return ImageReview.valid_url(value)


class Suggestions(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    wikipedia_page_id:int|None=Field(None,ge=1,le=9_999_999_999)
    wikipedia_language:Literal['vi','en','fr','ja']='vi'
    wikidata_id:str|None=Field(None,pattern=r'^Q[1-9][0-9]{0,15}$')
    search_by_name:bool=False


class ImageIds(BaseModel):
    model_config=ConfigDict(extra='forbid')
    ids:list[int]=Field(min_length=1,max_length=10)


@router.post('/places/{place_id}/images/url')
def image_url(place_id:int,data:ImageUrl,db:Session=Depends(get_db),actor:User=Depends(get_current_admin)):
    if not db.get(Place,place_id):raise HTTPException(404,'Place not found')
    from app.routers import media
    from app.routers.media import image_value
    metadata={'source_url':data.source_url or data.url,'attribution':data.attribution,'license':data.license}
    row,created=add_image(db,place_id,download_image(data.url),actor.id,media.UPLOAD_DIR,metadata)
    return {'created':created,'image':image_value(row)}


def parsed_commons(page):
    from app.services.source_metadata import plain
    from urllib.parse import urlsplit
    if not isinstance(page,dict) or not isinstance(page.get('title'),str) or not page['title'].startswith('File:'):return None
    entries=page.get('imageinfo')
    if not isinstance(entries,list) or not entries or not isinstance(entries[0],dict):return None
    info=entries[0];metadata=info.get('extmetadata',{})
    if not isinstance(metadata,dict):return None
    metadata={key:value for key,value in metadata.items() if isinstance(value,dict)}
    license=plain(metadata.get('LicenseShortName',{}).get('value'),200)
    author=plain(metadata.get('Artist',{}).get('value'),500)
    url=info.get('thumburl') or info.get('url') or ''
    if not isinstance(url,str) or len(url)>1000:return None
    try:
        parts=urlsplit(url)
        if parts.scheme!='https' or parts.hostname not in {'upload.wikimedia.org','thumb.wikimedia.org'} or parts.port or parts.username or parts.password or parts.fragment or not parts.path.startswith('/wikipedia/commons/') or not author or not re.fullmatch(r'CC BY(?:-SA)?(?: [1234](?:\.\d)?)?|CC0(?: 1\.0)?|Public domain',license,re.I):return None
    except ValueError:return None
    return {'url':url,'source_url':'https://commons.wikimedia.org/wiki/'+quote(page.get('title','').replace(' ','_'),safe=':'),'attribution':author,'license':license}


@router.post('/places/{place_id}/images/suggestions')
def suggestions(place_id:int,data:Suggestions,db:Session=Depends(get_db)):
    from app.services.source_metadata import resolve_metadata,fetch_json
    from app.services.place_service import _haversine_km
    place=db.get(Place,place_id)
    if not place:raise HTTPException(404,'Place not found')
    source=place.source_url
    if data.wikipedia_page_id:source=f'https://{data.wikipedia_language}.wikipedia.org/?curid={data.wikipedia_page_id}'
    elif data.wikidata_id:source=f'https://www.wikidata.org/wiki/{data.wikidata_id}'
    if not data.search_by_name and not data.wikipedia_page_id and not data.wikidata_id and place.source == 'wikipedia':
        from app.services.demo_catalog_service import load_demo_catalog
        _, reviewed = load_demo_catalog()
        exact = next((item for item in reviewed if item.source_id == place.source_id and item.source_url == source), None)
        if exact and _haversine_km(place.latitude, place.longitude, exact.latitude, exact.longitude) <= .2:
            image = exact.image
            return {'method':'reviewed_demo_identity','distance_m':_haversine_km(place.latitude,place.longitude,exact.latitude,exact.longitude)*1000,
                    'source_name':exact.name,'items':[{'url':image.thumbnail_url,'source_url':image.source_url,'attribution':image.attribution,'license':image.license,
                    'confidence':'reviewed_demo_identity','identity_matches_coordinates':True}],
                    'notice':'Checked-in source metadata; review the exact Commons file and photo date before copying to durable storage and approving'}
    if source and not data.search_by_name:
        metadata,image=resolve_metadata(source)
        distance=_haversine_km(place.latitude,place.longitude,metadata['latitude'],metadata['longitude'])*1000
        return {'method':'source_identity','distance_m':distance,'source_name':metadata['name'],
                'items':[{**image,'confidence':'source_identity','identity_matches_coordinates':distance<=200}] if image else [],
                'notice':'Confirm the place identity, author and license before saving the image to the library'}
    if not data.search_by_name:
        return {'method':'no_identity','items':[],'notice':'Enter a Wikipedia page ID or Wikidata ID, or explicitly search by name'}
    payload=fetch_json('https://commons.wikimedia.org/w/api.php',{'action':'query','format':'json','generator':'search','gsrsearch':place.name[:150],'gsrnamespace':6,'gsrlimit':6,'prop':'imageinfo','iiprop':'url|extmetadata','iiurlwidth':960})
    # MediaWiki can return an HTTP 200 with an API error, or omit `query` when
    # there are no matches. Distinguish those cases from a malformed response.
    query=payload.get('query',{})
    if 'error' in payload or not isinstance(query,dict) or not isinstance(query.get('pages',{}),dict):
        raise HTTPException(502,'Image search provider returned an error or invalid response; please retry')
    pages=query.get('pages',{})
    images=[parsed_commons(row) for row in pages.values()]
    return {'method':'name_search_unverified','items':[{**image,'confidence':'name_search_unverified','identity_matches_coordinates':False} for image in images if image],
            'notice':'Name matches do not prove place identity. Admin must verify every suggested image.'}


@router.get('/images/places')
def places(q:str=Query('',max_length=100),missing:bool=False,page:int=Query(1,ge=1),page_size:int=Query(18,ge=1,le=48),db:Session=Depends(get_db)):
    query=db.query(Place).filter(Place.deleted_at.is_(None))
    if q:query=query.filter(Place.name.ilike(f'%{q.strip()}%'))
    if missing:query=query.filter(or_(Place.image_url.is_(None),Place.image_url==''))
    total=query.count();rows=query.order_by(Place.id.desc()).offset((page-1)*page_size).limit(page_size).all()
    counts={}
    if rows:
        for place_id,status,count in db.query(PlaceImage.place_id,PlaceImage.status,func.count()).filter(PlaceImage.place_id.in_([row.id for row in rows])).group_by(PlaceImage.place_id,PlaceImage.status):
            counts.setdefault(place_id,{})[status]=count
    return {'items':[{'id':row.id,'name':row.name,'category':row.category,'address':row.address,'publication_status':row.publication_status,'image_url':row.image_url,'image_thumbnail_url':row.image_thumbnail_url,'images':counts.get(row.id,{})} for row in rows],
            'total':total,'page':page,'pages':(total+page_size-1)//page_size}


@router.post('/images/health')
def health(data:ImageIds,db:Session=Depends(get_db)):
    from app.routers.media import image_file
    from app.services.image_processing import normalize
    from concurrent.futures import ThreadPoolExecutor
    rows=db.query(PlaceImage).filter(PlaceImage.id.in_(set(data.ids))).all()
    def check(url):
        try:
            if url.startswith('/media/'):
                file=image_file(url.removeprefix('/media/'))
                if not file.is_file():raise HTTPException(404,'Image not found')
                with Image.open(file) as image:image.verify()
            else:normalize(download_image(url))
            return 'ok',None
        except (HTTPException,OSError,ValueError):
            return 'broken','Không tải hoặc xác minh được ảnh. Nguồn có thể tạm thời không khả dụng.'
    with ThreadPoolExecutor(max_workers=4) as workers:
        checks=list(workers.map(check,[row.url for row in rows]))
    results=[]
    for row,result in zip(rows,checks):
        row.health_status,row.health_error=result
        row.health_checked_at=datetime.now(timezone.utc)
        results.append({'id':row.id,'status':row.health_status,'checked_at':row.health_checked_at,'message':row.health_error})
    db.commit()
    return {'items':results}
