"""One bounded read-only GET per fixed provider at a public landmark."""
import asyncio
import json
import time
from pathlib import Path

import httpx2 as httpx

QUERY = '[out:json][timeout:6];(nwr(around:1000,10.7764,106.6993)["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|artwork)$"];nwr(around:1000,10.7764,106.6993)["name"]["historic"];nwr(around:1000,10.7764,106.6993)["name"]["leisure"="park"];);out center 250;'

async def check(endpoint):
    started = time.monotonic()
    result = {"endpoint": endpoint, "publicLandmarkOnly": True, "method": "GET"}
    try:
        async with httpx.AsyncClient(headers={"User-Agent": "MultilingualGuide/1.0 (OpenStreetMap nearby POI lookup)", "Accept": "application/json"}) as client:
            response = await asyncio.wait_for(client.get(endpoint, params={"data": QUERY}, timeout=httpx.Timeout(10, connect=5)), timeout=10)
            result["status"] = response.status_code
            if response.status_code == 200:
                body = response.json()
                result.update(count=len(body.get("elements", [])), remark=body.get("remark"))
    except Exception as error:
        result["error"] = type(error).__name__
    result["seconds"] = round(time.monotonic() - started, 3)
    return result

async def main():
    results = await asyncio.gather(*(check(url) for url in ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter"]))
    Path(".test-artifacts/overpass-get-live.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))

asyncio.run(main())
