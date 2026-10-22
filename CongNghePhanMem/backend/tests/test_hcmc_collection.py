"""Collector transformations use explicit fixture POI and never the live API or database."""
import importlib.util
from pathlib import Path


path = Path(__file__).resolve().parents[1] / "scripts/collect_hcmc_review.py"
spec = importlib.util.spec_from_file_location("collect_hcmc_review", path)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def point(identifier=1, **changes):
    return {"type": "node", "id": identifier, "lat": 10.75, "lon": 106.64,
            "tags": {"name": f"Fixture museum {identifier}", "tourism": "museum"}, **changes}


def test_primary_identity_coordinates_license_and_review_are_retained_without_invented_content():
    row = collector.candidate(point())
    assert row["source_id"] == "node/1"
    assert row["source_url"] == "https://www.openstreetmap.org/node/1"
    assert row["latitude"] == 10.75 and row["longitude"] == 106.64
    assert row["license"] == "ODbL-1.0"
    assert row["review_status"] == "pending_admin_review"
    assert row["publication_status"] == "draft"
    assert "description" not in row and "image" not in row and "district" not in row


def test_invalid_unrelated_closed_and_outside_data_cannot_enter_review_bundle():
    for value in [None, [], point(id=True), point(lat=float("nan")), point(lon=181), point(lat=11),
                  point(tags={"name": ""}), point(tags={"name": "Fixture cafe", "amenity": "cafe"}),
                  point(tags={"name": "Fixture inactive museum", "tourism": "museum", "disused": "yes"}),
                  point(tags={"name": "x" * 201, "tourism": "museum"})]:
        assert collector.candidate(value) is None


def test_way_and_relation_centers_are_labelled_as_centers_instead_of_claiming_an_entrance():
    for feature in ("way", "relation"):
        row = collector.candidate(point(type=feature, center={"lat": 10.75, "lon": 106.64}))
        assert row["source_id"] == f"{feature}/1"
        assert row["coordinate_role"] == "geometry_center_not_entrance"
        assert collector.candidate(point(type=feature, center=None)) is None


def test_duplicate_identity_and_same_nearby_name_are_removed_but_distant_names_remain():
    first = point(tags={"name": "Fixture temple", "amenity": "place_of_worship"})
    near = point(2, lat=10.75001, tags={"name": "Fixture Temple", "amenity": "place_of_worship"})
    far = point(3, lat=10.77, tags={"name": "Fixture temple", "amenity": "place_of_worship"})
    result = collector.select_places([first, first, near, far], 50)
    assert len(result) == 2
    assert {row["source_id"] for row in result} == {"node/1", "node/3"}


def test_limited_selection_covers_western_middle_and_central_search_bands_deterministically():
    values = [point(i, lon=106.64 if i <= 3 else 106.66 if i <= 6 else 106.7) for i in range(1, 10)]
    result = collector.select_places(values, 3)
    assert [row["longitude"] for row in result] == [106.64, 106.66, 106.7]
    assert result == collector.select_places(list(reversed(values)), 3)
