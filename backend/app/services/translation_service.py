"""Translation service using a configurable LibreTranslate-compatible API."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException, status

from app.config import TRANSLATION_API_KEY, TRANSLATION_API_URL


def translate_texts(texts: list[str], source_language: str, target_language: str) -> list[str]:
    """
    Translate a list of texts from *source_language* to *target_language*.

    Uses the endpoint configured via TRANSLATION_API_URL in the environment.
    Raises HTTP 503 if the endpoint is not configured, 502 for provider errors.
    """
    if not TRANSLATION_API_URL:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation provider is not configured",
        )

    payload: dict = {
        "q": texts,
        "source": source_language,
        "target": target_language,
        "format": "text",
    }
    if TRANSLATION_API_KEY:
        payload["api_key"] = TRANSLATION_API_KEY

    request = Request(
        TRANSLATION_API_URL.rstrip("/") + "/translate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Translation provider returned HTTP {error.code}",
        ) from error
    except (URLError, TimeoutError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach translation provider",
        ) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Translation provider returned an invalid response",
        ) from error

    translated = result.get("translatedText") if isinstance(result, dict) else None
    if isinstance(translated, str) and len(texts) == 1:
        translated = [translated]
    if not isinstance(translated, list) or len(translated) != len(texts):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Translation provider returned an unexpected response",
        )
    if not all(isinstance(v, str) for v in translated):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Translation provider returned invalid translated text",
        )
    return translated
