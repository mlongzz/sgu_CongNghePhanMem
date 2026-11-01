"""R2 S3 adapter: fixed account endpoint, backend-only credentials, public immutable assets."""
import os,re
from urllib.parse import urlsplit
from fastapi import HTTPException


def configuration():
    names=('R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','R2_PUBLIC_BASE_URL')
    values={name:os.getenv(name,'').strip() for name in names}
    if not all(values.values()):
        raise RuntimeError('R2 server configuration is incomplete')
    if not re.fullmatch(r'[a-fA-F0-9]{32}',values['R2_ACCOUNT_ID']):
        raise RuntimeError('Invalid R2 account ID')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',values['R2_BUCKET_NAME']):
        raise RuntimeError('Invalid R2 bucket name')
    parts=urlsplit(values['R2_PUBLIC_BASE_URL'])
    if parts.scheme!='https' or not parts.hostname or parts.username or parts.password or parts.port or parts.query or parts.fragment or parts.path not in ('','/'):
        raise RuntimeError('R2_PUBLIC_BASE_URL must be an HTTPS public origin')
    if parts.hostname=='localhost' or parts.hostname.endswith(('.local','.internal','.test')) or re.fullmatch(r'[\d.]+',parts.hostname) or ':' in parts.hostname:
        raise RuntimeError('R2 public origin cannot be a local address')
    return values


def client(values):
    import boto3
    from botocore.config import Config
    return boto3.client('s3',endpoint_url=f"https://{values['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=values['R2_ACCESS_KEY_ID'],aws_secret_access_key=values['R2_SECRET_ACCESS_KEY'],region_name='auto',
        config=Config(signature_version='s3v4',connect_timeout=4,read_timeout=20,retries={'max_attempts':1},
                      request_checksum_calculation='when_required',response_checksum_validation='when_required'))


def save(data,identity):
    values=configuration()
    key=f'places/{identity}.jpg'
    try:
        client(values).put_object(Bucket=values['R2_BUCKET_NAME'],Key=key,Body=data,ContentType='image/jpeg',CacheControl='public, max-age=31536000, immutable')
        return values['R2_PUBLIC_BASE_URL'].rstrip('/')+'/'+key
    except Exception:
        raise HTTPException(502,'Image storage is unavailable; no cover was changed') from None


def discard_unreferenced(url):
    values=configuration()
    prefix=values['R2_PUBLIC_BASE_URL'].rstrip('/')+'/places/'
    if not url.startswith(prefix) or not re.fullmatch(r'[a-f0-9]{32}(?:-thumb)?\.jpg',url[len(prefix):]):
        return
    try:
        client(values).delete_object(Bucket=values['R2_BUCKET_NAME'],Key='places/'+url[len(prefix):])
    except Exception:
        pass
