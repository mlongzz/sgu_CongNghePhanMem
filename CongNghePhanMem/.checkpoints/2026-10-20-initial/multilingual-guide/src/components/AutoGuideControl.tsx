import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
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

export default function AutoGuideControl({ candidates }: { candidates?: Place[] }) {
  const { places, speak, stop, playingId, speechStatus, speechError, refreshNearby, nearbyStatus } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const sequence = useRef(0);
  const activation = useRef<AbortController | null>(null);
  const heard = useRef(new Set<string>());
  const attempted = useRef(new Map<string, number>());
  const pending = useRef(false);
  const pendingId = useRef<string | null>(null);
  const pendingPlace = useRef<Place | null>(null);
  const lastSearch = useRef<{ latitude: number; longitude: number; at: number } | null>(null);
  const latest = useRef({ places: candidates ?? places, speak, playingId, speechStatus, nearbyStatus, refreshNearby });
  useEffect(() => { latest.current = { places: candidates ?? places, speak, playingId, speechStatus, nearbyStatus, refreshNearby }; }, [candidates, places, speak, playingId, speechStatus, nearbyStatus, refreshNearby]);
  useEffect(() => {
    if (playingId && pendingId.current === playingId && speechStatus === 'playing') heard.current.add(playingId);
  }, [playingId, speechStatus]);
  const disable = useCallback(() => {
    sequence.current++;
    activation.current?.abort(); activation.current = null;
    subscription.current?.remove(); subscription.current = null;
    pending.current = false; pendingId.current = null;
    pendingPlace.current = null;
    lastSearch.current = null;
    setEnabled(false); setStarting(false); stop();
  }, [stop]);
  useFocusEffect(useCallback(() => {
    const listener = AppState.addEventListener('change', value => { if (value !== 'active') disable(); });
    return () => { listener.remove(); disable(); };
  }, [disable]));
  const enable = async () => {
    if (starting) return;
    const current = ++sequence.current;
    const controller = new AbortController(); activation.current = controller;
    setStarting(true); setError('');
    try {
      await getCurrentCoordinates({ signal: controller.signal });
      if (current !== sequence.current) return;
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
        if (owned && state.playingId === owned.id && state.speechStatus === 'loading' && distanceKm(position.coords, owned) > 0.08) {
          stop(); pending.current = false; pendingId.current = null;
        }
        const now = Date.now();
        const previous = lastSearch.current;
        if (state.nearbyStatus !== 'locating' && state.nearbyStatus !== 'loading' && (!previous || (now - previous.at >= 30_000 && distanceKm(previous, position.coords) >= 0.1))) {
          lastSearch.current = { ...position.coords, at: now };
          void state.refreshNearby({ gpsCoordinates: { latitude: position.coords.latitude, longitude: position.coords.longitude,
            timestamp: position.timestamp, ...(position.coords.accuracy !== null ? { accuracy: position.coords.accuracy } : {}) } });
        }
        if (state.playingId || pending.current) return;
        const eligible = state.places.filter(place => now - (attempted.current.get(place.id) ?? 0) >= 120_000);
        const place = chooseAutoGuide(position.coords, position.coords.accuracy, eligible, heard.current);
        if (!place) return;
        pending.current = true; pendingId.current = place.id;
        pendingPlace.current = place;
        attempted.current.set(place.id, now);
        if (attempted.current.size > 250) attempted.current.delete(attempted.current.keys().next().value!);
        void state.speak(place).finally(() => { if (current === sequence.current) pending.current = false; });
      }, message => { if (current === sequence.current) { setError(message); disable(); } }, controller.signal);
      if (current !== sequence.current) { watcher.remove(); return; }
      subscription.current = watcher; setEnabled(true);
    } catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : 'Không bật được GPS.'); }
    finally { if (current === sequence.current) setStarting(false); }
  };
  return <View style={{ backgroundColor: C.white, padding: 14, borderRadius: 14, gap: 10, marginVertical: 12 }}>
    <Text style={{ fontWeight: '700', color: C.ink }}>Tự động kể chuyện khi đến gần</Text>
    <Text style={{ color: C.muted, fontSize: 12, lineHeight: 19 }}>Phát nội dung phù hợp trong 80 m khi sai số GPS tối đa 50 m. Không đọc chồng bài đang nghe. Mỗi địa điểm có thời gian chờ ít nhất 2 phút và cần đi ra ngoài 200 m để nghe lại. Chế độ này tự tắt khi rời bản đồ hoặc đưa ứng dụng vào nền.</Text>
    <PrimaryButton title={enabled ? 'Tắt thuyết minh tự động' : 'Bật thuyết minh tự động'} loading={starting} onPress={() => enabled ? disable() : void enable()} variant="outline" />
    {starting && <PrimaryButton title="Hủy bật thuyết minh tự động" onPress={disable} variant="outline"/>}
    <ErrorMessage message={error || (enabled ? speechError : '')} />
  </View>;
}
