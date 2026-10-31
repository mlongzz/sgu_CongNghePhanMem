import { useI18n } from "../hooks/useI18n";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { apiFetch } from "../services/api";
import PlaceImage from "./PlaceImage";
import { C } from "../theme/colors";
type Photo = {
  id: number;
  url: string;
  thumbnail_url?: string | null;
  source_url?: string;
  attribution?: string;
  license?: string;
};
export default function PlaceGallery({ placeId }: { placeId: string }) {
  const { t } = useI18n();

  const [result, setResult] = useState<{ id: string; items: Photo[] } | null>(
    null,
  );
  useEffect(() => {
    if (!/^db-[1-9]\d*$/.test(placeId)) return;
    const controller = new AbortController();
    void apiFetch<Photo[]>(`/places/${placeId.slice(3)}/images`, {
      signal: controller.signal,
    })
      .then((items) => {
        if (!controller.signal.aborted) setResult({ id: placeId, items });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [placeId]);
  const photos = result?.id === placeId ? result.items : [];
  if (!photos.length) return null;
  return (
    <View testID="place-gallery" style={{ gap: 12 }}>
      <Text style={{ fontWeight: "700", color: C.ink }}>
        {t("Ảnh đã được duyệt")}
      </Text>
      {photos.map((photo) => (
        <View key={photo.id} style={{ gap: 7 }}>
          <PlaceImage
            uri={photo.url}
            thumbnailUri={photo.thumbnail_url}
            style={{ height: 210, width: "100%", borderRadius: 14 }}
          />
          <Text style={{ color: C.muted }}>
            {photo.attribution} · {photo.license}
          </Text>
          {Boolean(photo.source_url && /^https?:\/\//.test(photo.source_url)) && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openURL(photo.source_url!)}
            >
              <Text style={{ color: C.primaryDark }}>Nguồn ảnh ↗</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
