import copy
import json
import pytest
from fastapi import HTTPException
from test_admin import client, admin_headers  # noqa: F401
from app.models.place import Place
from app.services import source_metadata as source, url_import_service as importer

WIKI = {
    "query": {
        "pages": {
            "9001": {
                "pageid": 9001,
                "ns": 0,
                "title": "Explicit URL import fixture",
                "extract": "A factual test fixture, not runtime data.",
                "coordinates": [
                    {"lat": 10, "lon": 106, "globe": "earth", "primary": ""}
                ],
                "pageimage": "Fixture.jpg",
            }
        }
    }
}
COMMONS = {
    "query": {
        "pages": {
            "2": {
                "title": "File:Fixture.jpg",
                "imageinfo": [
                    {
                        "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Fixture.jpg/1200px-Fixture.jpg",
                        "extmetadata": {
                            "LicenseShortName": {"value": "CC BY-SA 4.0"},
                            "Artist": {
                                "value": '<a href="https://example.test">Fixture author</a>'
                            },
                        },
                    }
                ],
            }
        }
    }
}


@pytest.fixture
def providers(monkeypatch):
    calls = []

    def fetch(endpoint, params):
        calls.append((endpoint, params))
        return copy.deepcopy(COMMONS if "commons.wikimedia.org" in endpoint else WIKI)

    monkeypatch.setattr(source, "fetch_json", fetch)
    return calls


@pytest.mark.parametrize(
    "url",
    [
        "http://vi.wikipedia.org/wiki/Test",
        "https://localhost/wiki/Test",
        "https://127.0.0.1/wiki/Test",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.1/wiki/Test",
        "https://[::1]/wiki/Test",
        "https://vi.wikipedia.org.evil.test/wiki/Test",
        "https://vi.wikipedia.org@evil.test/wiki/Test",
        "https://evil.test@vi.wikipedia.org/wiki/Test",
        "https://vi.wikipedia.org:443/wiki/Test",
        "https://vi.wikipedia.org%2eevil.test/wiki/Test",
        "https://w.wiki/abc",
        "https://maps.app.goo.gl/abc",
        "https://www.google.com/maps/place/test",
        "file:///etc/passwd",
        "https://vi.wikipedia.org\\@evil.test/wiki/Test",
        "https://vi.wikipedia.org/wiki/A%0aB",
        "https://www.wikidata.org/wiki/Q0",
        "https://www.openstreetmap.org/node/0",
    ],
)
def test_url_allowlist_rejects_hostile_shortened_and_unsupported_without_fetch(
    url, monkeypatch
):
    monkeypatch.setattr(
        source,
        "fetch_json",
        lambda *args: pytest.fail("Rejected URL must never issue a provider request"),
    )
    with pytest.raises(HTTPException) as error:
        source.resolve_metadata(url)
    assert error.value.status_code == 422


@pytest.mark.parametrize(
    "url,expected",
    [
        (
            "https://vi.wikipedia.org/wiki/B%E1%BA%BFn_Th%C3%A0nh",
            ("wikipedia", "vi", "Bến_Thành"),
        ),
        ("https://en.m.wikipedia.org/?curid=42", ("wikipedia", "en", 42)),
        (
            "https://www.openstreetmap.org/way/123#map=17/10/106",
            ("openstreetmap", "", "way/123"),
        ),
        ("https://www.wikidata.org/wiki/Q42", ("wikidata", "", "Q42")),
    ],
)
def test_known_urls_map_to_fixed_provider_identity(url, expected):
    assert source.parse_source_url(url) == expected


def test_preview_edit_import_is_draft_and_idempotent_with_pending_image(
    client, admin_headers, providers, db_session
):
    response = client.post(
        "/admin/imports/url/preview",
        headers=admin_headers,
        json={"url": "https://vi.wikipedia.org/wiki/Fixture"},
    )
    assert response.status_code == 200
    preview = response.json()
    assert preview["image"]["attribution"] == "Fixture author"
    assert all(endpoint in source.APIS for endpoint, params in providers)
    assert db_session.query(Place).count() == 0
    payload = {
        "preview_token": preview["preview_token"],
        "changes": {"name": "Reviewed fixture name"},
    }
    saved = client.post("/admin/imports/url", headers=admin_headers, json=payload)
    assert saved.status_code == 200 and saved.json()["created"] is True
    row = saved.json()["place"]
    assert row["publication_status"] == "draft" and row["image_url"] is None
    assert client.get(f"/places/{row['id']}").status_code == 404
    images = client.get(
        f"/admin/places/{row['id']}/images", headers=admin_headers
    ).json()
    assert (
        len(images) == 1
        and images[0]["status"] == "pending"
        and images[0]["license"] == "CC BY-SA 4.0"
    )
    assert (
        client.post("/admin/imports/url", headers=admin_headers, json=payload).json()[
            "created"
        ]
        is False
    )
    assert db_session.query(Place).count() == 1
    assert (
        client.post(
            "/admin/imports/url",
            headers=admin_headers,
            json={**payload, "changes": {"publication_status": "published"}},
        ).status_code
        == 422
    )


