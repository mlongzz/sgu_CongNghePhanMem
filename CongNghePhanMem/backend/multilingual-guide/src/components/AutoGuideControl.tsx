import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type * as Location from 'expo-location';
import { useApp } from '../context/AppContext';
import type { Place } from '../data/places';
import { chooseAutoGuide } from '../services/autoGuide';
import { distanceKm } from '../services/nearby';
import { PrimaryButton } from './auth';
import { ErrorMessage } from './Screen';
import { C } from '../theme/colors';
import { getCurrentCoordinates } from '../services/location';
import { watchCoordinates } from '../services/locationWatch';
import { shouldRefreshTrackedPlaces, type TrackedSearch } from '../services/gpsTracking';
import { useI18n } from '../hooks/useI18n';

export default function AutoGuideControl({ candidates }: { candidates?: Place[] }) {
  const { t } = useI18n();
  const { places, speak, stop, playingId, speechStatus, speechError, refreshNearby, nearbyStatus } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const narrationEnabled = useRef(false);
  const [priority, setPriority] = useState<'nearest' | 'official'>('nearest');
  const priorityRef = useRef(priority);
  const [error, setError] = useState('');
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const sequence = useRef(0);
  const activation = useRef<AbortController | null>(null);
  const heard = useRef(new Set<string>());
  const attempted = useRef(new Map<string, number>());
  const pending = useRef(false);
  const pendingId = useRef<string | null>(null);
  const pendingPlace = useRef<Place | null>(null);
  const lastSearch = useRef<TrackedSearch | null>(null);
  const latest = useRef({ places: candidates ?? places, speak, playingId, speechStatus, nearbyStatus, refreshNearby });
  useEffect(() => { latest.current = { places: candidates ?? places, speak, playingId, speechStatus, nearbyStatus, refreshNearby }; }, [candidates, places, speak, playingId, speechStatus, nearbyStatus, refreshNearby]);
  useEffect(() => {
    if (playingId && pendingId.current === playingId && speechStatus === 'playing') heard.current.add(playingId);
  }, [playingId, speechStatus]);
  const disable = useCallback(() => {
    sequence.current++;
    activation.current?.abort(); activation.current = null;
    subscription.current?.remove(); subscription.current = null;
    if (pendingId.current && (latest.current.playingId === pendingId.current || (pending.current && !latest.current.playingId))) stop();
    pending.current = false; pendingId.current = null;
    pendingPlace.current = null;
    lastSearch.current = null;
    narrationEnabled.current = false;
    setEnabled(false); setStarting(false); setNarrating(false);
  }, [stop]);
  useFocusEffect(useCallback(() => {
    const listener = AppState.addEventListener('change', value => { if (value !== 'active') disable(); });
    return () => { listener.remove(); disable(); };
  }, [disable]));
  const enable = async (withNarration = true) => {
    if (starting) return;
    const current = ++sequence.current;
    narrationEnabled.current = withNarration; setNarrating(withNarration);
    const controller = new AbortController(); activation.current = controller;
    setStarting(true); setError('');
    try {
      const initial = await getCurrentCoordinates({ signal: controller.signal });
      if (current !== sequence.current) return;
      if (shouldRefreshTrackedPlaces(initial, null)) {
        lastSearch.current = { ...initial, at: Date.now() };
        void latest.current.refreshNearby({ gpsCoordinates: initial });
      }
      const watcher = await watchCoordinates(position => {
        if (current !== sequence.current || AppState.currentState !== 'active') return;
        const age = Date.now() - position.timestamp;
        if (!Number.isFinite(age) || age > 60_000 || age < -5000 ||
          !Number.isFinite(position.coords.latitude) || Math.abs(position.coords.latitude) > 90 ||
          !Number.isFinite(position.coords.longitude) || Math.abs(position.coords.longitude) > 180) return;
        const state = latest.current;
        // Rearm on leaving even while another guide is playing or this POI is cooling down.
        chooseAutoGuide(position.coords, position.coords.accuracy, state.places, heard.current);
        const owned = pendingPlace.current;
        if (owned && state.playingId === owned.id && state.speechStatus === 'loading' && typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy) &&
          distanceKm(position.coords, owned) - position.coords.accuracy / 1000 > 0.08) {
          stop(); pending.current = false; pendingId.current = null;
        }
        const now = Date.now();
        const previous = lastSearch.current;
        const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp,
          ...(position.coords.accuracy !== null ? { accuracy: position.coords.accuracy } : {}) };
        if (state.nearbyStatus !== 'locating' && state.nearbyStatus !== 'loading' && shouldRefreshTrackedPlaces(fix, previous, now)) {
          lastSearch.current = { ...fix, at: now };
          void state.refreshNearby({ gpsCoordinates: fix });
        }
        if (!narrationEnabled.current || state.playingId || pending.current) return;
        const eligible = state.places.filter(place => now - (attempted.current.get(place.id) ?? 0) >= 120_000);
        const place = chooseAutoGuide(position.coords, position.coords.accuracy, eligible, heard.current, priorityRef.current);
        if (!place) return;
        pending.current = true; pendingId.current = place.id;
        pendingPlace.current = place;
        attempted.current.set(place.id, now);
        if (attempted.current.size > 250) attempted.current.delete(attempted.current.keys().next().value!);
        void state.speak(place).finally(() => { if (current === sequence.current) pending.current = false; });
      }, message => { if (current === sequence.current) { setError(message); disable(); } }, controller.signal);
      if (current !== sequence.current) { watcher.remove(); return; }
      subscription.current = watcher; setEnabled(true);
    } catch (e) { if (current === sequence.current) { setError(e instanceof Error ? e.message : 'Không bật được GPS.'); narrationEnabled.current = false; setNarrating(false); } }
    finally { if (current === sequence.current) setStarting(false); }
  };
  return <View style={{ backgroundColor: C.white, borderWidth: 1, borderColor: C.border, padding: 14, borderRadius: 18, gap: 10, marginTop: 14 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}><Text style={{ fontWeight: '700', color: C.darkBlue }}>{t('Trải nghiệm rảnh tay')}</Text><Text style={{ fontSize: 11, color: enabled ? C.primaryDark : C.muted }}>{t(enabled ? 'Đang theo dõi GPS' : 'Đang tắt')}</Text></View>
    <Text style={{ color: C.muted, fontSize: 11, lineHeight: 18 }}>{t('Tự cập nhật khi di chuyển. Thuyết minh chỉ phát trong 80 m khi GPS đủ chính xác và không có bài khác đang đọc.')}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><View style={{ flexGrow: 1, flexBasis: 190 }}><PrimaryButton title={t(enabled && narrating ? 'Tắt thuyết minh tự động' : 'Bật thuyết minh tự động')} loading={starting && narrating} onPress={() => enabled ? narrating ? disable() : (narrationEnabled.current = true, setNarrating(true)) : void enable()} variant="outline" /></View>
    <View style={{ flexGrow: 1, flexBasis: 180 }}><PrimaryButton title={t(enabled ? 'Dừng theo dõi GPS' : 'Theo dõi khi di chuyển')} loading={starting && !narrating} onPress={() => enabled ? disable() : void enable(false)} variant="outline" /></View></View>
    {narrating ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['nearest', 'official'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: priority === value }} onPress={() => { priorityRef.current = value; setPriority(value); }} style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: priority === value ? C.primarySoft : C.paper }}><Text style={{ fontSize: 11, color: priority === value ? C.primaryDark : C.muted }}>{t(value === 'nearest' ? 'Ưu tiên gần nhất' : 'Ưu tiên địa điểm hệ thống')}</Text></Pressable>)}</View> : null}
    <Text style={{ color: C.muted, fontSize: 10, lineHeight: 16 }}>{t('Chỉ theo dõi khi bật, tự dừng khi rời bản đồ hoặc vào nền. Không lưu lịch sử vị trí.')}</Text>
    {starting && <PrimaryButton title={t('Hủy bật thuyết minh tự động')} onPress={disable} variant="outline"/>}
    <ErrorMessage message={error || (enabled ? speechError : '')} />
  </View>;
}
