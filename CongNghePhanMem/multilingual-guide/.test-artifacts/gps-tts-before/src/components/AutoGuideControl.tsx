import { useCallback, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useApp } from '../context/AppContext';
import { chooseAutoGuide } from '../services/autoGuide';
import { PrimaryButton } from './auth';
import { ErrorMessage } from './Screen';
import { C } from '../theme/colors';

export default function AutoGuideControl() {
  const { places, speak, stop, playingId, refreshCatalog } = useApp();
  const [enabled, setEnabled] = useState(false); const [starting, setStarting] = useState(false); const [error, setError] = useState('');
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const sequence = useRef(0); const heard = useRef(new Set<string>());
  // Watcher callbacks read the current catalog/player without recreating GPS subscriptions.
  const latest = useRef({ places, speak, playingId });
  useFocusEffect(useCallback(() => { latest.current = { places, speak, playingId }; }, [places, speak, playingId]));
  const disable = useCallback(() => {
    sequence.current++; subscription.current?.remove(); subscription.current = null;
    setEnabled(false); setStarting(false); stop();
  }, [stop]);
  useFocusEffect(useCallback(() => {
    const listener = AppState.addEventListener('change', value => { if (value !== 'active') disable(); });
    return () => { listener.remove(); disable(); };
  }, [disable]));
  const enable = async () => {
    if (starting) return;
    const current = ++sequence.current;
    setStarting(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Hãy cho phép vị trí khi đang sử dụng ứng dụng để bật thuyết minh tự động.');
      await refreshCatalog();
      const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 }, position => {
        if (current !== sequence.current || AppState.currentState !== 'active') return;
        const state = latest.current;
        if (state.playingId) return;
        const place = chooseAutoGuide(position.coords, position.coords.accuracy, state.places, heard.current);
        if (place) { heard.current.add(place.id); state.speak(place); }
      }, message => { if (current === sequence.current) { setError(message); disable(); } });
      if (current !== sequence.current) { watcher.remove(); return; }
      subscription.current = watcher; setEnabled(true);
    } catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : 'Không bật được GPS.'); }
    finally { if (current === sequence.current) setStarting(false); }
  };
  return <View style={{ backgroundColor: C.white, padding: 14, borderRadius: 14, gap: 10, marginVertical: 12 }}>
    <Text style={{ fontWeight: '700', color: C.ink }}>Tự động kể chuyện khi đến gần</Text>
    <Text style={{ color: C.muted, fontSize: 12, lineHeight: 19 }}>Phát thuyết minh trong phạm vi 80 m khi GPS chính xác. Chỉ hoạt động khi màn hình bản đồ đang mở; tự tắt khi rời màn hình hoặc đưa ứng dụng vào nền.</Text>
    <PrimaryButton title={enabled ? 'Tắt thuyết minh tự động' : 'Bật thuyết minh tự động'} loading={starting} onPress={() => enabled ? disable() : void enable()} variant="outline" />
    <ErrorMessage message={error} />
  </View>;
}
