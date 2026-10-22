import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { apiFetch } from '../src/services/api';
import { Screen, ErrorMessage, LoadingState } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/auth';
import { useI18n } from '../src/hooks/useI18n';
import { C } from '../src/theme/colors';

type Journey = { id: number; name: string; description: string; place_ids: number[] };
type Poi = { id: number; name: string; address?: string };
export default function Journeys() {
  const { t } = useI18n();
  const [items, setItems] = useState<Journey[]>([]);
  const [selected, setSelected] = useState<Journey | null>(null);
  const [stops, setStops] = useState<Poi[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const rows = await apiFetch<Journey[]>(`/journeys?limit=20&offset=${page * 20}`, { signal: controller.signal });
      if (!controller.signal.aborted) setItems(rows);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Không tải được hành trình.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [page]);
  useFocusEffect(useCallback(() => { void load(); return () => request.current?.abort(); }, [load]));
  const open = async (item: Journey) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const fresh = await apiFetch<Journey>(`/journeys/${item.id}`, { signal: controller.signal });
      const points = await Promise.all(fresh.place_ids.map(id => apiFetch<Poi>(`/places/${id}`, { signal: controller.signal })));
      if (!controller.signal.aborted) { setSelected(fresh); setStops(points); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Không tải được điểm dừng.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <Screen title="Hành trình khám phá">
    <ErrorMessage message={error} />
    {error && <PrimaryButton title="Thử lại" onPress={() => selected ? void open(selected) : void load()} variant="outline" />}
    {busy ? <LoadingState /> : selected ? <View style={s.card}>
      <Text style={s.title}>{selected.name}</Text><Text style={s.copy}>{selected.description}</Text>
      {!stops.length && <Text style={s.copy}>{t('Hành trình chưa có điểm dừng.')}</Text>}
      {stops.map((stop, index) => <Pressable accessibilityRole="button" key={stop.id} style={s.stop} onPress={() => router.push(`/place/db-${stop.id}`)}><Text style={s.link}>{index + 1}. {stop.name} →</Text><Text style={s.copy}>{stop.address}</Text></Pressable>)}
      <PrimaryButton title="Danh sách hành trình" onPress={() => { setSelected(null); setError(''); }} variant="outline" />
    </View> : <>
      {!items.length && !error && <Text style={s.copy}>{t('Chưa có hành trình trong trang này.')}</Text>}
      {items.map(item => <Pressable accessibilityRole="button" key={item.id} style={s.card} onPress={() => void open(item)}><Text style={s.title}>{item.name}</Text><Text style={s.copy}>{item.description}</Text><Text style={s.link}>{item.place_ids.length} {t('điểm dừng')} →</Text></Pressable>)}
      <View style={s.row}><PrimaryButton title="← Trước" disabled={page === 0 || busy} onPress={() => setPage(value => value - 1)} /><Text style={s.copy}>{page + 1}</Text><PrimaryButton title="Sau →" disabled={items.length < 20 || busy} onPress={() => setPage(value => value + 1)} /></View>
    </>}
  </Screen>;
}
const s = StyleSheet.create({
  title: { color: C.ink, fontSize: 19, fontWeight: '800' },
  card: { backgroundColor: C.white, borderColor: C.border, borderWidth: 1, padding: 20, borderRadius: 18, gap: 14 },
  stop: { paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderColor: C.border },
  link: { color: C.primaryDark, fontWeight: '700' },
  copy: { color: C.muted, lineHeight: 22 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});