"""Read exact reviewed Wikipedia IDs and prepare a local, licensed demo proposal.

No database connection, login, seed or publication. Network refresh is explicit.
"""
import argparse
from datetime import datetime,timezone
import hashlib,html,json,math,re,time
from pathlib import Path
from urllib.parse import quote,urlsplit
import httpx2 as httpx

ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/'app/data/hcmc_discovery_review.json'
OUTPUT=ROOT/'app/data/hcmc_demo_candidate.json'
LICENSE=re.compile(r'^(CC BY(?:-SA)?(?: [1234](?:\.\d)?)?|CC0(?: 1\.0)?|Public domain)$',re.I)

def plain(value,limit=800):
    return html.unescape(re.sub(r'<[^>]*>','',str(value or ''))).strip()[:limit]

def query(endpoint,params):
    allowed={'https://vi.wikipedia.org/w/api.php','https://en.wikipedia.org/w/api.php','https://commons.wikimedia.org/w/api.php','https://www.wikidata.org/w/api.php'}
    if endpoint not in allowed:raise ValueError('Unsupported public source')
    with httpx.Client(timeout=20,follow_redirects=False,trust_env=False,headers={'User-Agent':'MultilingualGuide/1.0 (local demo catalog review; no automated publication)'}) as client:
        response=client.get(endpoint,params={'action':'query','format':'json','formatversion':'2',**params})
        if response.status_code!=200 or len(response.content)>4*1024*1024:raise RuntimeError('Public source unavailable or response too large')
        data=response.json()
        if not isinstance(data,dict) or data.get('error'):raise RuntimeError('Invalid public source response')
        return data

def prepare():
    old=json.loads(INPUT.read_text(encoding='utf-8'));found=[];all_files=set();now=datetime.now(timezone.utc).isoformat()
    for language in ('vi','en'):
        rows=[row for row in old['places'] if row['source_id'].startswith(language+':')]
        data=query(f'https://{language}.wikipedia.org/w/api.php',{'pageids':'|'.join(row['source_id'].split(':')[1] for row in rows),'prop':'coordinates|extracts|pageimages|revisions|pageprops','coprimary':'primary','colimit':'1','exintro':'1','explaintext':'1','exchars':'650','piprop':'name','rvprop':'ids|timestamp'})
        by_id={str(page['pageid']):page for page in data.get('query',{}).get('pages',[]) if isinstance(page,dict) and page.get('pageid')}
        for row in rows:
            page=by_id.get(row['source_id'].split(':')[1],{});coords=page.get('coordinates') or [];revisions=page.get('revisions') or []
            if page.get('ns')!=0 or page.get('missing') or 'disambiguation' in page.get('pageprops',{}) or not coords or not revisions:continue
            coordinate=coords[0];lat,lon=coordinate.get('lat'),coordinate.get('lon');filename=page.get('pageimage');extract=plain(page.get('extract'))
            if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)) or not math.isfinite(lat) or not math.isfinite(lon) or not (10.65<lat<10.95 and 106.5<lon<106.95) or coordinate.get('globe','earth')!='earth' or not filename or not extract:continue
            if row.get('wikidata_id') and page.get('pageprops',{}).get('wikibase_item')!=row['wikidata_id']:continue
            record={**row,'name':page['title'],'latitude':lat,'longitude':lon,'description':extract,'fetched_at':now,'source_revision_id':revisions[0]['revid'],'source_revision_url':f'https://{language}.wikipedia.org/w/index.php?oldid={revisions[0]["revid"]}'}
            found.append((record,filename));all_files.add(filename)
        time.sleep(.5)
    data=query('https://commons.wikimedia.org/w/api.php',{'titles':'|'.join('File:'+name for name in sorted(all_files)),'prop':'imageinfo','iiprop':'url|extmetadata|mime|size','iiurlwidth':'1200','iiextmetadatafilter':'Artist|LicenseShortName|LicenseUrl|Credit'})
    files={page.get('title','').removeprefix('File:').replace('_',' '):page for page in data.get('query',{}).get('pages',[]) if isinstance(page,dict)}
    places=[]
    for record,filename in found:
        info=(files.get(filename.replace('_',' '),{}).get('imageinfo') or [{}])[0];metadata=info.get('extmetadata') or {}
        author=plain(metadata.get('Artist',{}).get('value'),500);license=plain(metadata.get('LicenseShortName',{}).get('value'),200)
        url=info.get('url','');thumbnail=info.get('thumburl') or url
        def public_image(value):
            try:
                parsed=urlsplit(value)
                return parsed.scheme=='https' and parsed.hostname=='upload.wikimedia.org' and not parsed.username and not parsed.password and not parsed.port and parsed.path.startswith('/wikipedia/commons/') and len(value)<=1000
            except ValueError:return False
        if not author or not LICENSE.fullmatch(license) or info.get('mime') not in {'image/jpeg','image/png','image/webp'} or not public_image(url) or not public_image(thumbnail):continue
        record['image']={'url':url,'thumbnail_url':thumbnail,'source_url':'https://commons.wikimedia.org/wiki/File:'+quote(filename.replace(' ','_'),safe=''),'attribution':author,'license':license,'license_url':plain(metadata.get('LicenseUrl',{}).get('value'),500),'identity_method':'exact_article_pageimage','identity_evidence':f'Wikipedia {record["source_id"]} names exact Commons pageimage {filename}', 'reviewed_on':now[:10],'download_status':'source_metadata_reviewed_binary_not_downloaded','filename':filename,'mime':info['mime'],'width':info.get('width'),'height':info.get('height')}
        places.append(record)
    places=places[:25]
    if len(places)<15:raise RuntimeError('Fewer than 15 identity-verified, freely licensed places; proposal was not overwritten')
    return {'bundle_id':'hcmc-demo-candidate-pending-review-v1','compiled_at':now,'fetched_at':now,'selection':'First 25 reviewed primary article identities with verified coordinates, extracts and reusable exact-file Commons photos; Vietnamese sources first','review_status':'pending_admin_review','publication_status':'draft','coordinate_role':'primary_article_coordinate_not_verified_entrance','places':places,'verification':{'coordinate_source':'current primary Earth article coordinates','images':'exact article pageimage -> exact Commons file -> free license and author','database_writes':0}}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--refresh',action='store_true');args=parser.parse_args()
    if not args.refresh:
        print(json.dumps({'mode':'preview','network_requests':0,'database_writes':0,'input':INPUT.name,'output':OUTPUT.name}));return
    try:data=prepare()
    except (httpx.HTTPError,RuntimeError,ValueError) as error:
        parser.exit(1,'Public source unavailable; existing reviewed catalog unchanged. '+str(error)+'\n')
    OUTPUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'proposal':OUTPUT.name,'places':len(data['places']),'verified_images':len(data['places']),'database_writes':0,'sha256':hashlib.sha256(OUTPUT.read_bytes()).hexdigest()}))

if __name__=='__main__':main()
