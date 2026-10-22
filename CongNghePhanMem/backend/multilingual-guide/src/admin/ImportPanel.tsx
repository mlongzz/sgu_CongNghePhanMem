import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiFetch } from '../services/api';
import { C } from '../theme/colors';
import { useI18n } from '../hooks/useI18n';

type PreviewRow = { source_id?: string; name?: string; key?: string; status?: string; reason?: string; latitude?: number; longitude?: number; source_url?: string; sources?: string[] };
type Preview = { rows?: PreviewRow[]; places?: PreviewRow[]; counts?: Record<string, number>; preview_token: string; [key: string]: unknown };

export default function ImportPanel({ token }: { token: string }) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<{ type: 'osm' | 'catalog' | 'discovery'; result: Preview; payload?: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = <T,>(path: string, body?: unknown) => apiFetch<T>(path, { token, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const review = async (type: 'osm' | 'catalog' | 'discovery') => {
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      const payload = type === 'osm' ? JSON.parse(input) : undefined;
      if (type === 'osm' && (!payload || !Array.isArray(payload.places))) throw new Error('Dữ liệu cần có dạng {"places": [...]} từ công cụ nhập OSM.');
      const result = await request<Preview>(type === 'osm' ? '/admin/imports/osm/preview' : type === 'discovery' ? '/admin/catalog/hcmc-discovery' : '/admin/catalog/hcmc', payload);
      if (typeof result.preview_token !== 'string' || !result.preview_token) throw new Error('Máy chủ chưa cung cấp mã duyệt. Hãy cập nhật backend và thử lại.');
      setPreview({ type, result, payload });
    } catch (e) { setError(e instanceof Error ? e.message : 'Không xem trước được dữ liệu.'); }
    finally { setBusy(false); }
  };
  const reviewUnconflicted = async () => {
    if (preview?.type !== 'discovery' || busy) return;
    setBusy(true); setError('');
    try {
      const source_ids = (preview.result.rows ?? []).filter(row => row.status === 'create' && row.source_id).map(row => row.source_id!);
      if (!source_ids.length) throw new Error('Không có địa danh mới không xung đột để nhập.');
      const payload = { source_ids };
      const result = await request<Preview>('/admin/catalog/hcmc-discovery/preview', payload);
      setPreview({ type: 'discovery', result, payload });
    } catch (e) { setError(e instanceof Error ? e.message : 'Không xem trước được danh sách đã chọn.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      const body = preview.type === 'osm' ? { ...(preview.payload as Record<string, unknown>), preview_token: preview.result.preview_token } : preview.type === 'discovery' ? { source_ids: (preview.payload as { source_ids?: string[] } | undefined)?.source_ids ?? preview.result.rows?.map(row => row.source_id), preview_token: preview.result.preview_token } : { preview_token: preview.result.preview_token };
      await request(preview.type === 'osm' ? '/admin/imports/osm' : preview.type === 'discovery' ? '/admin/catalog/hcmc-discovery/import' : '/admin/catalog/hcmc/import', body);
      setNotice('Đã nhập bản nháp. Mở Địa điểm POI để kiểm duyệt và xuất bản.'); setPreview(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không nhập được dữ liệu.'); }
    finally { setBusy(false); }
  };
  const rows = preview?.result.rows ?? preview?.result.places ?? [];
  const conflicts = preview?.result.counts?.conflict ?? preview?.result.counts?.conflicts ?? (typeof preview?.result.conflicts === 'number' ? preview.result.conflicts : rows.filter(row => row.status === 'conflict').length);
  const summary = preview?.result.counts ?? Object.fromEntries(Object.entries(preview?.result ?? {}).filter(([key, value]) => ['places_to_create', 'guides_to_create', 'existing', 'conflicts'].includes(key) && typeof value === 'number'));
  return <View style={s.panel}>
    <Text style={s.title}>{t("Nhập địa danh có kiểm duyệt")}</Text>
    <Text style={s.muted}>{t("Xem nguồn và xung đột trước khi nhập. Dữ liệu được lưu thành bản nháp; chỉ xuất hiện với khách sau khi Admin xuất bản.")}</Text>
    <Text style={s.label}>{t("Dữ liệu OSM (JSON)")}</Text>
    <TextInput accessibilityLabel={t("Dữ liệu OSM (JSON)")} multiline editable={!busy} value={input} onChangeText={value => { setInput(value); setPreview(null); }} placeholder={'{"places":[{"name":"Tên từ OSM","latitude":0,"longitude":0,"source_id":"node/123"}]}'} style={s.input} />
    <Text style={s.muted}>{t("Nguồn: OpenStreetMap contributors · ODbL. Dùng dữ liệu xuất từ công cụ OSM; tọa độ và định danh phải có nguồn thực.")}</Text>
    <View style={s.row}><Action title={t("Xem trước OSM")} disabled={busy || !input.trim()} onPress={() => void review('osm')} /><Action title={t("Xem trước bộ POI TP.HCM")} disabled={busy} onPress={() => void review('catalog')} /><Action title={t("Xem trước POI Wikipedia đã xác minh")} disabled={busy} onPress={() => void review('discovery')} /></View>
    {busy && <ActivityIndicator color={C.primary} />}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
    {!!notice && <Text accessibilityRole="alert" style={s.notice}>{t(notice)}</Text>}
    {preview && <View style={{ gap: 14 }}>
      <Text style={s.title}>{t("Bản xem trước")}</Text>
      <Text style={s.muted}>{Object.entries(summary).map(([key, count]) => `${key}: ${count}`).join(' · ')}</Text>
      <ScrollView horizontal><View>{rows.map((row, index) => <View key={row.source_id ?? row.key ?? index} style={s.previewRow}><View style={{ width: 220, gap: 7 }}><Text style={s.name}>{row.name ?? row.key ?? row.source_id}</Text>{typeof row.latitude === 'number' && typeof row.longitude === 'number' && <Text style={s.muted}>{row.latitude}, {row.longitude}</Text>}{(row.source_url || row.sources?.[0] || preview.type === 'osm' && row.source_id) && <Pressable accessibilityRole="button" accessibilityLabel={`Nguồn ${row.name ?? row.source_id}`} onPress={() => void Linking.openURL(row.source_url || row.sources?.[0] || `https://www.openstreetmap.org/${row.source_id}`).catch(() => {})}><Text style={{ color: C.primaryDark }}>{t("Nguồn dữ liệu ↗")}</Text></Pressable>}</View><Text style={s.status}>{row.status}</Text><Text style={s.reason}>{row.reason}</Text></View>)}</View></ScrollView>
      <Text style={s.muted}>{t("Nhấn nút dưới đây xác nhận ghi các bản nháp đã xem trước vào cơ sở dữ liệu. Nếu dữ liệu thay đổi, cần xem trước lại.")}</Text>
      <Action title={t("Xác nhận nhập bản nháp đã xem trước")} disabled={busy || conflicts > 0} onPress={() => void apply()} />
      {conflicts > 0 && <Text style={s.error}>{t("Cần xử lý xung đột trước khi nhập.")}</Text>}
      {preview.type === 'discovery' && conflicts > 0 && <Action title={t("Xem trước các mục mới không xung đột")} disabled={busy} onPress={() => void reviewUnconflicted()} />}
    </View>}
  </View>;
}
function Action({ title, disabled, onPress }: { title: string; disabled?: boolean; onPress: () => void }) {
  const { t } = useI18n();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.45 }]}><Text style={s.buttonText}>{t(title)}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.white, padding: 22, gap: 16 },
  title: { color: C.ink, fontSize: 18, fontWeight: '800' },
  label: { color: C.ink, fontSize: 13, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 13, lineHeight: 21 },
  input: { borderRadius: 12, borderWidth: 1, borderColor: C.border, minHeight: 180, textAlignVertical: 'top', color: C.ink, padding: 14, fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { backgroundColor: C.primaryDark, borderRadius: 10, padding: 13, alignSelf: 'flex-start' },
  buttonText: { color: C.white, fontWeight: '700', fontSize: 13 },
  error: { color: C.danger, lineHeight: 22 }, notice: { color: C.primaryDark, lineHeight: 22 },
  previewRow: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border, gap: 12 },
  name: { width: 220, color: C.ink }, status: { width: 85, color: C.primaryDark }, reason: { width: 280, color: C.muted },
});
