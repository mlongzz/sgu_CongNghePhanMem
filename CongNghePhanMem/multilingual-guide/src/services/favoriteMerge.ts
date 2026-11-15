export type FavoriteMergeResult = { resolved: string[]; failed: string[] };

function isConflict(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409;
}

export function isSystemFavorite(id: string) {
  return /^db-\d+$/.test(id);
}

export async function mergeGuestFavorites(ids: readonly string[], save: (placeId: number) => Promise<unknown>): Promise<FavoriteMergeResult> {
  const unique = [...new Set(ids.filter(isSystemFavorite))];
  const settled = await Promise.allSettled(unique.map(id => save(Number(id.slice(3)))));
  const resolved: string[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled' || isConflict(result.reason)) resolved.push(unique[index]);
    else failed.push(unique[index]);
  });
  return { resolved, failed };
}
