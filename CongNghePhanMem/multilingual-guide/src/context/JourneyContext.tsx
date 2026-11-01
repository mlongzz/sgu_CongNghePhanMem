import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { ApiError, apiFetch } from "../services/api";
import {
  advanceJourney,
  currentJourneyStop,
  JOURNEY_STORAGE,
  parseJourney,
  restoreJourney,
  serializeJourney,
  type JourneyProgress,
} from "../services/journey";
import { useApp } from "./AppContext";
import type { Place } from "../data/places";

type JourneyState = {
  progress: JourneyProgress | null;
  current: Place | null;
  automatic: boolean;
  busy: boolean;
  error: string;
  hydrated: boolean;
  playback: { id: string | null; status: 'idle' | 'loading' | 'playing' | 'paused' | 'completed' | 'error' | 'cancelled'; error: string };
  open: (id: number, signal: AbortSignal) => Promise<boolean>;
  start: (id: number) => Promise<boolean>;
  resume: () => Promise<boolean>;
  pause: () => void;
  end: () => void;
  skip: () => void;
  play: (place?: Place) => Promise<boolean>;
  setAutomatic: (enabled: boolean) => void;
};
const Context = createContext<JourneyState | null>(null);
export function JourneyProvider({ children }: { children: React.ReactNode }) {
  const { speak, stop, playingId, speechCompletion, speechStatus, speechError, user } = useApp();
  const [progress, saveProgress] = useState<JourneyProgress | null>(null);
  const [automatic, saveAutomatic] = useState(false);
  const [playback, setPlayback] = useState<JourneyState['playback']>({ id: null, status: 'idle', error: '' });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hydrated, setHydrated] = useState(false);
  const latest = useRef(progress);
  const owned = useRef<string | null>(null),
    pending = useRef(false),
    sequence = useRef(0);
  const request = useRef<AbortController | null>(null),
    writes = useRef(Promise.resolve());
  const update = useCallback((next: JourneyProgress | null) => {
    latest.current = next;
    saveProgress(next);
  }, []);
  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(JOURNEY_STORAGE)
      .then((raw) => {
        if (alive) {
          const restored = restoreJourney(raw);
          latest.current = restored;
          saveProgress(restored);
        }
      })
      .catch(() => {
        if (alive) setError("Không khôi phục được hành trình đã lưu.");
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const value = progress ? serializeJourney(progress) : null;
    writes.current = writes.current
      .then(() =>
        value
          ? AsyncStorage.setItem(JOURNEY_STORAGE, value)
          : AsyncStorage.removeItem(JOURNEY_STORAGE),
      )
      .catch(() => setError("Không lưu được tiến độ trên thiết bị."));
  }, [progress, hydrated]);
  const pause = useCallback(() => {
    sequence.current++;
    request.current?.abort();
    setBusy(false);
    saveAutomatic(false);
    if (owned.current) {
      setPlayback({ id: owned.current, status: 'cancelled', error: '' });
      stop();
    }
    owned.current = null;
    pending.current = false;
    const value = latest.current;
    if (value?.status === "active") update({ ...value, status: "paused" });
  }, [stop, update]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (value) => {
      if (value !== "active") pause();
    });
    return () => listener.remove();
  }, [pause]);
  useEffect(() => {
    if (!speechCompletion || speechCompletion.id !== owned.current) return;
    const value = latest.current;
    if (value) {
      const advanced = advanceJourney(value, speechCompletion.id);
      update(advanced);
      if (advanced.status === "completed") saveAutomatic(false);
    }
    setPlayback({ id: speechCompletion.id, status: 'completed', error: '' });
    owned.current = null;
  }, [speechCompletion, update]);
  useEffect(() => {
    const id = owned.current;
    if (!id) return;
    if (playingId === id) {
      setPlayback({ id, status: speechStatus, error: speechError });
    } else {
      setPlayback({ id, status: speechError ? 'error' : 'cancelled', error: speechError });
      owned.current = null;
      pending.current = false;
    }
  }, [playingId, speechStatus, speechError]);
  const load = useCallback(
    async (id: number, existing: JourneyProgress | null, status: JourneyProgress['status'] = 'active', signal?: AbortSignal) => {
      request.current?.abort();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) controller.abort();
      request.current = controller;
      const current = ++sequence.current;
      saveAutomatic(false);
      setBusy(true);
      setError("");
      if (owned.current) stop();
      owned.current = null;
      pending.current = false;
      setPlayback({ id: null, status: 'idle', error: '' });
      if (latest.current?.journey.id !== id) update(null);
      try {
        const journey = parseJourney(
          await apiFetch(`/journeys/${id}`, { signal: controller.signal }),
        );
        if (current !== sequence.current || controller.signal.aborted) return false;
        const valid = new Set(journey.stops.map((p) => p.id));
        const next: JourneyProgress = {
          journey,
          status: journey.stops.length ? status : 'paused',
          completed: existing?.completed.filter((p) => valid.has(p)) ?? [],
          skipped: existing?.skipped.filter((p) => valid.has(p)) ?? [],
        };
        if (journey.stops.length && !currentJourneyStop(next)) next.status = "completed";
        update(next);
        return true;
      } catch (e) {
        if (current === sequence.current && !controller.signal.aborted)
          setError(
            e instanceof ApiError && e.status === 404 ? 'Hành trình không tồn tại.' : e instanceof Error
              ? e.message
              : "Không tải được hành trình. Tiến độ cũ vẫn được giữ.",
          );
        return false;
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (current === sequence.current) setBusy(false);
      }
    },
    [stop, update],
  );
  const start = useCallback((id: number) => load(id, null), [load]);
  const open = useCallback((id: number, signal: AbortSignal) => {
    const existing = latest.current?.journey.id === id ? latest.current : null;
    return load(id, existing, existing?.status ?? 'paused', signal);
  }, [load]);
  const resume = useCallback(
    () =>
      latest.current
        ? load(latest.current.journey.id, latest.current)
        : Promise.resolve(false),
    [load],
  );
  const end = useCallback(() => {
    pause();
    update(null);
    setError("");
  }, [pause, update]);
  const previousUser = useRef(user?.id);
  useEffect(() => {
    if (previousUser.current !== undefined && previousUser.current !== user?.id) end();
    previousUser.current = user?.id;
  }, [user?.id, end]);
  const skip = useCallback(() => {
    const value = latest.current,
      point = currentJourneyStop(value);
    if (!value || !point) return;
    sequence.current++;
    request.current?.abort();
    setBusy(false);
    if (owned.current) stop();
    owned.current = null;
    pending.current = false;
    update(advanceJourney(value, point.id, true));
  }, [stop, update]);
  const play = useCallback(
    async (place?: Place) => {
      const value = latest.current,
        target = place ?? currentJourneyStop(value);
      if (
        !value ||
        !target ||
        !value.journey.stops.some((p) => p.id === target.id) ||
        playingId ||
        pending.current
      )
        return false;
      const current = sequence.current;
      pending.current = true;
      owned.current = target.id;
      setPlayback({ id: target.id, status: 'loading', error: '' });
      const success = await speak(target);
      if (current === sequence.current) {
        pending.current = false;
        if (!success) owned.current = null;
      }
      return success;
    },
    [speak, playingId],
  );
  const setAutomatic = useCallback((enabled: boolean) => {
    saveAutomatic(enabled && latest.current?.status === "active");
  }, []);
  return (
    <Context.Provider
      value={{
        progress,
        current: currentJourneyStop(progress),
        automatic,
        busy,
        error,
        hydrated,
        playback,
        open,
        start,
        resume,
        pause,
        end,
        skip,
        play,
        setAutomatic,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useJourney() {
  const value = useContext(Context);
  if (!value) throw new Error("JourneyProvider is missing");
  return value;
}
