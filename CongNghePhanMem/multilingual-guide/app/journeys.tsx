import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiFetch } from "../src/services/api";
import { Screen, ErrorMessage, LoadingState } from "../src/components/Screen";
import { PrimaryButton } from "../src/components/auth";
import { useI18n } from "../src/hooks/useI18n";
import { C } from "../src/theme/colors";
import { parseJourney, type Journey } from "../src/services/journey";
import { useJourney } from "../src/context/JourneyContext";
import PlaceImage from "../src/components/PlaceImage";
import JourneyProgressCard from "../src/components/JourneyProgressCard";

export default function Journeys() {
  const { t } = useI18n(),
    active = useJourney();
  const [items, setItems] = useState<Journey[]>([]),
    [selected, setSelected] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const rows = await apiFetch<unknown[]>(
        `/journeys?limit=20&offset=${page * 20}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setItems(rows.map(parseJourney));
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Không tải được hành trình.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [page]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => request.current?.abort();
    }, [load]),
  );
  const open = async (item: Journey) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const fresh = parseJourney(
        await apiFetch(`/journeys/${item.id}`, { signal: controller.signal }),
      );
      if (!controller.signal.aborted) setSelected(fresh);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Không tải được điểm dừng.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <Screen title="Hành trình khám phá">
      <JourneyProgressCard />
      <ErrorMessage message={error || active.error} />
      {!!error && (
        <PrimaryButton
          title="Thử lại"
          onPress={() => (selected ? void open(selected) : void load())}
          variant="outline"
        />
      )}
      {busy ? (
        <LoadingState />
      ) : selected ? (
        <View style={s.card}>
          <PlaceImage
            uri={selected.image} thumbnailUri={selected.imageThumbnail}
            style={s.cover}
            label={selected.name}
          />
          <Text style={s.title}>{selected.name}</Text>
          <Text style={s.copy}>{selected.description}</Text>
          <Text style={s.copy}>
            {selected.stops.length} {t("điểm dừng")}
          </Text>
          {selected.unavailable > 0 && (
            <Text style={s.copy}>
              {t(
                "Một số điểm dừng chưa xuất bản hoặc đã lưu trữ nên không nằm trong tuyến hiện tại.",
              )}
            </Text>
          )}
          {!selected.stops.length && (
            <Text style={s.copy}>{t("Hành trình chưa có điểm dừng.")}</Text>
          )}
          {selected.stops.map((point, index) => (
            <View key={point.id} style={s.stop}>
              <PlaceImage
                uri={point.image} thumbnailUri={point.imageThumbnail}
                style={s.thumb}
                label={point.title}
              />
              <View style={{ flex: 1, gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/place/${point.id}`)}
                >
                  <Text style={s.link}>
                    {index + 1}. {point.title} →
                  </Text>
                </Pressable>
                <Text style={s.copy}>{point.district}</Text>
              </View>
            </View>
          ))}
          <PrimaryButton
            title={t("Bắt đầu hành trình")}
            disabled={!selected.stops.length || !active.hydrated}
            loading={active.busy}
            onPress={() =>
              void active.start(selected.id).then((ok) => {
                if (ok) router.push({ pathname: '/map', params: { journey: String(selected.id) } });
              })
            }
          />
          <Text style={s.copy}>
            {t(
              "Bắt đầu không tự bật GPS hoặc âm thanh. Bật AutoGuide trên bản đồ khi bạn sẵn sàng.",
            )}
          </Text>
          <PrimaryButton
            title="Danh sách hành trình"
            onPress={() => {
              setSelected(null);
              setError("");
            }}
            variant="outline"
          />
        </View>
      ) : (
        <>
          {!items.length && !error && (
            <Text style={s.copy}>
              {t("Chưa có hành trình trong trang này.")}
            </Text>
          )}
          {items.map((item) => (
            <View key={item.id} style={s.card}>
              <PlaceImage uri={item.image} thumbnailUri={item.imageThumbnail} style={s.cover} label={item.name} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                style={{ gap: 14 }}
                onPress={() => void open(item)}
              >
                <Text style={s.title}>{item.name}</Text>
                <Text style={s.copy}>{item.description}</Text>
                <Text style={s.link}>
                  {item.stops.length} {t("điểm dừng")} →
                </Text>
              </Pressable>
            </View>
          ))}
          {(page > 0 || items.length >= 20) && <View style={s.row}>
            <PrimaryButton
              variant="outline"
              title="← Trước"
              disabled={page === 0 || busy}
              onPress={() => setPage((value) => value - 1)}
            />
            <Text style={s.copy}>{page + 1}</Text>
            <PrimaryButton
              variant="outline"
              title="Sau →"
              disabled={items.length < 20 || busy}
              onPress={() => setPage((value) => value + 1)}
            />
          </View>}
        </>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  title: { color: C.ink, fontSize: 19, fontWeight: "800" },
  card: {
    backgroundColor: C.white,
    borderColor: C.border,
    borderWidth: 1,
    padding: 20,
    borderRadius: 18,
    gap: 14,
  },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  cover: { width: "100%", height: 170, borderRadius: 14 },
  thumb: { width: 58, height: 58, borderRadius: 10 },
  link: { color: C.primaryDark, fontWeight: "700" },
  copy: { color: C.muted, lineHeight: 22 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
