import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { freshGps } from '../services/discoveryStatus';

/** Refresh the same 60-second freshness rule on focus, resume and expiry. */
export function useGpsFreshness(timestamp: number | undefined, source: string | null) {
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observe = () => {
      clearTimeout(timer);
      setNow(Date.now());
      if (AppState.currentState === 'active' && source === 'gps' && typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp + 60_001 > Date.now())
        timer = setTimeout(observe, timestamp + 60_001 - Date.now());
    };
    observe();
    const listener = AppState.addEventListener('change', observe);
    return () => { clearTimeout(timer); listener.remove(); };
  }, [timestamp, source]));
  return source !== 'gps' || freshGps(timestamp, now);
}
