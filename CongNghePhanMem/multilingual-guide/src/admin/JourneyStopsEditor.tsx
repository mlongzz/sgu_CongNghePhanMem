import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { apiFetch } from "../services/api";
import { useApp } from "../context/AppContext";
import { C } from "../theme/colors";
import { ErrorMessage } from "../components/Screen";
import PlaceImage from "../components/PlaceImage";
import { useI18n } from "../hooks/useI18n";
import { PrimaryButton } from "../components/auth";

type Option = {
  id: number;
  name: string;
  category?: string;
  address?: string;
  image_url?: string;
  publication_status: string;
  deleted_at?: string;
};
export default function JourneyStopsEditor({
  value,
  onChange,
  onSuggest,
}: {
  value: string;
  onChange: (update: (previous: string) => string) => void;
  onSuggest?: () => void;
}) {
  const { t } = useI18n(),
    { token } = useApp();
  const [options, setOptions] = useState<Option[]>([]),
    [selected, setSelected] = useState<Record<number, Option>>({});
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      void apiFetch<{ items: Option[]; total: number; pages: number }>(
        `/admin/places?page_size=24&page=${page}&q=${encodeURIComponent(query)}`,
        { token: token ?? undefined, signal: controller.signal },
      )
        .then((data) => {
          if (!controller.signal.aborted) {
            setOptions(data.items);
            setPages(data.pages);
            setTotal(data.total);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(
              e instanceof Error ? e.message : "Không tải được địa điểm.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, token]);
  useEffect(() => {
    if (!value.trim()) return;
    const controller = new AbortController();
    void apiFetch<Option[]>(
      `/admin/places/selection?ids=${encodeURIComponent(value.replace(/\s/g, ""))}`,
      { token: token ?? undefined, signal: controller.signal },
    )
      .then((rows) => {
        if (!controller.signal.aborted)
          setSelected(Object.fromEntries(rows.map((row) => [row.id, row])));
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Không tải được điểm đã chọn.",
          );
      });
    return () => controller.abort();
  }, [value, token]);
  const ids = [
    ...new Set(
      value
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isSafeInteger(v) && v > 0),
    ),
  ];
  const mutate = (transform: (current: number[]) => number[]) => onChange(previous => {
    const current = [...new Set(previous.split(',').map(value => Number(value.trim())).filter(value => Number.isSafeInteger(value) && value > 0))];
    return transform(current).join(', ');
  });
  const add = (id: number) => mutate(current => current.includes(id) || current.length >= 200 ? current : [...current,id]);
  const remove = (id: number) => mutate(current => current.filter(value => value !== id));
  const move = (id: number, delta: number) => mutate(current => {
    const next = [...current], index = next.indexOf(id);
    if (index < 0 || index + delta < 0 || index + delta >= next.length) return current;
    [next[index],next[index+delta]] = [next[index+delta],next[index]];
    return next;
  });
  return (
    <View style={{ gap: 10, marginTop: 16 }}>
      <Text style={{ fontWeight: "700", color: C.ink }}>
        {t("Các điểm dừng theo thứ tự")} ({ids.length}/200)
      </Text>
      <ErrorMessage message={error} />
      {ids.map((id, index) => {
        const row = selected[id] ?? options.find((p) => p.id === id);
        return (
          <View
            key={id}
            style={{
              padding: 12,
              gap: 8,
              backgroundColor: C.paper,
              borderRadius: 10,
            }}
          >
            <Text>
              {index + 1}. {row?.name ?? t("Điểm dừng không còn khả dụng")}
            </Text>
            {Boolean(row &&
              (row.publication_status !== "published" || row.deleted_at)) && (
                <Text style={{ color: C.danger }}>
                  {t(
                    row.deleted_at ? "Điểm đã lưu trữ. Hãy bỏ khỏi hành trình trước khi lưu." : "nháp — chưa hiển thị cho người dùng",
                  )}
                </Text>
              )}
            <View style={{ flexDirection: "row", gap: 20 }}>
              <Pressable
                accessibilityRole="button"
                disabled={index === 0}
                onPress={() => move(id, -1)}
              >
                <Text style={{ color: C.primaryDark }}>{t("↑ Lên")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={index === ids.length - 1}
                onPress={() => move(id, 1)}
              >
                <Text style={{ color: C.primaryDark }}>{t("↓ Xuống")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => remove(id)}
              >
                <Text style={{ color: C.danger }}>{t("Bỏ điểm dừng")}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <TextInput
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setPage(1);
        }}
        accessibilityLabel={t("Tìm địa điểm để thêm vào hành trình")}
        placeholder={t("Tìm địa điểm để thêm…")}
        style={{
          padding: 12,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 10,
        }}
      />
      <Text style={{ color: C.muted }}>
        {t("Chọn điểm đã xuất bản hoặc bản nháp; không chọn điểm đã lưu trữ.")} {total} {t("kết quả")}{" "}
        · {page}/{Math.max(1, pages)}
      </Text>
      {options
        .filter((p) => !ids.includes(p.id) && !p.deleted_at)
        .map((p) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Thêm ${p.name}`}
            disabled={busy || ids.length >= 200}
            key={p.id}
            onPress={() => {
              setSelected((rows) => ({ ...rows, [p.id]: p }));
              add(p.id);
            }}
            style={{
              padding: 12,
              backgroundColor: C.primarySoft,
              borderRadius: 10,
              flexDirection: "row",
              gap: 12,
            }}
          >
            <PlaceImage
              retryEnabled={false}
              uri={p.image_url ?? ""}
              style={{ width: 48, height: 48, borderRadius: 8 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.primaryDark }}>＋ {p.name}{p.publication_status === 'draft' ? ` (${t('nháp')})` : ''}</Text>
              <Text style={{ color: C.muted }}>
                {p.category} · {p.address}
              </Text>
            </View>
          </Pressable>
        ))}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PrimaryButton
          title="← Trước"
          disabled={page <= 1 || busy}
          onPress={() => setPage((v) => v - 1)}
          variant="outline"
        />
        <PrimaryButton
          title="Sau →"
          disabled={page >= pages || busy}
          onPress={() => setPage((v) => v + 1)}
          variant="outline"
        />
      </View>
      {onSuggest && (
        <PrimaryButton
          title={t("Đề xuất nhập địa danh")}
          onPress={onSuggest}
          variant="outline"
        />
      )}
    </View>
  );
}
