"""Preview the primary-source review bundle; actual import requires Admin and IMPORT."""
import argparse
import json
from pathlib import Path
import sys

import httpx2 as httpx

from scripts.import_hcmc import authenticate_admin

ROOT = Path(__file__).resolve().parents[1]


def run(api_url, apply=False, review_database=False, source_ids=None):
    bundle = json.loads((ROOT / "app/data/hcmc_discovery_review.json").read_text(encoding="utf-8"))
    rows = [row for row in bundle["places"] if source_ids is None or row["source_id"] in source_ids]
    if not rows or (source_ids is not None and not set(source_ids) <= {row["source_id"] for row in rows}):
        raise ValueError("Unknown or empty selection")
    print(f"{len(rows)} POI; primary-source metadata checked, pending administrator review. No guides or images generated.")
    for row in rows:
        print(f"{row['source_id']}: {row['name']} | {row['source_url']} | revision {row['source_revision_id']}")
    if not (apply or review_database):
        print("Local preview only; --review-database signs in for conflict preview; --apply requires IMPORT before writing drafts.")
        return
    with httpx.Client(base_url=api_url.rstrip("/"), timeout=20, follow_redirects=False) as client:
        authenticate_admin(client, api_url)
        selection = {"source_ids": [row["source_id"] for row in rows]}
        preview = client.post("/admin/catalog/hcmc-discovery/preview", json=selection)
        preview.raise_for_status()
        plan = preview.json()
        for row in plan["rows"]:
            print(f"{row['source_id']}: {row['status']} | {row['name']} | {row['reason'] or 'new draft'}")
        print(f"Create {plan['places_to_create']}; existing {plan['existing']}; conflicts {plan['conflicts']}; guides 0.")
        destination = ROOT / ".test-artifacts/hcmc-discovery-preview.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        if not apply:
            print("Read-only database review complete; no import was submitted.")
            return
        if plan["conflicts"]:
            print("No import submitted. Review conflicts and select a subset with repeated --source-id options.")
            return
        if input("Nhap IMPORT de duyet va ghi cac POI tren thanh draft: ").strip() != "IMPORT":
            print("Cancelled; no import was submitted.")
            return
        response = client.post("/admin/catalog/hcmc-discovery/import", json={**selection, "preview_token": plan["preview_token"]})
        response.raise_for_status()
        result = response.json()
        destination.with_name("hcmc-discovery-import.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Imported {result['places_to_create']} drafts. Review content and publish through Admin when ready.")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--review-database", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source-id", action="append")
    args = parser.parse_args()
    try:
        run(args.api_url, args.apply, args.review_database, args.source_id)
    except (httpx.HTTPError, ValueError, RuntimeError) as error:
        # HTTP repr may contain authenticated request details; print only status/type.
        status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
        print(f"Import incomplete ({'HTTP ' + str(status) if status else type(error).__name__}); review without exposing credentials.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
