import type { LocationObject, LocationSubscription } from 'expo-location';

function cancelled(): Error {
  return Object.assign(new Error('Đã hủy theo dõi GPS.'), { code: 'ABORT_ERR' });
}

/** Retain the browser's own watch ID; Expo's internal ID can differ on Web. */
export async function watchCoordinates(
  onPosition: (position: LocationObject) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<LocationSubscription> {
  if (signal?.aborted) throw cancelled();
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.geolocation?.watchPosition)
    throw new Error('Trình duyệt không hỗ trợ theo dõi GPS.');
  if (window.isSecureContext === false)
    throw new Error('Trình duyệt chặn GPS trên HTTP của địa chỉ mạng LAN. Hãy dùng localhost hoặc HTTPS.');

  let active = true;
  let browserWatchId: number | undefined;
  const remove = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', remove);
    if (browserWatchId !== undefined) navigator.geolocation.clearWatch(browserWatchId);
  };
  signal?.addEventListener('abort', remove, { once: true });
  try {
    browserWatchId = navigator.geolocation.watchPosition(position => {
      if (!active) return;
      if (!position?.coords) { onError('Trình duyệt trả tọa độ GPS không hợp lệ. Hãy bật GPS lại.'); return; }
      onPosition({ coords: position.coords, timestamp: position.timestamp });
    }, error => {
      if (!active) return;
      const message = error.code === 1
        ? 'Quyền vị trí bị từ chối hoặc đã bị thu hồi. Cho phép Vị trí trong cài đặt trình duyệt rồi bật GPS lại.'
        : error.code === 2
          ? 'Thiết bị không xác định được vị trí. Kiểm tra dịch vụ vị trí rồi bật GPS lại.'
          : error.code === 3
            ? 'Chưa nhận được cập nhật GPS sau 30 giây. Hãy bật GPS lại ở nơi thoáng hơn.'
            : 'Không theo dõi được GPS. Hãy kiểm tra dịch vụ vị trí rồi thử lại.';
      onError(message);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    // A synchronous callback can cancel activation before watchPosition returns its ID.
    if (!active) navigator.geolocation.clearWatch(browserWatchId);
    return { remove };
  } catch {
    remove();
    throw new Error('Không khởi động được theo dõi GPS. Kiểm tra quyền vị trí rồi thử lại.');
  }
}
