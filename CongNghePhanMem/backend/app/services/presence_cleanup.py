import asyncio
import logging
from app.database import SessionLocal
from app.services.presence_service import prune


def prune_once():
    with SessionLocal() as db:
        # Batches bound lock time and memory. Another worker may safely run the same delete.
        for _ in range(20):
            if prune(db) < 1000:
                break


async def retention_worker():
    while True:
        try:
            await asyncio.to_thread(prune_once)
        except Exception:
            logging.getLogger(__name__).warning('Presence retention task could not complete; check database readiness.')
        await asyncio.sleep(3600)
