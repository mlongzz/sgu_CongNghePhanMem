"""Google Maps ratings and reviews for a place via the official Places API (New).

The API key stays on the server (GOOGLE_MAPS_API_KEY). Results are kept in memory only, for a
short time, and always returned with Google attribution and the link back to Google Maps, as the
Places API policies require. Without a key the endpoint still returns a Google Maps search link so
visitors can read the reviews there.
"""
import os
import time
from urllib.parse import urlencode

import httpx2 as httpx

SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
FIELD_MASK = 'places.id,places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.reviews'
CACHE_SECONDS = 3600
LANGUAGES = {'vi', 'en', 'fr', 'ja'}
_cache: dict[tuple[int, str], tuple[float, dict]] = {}


def api_key() -> str:
    return os.getenv('GOOGLE_MAPS_API_KEY', '').strip()


def maps_search_url(name: str, address: str | None) -> str:
    query = ', '.join(part for part in (name, address or 'Quận 1, Thành phố Hồ Chí Minh') if part)
    return 'https://www.google.com/maps/search/?' + urlencode({'api': '1', 'query': query})


def _review(raw: dict) -> dict | None:
    text = (raw.get('text') or raw.get('originalText') or {}).get('text') or ''
    author = raw.get('authorAttribution') or {}
    rating = raw.get('rating')
    if not isinstance(rating, (int, float)) or not author.get('displayName'):
        return None
    return {
        'author': str(author['displayName'])[:120],
        'author_url': author.get('uri') if str(author.get('uri', '')).startswith('https://') else None,
        'author_photo': author.get('photoUri') if str(author.get('photoUri', '')).startswith('https://') else None,
        'rating': max(1, min(5, round(rating))),
        'text': text.strip()[:2000],
        'relative_time': str(raw.get('relativePublishTimeDescription') or '')[:60],
        'publish_time': raw.get('publishTime'),
        'url': raw.get('googleMapsUri') if str(raw.get('googleMapsUri', '')).startswith('https://') else None,
    }


def google_reviews(place_id: int, name: str, address: str | None, latitude: float, longitude: float,
                   language: str = 'vi', client: httpx.Client | None = None) -> dict:
    language = language if language in LANGUAGES else 'vi'
    fallback = {'configured': False, 'source': 'Google Maps', 'google_maps_uri': maps_search_url(name, address),
                'rating': None, 'user_rating_count': None, 'reviews': []}
    key = api_key()
    if not key:
        return fallback
    cached = _cache.get((place_id, language))
    if cached and cached[0] > time.time():
        return cached[1]
    body = {
        'textQuery': ', '.join(part for part in (name, address, 'Thành phố Hồ Chí Minh') if part),
        'languageCode': language,
        'maxResultCount': 1,
        'locationBias': {'circle': {'center': {'latitude': latitude, 'longitude': longitude}, 'radius': 300.0}},
    }
    headers = {'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK, 'Content-Type': 'application/json'}
    owns = client is None
    client = client or httpx.Client(timeout=10, follow_redirects=False, trust_env=False)
    try:
        response = client.post(SEARCH_URL, json=body, headers=headers)
        if response.status_code != 200:
            return {**fallback, 'configured': True, 'error': f'Google Places trả HTTP {response.status_code}'}
        places = (response.json() or {}).get('places') or []
    except (httpx.HTTPError, ValueError):
        return {**fallback, 'configured': True, 'error': 'Không kết nối được Google Places'}
    finally:
        if owns:
            client.close()
    if not places:
        result = {**fallback, 'configured': True}
    else:
        place = places[0]
        result = {
            'configured': True,
            'source': 'Google Maps',
            'google_maps_uri': place.get('googleMapsUri') if str(place.get('googleMapsUri', '')).startswith('https://') else fallback['google_maps_uri'],
            'rating': place.get('rating') if isinstance(place.get('rating'), (int, float)) else None,
            'user_rating_count': place.get('userRatingCount') if isinstance(place.get('userRatingCount'), int) else None,
            'reviews': [r for r in (_review(x) for x in (place.get('reviews') or [])[:5]) if r],
        }
    _cache[(place_id, language)] = (time.time() + CACHE_SECONDS, result)
    if len(_cache) > 500:
        _cache.pop(next(iter(_cache)))
    return result
