import * as Location from "expo-location";
import type { LocationCoordinates, LocationRequestOptions } from "./locationOptions";
export type { LocationCoordinates } from "./locationOptions";

function locationError(message: string, code: string | number): Error {
  return Object.assign(new Error(message), { code });
}

/** Expo's one-shot request cannot be cancelled. Stop awaiting it and ignore a late fix. */
function waitForLocation<T>(operation: () => Promise<T>, timeoutMs: number, timeoutError: Error, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(locationError("Đã hủy lấy vị trí.", "ABORT_ERR"));
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (value?: T, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error); else resolve(value!);
    };
    const abort = () => finish(undefined, locationError("Đã hủy lấy vị trí.", "ABORT_ERR"));
    const timer = setTimeout(() => finish(undefined, timeoutError), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    try { operation().then(value => finish(value), error => finish(undefined, error)); }
    catch (error) { finish(undefined, error); }
  });
}

/** Native platforms keep expo-location and the existing permission flow. */
export async function getCurrentCoordinates({ signal, onProgress }: LocationRequestOptions = {}): Promise<LocationCoordinates> {
  if (signal?.aborted) throw locationError("Đã hủy lấy vị trí.", "ABORT_ERR");
  const enabled = await waitForLocation(() => Location.hasServicesEnabledAsync(), 10_000,
    locationError("Không kiểm tra được dịch vụ vị trí của thiết bị. Hãy thử lại.", "SERVICES_TIMEOUT"), signal);
  if (!enabled) throw locationError("Dịch vụ vị trí của thiết bị đang tắt. Hãy bật Vị trí trong cài đặt thiết bị rồi thử lại.", "SERVICES_DISABLED");
  onProgress?.("Đang xin quyền vị trí của thiết bị...");
  const permission = await waitForLocation(() => Location.requestForegroundPermissionsAsync(), 90_000,
    locationError("Chưa hoàn tất cấp quyền vị trí. Chọn Cho phép trong thông báo của thiết bị rồi thử lại.", "PERMISSION_TIMEOUT"), signal);
  if (!permission.granted) throw locationError(permission.canAskAgain === false
    ? "Quyền vị trí đã bị từ chối và không thể hỏi lại. Mở Cài đặt → Ứng dụng → Quyền → Vị trí để cho phép, rồi thử lại."
    : "Bạn chưa cấp quyền vị trí. Hãy cho phép vị trí trong cài đặt ứng dụng để tìm địa điểm gần bạn.", 1);
  onProgress?.("Đang lấy vị trí của thiết bị, tối đa 35 giây...");
  const position = await waitForLocation(() => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 35_000,
    locationError("Chưa nhận được tọa độ GPS sau 35 giây. Kiểm tra dịch vụ vị trí của thiết bị rồi thử lại.", 3), signal);
  if (signal?.aborted) throw locationError("Đã hủy lấy vị trí.", "ABORT_ERR");
  const latitude = position?.coords?.latitude;
  const longitude = position?.coords?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new Error("Thiết bị trả tọa độ GPS không hợp lệ. Hãy thử lại.");
  const timestamp = position.timestamp;
  if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp <= 0 || Date.now() - timestamp > 60_000 || timestamp - Date.now() > 60_000))
    throw locationError("Thiết bị trả vị trí đã cũ hoặc thời gian GPS không hợp lệ. Hãy lấy GPS lại.", "STALE_POSITION");
  const accuracy = position.coords.accuracy;
  return { latitude, longitude,
    ...(typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}),
    ...(typeof timestamp === "number" ? { timestamp } : {}),
  };
}
