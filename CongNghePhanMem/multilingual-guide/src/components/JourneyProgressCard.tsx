import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Text, View } from "react-native";
import { useJourney } from "../context/JourneyContext";
import { PrimaryButton } from "./auth";
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
  return (
    <View
      testID="journey-progress"
      style={{
        padding: 16,
        borderRadius: 18,
        backgroundColor: C.primarySoft,
        gap: 9,
      }}
    >
      <Text style={{ color: C.ink, fontWeight: "800", fontSize: 17 }}>
        {progress.journey.name}
      </Text>
      <Text>
        {t(
          progress.status === "completed"
            ? t("Hành trình đã hoàn thành")
            : progress.status === "paused"
              ? t("Hành trình tạm dừng")
              : t("Hành trình đang thực hiện"),
        )}
      </Text>
      {route.playback.status !== 'idle' && <Text testID="journey-playback-state">{t({ loading: 'Đang tải thuyết minh', playing: 'Đang phát', paused: 'Đã tạm dừng âm thanh', completed: 'Đã nghe xong', error: 'Phát lỗi', cancelled: 'Đã hủy phát' }[route.playback.status])}</Text>}
      <Text>
        {t("Đã hoàn thành")}: {progress.completed.length}/
        {progress.journey.stops.length} · {t("Đã bỏ qua")}:{" "}
        {progress.skipped.length}
      </Text>
      {current && (
        <Text testID="journey-current">
          {t("Điểm đang đến")}: {current.title}
        </Text>
      )}
      {current && location && locationSource === "gps" && (
        <Text>
          {distanceKm(location, current).toFixed(2)} km ·{" "}
          {t("từ vị trí gần nhất, theo đường chim bay")}
        </Text>
      )}
      {next && (
        <Text>
          {t("Điểm tiếp theo")}: {next.title}
        </Text>
      )}
      {progress.journey.unavailable > 0 && (
        <Text>
          {t(
            "Một số điểm dừng chưa xuất bản hoặc đã lưu trữ nên không nằm trong tuyến hiện tại.",
          )}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {progress.status === "active" ? (
          <PrimaryButton
            title={t("Tạm dừng hành trình")}
            onPress={route.pause}
            variant="outline"
          />
        ) : (
          progress.status === "paused" && (
            <PrimaryButton
              title={t("Tiếp tục hành trình")}
              disabled={!progress.journey.stops.length}
              loading={route.busy}
              onPress={() => void route.resume()}
            />
          )
        )}
        {current && (
          <>
            <PrimaryButton
              title={t("Nghe điểm hiện tại")}
              onPress={() => void route.play()}
              variant="outline"
            />
            <PrimaryButton
              title={t("Bỏ qua điểm dừng")}
              onPress={route.skip}
              variant="outline"
            />
          </>
        )}
        {!!progress.completed.length && (
          <PrimaryButton
            title={t("Nghe lại điểm vừa hoàn thành")}
            onPress={() =>
              void route.play(
                progress.journey.stops.find(
                  (p) => p.id === progress.completed.at(-1),
                ),
              )
            }
            variant="outline"
          />
        )}
        <PrimaryButton
          title={t("Xem bản đồ hành trình")}
          onPress={() => router.push({ pathname: '/map', params: { journey: String(progress.journey.id) } })}
          variant="outline"
        />
        <PrimaryButton
          title={t("Kết thúc hành trình")}
          onPress={() => { route.end(); router.replace('/map'); }}
          variant="outline"
        />
      </View>
      <ErrorMessage message={route.error || route.playback.error} />
    </View>
  );
}
