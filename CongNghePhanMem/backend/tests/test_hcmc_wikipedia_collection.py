"""Verify source provenance without network requests or application DB writes."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("wiki_collector", ROOT / "scripts/collect_hcmc_wikipedia.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def article(**changes):
    return {"pageid": 123, "ns": 0, "title": "Fixture Temple", "lastrevid": 456,
            "pageprops": {"wikibase_item": "Q789"},
            "coordinates": [{"lat": 10.75, "lon": 106.65, "globe": "earth", "primary": True}], **changes}


def batch(language, pages, **changes):
    return {"language": language, "endpoint": f"https://{language}.wikipedia.org/w/api.php",
            "fetched_at": "2026-10-20T17:45:32+00:00", "response": {"query": {"pages": pages}}, **changes}


def test_only_primary_earth_coordinates_and_exact_page_revision_are_accepted():
    row = collector.row_from_page(article(), "2026-10-20T17:45:32+00:00", "en")
    assert row["source_id"] == "en:123"
    assert row["source_url"] == "https://en.wikipedia.org/?curid=123"
    assert row["source_revision_url"] == "https://en.wikipedia.org/w/index.php?oldid=456"
    assert row["wikidata_id"] == "Q789"
    assert row["review_status"] == "pending_admin_review" and row["publication_status"] == "draft"
    assert row["category_status"] == "editorial_suggestion_pending_review"
    assert all(key not in row for key in ("description", "images", "guides", "district"))
    for bad in [article(pageid=True), article(ns=1), article(lastrevid=None), article(lastrevid=True),
                article(pageprops={"disambiguation": ""}), article(pageprops=[]),
                article(missing=True), article(title="bad\nname"), article(coordinates=[]),
                article(coordinates=[{"lat": 10.75, "lon": 106.65, "globe": "earth", "primary": False}]),
                article(coordinates=[{"lat": float("nan"), "lon": 106.65, "globe": "earth", "primary": True}]),
                article(coordinates=[{"lat": 10.75, "lon": 106.65, "globe": "moon", "primary": True}]),
                article(coordinates=[{"lat": 11.0, "lon": 106.65, "globe": "earth", "primary": True}])]:
        assert collector.row_from_page(bad, "2026-10-20T17:45:32+00:00") is None


def test_cross_language_identity_keeps_vietnamese_source_and_original_retrieval_time():
    english = batch("en", [article(pageid=222)])
    vietnamese = batch("vi", [article(pageid=111)])
    rows, missing, duplicates = collector.verified_rows([english, vietnamese])
    assert len(rows) == 1 and rows[0]["source_id"] == "vi:111"
    assert rows[0]["fetched_at"] == vietnamese["fetched_at"]
    assert not missing
    assert duplicates == [{"retained_source_id": "vi:111", "excluded_source_id": "en:222", "wikidata_id": "Q789"}]
    with pytest.raises(ValueError, match="original fetched_at"):
        collector.verified_rows([batch("vi", [article()], fetched_at=None)])
    with pytest.raises(ValueError, match="timezone"):
        collector.verified_rows([batch("vi", [article()], fetched_at="2026-10-20T17:45:32")])
    with pytest.raises(ValueError, match="endpoint"):
        collector.verified_rows([batch("en", [article()], endpoint="https://example.invalid/w/api.php")])


def test_committed_review_corpus_matches_raw_source_records_and_integrity_hash():
    bundle = json.loads((ROOT / "app/data/hcmc_discovery_review.json").read_text(encoding="utf-8"))
    raw_bytes = (ROOT / "app/data" / bundle["raw_snapshot"]).read_bytes()
    assert hashlib.sha256(raw_bytes).hexdigest() == bundle["raw_snapshot_sha256"]
    rows, _, duplicates = collector.verified_rows(json.loads(raw_bytes))
    expected = {row["source_id"]: row for row in rows}
    assert 30 <= len(bundle["places"]) <= 50
    assert bundle["selected_count"] == len(bundle["places"])
    assert bundle["verified_source_record_count"] == len(rows)
    assert bundle["cross_language_duplicates"] == duplicates
    assert all(row == expected[row["source_id"]] for row in bundle["places"])
    assert len({row["source_id"] for row in bundle["places"]}) == len(bundle["places"])
    assert len({row["wikidata_id"] for row in bundle["places"]}) == len(bundle["places"])
    assert all(row["publication_status"] == "draft" for row in bundle["places"])
    assert bundle["verification"]["database_writes"] is False
