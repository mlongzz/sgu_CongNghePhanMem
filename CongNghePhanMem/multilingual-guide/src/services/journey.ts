import type { Place } from "../data/places";
import { distanceKm, validateBackendPlace } from "./nearby";
import type { LocationCoordinates } from "./locationOptions";

export type Journey = {
  id: number;
  name: string;
  description: string;
  stops: Place[];
  raw: Record<string, unknown>;
  unavailable: number;
  image: string;
  imageThumbnail?: string;
};
export type JourneyProgress = {
  journey: Journey;
  completed: string[];
  skipped: string[];
  status: "active" | "paused" | "completed";
};
export const JOURNEY_STORAGE = "mg_active_journey_v1";

export function parseJourneyId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

export function parseJourney(raw: unknown): Journey {
  if (!raw || typeof raw !== "object")
    throw new Error("Hành trình không hợp lệ.");
  const row = raw as Record<string, unknown>;
  if (
    !Number.isSafeInteger(row.id) ||
    Number(row.id) <= 0 ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    !Array.isArray(row.stops) ||
    row.stops.length > 200
  )
    throw new Error("Hành trình không hợp lệ.");
  const stops: Place[] = [];
  const validRows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of row.stops) {
    const point = validateBackendPlace(item);
    if (!point || seen.has(point.id)) continue;
    seen.add(point.id);
    stops.push(point);
    validRows.push(item as Record<string, unknown>);
  }
  return {
    id: Number(row.id),
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    stops,
    raw: { ...row, stops: validRows },
    unavailable:
      typeof row.unavailable_stop_count === "number"
        && Number.isFinite(row.unavailable_stop_count)
        ? Math.max(0, row.unavailable_stop_count) + row.stops.length - stops.length
        : row.stops.length - stops.length,
    image:
      typeof row.image_url === "string"
        ? row.image_url
        : (stops.find((p) => p?.image)?.image ?? ""),
    imageThumbnail: typeof row.image_thumbnail_url === "string"
      ? row.image_thumbnail_url : stops.find((p) => p?.image)?.imageThumbnail,
  };
}
export function currentJourneyStop(
  state: JourneyProgress | null,
): Place | null {
  return (
    state?.journey.stops.find(
      (p) => !state.completed.includes(p.id) && !state.skipped.includes(p.id),
    ) ?? null
  );
}
export function advanceJourney(
  state: JourneyProgress,
  id: string,
  skipped = false,
): JourneyProgress {
  if (state.status === "completed" || !state.journey.stops.some(p => p.id === id) ||
      state.completed.includes(id) || state.skipped.includes(id))
    return state;
  const next = {
    ...state,
    completed: skipped ? state.completed : [...state.completed, id],
    skipped: skipped ? [...state.skipped, id] : state.skipped,
  };
  if (!currentJourneyStop(next)) next.status = "completed";
  return next;
}
export function serializeJourney(state: JourneyProgress): string {
  // Route recovery needs identity, coordinates and provenance, not entire guide text.
  const keep = ['id','name','latitude','longitude','address','category','image_url','image_thumbnail_url','publication_status','source','source_id','source_url','source_license','image_source_url','image_attribution','image_license'];
  const original = state.journey.raw.stops as Record<string,unknown>[];
  const stops = original.map(row => ({...Object.fromEntries(keep.filter(key => row[key] !== undefined).map(key => [key,row[key]])),description:typeof row.description === 'string' ? row.description.slice(0,240) : null}));
  const snapshot = {id:state.journey.id,name:state.journey.name,description:state.journey.description,stops,unavailable_stop_count:state.journey.unavailable};
  return JSON.stringify({version:1,journey:snapshot,completed:state.completed,skipped:state.skipped,status:state.status});
}
export function restoreJourney(raw: string | null): JourneyProgress | null {
  if (!raw || raw.length > 1_000_000) return null;
  try {
    const row = JSON.parse(raw);
    if (
      row.version !== 1 ||
      !["active", "paused", "completed"].includes(row.status)
    )
      return null;
    const journey = parseJourney(row.journey);
    const valid = new Set(journey.stops.map((p) => p.id));
    const ids = (value: unknown) =>
      Array.isArray(value)
        ? [
            ...new Set(
              value.filter(
                (id): id is string => typeof id === "string" && valid.has(id),
              ),
            ),
          ]
        : [];
    const completed = ids(row.completed),
      skipped = ids(row.skipped).filter((id) => !completed.includes(id));
    const state: JourneyProgress = {
      journey,
      completed,
      skipped,
      status: "paused",
    };
    if (!currentJourneyStop(state)) state.status = "completed";
    return state;
  } catch {
    return null;
  }
}
/** Flexible route order: among nearby unfinished stops, prefer the earliest one. */
export function journeyAutoDecision(
  state: JourneyProgress | null,
  enabled: boolean,
  fix: LocationCoordinates | null,
  busy: boolean,
  now = Date.now(),
): { place: Place | null; reason: string } {
  const no = (reason: string) => ({ place: null, reason });
  if (!state) return no("Chọn và bắt đầu một hành trình để bật AutoGuide.");
  if (state.status !== "active")
    return no("Hành trình đang tạm dừng hoặc đã hoàn thành.");
  if (!enabled) return no("AutoGuide chưa bật. Bạn có thể nghe thủ công.");
  if (busy) return no("Đang phát một bài khác.");
  if (
    !fix ||
    !Number.isFinite(fix.latitude) ||
    Math.abs(fix.latitude) > 90 ||
    !Number.isFinite(fix.longitude) ||
    Math.abs(fix.longitude) > 180 ||
    typeof fix.timestamp !== "number" ||
    now - fix.timestamp > 60_000 ||
    fix.timestamp - now > 5000 ||
    !Number.isFinite(fix.timestamp)
  )
    return no(
      "GPS đã cũ hoặc chưa sẵn sàng. Hãy định vị lại hoặc nghe thủ công.",
    );
  if (
    typeof fix.accuracy !== "number" ||
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy < 0 ||
    fix.accuracy > 50
  )
    return no("GPS chưa đủ chính xác để tự phát. Bạn có thể nghe thủ công.");
  const place = state.journey.stops.find(p => p.source === 'backend' &&
    !state.completed.includes(p.id) && !state.skipped.includes(p.id) &&
    distanceKm(fix, p) * 1000 + fix.accuracy! <= 80);
  if (!place) return no("Chưa đến gần điểm dừng chưa nghe. Bạn có thể nghe thủ công.");
  return { place, reason: "" };
}
