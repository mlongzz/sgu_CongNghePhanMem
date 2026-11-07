import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useJourney } from "../context/JourneyContext";
import { PrimaryButton } from "./auth";
import ChipButton from "./ChipButton";
import { C } from "../theme/colors";
import { ErrorMessage } from "./Screen";
import { useI18n } from "../hooks/useI18n";
import { useApp } from "../context/AppContext";
import { distanceKm } from "../services/nearby";

export default function JourneyProgressCard() {
  const route = useJourney(),
    { t } = useI18n();
  const { location, locationSource } = useApp();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { progress, current } = route;
  if (!progress || !focused) return null;
  const next = progress.journey.stops.filter(
    (p) =>
      !progress.completed.includes(p.id) && !progress.skipped.includes(p.id),
  )[1];
  const total = progress.journey.stops.length;
  const ratio = total ? (progress.completed.length + progress.skipped.length) / total : 0;
  const statusLabel =
    progress.status === "completed"
      ? "Hành trình đã hoàn thành"
      : progress.status === "paused"
        ? "Hành trình tạm dừng"
        : "Hành trình đang thực hiện";
  const statusColor = progress.status === "completed" ? C.success : progress.status === "paused" ? C.gold : C.primary;
  return (
    <View testID="journey-progress" style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{progress.journey.name}</Text>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: statusColor }]} />
            <Text style={s.statusText}>{t(statusLabel)}</Text>
          </View>
        </View>
        <Text style={s.count}>{progress.completed.length}/{total}</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${Math.round(ratio * 100)}%` }]} /></View>
      <Text style={s.meta}>
        {t("Đã hoàn thành")}: {progress.completed.length}/{total} · {t("Đã bỏ qua")}: {progress.skipped.length}
      </Text>
      {route.playback.status !== 'idle' && <View style={s.playback}><Ionicons name="volume-high" size={15} color={C.primaryDark} /><Text testID="journey-playback-state" style={s.playbackText}>{t({ loading: 'Đang tải thuyết minh', playing: 'Đang phát', paused: 'Đã tạm dừng âm thanh', completed: 'Đã nghe xong', error: 'Phát lỗi', cancelled: 'Đã hủy phát' }[route.playback.status])}</Text></View>}
      {current && (
        <View style={s.place}>
          <Ionicons name="location" size={18} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text testID="journey-current" style={s.placeText}>{t("Điểm đang đến")}: {current.title}</Text>
            {location && locationSource === "gps" && (
              <Text style={s.meta}>{distanceKm(location, current).toFixed(2)} km · {t("từ vị trí gần nhất, theo đường chim bay")}</Text>
            )}
          </View>
        </View>
      )}
      {next && <Text style={s.meta}>{t("Điểm tiếp theo")}: {next.title}</Text>}
      {progress.journey.unavailable > 0 && (
        <Text style={s.meta}>{t("Một số điểm dừng chưa xuất bản hoặc đã lưu trữ nên không nằm trong tuyến hiện tại.")}</Text>
      )}
      {progress.status === "paused" && (
        <PrimaryButton
          title={t("Tiếp tục hành trình")}
          icon="play"
          disabled={!total}
          loading={route.busy}
          onPress={() => void route.resume()}
        />
      )}
      <View style={s.actions}>
        {current && <ChipButton icon="play-circle" tone="solid" label={t("Nghe điểm hiện tại")} onPress={() => void route.play()} />}
        {progress.status === "active" && <ChipButton icon="pause" tone="ghost" label={t("Tạm dừng hành trình")} onPress={route.pause} />}
        {current && <ChipButton icon="play-skip-forward" tone="ghost" label={t("Bỏ qua điểm dừng")} onPress={route.skip} />}
        {!!progress.completed.length && (
          <ChipButton
            icon="refresh"
            tone="ghost"
            label={t("Nghe lại điểm vừa hoàn thành")}
            onPress={() => void route.play(progress.journey.stops.find((p) => p.id === progress.completed.at(-1)))}
          />
        )}
        <ChipButton icon="map-outline" tone="ghost" label={t("Xem bản đồ hành trình")} onPress={() => router.push({ pathname: '/map', params: { journey: String(progress.journey.id) } })} />
        <ChipButton icon="stop-circle-outline" tone="danger" label={t("Kết thúc hành trình")} onPress={() => { route.end(); router.replace('/map'); }} />
      </View>
      <ErrorMessage message={route.error || route.playback.error} />
    </View>
  );
}

const s = StyleSheet.create({
  card: { padding: 18, borderRadius: 20, backgroundColor: C.white, borderWidth: 1, borderColor: C.primarySoft, gap: 10, shadowColor: C.shadow, shadowOpacity: .06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { color: C.ink, fontWeight: "800", fontSize: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: C.muted, fontSize: 13, fontWeight: '600' },
  count: { color: C.primaryDark, fontWeight: '900', fontSize: 22 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.primarySoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: C.primary },
  meta: { color: C.muted, fontSize: 12, lineHeight: 18 },
  playback: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  playbackText: { color: C.primaryDark, fontSize: 12, fontWeight: '700' },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.paper, borderRadius: 14, padding: 12 },
  placeText: { color: C.ink, fontWeight: '700', fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
