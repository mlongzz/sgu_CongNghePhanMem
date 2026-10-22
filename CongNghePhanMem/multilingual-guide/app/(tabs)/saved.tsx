import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlaceCard, EmptyState } from '../../src/components/UI';
import { LoadingState, ErrorMessage } from '../../src/components/Screen';
import { PrimaryButton } from '../../src/components/auth';
import { useApp } from '../../src/context/AppContext';
import { apiFetch, ApiError } from '../../src/services/api';
import { validateBackendPlace } from '../../src/services/nearby';
import type { Place } from '../../src/data/places';
import { C } from '../../src/theme/colors';
import { useI18n } from '../../src/hooks/useI18n';
export default function Saved() {
  const { favorites, findPlace, favoriteError, favoritesLoading, refreshFavorites, token } = useApp();
  const { t } = useI18n();
  const [result, setResult] = useState<{ key: string; places: Place[] } | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = favorites.join(',');
  useFocusEffect(useCallback(() => { if (token) void refreshFavorites(); }, [token, refreshFavorites]));
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (alive) { setLoading(true); setError(''); } });
    void Promise.all(favorites.map(async id => {
      if (!id.startsWith('db-')) return findPlace(id) ?? null;
      try { return validateBackendPlace(await apiFetch(`/places/${Number(id.slice(3))}`, { signal: controller.signal })); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    })).then(rows => { if (alive) setResult({ key, places: rows.filter((p): p is Place => !!p) }); })
      .catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [key, favorites, findPlace, retry]);
  const places = result?.key === key ? result.places : [];
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.icon}><Ionicons name="heart" size={21} color={C.primary} /></View>
    <Text style={s.subtitle}>{t('BỘ SƯU TẬP CỦA BẠN')}</Text><Text style={s.title}>{t('Địa điểm yêu thích')}</Text>
    <Text style={s.info}>{t(token ? 'Được đồng bộ với tài khoản của bạn.' : 'Được lưu trên thiết bị khi chưa đăng nhập.')}</Text>
    {favorites.some(id => !id.startsWith('db-')) && <Text style={s.info}>{t('Địa danh khám phá được lưu trên thiết bị này.')}</Text>}
    <ErrorMessage message={error || favoriteError} />
    {(loading || favoritesLoading) ? <LoadingState /> : places.length ? <View style={s.list}>{places.map(p => <PlaceCard key={p.id} place={p} wide />)}</View> : !(error || favoriteError) && <EmptyState icon="heart-outline" title="Chưa có điểm đến yêu thích" text="Nhấn vào biểu tượng trái tim tại các địa điểm để lưu và quay lại." />}
    <PrimaryButton title="Tải lại" variant="outline" disabled={loading || favoritesLoading} onPress={() => { void refreshFavorites(); setRetry(v => v + 1); }} />
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: C.paper }, page: { padding: 22, paddingTop: 28, paddingBottom: 100, width: '100%', maxWidth: 860, alignSelf: 'center' }, icon: { height: 46, width: 46, borderRadius: 15, backgroundColor: C.primarySoft, justifyContent: 'center', alignItems: 'center', marginBottom: 21 }, subtitle: { color: C.primaryDark, fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 7 }, title: { color: C.ink, fontWeight: '900', fontSize: 27 }, info: { color: C.muted, fontSize: 13, marginTop: 8 }, list: { marginTop: 25 } });
