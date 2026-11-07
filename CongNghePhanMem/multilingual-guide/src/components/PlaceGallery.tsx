import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../hooks/useI18n";
import { useApp } from "../context/AppContext";
import type { Language, Place } from "../data/places";
import { apiFetch } from "../services/api";
import PlaceImage from "./PlaceImage";
import ImageCredit from "./ImageCredit";
import ChipButton from "./ChipButton";
import { C } from "../theme/colors";
import { ErrorMessage, LoadingState } from "./Screen";
import { PrimaryButton } from "./auth";
import { selectPhotoStory } from "../services/photoStories";

type Photo = {
  id: number;
  url: string;
  thumbnail_url?: string | null;
  source_url?: string;
  attribution?: string;
  license?: string;
  story?: Partial<Record<Language, string>> | null;
};

const blank = { vi: "", en: "", fr: "", ja: "" };

/** Every approved photo of a place, each with its own short story that can be read aloud. */
export default function PlaceGallery({ placeId, placeTitle = "" }: { placeId: string; placeTitle?: string }) {
  const { t } = useI18n();
  const { language, speak, stop, playingId, speechStatus } = useApp();
  const [result, setResult] = useState<{ id: string; items: Photo[] } | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const isDatabasePlace = /^db-[1-9]\d*$/.test(placeId) && Number.isSafeInteger(Number(placeId.slice(3)));
  useEffect(() => {
    if (!isDatabasePlace) return;
    const controller = new AbortController();
    void apiFetch<Photo[]>(`/places/${placeId.slice(3)}/images`, { signal: controller.signal })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('Invalid photo list');
        if (!controller.signal.aborted) { setResult({ id: placeId, items }); setError(null); }
      })
      .catch(() => { if (!controller.signal.aborted) setError({ id: placeId, message: 'Không tải được thư viện ảnh. Vui lòng thử lại.' }); });
    return () => controller.abort();
  }, [placeId, isDatabasePlace, retry]);
  const photos = result?.id === placeId ? result.items : [];
  if (!isDatabasePlace) return null;
  if (error?.id === placeId) return <View testID="place-gallery-error" style={s.wrap}>
    <ErrorMessage message={error.message} />
    <PrimaryButton title="Thử tải lại thư viện ảnh" variant="outline" onPress={() => { setError(null); setResult(null); setRetry(value => value + 1); }} />
  </View>;
  if (result?.id !== placeId) return <View testID="place-gallery-loading" style={s.wrap}><LoadingState /></View>;
  if (!photos.length) return null;
  const withStories = photos.filter((photo) => selectPhotoStory(photo.story, language)).length;
  return (
    <View testID="place-gallery" style={s.wrap}>
      <Text style={s.heading}>{t(withStories ? "Câu chuyện qua từng bức ảnh" : "Ảnh địa điểm")}</Text>
      {photos.map((photo, index) => {
        const selectedStory = selectPhotoStory(photo.story, language);
        const story = selectedStory?.text ?? "";
        const id = `photo-story-${photo.id}`;
        const playing = playingId === id;
        const listen = () => {
          if (playing) { stop(); return; }
          const place: Place = { id, title: `${placeTitle} · ${index + 1}`, subtitle: blank, description: blank, category: "Khám phá", district: "", latitude: 0, longitude: 0, image: "", duration: 0, rating: 0 };
          if (selectedStory) void speak(place, { text: selectedStory.text, language: selectedStory.language, source: "description" });
        };
        return (
          <View key={photo.id} testID="photo-story" style={s.card}>
            <PlaceImage uri={photo.url} thumbnailUri={photo.thumbnail_url} label={placeTitle} style={s.image} />
            {story ? <View style={s.body}>
              <Text style={s.index}>{t("Ảnh")} {index + 1}/{photos.length}</Text>
              <Text style={s.story}>{story}</Text>
              {selectedStory?.fallback && <Text style={s.index}>{t('Đang dùng câu chuyện tiếng Việt vì chưa có bản dịch.')}</Text>}
              <ChipButton icon={playing ? "stop-circle-outline" : "headset-outline"} tone={playing ? "solid" : "soft"}
                label={t(playing ? (speechStatus === "loading" ? "Đang chuẩn bị…" : "Dừng") : "Nghe câu chuyện này")}
                accessibilityLabel={`${t(playing ? "Dừng" : "Nghe câu chuyện này")} ${index + 1}`} onPress={listen} />
            </View> : null}
            <View style={s.credit}>
              <ImageCredit place={{ imageAttribution: photo.attribution, imageLicense: photo.license, imageSourceUrl: photo.source_url }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14, marginTop: 8 },
  heading: { fontSize: 19, fontWeight: "900", color: C.ink },
  card: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  image: { height: 230, width: "100%" },
  body: { padding: 14, gap: 10 },
  index: { color: C.primaryDark, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  story: { color: "#425466", fontSize: 14, lineHeight: 23 },
  credit: { paddingHorizontal: 14, paddingBottom: 12 },
});
