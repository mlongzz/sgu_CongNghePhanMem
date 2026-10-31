"""HTTPS image fetch with public DNS validation, IP pinning, TLS SNI, no redirects/proxies."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
import http.client
import ipaddress
import socket
import ssl
import time
from urllib.parse import quote, urlsplit
from fastapi import HTTPException

MAX_BYTES = 5 * 1024 * 1024
_resolver = ThreadPoolExecutor(max_workers=4, thread_name_prefix='image-dns')


def public_destination(url):
    if not isinstance(url, str) or len(url) > 1000 or any(ord(c) < 33 for c in url) or '\\' in url:
        raise HTTPException(422, 'Use a public HTTPS image URL without whitespace or credentials')
    try:
        parts = urlsplit(url)
        host = (parts.hostname or '').encode('idna').decode('ascii').lower().rstrip('.')
        if parts.scheme != 'https' or not host or parts.port not in (None,443) or parts.username or parts.password or parts.fragment:
            raise ValueError()
        if host in {'localhost','metadata.google.internal'} or host.endswith(('.localhost','.local','.internal','.test')):
            raise ValueError()
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None and (not literal.is_global or literal.is_multicast):
            raise ValueError()
        future = _resolver.submit(socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM)
        try:
            answers = future.result(timeout=3)
        except FutureTimeout:
            future.cancel()
            raise HTTPException(504, 'Image DNS lookup timed out') from None
        addresses = list(dict.fromkeys(answer[4][0] for answer in answers))
        if not addresses or any(not ipaddress.ip_address(address).is_global or ipaddress.ip_address(address).is_multicast for address in addresses):
            raise ValueError()
        return host, addresses[0], quote(parts.path or '/', safe='/%:@!$&\x27()*+,;=-._~') + ('?' + parts.query if parts.query else '')
    except (ValueError, UnicodeError, socket.gaierror):
        raise HTTPException(422, 'Private, local, metadata or invalid image destination is not allowed') from None


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address):
        super().__init__(host, port=443, timeout=4, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address,443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def download_image(url):
    deadline = time.monotonic() + 15
    host,address,target = public_destination(url)
    connection = PinnedHTTPSConnection(host,address)
    try:
        connection.request('GET',target,headers={'Accept':'image/jpeg,image/png,image/webp','Accept-Encoding':'identity','User-Agent':'MultilingualGuide/1.0 (administrator image import)'})
        response = connection.getresponse()
        if response.status != 200:
            raise HTTPException(422, 'Image URL did not return a file; redirects are not followed')
        mime = response.getheader('Content-Type','').split(';',1)[0].lower()
        if mime not in {'image/jpeg','image/png','image/webp','application/octet-stream'}:
            raise HTTPException(415,'URL must return JPEG, PNG or WebP image data')
        if response.getheader('Content-Encoding','identity').lower() not in {'identity',''}:
            raise HTTPException(415,'Compressed image HTTP responses are not accepted')
        if int(response.getheader('Content-Length','0')) > MAX_BYTES:
            raise HTTPException(413,'Image must be at most 5 MB')
        data = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise HTTPException(504,'Image download timed out')
            if connection.sock:
                connection.sock.settimeout(min(4,remaining))
            chunk = response.read1(65536)
            if not chunk:
                break
            if len(data)+len(chunk)>MAX_BYTES:
                raise HTTPException(413,'Image must be at most 5 MB')
            data.extend(chunk)
        return bytes(data)
    except (OSError, http.client.HTTPException, ValueError):
        raise HTTPException(502,'Image source is unavailable; no cover was changed') from None
    finally:
        connection.close()
