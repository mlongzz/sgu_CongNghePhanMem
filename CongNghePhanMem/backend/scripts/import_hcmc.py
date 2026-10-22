"""Local credential prompt; all writes use JWT/RBAC Admin endpoints, never SQL."""
import argparse
from getpass import getpass
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

import httpx2 as httpx

CATALOG = Path(__file__).resolve().parents[1] / "app" / "data" / "hcmc_catalog.json"
RESULT = Path(__file__).resolve().parents[1] / ".test-artifacts" / "hcmc-import-live.json"


def authenticate_admin(client, api_url):
    """Prompt locally; keep credentials and tokens out of logs/artifacts."""
    parts = urlsplit(api_url)
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in ("127.0.0.1", "localhost", "::1")):
        raise ValueError("Use HTTPS or the local loopback API for credentials")
    for _ in range(3):
        print("\nDang nhap Admin / Administrator sign-in. Mat khau duoc an; khong luu ra file.", flush=True)
        email = input("Email Admin: ").strip()
        password = getpass("Mat khau / Password: ")
        response = client.post("/auth/login", json={"email": email, "password": password})
        password = ""
        if response.status_code == 401:
            print("Sai thong tin dang nhap. Hay thu lai.", flush=True)
            continue
        response.raise_for_status()
        client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
        status = client.get("/admin/me")
        if status.status_code == 403:
            print("Tai khoan chua co quyen Admin. Khong nhap du lieu.", flush=True)
            client.headers.pop("Authorization", None)
            continue
        status.raise_for_status()
        return
    raise RuntimeError("Administrator authentication did not succeed")


def run(api_url: str, apply: bool):
    bundle = json.loads(CATALOG.read_text(encoding="utf-8"))
    print("BO DIA DIEM TP.HCM / HCMC CATALOG", flush=True)
    for item in bundle["places"]:
        print(f"- {item['place']['name']} ({item['place']['latitude']}, {item['place']['longitude']})")
    print(f"{len(bundle['places'])} dia diem; bai gioi thieu vi/en/fr/ja. Chi them muc con thieu duoi dang ban nhap, giu noi dung da co.", flush=True)
    if not apply:
        print("Preview only. Use --apply to sign in locally and import through Admin.")
        return
    parts = urlsplit(api_url)
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in ("127.0.0.1", "localhost", "::1")):
        raise ValueError("Use HTTPS or the local loopback API for credentials")
    with httpx.Client(base_url=api_url.rstrip("/"), timeout=15, follow_redirects=False) as client:
        authenticate_admin(client, api_url)
        preview = client.get("/admin/catalog/hcmc")
        preview.raise_for_status()
        plan = preview.json()
        print(f"De xuat them {plan['places_to_create']} dia diem va {plan['guides_to_create']} bai gioi thieu duoi dang ban nhap.", flush=True)
        for row in plan["rows"]:
            print(f"- {row['name']}: {row['status']}; missing {','.join(row['missing_languages'])}", flush=True)
        if input("Duyet ban xem truoc nay? Nhap IMPORT de ghi ban nhap: ").strip() != "IMPORT":
            print("Da huy. Khong ghi du lieu.", flush=True)
            return
        response = client.post("/admin/catalog/hcmc/import", json={"preview_token": plan["preview_token"]})
        response.raise_for_status()
        result = response.json()
        checks = []
        for row in result["rows"]:
            langs = client.get("/admin/guides", params={"place_id": row["place_id"], "page_size": 100})
            langs.raise_for_status()
            checks.append({"id": row["place_id"], "name": row["name"], "languages": [guide["language_code"] for guide in langs.json()["items"]]})
        result["verified_places"] = checks
        result["nearby_checks"] = []
        # Public landmarks only; this is not a request for device/user GPS.
        for lat, lon in [(10.749375, 106.651078), (10.777108, 106.695441)]:
            nearby = client.get("/places/nearby", params={"latitude": lat, "longitude": lon, "radius_km": 3, "limit": 100})
            nearby.raise_for_status()
            result["nearby_checks"].append({"public_landmark": [lat, lon], "count": len(nearby.json())})
        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nHOAN TAT: {result['places_to_create']} POI moi, {result['guides_to_create']} bai moi.", flush=True)
        print("Da doc lai ngon ngu va POI gan hai dia danh cong cong. Khong goi Overpass.", flush=True)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        run(args.api_url, args.apply)
    except (httpx.HTTPError, ValueError, RuntimeError) as error:
        # Never print the request, credentials, headers or token.
        status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
        print(f"Khong hoan tat nhap du lieu ({'HTTP ' + str(status) if status else type(error).__name__}).", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
