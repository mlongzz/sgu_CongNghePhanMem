import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import * as Speech from "expo-speech";
import { useApp } from "../context/AppContext";
import { apiFetch, checkAdmin } from "../services/api";
import GoogleMap from "./GoogleMap";
import JourneyStopsEditor from "./JourneyStopsEditor";
import PlaceImageEditor from "./PlaceImageEditor";
import { splitSpeechText } from "../services/speechText";
import { speechConfig } from "../services/speechConfig";
import ImportPanel from './ImportPanel';
import LanguageMenu from '../components/LanguageMenu';
import { useI18n } from '../hooks/useI18n';

type Row = Record<string, unknown> & { id?: number };
type Page = { items: Row[]; total: number; pages: number };
type Overview = { kpis: Record<string, number>; series: { label: string; count: number }[]; languages: { language: string; count: number }[]; popular: { id: number; name: string; count: number }[] };
type Section = "overview" | "users" | "places" | "journeys" | "guides" | "playback" | "audit-logs" | "settings" | "status" | "imports";
type Field = { key: string; label: string; multiline?: boolean; number?: boolean; secret?: boolean; choices?: [string, string][] };
const publicationField: Field = { key: 'publication_status', label: 'Trạng thái xuất bản', choices: [['draft', 'Bản nháp'], ['published', 'Đã xuất bản']] };
const sections: [Section, string][] = [["overview", "Tổng quan"], ["users", "Người dùng"], ["places", "Địa điểm POI"], ["imports", "Nhập địa danh"], ["journeys", "Hành trình"], ["guides", "Bản dịch & TTS"], ["playback", "Lịch sử phát"], ["audit-logs", "Nhật ký quản trị"], ["status", "Trạng thái API"], ["settings", "Cài đặt"]];
const fields: Partial<Record<Section, Field[]>> = {
  users: [{ key: "full_name", label: "Họ tên" }, { key: "email", label: "Email" }, { key: "language", label: "Ngôn ngữ" }, { key: "password", label: "Mật khẩu khi tạo (ít nhất 8 ký tự)", secret: true }],
  places: [{ key: "name", label: "Tên địa điểm" }, publicationField, { key: "description", label: "Mô tả", multiline: true }, { key: "latitude", label: "Vĩ độ (-90…90)", number: true }, { key: "longitude", label: "Kinh độ (-180…180)", number: true }, { key: "address", label: "Địa chỉ" }, { key: "category", label: "Danh mục" }, { key: "image_url", label: "URL ảnh" }, { key: 'source', label: 'Nguồn dữ liệu' }, { key: 'source_id', label: 'Định danh nguồn' }, { key: 'source_url', label: 'URL nguồn dữ liệu' }, { key: 'source_license', label: 'Giấy phép dữ liệu' }, { key: 'image_source_url', label: 'URL nguồn ảnh' }, { key: 'image_attribution', label: 'Ghi công ảnh' }, { key: 'image_license', label: 'Giấy phép ảnh' }],
  journeys: [{ key: "name", label: "Tên hành trình" }, { key: "description", label: "Mô tả", multiline: true }, { key: "place_ids", label: "ID POI theo thứ tự dừng, cách nhau bằng dấu phẩy" }],
  guides: [{ key: "place_id", label: "ID địa điểm", number: true }, { key: "language_code", label: "Mã ngôn ngữ (vi/en/fr/ja…)" }, publicationField, { key: "title", label: "Tiêu đề bản dịch" }, { key: "content", label: "Nội dung thuyết minh", multiline: true }, { key: 'source_url', label: 'URL nguồn dữ liệu' }, { key: 'source_license', label: 'Giấy phép dữ liệu' }],
  settings: [{ key: "site_name", label: "Tên hệ thống" }, { key: "default_language", label: "Ngôn ngữ mặc định (vi/en/fr/ja)" }, { key: "nearby_radius_km", label: "Bán kính mặc định (1–20 km)", number: true }],
};
const columns: Partial<Record<Section, string[]>> = { users: ["id", "full_name", "email", "role", "language"], places: ["id", "name", "publication_status", "category", "latitude", "longitude"], journeys: ["id", "name", "place_ids"], guides: ["id", "place_id", "language_code", "publication_status", "title"], playback: ["id", "user_id", "place_id", "language_code", "progress", "completed", "started_at"], "audit-logs": ["id", "actor_id", "action", "resource", "resource_id", "created_at"] };
const labels: Record<string, string> = { users: "Người dùng", places: "Địa điểm", guides: "Bản thuyết minh", journeys: "Hành trình", plays: "Lượt phát trong kỳ", completed: "Đã nghe hết trong kỳ", visits: "Lượt ghé thăm trong kỳ" };
function Button({ title, onPress, disabled, danger }: { title: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { t } = useI18n();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, danger && { backgroundColor: "#b44747" }, disabled && { opacity: 0.45 }]}><Text style={s.buttonText}>{t(title)}</Text></Pressable>;
}
function Bars({ values }: { values: { label: string; count: number }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...values.map(v => v.count));
  if (!values.length) return <Text style={s.muted}>{t("Chưa có lượt nghe trong khoảng thời gian này.")}</Text>;
  return <View style={{ gap: 12 }}>{values.map(v => <View key={v.label} style={{ gap: 5 }}><View style={s.between}><Text style={s.muted}>{v.label}</Text><Text>{v.count}</Text></View><View style={s.track}><View style={[s.bar, { width: `${v.count / max * 100}%` }]} /></View></View>)}</View>;
}

