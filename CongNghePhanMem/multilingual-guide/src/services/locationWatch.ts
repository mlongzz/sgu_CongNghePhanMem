import * as Location from 'expo-location';

function cancelled(): Error {
  return Object.assign(new Error('Đã hủy theo dõi GPS.'), { code: 'ABORT_ERR' });
}

/** The caller owns foreground permission; this wrapper only creates/removes a watch. */
export function watchCoordinates(
  onPosition: (position: Location.LocationObject) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<Location.LocationSubscription> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let active = true;
    let settled = false;
    let subscription: Location.LocationSubscription | undefined;
    const remove = () => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      subscription?.remove();
    };
    const fail = (error: unknown) => {
      remove();
      if (!settled) { settled = true; reject(error); }
    };
    const abort = () => fail(cancelled());
    const timer = setTimeout(() => fail(Object.assign(new Error('Chưa khởi động được theo dõi GPS sau 30 giây. Hãy thử lại.'), { code: 'WATCH_TIMEOUT' })), 30_000);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      void Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 5000 },
        position => { if (active) onPosition(position); },
        message => { if (active) onError(message); },
      ).then(watcher => {
        if (!active) { watcher.remove(); return; }
        subscription = watcher;
        settled = true;
        clearTimeout(timer);
        resolve({ remove });
      }, error => fail(error));
    } catch (error) { fail(error); }
  });
}
