import type { Place } from '../data/places';

type Options = {
  ids: readonly string[];
  known: (id: string) => Place | undefined;
  cache: Map<string, Place | null>;
  fetchPlace: (placeId: number) => Promise<Place | null>;
};

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

export async function resolveSavedPlaces({ ids, known, cache, fetchPlace }: Options): Promise<{ places: Place[]; failed: number }> {
  const resolved = new Map<string, Place | null>();
  const pending: string[] = [];
  for (const id of ids) {
    const local = known(id);
    if (local) resolved.set(id, local);
    else if (cache.has(id)) resolved.set(id, cache.get(id) ?? null);
    else if (!id.startsWith('db-')) resolved.set(id, null);
    else if (!pending.includes(id)) pending.push(id);
  }
  const settled = await Promise.allSettled(pending.map(id => fetchPlace(Number(id.slice(3)))));
  let failed = 0;
  settled.forEach((result, index) => {
    const id = pending[index];
    if (result.status === 'fulfilled') { cache.set(id, result.value); resolved.set(id, result.value); }
    else if (isNotFound(result.reason)) { cache.set(id, null); resolved.set(id, null); }
    else failed++;
  });
  const places = ids.map(id => resolved.get(id)).filter((p): p is Place => !!p);
  return { places, failed };
}
