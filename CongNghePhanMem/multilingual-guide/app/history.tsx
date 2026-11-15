import { useCallback, useRef, useState } from 'react';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Screen, LoadingState, ErrorMessage, panel } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/auth';
import { apiFetch } from '../src/services/api';
import { resolveVisitNames, type Visit, type VisitRow } from '../src/services/history';
import { useApp } from '../src/context/AppContext';
import { useI18n } from '../src/hooks/useI18n';

export default function History() {
  const { t, language } = useI18n();
  const { token, authLoading, user } = useApp();
  const [rows, setRows] = useState<VisitRow[]>([]); const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false);
  const seq = useRef(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    const current = ++seq.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const visits = await apiFetch<Visit[]>(`/history?limit=20&offset=${page * 20}`, { token, signal: controller.signal });
      const named = await resolveVisitNames(visits, async id => (await apiFetch<{ name: string }>(`/places/${id}`, { signal: controller.signal })).name);
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
  if (authLoading) return <LoadingState />;
  if (!token) return <Redirect href="/login" />;
  return <Screen title="Lịch sử khám phá"><Text>{user?.full_name}</Text><ErrorMessage message={error} />
    {busy ? <LoadingState /> : rows.length ? rows.map(row => <Pressable accessibilityRole="button" key={row.id} style={panel} onPress={() => router.push(`/place/db-${row.place_id}`)}><Text style={{ fontWeight: '700' }}>{row.state === 'ok' ? row.name : t(row.state === 'deleted' ? 'Địa điểm đã được xóa' : 'Không tải được tên địa điểm')}</Text><Text>{new Date(row.visited_at.endsWith('Z') || /[+-]\d\d:\d\d$/.test(row.visited_at) ? row.visited_at : row.visited_at + 'Z').toLocaleString(language === 'vi' ? 'vi-VN' : language === 'ja' ? 'ja-JP' : language === 'fr' ? 'fr-FR' : 'en-US')}</Text></Pressable>) : !error && <Text>{t('Chưa có lịch sử trong trang này.')}</Text>}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><PrimaryButton title="← Trước" disabled={busy || page === 0} onPress={() => setPage(v => v - 1)} /><Text>{t('Trang')} {page + 1}</Text><PrimaryButton title="Sau →" disabled={busy || rows.length < 20} onPress={() => setPage(v => v + 1)} /></View>
    <PrimaryButton title="Tải lại" disabled={busy} onPress={() => void load()} variant="outline" />
    <PrimaryButton title="Xóa lịch sử của tôi" disabled={busy} onPress={() => setConfirm(!confirm)} variant="outline" />
    {confirm && <View style={panel}><Text>{t('Xóa toàn bộ lịch sử khám phá của tài khoản này?')}</Text><PrimaryButton title="Xác nhận xóa" disabled={busy} onPress={() => void clear()} /><PrimaryButton title="Hủy" onPress={() => setConfirm(false)} variant="outline" /></View>}
  </Screen>;
}
