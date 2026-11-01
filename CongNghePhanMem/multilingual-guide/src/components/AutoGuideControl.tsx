import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type * as Location from "expo-location";
import { useApp } from "../context/AppContext";
import { useJourney } from "../context/JourneyContext";
import type { Place } from "../data/places";
import { journeyAutoDecision } from "../services/autoGuide";
import { PrimaryButton } from "./auth";
import { ErrorMessage } from "./Screen";
import { C } from "../theme/colors";
import { getCurrentCoordinates } from "../services/location";
import { watchCoordinates } from "../services/locationWatch";
import {
  shouldRefreshTrackedPlaces,
  type TrackedSearch,
} from "../services/gpsTracking";
import { useI18n } from "../hooks/useI18n";
import JourneyProgressCard from "./JourneyProgressCard";

export default function AutoGuideControl(_props: { candidates?: Place[] }) {
  const { t } = useI18n(),
    app = useApp(),
    journey = useJourney();
  const [enabled, setEnabled] = useState(false),
    [starting, setStarting] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState("");
  const subscription = useRef<Location.LocationSubscription | null>(null),
    activation = useRef<AbortController | null>(null);
  const sequence = useRef(0),
    pending = useRef(false),
    attempted = useRef(new Map<string, number>()),
    lastSearch = useRef<TrackedSearch | null>(null);
  const latest = useRef({ app, journey });
  useEffect(() => {
    latest.current = { app, journey };
  }, [app, journey]);
  const disable = useCallback(() => {
    sequence.current++;
    activation.current?.abort();
    subscription.current?.remove();
    subscription.current = null;
    if (latest.current.journey.automatic) latest.current.journey.pause();
    latest.current.journey.setAutomatic(false);
    pending.current = false;
    lastSearch.current = null;
    setEnabled(false);
    setStarting(false);
  }, []);
  const previousJourney = useRef(journey.progress?.journey.id);
  useEffect(() => {
    if (previousJourney.current === journey.progress?.journey.id) return;
    previousJourney.current = journey.progress?.journey.id;
    attempted.current.clear();
    disable();
  }, [journey.progress?.journey.id, disable]);
  useFocusEffect(
    useCallback(() => {
      const listener = AppState.addEventListener("change", (value) => {
        if (value !== "active") disable();
      });
      return () => {
        listener.remove();
        disable();
      };
    }, [disable]),
  );
  useEffect(() => {
    if (journey.progress?.status !== "completed" || !enabled) return;
    const timer = setTimeout(disable, 0);
    return () => clearTimeout(timer);
  }, [journey.progress?.status, enabled, disable]);
  const enable = async (narrate: boolean) => {
    if (starting || (narrate && journey.progress?.status !== "active")) return;
    const current = ++sequence.current,
      controller = new AbortController();
    activation.current = controller;
    setStarting(true);
    setError("");
    journey.setAutomatic(narrate);
    const receive = (position: {
      coords: { latitude: number; longitude: number; accuracy: number | null };
      timestamp: number;
    }) => {
      if (current !== sequence.current || AppState.currentState !== "active")
        return;
      const { app: state, journey: route } = latest.current;
      const fix = {
          ...position.coords,
          accuracy: position.coords.accuracy ?? undefined,
          timestamp: position.timestamp,
        },
        now = Date.now();
      if (
        state.nearbyStatus !== "loading" &&
        state.nearbyStatus !== "locating" &&
        shouldRefreshTrackedPlaces(fix, lastSearch.current, now)
      ) {
        lastSearch.current = { ...fix, at: now };
        void state.refreshNearby({ gpsCoordinates: fix });
      }
      const decision = journeyAutoDecision(
        route.progress,
        route.automatic,
        fix,
        !!state.playingId || pending.current,
        now,
      );
      setReason(decision.reason);
      if (
        !decision.place ||
        now - (attempted.current.get(decision.place.id) ?? 0) < 120_000
      )
        return;
      attempted.current.set(decision.place.id, now);
      pending.current = true;
      void route.play(decision.place).finally(() => {
        if (current === sequence.current) pending.current = false;
      });
    };
    try {
      const initial = await getCurrentCoordinates({
        signal: controller.signal,
      });
      if (current !== sequence.current) return;
      receive({
        coords: { ...initial, accuracy: initial.accuracy ?? null },
        timestamp: initial.timestamp ?? NaN,
      });
      const watcher = await watchCoordinates(
        receive,
        (message) => {
          if (current === sequence.current) {
            setError(message);
            disable();
          }
        },
        controller.signal,
      );
      if (current !== sequence.current) {
        watcher.remove();
        return;
      }
      subscription.current = watcher;
      setEnabled(true);
    } catch (e) {
      if (current === sequence.current) {
        setError(e instanceof Error ? e.message : "Không bật được GPS.");
        journey.setAutomatic(false);
      }
    } finally {
      if (current === sequence.current) setStarting(false);
    }
  };
  return (
    <View style={{ gap: 10, marginTop: 14 }}>
      <JourneyProgressCard />
      <View
        style={{
          backgroundColor: C.white,
          borderWidth: 1,
          borderColor: C.border,
          padding: 14,
          borderRadius: 18,
          gap: 10,
        }}
      >
        <Text style={{ fontWeight: "700", color: C.darkBlue }}>
          {t("Trải nghiệm rảnh tay")}
        </Text>
        <Text style={{ color: C.muted, lineHeight: 18 }}>
          {t(
            "AutoGuide đọc điểm dừng chưa nghe trong 80 m khi GPS đủ chính xác; ưu tiên thứ tự hành trình khi nhiều điểm cùng gần.",
          )}
        </Text>
        {!journey.progress && (
          <PrimaryButton
            title="Chọn hành trình"
            onPress={() => router.push("/journeys")}
            variant="outline"
          />
        )}
        <PrimaryButton
          title={
            journey.automatic
              ? "Tắt thuyết minh tự động"
              : "Bật thuyết minh tự động"
          }
          disabled={journey.progress?.status !== "active"}
          loading={starting}
          onPress={() => {
            if (journey.automatic) {
              journey.pause();
              disable();
            } else if (enabled) journey.setAutomatic(true);
            else void enable(true);
          }}
          variant="outline"
        />
        <PrimaryButton
          title={enabled ? "Dừng theo dõi GPS" : "Theo dõi khi di chuyển"}
          loading={starting}
          onPress={() => (enabled ? disable() : void enable(false))}
          variant="outline"
        />
        {!!reason && journey.automatic && (
          <Text accessibilityLiveRegion="polite" style={{ color: C.muted }}>
            {t(reason)}
          </Text>
        )}
        <Text style={{ color: C.muted, fontSize: 11 }}>
          {t(
            "Chỉ theo dõi khi bật, tự dừng khi rời bản đồ hoặc vào nền. Không lưu lịch sử vị trí.",
          )}
        </Text>
        {starting && (
          <PrimaryButton
            title="Hủy bật thuyết minh tự động"
            onPress={disable}
            variant="outline"
          />
        )}
        <ErrorMessage message={error || (enabled ? app.speechError : "")} />
      </View>
    </View>
  );
}
