from test_admin import client, admin_headers  # noqa: F401


def test_echoed_published_status_cannot_publish_changed_place_or_guide(
    client, admin_headers
):
    place = client.post(
        "/admin/places",
        headers=admin_headers,
        json={
            "name": "Review fixture",
            "latitude": 10,
            "longitude": 106,
            "publication_status": "published",
        },
    ).json()
    pid = place["id"]
    edited = client.put(
        f"/admin/places/{pid}",
        headers=admin_headers,
        json={
            "description": "New unreviewed content",
            "publication_status": "published",
        },
    )
    assert edited.json()["publication_status"] == "draft"
    assert client.get(f"/places/{pid}").status_code == 404
    assert (
        client.put(
            f"/admin/places/{pid}",
            headers=admin_headers,
            json={"publication_status": "published"},
        ).json()["publication_status"]
        == "published"
    )
    path = f"/admin/places/{pid}/guide-content/vi"
    assert (
        client.put(
            path,
            headers=admin_headers,
            json={
                "title": "Fixture",
                "content": "Original reviewed fixture",
                "publication_status": "published",
            },
        ).status_code
        == 200
    )
    edited = client.put(
        path,
        headers=admin_headers,
        json={
            "title": "Changed fixture",
            "content": "New unreviewed fixture",
            "publication_status": "published",
        },
    )
    assert edited.json()["publication_status"] == "draft"
    assert client.get(f"/places/{pid}/guide-content?language=vi").status_code == 404
    assert (
        client.put(
            path, headers=admin_headers, json={"publication_status": "published"}
        ).status_code
        == 200
    )
    assert (
        client.get(f"/places/{pid}/guide-content?language=vi").json()["content"]
        == "New unreviewed fixture"
    )
