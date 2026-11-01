import { useRef, useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { apiFetch } from "../services/api";
import { PrimaryButton } from "../components/auth";
import PlaceImage from "../components/PlaceImage";
import { C } from "../theme/colors";
import { useI18n } from "../hooks/useI18n";

type Preview = {
  metadata: {
    name: string;
    description?: string;
    latitude: number;
    longitude: number;
    address?: string;
    category?: string;
    source_url: string;
    source_license: string;
  };
  image: {
    url: string;
    attribution: string;
    license: string;
    source_url: string;
  } | null;
  existing_place: { id: number; name: string; deleted: boolean } | null;
  preview_token: string;
};
export default function UrlImportPanel({ token }: { token: string }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const review = async () => {
    const current = ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    try {
      const value = await apiFetch<Preview>("/admin/imports/url/preview", {
        token,
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      if (current === sequence.current) {
        setPreview(value);
        setForm(
          Object.fromEntries(
            [
              "name",
              "description",
              "latitude",
              "longitude",
              "address",
              "category",
            ].map((key) => [
              key,
              String(value.metadata[key as keyof Preview["metadata"]] ?? ""),
            ]),
          ),
        );
      }
    } catch (e) {
      if (current === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "Không lấy được thông tin từ liên kết.",
        );
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  };
  const save = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const latitude = Number(form.latitude),
        longitude = Number(form.longitude);
      if (
        !form.name.trim() ||
        !form.latitude.trim() ||
        !form.longitude.trim() ||
        !Number.isFinite(latitude) ||
        Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) ||
        Math.abs(longitude) > 180
      )
        throw new Error("Kiểm tra tên và tọa độ trước khi lưu.");
      const result = await apiFetch<{
        created: boolean;
        place: { name: string };
      }>("/admin/imports/url", {
        token,
        method: "POST",
        body: JSON.stringify({
          preview_token: preview.preview_token,
          changes: { ...form, latitude, longitude },
        }),
      });
      setNotice(
        result.created
          ? `Đã lưu bản nháp: ${result.place.name}. Kiểm tra ảnh và nội dung trước khi xuất bản.`
          : "Địa danh này đã tồn tại. Không tạo thêm hoặc ghi đè.",
      );
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được bản nháp.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{
        padding: 20,
        gap: 13,
        borderRadius: 18,
        backgroundColor: C.white,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: "800", color: C.ink }}>
        {t("Nhập địa danh bằng liên kết")}
      </Text>
      <Text style={{ color: C.muted }}>
        {t(
          "Dán Wikipedia (vi/en/fr/ja), OpenStreetMap hoặc Wikidata. Không hỗ trợ link rút gọn và không thu thập Google Maps.",
        )}
      </Text>
      <TextInput
        accessibilityLabel={t("Liên kết địa danh")}
        autoCapitalize="none"
        value={url}
        editable={!busy}
        onChangeText={(value) => {
          setUrl(value);
          setPreview(null);
        }}
        placeholder="https://vi.wikipedia.org/wiki/..."
        style={inputStyle}
      />
      <PrimaryButton
        title={t("Xem trước liên kết")}
        disabled={!url.trim()}
        loading={busy}
        onPress={() => void review()}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: C.danger }}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="alert" style={{ color: C.primaryDark }}>
          {notice}
        </Text>
      )}
      {preview && (
        <View style={{ gap: 12 }}>
          {preview.existing_place && (
            <Text accessibilityRole="alert">
              {t("Địa danh đã tồn tại")}: {preview.existing_place.name}.{" "}
              {t("Mở danh mục POI để kiểm tra bản ghi hiện có.")}
            </Text>
          )}
          {(
            [
              "name",
              "description",
              "latitude",
              "longitude",
              "address",
              "category",
            ] as const
          ).map((key) => (
            <View key={key}>
              <Text>
                {t(
                  {
                    name: "Tên địa điểm",
                    description: "Mô tả",
                    latitude: "Vĩ độ (-90…90)",
                    longitude: "Kinh độ (-180…180)",
                    address: "Địa chỉ",
                    category: "Danh mục",
                  }[key],
                )}
              </Text>
              <TextInput
                accessibilityLabel={`Nhập URL ${key}`}
                value={form[key]}
                multiline={key === "description"}
                onChangeText={(value) =>
                  setForm((v) => ({ ...v, [key]: value }))
                }
                style={[
                  inputStyle,
                  key === "description" && { minHeight: 100 },
                ]}
              />
            </View>
          ))}
          <Text style={{ color: C.muted }}>
            {preview.metadata.source_license} ·{" "}
            {t("Tọa độ nguồn chưa xác minh cổng vào thực địa.")}
          </Text>
          <PrimaryButton
            title={t("Mở bài nguồn")}
            onPress={() => void Linking.openURL(preview.metadata.source_url)}
            variant="outline"
          />
          <PlaceImage
            uri={preview.image?.url ?? ""}
            style={{ height: 170, width: "100%", borderRadius: 12 }}
          />
          {preview.image && (
            <Text>
              {preview.image.attribution} · {preview.image.license} ·{" "}
              {t("Ảnh được lưu trong thư viện; kiểm tra nguồn và chọn ảnh để sử dụng.")}
            </Text>
          )}
          <PrimaryButton
            title={t("Lưu địa danh thành bản nháp")}
            disabled={!!preview.existing_place}
            loading={busy}
            onPress={() => void save()}
          />
        </View>
      )}
    </View>
  );
}
const inputStyle = {
  padding: 12,
  borderWidth: 1,
  borderColor: C.border,
  borderRadius: 10,
  backgroundColor: C.white,
  color: C.ink,
};