export default function Dashboard() {
  const { t } = useI18n();
  const { token, setToken } = useApp(); const { width } = useWindowDimensions();
  const [authorization, setAuthorization] = useState<{ token: string; allowed: boolean } | null>(null);
  const allowed = !token ? false : authorization?.token === token ? authorization.allowed : null;
  const [section, setSection] = useState<Section>("overview"); const [page, setPage] = useState(1);
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState(""); const [period, setPeriod] = useState("day");
  const [publicationFilter, setPublicationFilter] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [data, setData] = useState<Page>({ items: [], total: 0, pages: 0 }); const [overview, setOverview] = useState<Overview | null>(null); const [info, setInfo] = useState<Row>({});
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Row | null>(null); const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<null | { label: string; path: string; method: string; body?: Row }>(null);
  const [map, setMap] = useState<Row | null>(null); const [target, setTarget] = useState("en"); const requestSeq = useRef(0); const previewSeq = useRef(0);
  const call = useCallback(<T,>(path: string, method = "GET", body?: unknown) => apiFetch<T>(path, { token: token ?? undefined, method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), [token]);
  useEffect(() => { let active = true; if (!token) return;
    checkAdmin(token).then(r => { if (active) setAuthorization({ token, allowed: r.enabled === true }); }).catch(e => { if (active) { setAuthorization({ token, allowed: false }); setError(e.message); } }); return () => { active = false; }; }, [token]);
  const load = useCallback(async () => {
    if (!allowed) return; const seq = ++requestSeq.current; setBusy(true); setError("");
    const params = new URLSearchParams({ page: String(page), page_size: "20", q: query });
    if (filter) params.set(section === "places" ? "category" : section === "users" ? "role" : "language", filter);
    if (['places', 'guides'].includes(section) && publicationFilter) params.set('publication_status', publicationFilter);
    if (section === 'places' && includeDeleted) params.set('include_deleted', 'true');
    try {
      if (section === 'imports') return;
      if (section === "overview") { const p = new URLSearchParams({ period }); if (start) p.set("start", start); if (end) p.set("end", end); const r = await call<Overview>(`/admin/overview?${p}`); if (seq === requestSeq.current) setOverview(r); }
      else if (section === "settings" || section === "status") { const r = await call<Row>(`/admin/${section}`); if (seq === requestSeq.current) setInfo(r); }
      else { const r = await call<Page>(`/admin/${section}?${params}`); if (seq === requestSeq.current) setData(r); }
    } catch (e) { if (seq === requestSeq.current) setError(e instanceof Error ? e.message : "Không tải được dữ liệu"); }
    finally { if (seq === requestSeq.current) setBusy(false); }
  }, [allowed, call, section, page, query, filter, publicationFilter, includeDeleted, period, start, end]);
  const invalidate = useCallback(() => { requestSeq.current++; }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 300); return () => { clearTimeout(timer); invalidate(); }; }, [load, invalidate]);
  useEffect(() => () => { previewSeq.current++; void Speech.stop(); }, []);
  const edit = (row: Row = {}) => { const next: Record<string, string> = {}; for (const f of fields[section] ?? []) next[f.key] = Array.isArray(row[f.key]) ? (row[f.key] as number[]).join(", ") : String(row[f.key] ?? ""); if (section === "users" && !row.id) next.language = "vi"; if (section === "guides" && !row.id) next.language_code = "vi"; if (['places', 'guides'].includes(section) && !next.publication_status) next.publication_status = 'draft'; if (section === 'places' && !next.source) next.source = 'manual'; setEditor(row); setForm(next); setError(""); };
  const save = async () => {
    if (!editor) return; setSaving(true); setError("");
    try { const body: Row = {}; for (const f of fields[section] ?? []) {
      if (section === "users" && editor.id && f.key === "password") continue;
      if (f.key === "place_ids") { body[f.key] = form[f.key].trim() ? form[f.key].split(",").map(v => Number(v.trim())) : []; if ((body[f.key] as number[]).some(v => !Number.isInteger(v) || v <= 0)) throw new Error("ID điểm dừng phải là số nguyên dương."); }
      else if (f.number) { if (!form[f.key]?.trim() || !Number.isFinite(Number(form[f.key]))) throw new Error(`${f.label}: cần nhập số hợp lệ.`); body[f.key] = Number(form[f.key]); }
      else body[f.key] = f.secret ? (form[f.key] ?? "") : (form[f.key]?.trim() ?? "");
      if ((section === 'places' && !['name', 'source', 'publication_status', 'latitude', 'longitude'].includes(f.key) || section === 'guides' && ['source_url', 'source_license'].includes(f.key)) && body[f.key] === '') body[f.key] = null;
    }
      const path = section === "guides" ? `/admin/places/${body.place_id}/guide-content/${encodeURIComponent(String(body.language_code))}` : `/admin/${section}${editor.id ? `/${editor.id}` : ""}`;
      if (section === "guides") delete body.place_id;
      await call(path, editor.id || section === "settings" || section === "guides" ? "PUT" : "POST", body); setEditor(null); setNotice("Đã lưu vào cơ sở dữ liệu."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được dữ liệu"); } finally { setSaving(false); }
  };
  const confirmAction = async () => { if (!pending) return; setSaving(true); setError(""); try { await call(pending.path, pending.method, pending.body); setPending(null); setNotice("Thao tác thành công."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại"); } finally { setSaving(false); } };
  const publicationAction = (row: Row) => setPending({
    label: row.publication_status === 'published' ? 'Gỡ xuất bản? Khách sẽ không thấy nội dung này sau khi làm mới.' : 'Xuất bản nội dung đã kiểm duyệt để khách có thể tìm thấy?',
    path: section === 'guides' ? `/admin/places/${row.place_id}/guide-content/${encodeURIComponent(String(row.language_code))}` : `/admin/places/${row.id}`,
    method: 'PUT', body: { publication_status: row.publication_status === 'published' ? 'draft' : 'published' },
  });
  const translate = async (row: Row) => { setSaving(true); setError(""); try { await call(`/places/${row.place_id}/guide-content/${row.language_code}/translate`, "POST", { target_language: target }); setNotice("Đã lưu bản dịch từ dịch vụ dịch thuật."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Dịch thất bại"); } finally { setSaving(false); } };
  const preview = async (row: Row) => {
    const current = ++previewSeq.current;
    try {
      await Speech.stop();
      const chunks = splitSpeechText(String(row.content), Math.min(750, Speech.maxSpeechInputLength));
      const play = (index: number) => {
        if (current !== previewSeq.current || index >= chunks.length) return;
        Speech.speak(chunks[index], { ...speechConfig, language: String(row.language_code), onDone: () => play(index + 1), onError: () => setError("Thiết bị không phát được giọng đọc này.") });
      };
      play(0);
    } catch { setError("Không khởi chạy được TTS."); }
  };
  if (allowed === null) return <View style={s.center}><ActivityIndicator /><Text>{t("Đang xác thực quyền quản trị…")}</Text></View>;
  if (!allowed) return <View style={s.center}><Text style={s.title}>{t("Khu vực quản trị")}</Text><Text>{error || "Vui lòng đăng nhập tài khoản Admin."}</Text><Button title={t("Đăng nhập")} onPress={() => router.push("/login")} /><Button title={t("Về ứng dụng")} onPress={() => router.replace("/")} /></View>;
  const current = sections.find(v => v[0] === section)!; const canEdit = ["users", "places", "journeys", "guides"].includes(section);
  return <View style={[s.shell, width < 900 && { flexDirection: "column" }]}>
    <View style={[s.sidebar, width < 900 && { width: "100%", padding: 14 }]}><Text style={s.brand}>◈  GUIDE STUDIO</Text><Text style={s.sidebarHint}>{t("THUYẾT MINH ĐA NGÔN NGỮ")}</Text>
      <ScrollView horizontal={width < 900} contentContainerStyle={{ paddingVertical: 18 }}><View style={width < 900 ? s.row : { gap: 5 }}>{sections.map(([key, label]) => <Pressable key={key} accessibilityRole="button" onPress={() => { setSection(key); setPage(1); setQuery(""); setFilter(""); setData({ items: [], total: 0, pages: 0 }); setInfo({}); setMap(null); setNotice(""); }} style={[s.nav, section === key && s.navActive]}><Text style={[s.navText, section === key && { color: "#fff" }]}>{t(label)}</Text></Pressable>)}</View></ScrollView>
      {width >= 900 && <View style={{ gap: 14, marginTop: "auto" }}><Text style={s.sidebarHint}>{t("Dữ liệu trực tiếp từ API chung")}</Text><Button title={t("Mở ứng dụng")} onPress={() => router.push("/")} /><Button title={t("Đăng xuất")} onPress={() => setToken(null)} /></View>}
    </View><View style={{ flex: 1, minWidth: 0 }}><View style={s.header}><View><Text style={s.muted}>{t("Không gian quản trị /")}{t(current[1])}</Text><Text style={s.heading}>{t(current[1])}</Text></View><View style={s.row}><LanguageMenu /><Button title={t("Làm mới")} onPress={() => void load()} disabled={busy} />{width < 900 && <Button title={t("Đăng xuất")} onPress={() => setToken(null)} />}</View></View>
      <ScrollView contentContainerStyle={[s.content, width < 600 && { padding: 16 }]}><Text style={s.title}>{section === "overview" ? "Hệ thống thuyết minh của bạn" : current[1]}</Text><Text style={s.subtitle}>{t("Quản lý nội dung và trải nghiệm khám phá đa ngôn ngữ.")}</Text>
        {!!error && <View accessibilityRole="alert" style={s.errorBox}><Text style={s.error}>{t(error)}</Text><Button title={t("Thử tải lại")} onPress={() => void load()} /></View>}{!!notice && <Pressable onPress={() => setNotice("")}><Text style={s.notice}>{t(notice)}{t("×")}</Text></Pressable>}
        {section === 'imports' && token && <ImportPanel token={token} />}
        {section === "overview" && <><View style={s.filters}>{["day", "month", "year"].map((v, i) => <Pressable key={v} onPress={() => setPeriod(v)} style={[s.chip, period === v && s.selected]}><Text style={{ color: period === v ? "#fff" : "#334155" }}>{["Ngày", "Tháng", "Năm"][i]}</Text></Pressable>)}<TextInput accessibilityLabel={t("Từ ngày YYYY-MM-DD")} placeholder={t("Từ ngày YYYY-MM-DD")} style={s.input} value={start} onChangeText={setStart} /><TextInput accessibilityLabel={t("Đến ngày YYYY-MM-DD")} placeholder={t("Đến ngày YYYY-MM-DD")} style={s.input} value={end} onChangeText={setEnd} /></View>
          {!busy && !error && overview && <><View style={s.kpis}>{Object.entries(overview.kpis).map(([key, value]) => <View style={s.kpi} key={key}><Text style={s.muted}>{labels[key] ?? key}</Text><Text style={s.metric}>{value.toLocaleString("vi-VN")}</Text><Text style={s.kpiHint}>{["plays", "completed", "visits"].includes(key) ? "Trong khoảng ngày đã chọn · UTC" : "Tổng số trong cơ sở dữ liệu"}</Text></View>)}</View><View style={s.card}><Text style={s.cardTitle}>{t("Lượt nghe theo")}{period === "day" ? "ngày" : period === "month" ? "tháng" : "năm"}</Text><Bars values={overview.series} /></View>
            <View style={[s.row, { alignItems: "stretch", flexWrap: "wrap" }]}><View style={[s.card, { flex: 1, minWidth: 240 }]}><Text style={s.cardTitle}>{t("Ngôn ngữ được nghe")}</Text><Bars values={overview.languages.map(v => ({ label: v.language, count: v.count }))} /></View><View style={[s.card, { flex: 1, minWidth: 240 }]}><Text style={s.cardTitle}>{t("Địa điểm phổ biến")}</Text><Bars values={overview.popular.map(v => ({ label: `${v.name} (#${v.id})`, count: v.count }))} /></View></View></>}
        </>}
        {(section === "settings" || section === "status") && !busy && !error && <View style={s.card}>{Object.entries(info).map(([key, value]) => <View style={s.infoRow} key={key}><Text style={s.muted}>{fields.settings?.find(f => f.key === key)?.label ?? key}</Text><Text>{String(value)}</Text></View>)}{section === "settings" ? <Button title={t("Chỉnh sửa cài đặt")} onPress={() => edit(info)} /> : <Text style={s.muted}>{t("Trạng thái tại thời điểm tải. Cấu hình dịch vụ ngoài không đồng nghĩa đã kiểm thử dịch vụ.")}</Text>}</View>}
        {columns[section] && <><View style={s.filters}>{section !== "playback" && <TextInput accessibilityLabel={t("Tìm kiếm")} placeholder={t("Tìm kiếm…")} style={[s.input, { flex: 1, minWidth: 160 }]} value={query} onChangeText={v => { setQuery(v); setPage(1); }} />}{["places", "users", "guides", "playback"].includes(section) && <TextInput accessibilityLabel={t("Bộ lọc")} placeholder={section === "places" ? "Danh mục" : section === "users" ? "Role: admin hoặc user" : "Mã ngôn ngữ"} style={s.input} value={filter} onChangeText={v => { setFilter(v); setPage(1); }} />}{canEdit && <Button title={t("＋ Thêm mới")} onPress={() => edit()} />}</View>
          {section === "guides" && <View style={s.filters}><Text style={s.muted}>{t("Ngôn ngữ đích khi dịch tự động:")}</Text><TextInput value={target} onChangeText={setTarget} style={s.input} accessibilityLabel={t("Ngôn ngữ đích")} /><Button title={t("Dừng nghe thử")} onPress={() => { previewSeq.current++; void Speech.stop(); }} /></View>}
          {['places', 'guides'].includes(section) && <View style={s.filters}>{[['', 'Tất cả trạng thái'], ['draft', 'Bản nháp'], ['published', 'Đã xuất bản']].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: publicationFilter === value }} onPress={() => { setPublicationFilter(value); setPage(1); }} style={[s.chip, publicationFilter === value && s.selected]}><Text style={{ color: publicationFilter === value ? '#fff' : '#334155' }}>{t(label)}</Text></Pressable>)}{section === 'places' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeDeleted }} onPress={() => { setIncludeDeleted(v => !v); setPage(1); }} style={s.chip}><Text>{includeDeleted ? '☑' : '☐'}{t("Hiện địa điểm đã lưu trữ")}</Text></Pressable>}</View>}
          {!busy && !error && <View style={s.card}><Text style={s.cardTitle}>{data.total}{t("bản ghi")}</Text>{!data.items.length ? <View style={s.empty}><Text style={s.title}>{t("Chưa có dữ liệu")}</Text><Text style={s.muted}>{t("Thêm dữ liệu hoặc điều chỉnh bộ lọc tìm kiếm.")}</Text></View> : <ScrollView horizontal><View><View style={s.tableRow}>{columns[section]!.map(key => <Text style={[s.cell, s.column]} key={key}>{key}</Text>)}{canEdit && <Text style={[s.cell, s.column, { width: 320 }]}>{t("Thao tác")}</Text>}</View>{data.items.map(row => <View style={s.tableRow} key={row.id}>{columns[section]!.map(key => <Text style={s.cell} key={key}>{key === 'publication_status' ? row.deleted_at ? 'Đã lưu trữ' : row[key] === 'published' ? 'Đã xuất bản' : 'Bản nháp' : Array.isArray(row[key]) ? (row[key] as unknown[]).join(" → ") : String(row[key] ?? "—")}</Text>)}{canEdit && <View style={[s.cell, s.row, { width: 320, flexWrap: "wrap" }]}><Button title={t("Sửa")} onPress={() => edit(row)} disabled={saving || !!row.deleted_at} />{section === 'places' && row.deleted_at ? <Button title={t("Khôi phục bản nháp")} disabled={saving} onPress={() => setPending({ label: 'Khôi phục địa điểm dưới dạng bản nháp?', path: `/admin/places/${row.id}/restore`, method: 'POST' })} /> : section === 'places' ? <Button title={t("Lưu trữ")} danger disabled={saving} onPress={() => setPending({ label: `Lưu trữ địa điểm #${row.id}? Ảnh, bài thuyết minh và dữ liệu liên quan được giữ lại.`, path: `/admin/places/${row.id}`, method: 'DELETE' })} /> : section !== 'guides' && <Button title={t("Xóa")} danger disabled={saving} onPress={() => setPending({ label: `Xóa bản ghi #${row.id}? Dữ liệu liên quan có thể bị xóa theo.`, path: `/admin/${section}/${row.id}`, method: 'DELETE' })} />}{['places', 'guides'].includes(section) && !row.deleted_at && <Button title={row.publication_status === 'published' ? 'Gỡ xuất bản' : 'Xuất bản'} disabled={saving} onPress={() => publicationAction(row)} />}
            {section === "users" && <Button title={row.role === "admin" ? "→ User" : "→ Admin"} onPress={() => setPending({ label: `Đổi quyền tài khoản #${row.id}?`, path: `/admin/users/${row.id}/role`, method: "PATCH", body: { role: row.role === "admin" ? "user" : "admin" } })} />}{section === "places" && <Button title={t("Bản đồ")} onPress={() => setMap(row)} />}{section === "guides" && <><Button title={t("Nghe thử")} onPress={() => void preview(row)} /><Button title={t("Dịch")} disabled={saving} onPress={() => void translate(row)} /></>}</View>}</View>)}</View></ScrollView>}
            <View style={[s.between, { marginTop: 20 }]}><Button title={t("← Trước")} disabled={page <= 1} onPress={() => setPage(page - 1)} /><Text style={s.muted}>Trang {page}/{Math.max(1, data.pages)}</Text><Button title="Sau →" disabled={page >= data.pages} onPress={() => setPage(page + 1)} /></View></View>}
        </>}
        {busy && <View style={s.empty}><ActivityIndicator color="#0f766e" /><Text style={s.muted}>{t("Đang tải dữ liệu…")}</Text></View>}{map && <View style={s.card}><View style={s.between}><Text style={s.cardTitle}>{String(map.name)}</Text><Button title={t("Đóng bản đồ")} onPress={() => setMap(null)} /></View><GoogleMap latitude={Number(map.latitude)} longitude={Number(map.longitude)} /></View>}
      </ScrollView></View>
    <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => { if (!saving) setEditor(null); }}><View style={s.overlay}><View style={s.dialog}><ScrollView keyboardShouldPersistTaps="handled"><Text style={s.title}>{editor?.id ? "Chỉnh sửa" : "Nhập thông tin"}</Text>{section === "places" && !!editor?.id && token && <PlaceImageEditor placeId={editor.id} uri={form.image_url || ""} token={token} onSaved={uri => { setForm(v => ({ ...v, image_url: uri })); void load(); }} />}{section === "journeys" && <JourneyStopsEditor value={form.place_ids || ""} onChange={value => setForm(v => ({ ...v, place_ids: value }))} />}{(fields[section] ?? []).filter(f => f.key !== "place_ids").filter(f => !(section === "users" && editor?.id && f.key === "password")).map(f => <View style={{ marginTop: 16 }} key={f.key}><Text style={s.label}>{t(f.label)}</Text>{f.choices ? <View style={s.filters}>{f.choices.map(([value, label]) => <Pressable accessibilityRole="radio" accessibilityLabel={t(label)} accessibilityState={{ selected: form[f.key] === value }} disabled={saving} key={value} onPress={() => setForm(v => ({ ...v, [f.key]: value }))} style={[s.chip, form[f.key] === value && s.selected]}><Text style={{ color: form[f.key] === value ? '#fff' : '#334155' }}>{t(label)}</Text></Pressable>)}</View> : <TextInput accessibilityLabel={t(f.label)} style={[s.input, f.multiline && { minHeight: 140, textAlignVertical: "top" }]} multiline={f.multiline} secureTextEntry={f.secret} autoCapitalize="none" value={form[f.key] ?? ""} onChangeText={v => setForm({ ...form, [f.key]: v })} />}</View>)}{!!error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}<View style={[s.row, { marginTop: 24 }]}><Button title={saving ? "Đang lưu…" : "Lưu thay đổi"} disabled={saving} onPress={() => void save()} /><Button title={t("Hủy")} disabled={saving} onPress={() => { setEditor(null); setError(""); }} /></View></ScrollView></View></View></Modal>
    <Modal visible={pending !== null} transparent animationType="fade" onRequestClose={() => { if (!saving) setPending(null); }}><View style={s.overlay}><View style={s.dialog}><Text style={s.title}>{t("Xác nhận thao tác")}</Text><Text style={s.subtitle}>{pending?.label}</Text>{!!error && <Text style={s.error}>{t(error)}</Text>}<View style={s.row}><Button title={saving ? "Đang xử lý…" : "Xác nhận"} danger disabled={saving} onPress={() => void confirmAction()} /><Button title={t("Hủy")} disabled={saving} onPress={() => setPending(null)} /></View></View></View></Modal>
  </View>;
}
const s = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: "#f3f6f8" }, sidebar: { width: 246, backgroundColor: "#102e32", padding: 24 }, brand: { color: "#fff", fontWeight: "800", fontSize: 19, letterSpacing: 1 }, sidebarHint: { color: "#93b5b6", fontSize: 10, letterSpacing: 1, marginTop: 8 }, nav: { paddingVertical: 14, paddingHorizontal: 13, borderRadius: 10 }, navActive: { backgroundColor: "#217b72" }, navText: { color: "#b8cdce", fontSize: 14, fontWeight: "600" },
  header: { paddingHorizontal: 28, paddingVertical: 19, backgroundColor: "#fff", borderBottomWidth: 1, borderColor: "#e4eaf0", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }, heading: { fontSize: 18, fontWeight: "700", color: "#173339", marginTop: 5 }, content: { padding: 28, gap: 18, paddingBottom: 64 }, title: { fontSize: 25, fontWeight: "800", color: "#14353b" }, subtitle: { fontSize: 14, color: "#64748b", lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 }, between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, filters: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }, input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#ccd8df", borderRadius: 9, paddingHorizontal: 13, paddingVertical: 11, color: "#173339", fontSize: 14, minWidth: 140 }, button: { backgroundColor: "#147b70", paddingVertical: 10, paddingHorizontal: 13, borderRadius: 8, alignSelf: "flex-start" }, buttonText: { color: "#fff", fontSize: 12, fontWeight: "700" }, chip: { backgroundColor: "#e4ecee", padding: 12, borderRadius: 8 }, selected: { backgroundColor: "#147b70" },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 14 }, kpi: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e4eaf0", borderRadius: 15, padding: 20, flexGrow: 1, minWidth: 200 }, metric: { fontSize: 34, fontWeight: "800", color: "#15383c", marginVertical: 12 }, kpiHint: { fontSize: 11, color: "#758890" }, card: { backgroundColor: "#fff", borderRadius: 15, borderWidth: 1, borderColor: "#e4eaf0", padding: 22, gap: 12 }, cardTitle: { fontSize: 16, fontWeight: "700", color: "#1f4248", marginBottom: 12 }, muted: { fontSize: 13, color: "#64748b", lineHeight: 20 }, track: { height: 9, backgroundColor: "#edf3f3", borderRadius: 6 }, bar: { height: 9, borderRadius: 6, backgroundColor: "#2b9c8f" }, infoRow: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#edf1f4" },
  tableRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: "#e9eff2" }, cell: { width: 150, padding: 12, fontSize: 12, color: "#3f555b" }, column: { backgroundColor: "#f4f8f9", fontWeight: "700", color: "#32555c" }, empty: { alignItems: "center", padding: 36, gap: 14 }, center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 20 }, errorBox: { padding: 16, backgroundColor: "#fff0ed", borderRadius: 12, gap: 10 }, error: { color: "#ae3535", lineHeight: 22, marginTop: 10 }, notice: { backgroundColor: "#dff3e9", color: "#16604e", padding: 15, borderRadius: 10 }, overlay: { flex: 1, backgroundColor: "rgba(9,28,35,.55)", alignItems: "center", justifyContent: "center", padding: 20 }, dialog: { backgroundColor: "#fff", borderRadius: 18, padding: 26, width: "100%", maxWidth: 620, maxHeight: "90%" }, label: { fontSize: 13, fontWeight: "600", color: "#36555d", marginBottom: 7 },
});
