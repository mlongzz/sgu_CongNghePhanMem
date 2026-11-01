"""Plan by default. --apply copies referenced local images into configured R2, then atomically updates URLs.

Run after a verified DB/uploads backup. No local file is removed. Never invoke without cloud approval.
"""
import argparse
from pathlib import Path
import re
from uuid import uuid4
from sqlalchemy import or_
from app.database import SessionLocal
from app.config import UPLOAD_DIR
from app.models.place import Place
from app.models.place_image import PlaceImage


def migrate(db, directory, apply=False, save=None):
    references=[]
    for model,columns in ((Place,('image_url','image_thumbnail_url')),(PlaceImage,('url','thumbnail_url'))):
        for row in db.query(model).filter(or_(*(getattr(model,key).like('/media/%') for key in columns))).with_for_update().all():
            for key in columns:
                url=getattr(row,key)
                if url and url.startswith('/media/'):
                    name=url.removeprefix('/media/')
                    if not re.fullmatch(r'[a-f0-9]{32}(?:-thumb)?\.jpg',name):
                        raise RuntimeError('Unsupported local image reference; nothing was updated')
                    path=Path(directory).resolve()/name
                    if not path.is_file():raise RuntimeError('A referenced local image is missing; restore uploads first')
                    references.append((row,key,url,path))
    urls={url:path for _,_,url,path in references}
    if not apply:return {'referenced_files':len(urls),'updated_references':0,'applied':False}
    if save is None:
        from app.services.r2_storage import configuration,save as adapter
        configuration()
        save=adapter
    # Finish all copies before modifying any DB URL. Uploaded orphans may remain if a copy fails.
    copied={url:save(path.read_bytes(),uuid4().hex) for url,path in urls.items()}
    for row,key,url,_ in references:
        setattr(row,key,copied[url])
        if isinstance(row,PlaceImage):row.storage_backend='r2'
    db.commit()
    return {'referenced_files':len(urls),'updated_references':len(references),'applied':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    with SessionLocal() as db:
        print(migrate(db,UPLOAD_DIR,args.apply))


if __name__=='__main__':main()