def test_duplicate_name_nearby_never_overwrites_existing_record(
    client, admin_headers, providers, db_session
):
    row = Place(
        name="Explicit URL import fixture",
        latitude=10,
        longitude=106,
        publication_status="published",
    )
    db_session.add(row)
    db_session.commit()
    preview = client.post(
        "/admin/imports/url/preview",
        headers=admin_headers,
        json={"url": "https://vi.wikipedia.org/wiki/Fixture"},
    ).json()
    assert preview["existing_place"]["id"] == row.id
    assert (
        client.post(
            "/admin/imports/url",
            headers=admin_headers,
            json={"preview_token": preview["preview_token"]},
        ).status_code
        == 409
    )
    assert row.source == "manual" and row.publication_status == "published"


def test_url_import_auth_tampering_expiry_missing_coordinates_and_bad_provider(
    client, admin_headers, providers, monkeypatch
):
    assert (
        client.post(
            "/admin/imports/url/preview",
            json={"url": "https://vi.wikipedia.org/wiki/Fixture"},
        ).status_code
        == 401
    )
    preview = client.post(
        "/admin/imports/url/preview",
        headers=admin_headers,
        json={"url": "https://vi.wikipedia.org/wiki/Fixture"},
    ).json()
    assert (
        client.post(
            "/admin/imports/url",
            headers=admin_headers,
            json={"preview_token": preview["preview_token"][:-1] + "x"},
        ).status_code
        == 409
    )
    original_time = importer.time.time
    monkeypatch.setattr(importer.time, "time", lambda: original_time() + 700)
    assert (
        client.post(
            "/admin/imports/url",
            headers=admin_headers,
            json={"preview_token": preview["preview_token"]},
        ).status_code
        == 409
    )
    monkeypatch.setattr(
        source,
        "fetch_json",
        lambda *args: {"query": {"pages": {"-1": {"missing": ""}}}},
    )
    assert (
        client.post(
            "/admin/imports/url/preview",
            headers=admin_headers,
            json={"url": "https://vi.wikipedia.org/wiki/Missing"},
        ).status_code
        == 422
    )
    monkeypatch.setattr(source, "fetch_json", lambda *args: {"query": None})
    assert (
        client.post(
            "/admin/imports/url/preview",
            headers=admin_headers,
            json={"url": "https://vi.wikipedia.org/wiki/Bad"},
        ).status_code
        == 502
    )


def test_unknown_license_or_wrong_image_host_does_not_assign_photo(monkeypatch):
    for change in ["license", "host", "author"]:
        fixture = copy.deepcopy(COMMONS)
        info = fixture["query"]["pages"]["2"]["imageinfo"][0]
        if change == "license":
            info["extmetadata"]["LicenseShortName"]["value"] = "All rights reserved"
        elif change == "host":
            info["thumburl"] = "https://upload.wikimedia.org.evil.test/photo.jpg"
        else:
            info["extmetadata"]["Artist"]["value"] = ""
        monkeypatch.setattr(source, "fetch_json", lambda *args: fixture)
        assert source.commons_image("Fixture.jpg") is None


@pytest.mark.parametrize("response", ["redirect", "oversized", "bad_json"])
def test_provider_fetch_does_not_follow_redirects_or_accept_unbounded_content(
    monkeypatch, response
):
    import httpx2

    real = source.httpx.Client
    seen = []

    def handler(request):
        seen.append(request)
        if response == "redirect":
            return httpx2.Response(
                302, headers={"location": "http://169.254.169.254/latest/meta-data"}
            )
        if response == "oversized":
            return httpx2.Response(200, content=b"x" * (source.MAX_RESPONSE + 1))
        return httpx2.Response(200, content=b"{")

    monkeypatch.setattr(
        source.httpx,
        "Client",
        lambda **options: real(transport=httpx2.MockTransport(handler), **options),
    )
    with pytest.raises(HTTPException) as error:
        source.fetch_json("https://vi.wikipedia.org/w/api.php", {"action": "query"})
    assert error.value.status_code == 502 and len(seen) == 1
    assert seen[0].url.host == "vi.wikipedia.org"
