export type Visit = { id: number; place_id: number; visited_at: string; place_name?: string | null };
export type VisitState = 'ok' | 'deleted' | 'unavailable';
export type VisitRow = Visit & { name: string; state: VisitState };

type FetchName = (placeId: number) => Promise<string>;

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

export async function resolveVisitNames(visits: Visit[], fetchName: FetchName): Promise<VisitRow[]> {
  const missing = [...new Set(visits.filter(v => !('place_name' in v)).map(v => v.place_id))];
  const settled = await Promise.allSettled(missing.map(id => fetchName(id)));
  const lookup = new Map<number, PromiseSettledResult<string>>(missing.map((id, index) => [id, settled[index]]));
  return visits.map(visit => {
    if ('place_name' in visit) {
      return typeof visit.place_name === 'string' && visit.place_name
        ? { ...visit, name: visit.place_name, state: 'ok' as const }
        : { ...visit, name: '', state: 'deleted' as const };
    }
    const result = lookup.get(visit.place_id);
    if (result?.status === 'fulfilled') return { ...visit, name: result.value, state: 'ok' as const };
    if (result?.status === 'rejected' && isNotFound(result.reason)) return { ...visit, name: '', state: 'deleted' as const };
    return { ...visit, name: '', state: 'unavailable' as const };
  });
}
