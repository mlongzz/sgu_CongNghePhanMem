import { useI18n } from "../hooks/useI18n";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useApp } from "../context/AppContext";
import { apiFetch } from "../services/api";
import { PrimaryButton } from "../components/auth";
import { C } from "../theme/colors";
type Poi = { id: number; name: string; publication_status: string };
export default function PlacePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();

  const { token } = useApp();
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [options, setOptions] = useState<Poi[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    void apiFetch<Poi[]>(
      `/admin/places/selection?ids=${encodeURIComponent(value)}`,
      { token: token ?? undefined, signal: controller.signal },
    )
      .then((rows) => {
        if (!controller.signal.aborted)
          setSelected(rows[0]?.name ?? "Điểm không còn khả dụng");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [value, token]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void apiFetch<{ items: Poi[]; pages: number }>(
        `/admin/places?q=${encodeURIComponent(query)}&page=${page}&page_size=12`,
        { token: token ?? undefined, signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setOptions(data.items);
            setPages(data.pages);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token, query, page]);
  return (
    <View style={{ gap: 10, marginTop: 14 }}>
      <Text style={{ color: C.ink, fontWeight: "700" }}>
        {t("Địa danh cho bài thuyết minh")}
      </Text>
      {!!value && <Text>Đang chọn: {selected}</Text>}
      <TextInput
        accessibilityLabel={t("Tìm địa danh cho bài thuyết minh")}
        placeholder="Tìm theo tên địa danh…"
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setPage(1);
        }}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 10,
        }}
      />
      {options.map((row) => (
        <PrimaryButton
          key={row.id}
          title={`${row.name} · ${row.publication_status === "published" ? "Đã xuất bản" : "Bản nháp"}`}
          onPress={() => {
            setSelected(row.name);
            onChange(String(row.id));
          }}
          variant="outline"
        />
      ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PrimaryButton
          title="← Trước"
          disabled={page <= 1}
          onPress={() => setPage((v) => v - 1)}
          variant="outline"
        />
        <PrimaryButton
          title="Sau →"
          disabled={page >= pages}
          onPress={() => setPage((v) => v + 1)}
          variant="outline"
        />
      </View>
      {!!error && <Text style={{ color: C.danger }}>{error}</Text>}
    </View>
  );
}
