"""Deterministic QA regressions. All records belong to the isolated db fixture."""
from math import degrees

import pytest

from app.models.place import Place
from app.services.place_service import EARTH_RADIUS_KM, get_nearby_places
from scripts.prepare_osm_import import convert


@pytest.mark.parametrize("radius", [1, 3, 5, 10, 20])
def test_nearby_includes_boundary_and_excludes_points_outside(db_session, radius):
    latitude, longitude = 10.0, 106.0
    for name, distance in [("Inside", radius - .001), ("Boundary", radius), ("Outside", radius + .001)]:
        db_session.add(Place(name=name, latitude=latitude + degrees(distance / EARTH_RADIUS_KM), longitude=longitude))
    db_session.commit()

    results = get_nearby_places(db_session, latitude, longitude, radius)

    assert [place.name for place, _ in results] == ["Inside", "Boundary"]


@pytest.mark.parametrize("malformed", [
    {"properties": ["invalid"]},
    {"tags": ["invalid"]},
    {"geometry": "invalid"},
    {"geometry": {"type": "Point", "coordinates": None}},
    {"geometry": {"type": "Point", "coordinates": "106,10"}},
    {"center": [10, 106]},
])
def test_osm_converter_rejects_malformed_rows_and_keeps_valid_rows(malformed):
    valid = {"type": "node", "id": 1, "lat": 10, "lon": 106,
             "tags": {"name": "Fixture museum", "tourism": "museum"}}
    broken = {**valid, "id": 2, **malformed}

    payload, rejected = convert({"elements": [broken, valid]})

    assert [row["source_id"] for row in payload["places"]] == ["node/1"]
    assert len(rejected) == 1
