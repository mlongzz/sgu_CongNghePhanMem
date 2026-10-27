import { useCallback, useRef, useState } from 'react';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Screen, LoadingState, ErrorMessage, panel } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/auth';
import { apiFetch, ApiError } from '../src/services/api';
import { useApp } from '../src/context/AppContext';
import { useI18n } from '../src/hooks/useI18n';
import { filterHistoryEntries, historyTime, resolveHistoryEntries, type HistoryEntry, type HistoryRange, type HistoryVisit } from '../src/services/historyEntries';

export default function History() {
  const { t, language } = useI18n();
  const { token, authLoading, user } = useApp();
  const [rows, setRows] = useState<HistoryEntry[]>([]); const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const [range, setRange] = useState<HistoryRange>('all');
  const seq = useRef(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    const current = ++seq.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const visits = await apiFetch<HistoryVisit[]>(`/history?limit=20&offset=${page * 20}`, { token, signal: controller.signal });
      const named = await resolveHistoryEntries(visits,
        async id => (await apiFetch<{ name: string }>(`/places/${id}`, { signal: controller.signal })).name,
        error => error instanceof ApiError && error.status === 404);
      if (current === seq.current) setRows(named);
    } catch (e) { if (current === seq.current) setError(e instanceof Error ? e.message : 'Không tải được lịch sử.'); }
    finally { if (current === seq.current) setBusy(false); }
  }, [page, token]);
  useFocusEffect(useCallback(() => { void load(); return () => { seq.current++; request.current?.abort(); }; }, [load]));
  const clear = async () => {
    if (!token) return;
    seq.current++;
    request.current?.abort();
    setBusy(true); setError('');
    try { await apiFetch('/history', { token, method: 'DELETE' }); setRows([]); setPage(0); setConfirm(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không xóa được lịch sử.'); }
    finally { setBusy(false); }
  };
  const visibleRows = filterHistoryEntries(rows, range);
  if (authLoading) return <LoadingState />;
  if (!token) return <Redirect href="/login" />;
  return <Screen title="Lịch sử khám phá"><Text>{user?.full_name}</Text><ErrorMessage message={error} />
    <Text>{t('Lọc thời gian trong trang hiện tại')}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={t('Lọc thời gian trong trang hiện tại')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
      {([['all', 'Tất cả trong trang'], ['today', 'Hôm nay'], ['week', '7 ngày gần đây']] as const).map(([value, label]) =>
        <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: range === value }}
          disabled={busy} onPress={() => setRange(value)} style={[panel, { marginBottom: 0, padding: 12, minHeight: 44, opacity: range === value ? 1 : 0.65 }]}>
          <Text>{t(label)}</Text>
        </Pressable>)}
    </View>
    {!busy && <Text>{visibleRows.length}/{rows.length} {t('lượt khám phá')}</Text>}
    {!busy && rows.some(row => row.state === 'unavailable') && <Text accessibilityRole="alert">{t('Một số tên địa điểm chưa tải được. Bạn có thể tải lại.')}</Text>}
    {busy ? <LoadingState /> : visibleRows.length ? visibleRows.map(row => <Pressable accessibilityRole="button" key={row.id} style={panel}
      disabled={row.state === 'deleted'} accessibilityState={{ disabled: row.state === 'deleted' }}
      onPress={() => router.push(`/place/db-${row.place_id}`)}>
      <Text style={{ fontWeight: '700' }}>{row.state === 'available' ? row.name : t(row.name)}</Text>
      <Text>{new Date(historyTime(row.visited_at)).toLocaleString(language === 'vi' ? 'vi-VN' : language === 'ja' ? 'ja-JP' : language === 'fr' ? 'fr-FR' : 'en-US')}</Text>
    </Pressable>) : !error && <Text>{t(rows.length ? 'Không có lượt khám phá phù hợp trong trang này.' : 'Chưa có lịch sử trong trang này.')}</Text>}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><PrimaryButton title="← Trước" disabled={busy || page === 0} onPress={() => setPage(v => v - 1)} /><Text>Trang {page + 1}</Text><PrimaryButton title="Sau →" disabled={busy || rows.length < 20} onPress={() => setPage(v => v + 1)} /></View>
    <PrimaryButton title="Tải lại" disabled={busy} onPress={() => void load()} variant="outline" />
    <PrimaryButton title="Xóa lịch sử của tôi" disabled={busy} onPress={() => setConfirm(!confirm)} variant="outline" />
    {confirm && <View style={panel}><Text>{t('Xóa toàn bộ lịch sử khám phá của tài khoản này?')}</Text><PrimaryButton title="Xác nhận xóa" disabled={busy} onPress={() => void clear()} /><PrimaryButton title="Hủy" onPress={() => setConfirm(false)} variant="outline" /></View>}
  </Screen>;
}
