import pytest
from test_admin import client, admin_headers  # noqa: F401
from app.models.place import Place


@pytest.mark.parametrize("count", [3, 10, 20, 25])
def test_journey_order_and_full_public_details(
    client, admin_headers, db_session, count
):
    rows = [
        Place(
            name=f"Journey fixture {i:03}",
            latitude=10 + i / 10000,
            longitude=106,
            publication_status="published",
        )
        for i in range(count)
    ]
    db_session.add_all(rows)
    db_session.commit()
    ids = [row.id for row in reversed(rows)]
    saved = client.post(
        "/admin/journeys",
        headers=admin_headers,
        json={"name": "Ordered fixture", "place_ids": ids},
    )
    assert saved.status_code == 201
    public = client.get(f"/journeys/{saved.json()['id']}").json()
    assert public["place_ids"] == ids
    assert [row["id"] for row in public["stops"]] == ids
    assert public["stop_count"] == count
    assert public["unavailable_stop_count"] == 0
    assert client.get("/journeys").json()[0]["place_ids"] == ids


def test_journey_accepts_drafts_but_rejects_duplicates_and_missing_stops(
    client, admin_headers, db_session
):
    draft = Place(
        name="Draft fixture", latitude=10, longitude=106, publication_status="draft"
    )
    db_session.add(draft)
    db_session.commit()
    saved = client.post('/admin/journeys', headers=admin_headers,
                        json={'name': 'Draft itinerary', 'place_ids': [draft.id]})
    assert saved.status_code == 201
    public = client.get(f"/journeys/{saved.json()['id']}").json()
    assert public['place_ids'] == [] and public['stops'] == []
    assert public['unavailable_stop_count'] == 1
    for ids in [[draft.id, draft.id], [999999]]:
        assert (
            client.post(
                "/admin/journeys",
                headers=admin_headers,
                json={"name": "Invalid fixture", "place_ids": ids},
            ).status_code
            == 422
        )


def test_unpublished_stop_is_hidden_without_reordering_or_leaking_metadata(
    client, admin_headers, db_session
):
    points = [
        Place(
            name=f"Public fixture {i}",
            latitude=10,
            longitude=106,
            publication_status="published",
        )
        for i in range(3)
    ]
    db_session.add_all(points)
    db_session.commit()
    saved = client.post(
        "/admin/journeys",
        headers=admin_headers,
        json={"name": "Filter fixture", "place_ids": [p.id for p in points]},
    ).json()
    points[1].publication_status = "draft"
    db_session.commit()
    public = client.get(f"/journeys/{saved['id']}").json()
    assert public["place_ids"] == [points[0].id, points[2].id]
    assert public["unavailable_stop_count"] == 1
    assert "Public fixture 1" not in str(public)
    response = client.get(
        "/admin/places/selection",
        headers=admin_headers,
        params={"ids": ",".join(str(p.id) for p in reversed(points))},
    )
    assert [p["id"] for p in response.json()] == [p.id for p in reversed(points)]
    assert response.json()[1]["publication_status"] == "draft"


def test_admin_place_search_can_reach_beyond_first_twenty_and_is_protected(
    client, admin_headers, db_session
):
    db_session.add_all(
        [
            Place(
                name=f"Queryable fixture {i:03}",
                latitude=10,
                longitude=106,
                publication_status="published",
            )
            for i in range(130)
        ]
    )
    db_session.commit()
    page = client.get(
        "/admin/places",
        headers=admin_headers,
        params={"publication_status": "published", "page_size": 24, "page": 5},
    ).json()
    assert page["total"] == 130 and len(page["items"]) == 24
    found = client.get(
        "/admin/places", headers=admin_headers, params={"q": "fixture 000"}
    ).json()
    assert found["total"] == 1
    assert client.get("/admin/places/selection?ids=1").status_code == 401
