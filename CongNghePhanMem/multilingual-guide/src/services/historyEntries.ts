export type HistoryVisit = { id: number; place_id: number; visited_at: string };
export type HistoryEntry = HistoryVisit & { name: string; state: 'available' | 'deleted' | 'unavailable' };

export async function resolveHistoryEntries(
  visits: HistoryVisit[],
  fetchName: (placeId: number) => Promise<string>,
  isMissing: (error: unknown) => boolean,
): Promise<HistoryEntry[]> {
  const requests = new Map<number, Promise<Pick<HistoryEntry, 'name' | 'state'>>>();
  return Promise.all(visits.map(async visit => {
    let request = requests.get(visit.place_id);
    if (!request) {
      request = (async () => {
        try {
          const name = await fetchName(visit.place_id);
          if (typeof name !== 'string' || !name.trim()) throw new Error('Missing place name');
          return { name, state: 'available' as const };
        } catch (error) {
          if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
          return isMissing(error)
            ? { name: 'Địa điểm đã được xóa', state: 'deleted' as const }
            : { name: 'Không tải được tên địa điểm', state: 'unavailable' as const };
        }
      })();
      requests.set(visit.place_id, request);
    }
    return { ...visit, ...await request };
  }));
}
