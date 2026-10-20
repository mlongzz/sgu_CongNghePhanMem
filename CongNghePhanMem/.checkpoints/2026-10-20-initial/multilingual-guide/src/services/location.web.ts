import type { LocationCoordinates, LocationRequestOptions } from "./locationOptions";
export type { LocationCoordinates } from "./locationOptions";

const POSITION_TIMEOUT_MS = 30_000;
const CALLBACK_GRACE_MS = 5_000;
const PERMISSION_WAIT_MS = 90_000;

function locationError(message: string, code: number | string, browserMessage = ""): Error {
  return Object.assign(new Error(message), { code, browserMessage });
}

/** Use the browser's real position. Permission time is separate from acquisition time. */
export function getCurrentCoordinates({ signal, onProgress }: LocationRequestOptions = {}): Promise<LocationCoordinates> {
  if (signal?.aborted) return Promise.reject(locationError("Đã hủy lấy vị trí.", "ABORT_ERR"));
  if (typeof window === "undefined" || typeof navigator === "undefined") return Promise.reject(new Error("GPS chỉ khả dụng khi mở ứng dụng trong trình duyệt."));
  if (window.isSecureContext === false) return Promise.reject(new Error("Trình duyệt chặn GPS trên HTTP của địa chỉ mạng LAN. Trên máy tính này, hãy mở ứng dụng bằng localhost hoặc dùng HTTPS."));
  if (!navigator.geolocation?.getCurrentPosition) return Promise.reject(new Error("Trình duyệt không hỗ trợ lấy vị trí."));

  return new Promise((resolve, reject) => {
    let settled = false;
    let attempt = 0;
    let permission: PermissionStatus | undefined;
    let acquisitionStarted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const denied = (browserMessage = "") => locationError(permission?.state === "granted"
      ? "Trình duyệt đã cho phép vị trí, nhưng thiết bị vẫn từ chối. Trên Windows, mở Settings → Privacy & security → Location, bật Location services và Let desktop apps access your location, rồi mở lại trình duyệt."
      : "Bạn chưa cấp quyền vị trí. Bấm biểu tượng bên trái thanh địa chỉ và cho phép Vị trí. Nếu đã cho phép, kiểm tra thêm Location services và quyền ứng dụng desktop trong Windows Settings → Location.", 1, browserMessage);

    const finish = (coordinates?: LocationCoordinates, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      permission?.removeEventListener("change", permissionChanged);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(coordinates!);
    };
    const abort = () => finish(undefined, locationError("Đã hủy lấy vị trí.", "ABORT_ERR"));
    const exhausted = (code: number, browserMessage = "") => finish(undefined, locationError(code === 2
      ? "Trình duyệt không xác định được vị trí sau hai lần thử (mã GPS 2). Kiểm tra dịch vụ vị trí của thiết bị và kết nối mạng, rồi thử lại."
      : "Chưa nhận được tọa độ sau hai lần thử GPS (mã GPS 3). Kiểm tra dịch vụ vị trí của thiết bị và kết nối mạng, rồi thử lại.", code, browserMessage));

    const armWatchdog = () => {
      clearTimeout(timer);
      const thisAttempt = attempt;
      timer = setTimeout(() => {
        if (settled || thisAttempt !== attempt) return;
        if (permission?.state === "prompt") {
          finish(undefined, locationError("Chưa hoàn tất cấp quyền vị trí. Chọn Cho phép trong thông báo của trình duyệt, rồi bấm lấy GPS lại.", "PERMISSION_TIMEOUT"));
        } else if (attempt === 1) {
          acquisitionStarted = true;
          startAttempt();
        }
        else exhausted(3);
      }, acquisitionStarted ? POSITION_TIMEOUT_MS + CALLBACK_GRACE_MS : PERMISSION_WAIT_MS);
    };
    function permissionChanged() {
      if (settled) return;
      if (permission?.state === "denied") { finish(undefined, denied()); return; }
      if (permission?.state === "granted") {
        acquisitionStarted = true;
        onProgress?.(attempt === 1 ? "Đã có quyền vị trí. Đang lấy tọa độ, tối đa 30 giây..." : "Đang thử lại GPS với độ chính xác cao, tối đa 30 giây...");
      } else onProgress?.("Chọn Cho phép trong yêu cầu vị trí của trình duyệt. Thời gian chờ cấp quyền được tính riêng.");
      armWatchdog();
    }
    function startAttempt() {
      if (settled) return;
      const thisAttempt = ++attempt;
      onProgress?.(attempt === 1
        ? "Đang yêu cầu vị trí. Chọn Cho phép nếu trình duyệt hỏi."
        : "Chưa có tọa độ. Đang thử lại GPS với độ chính xác cao, tối đa 30 giây...");
      armWatchdog();
      try {
        navigator.geolocation.getCurrentPosition(position => {
          if (settled || thisAttempt !== attempt) return;
          const latitude = position?.coords?.latitude;
          const longitude = position?.coords?.longitude;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            finish(undefined, new Error("Trình duyệt trả tọa độ GPS không hợp lệ. Hãy thử lại."));
            return;
          }
          const timestamp = position.timestamp;
          if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp <= 0 || Date.now() - timestamp > 60_000 || timestamp - Date.now() > 60_000)) {
            finish(undefined, locationError("Trình duyệt trả vị trí đã cũ hoặc thời gian GPS không hợp lệ. Hãy lấy GPS lại.", "STALE_POSITION"));
            return;
          }
          const accuracy = position.coords.accuracy;
          finish({ latitude, longitude,
            ...(typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}),
            ...(typeof timestamp === "number" ? { timestamp } : {}),
          });
        }, error => {
          if (settled || thisAttempt !== attempt) return;
          if (error.code === 1) { finish(undefined, denied(error.message)); return; }
          // A timeout/unavailable callback implies the browser has passed its permission step.
          acquisitionStarted = true;
          if (attempt === 1 && (error.code === 2 || error.code === 3)) startAttempt();
          else exhausted(error.code, error.message);
        }, { enableHighAccuracy: attempt > 1, timeout: POSITION_TIMEOUT_MS, maximumAge: 60_000 });
      } catch {
        finish(undefined, new Error("Không gọi được GPS trong trình duyệt. Hãy kiểm tra quyền vị trí rồi thử lại."));
      }
    }

    signal?.addEventListener("abort", abort, { once: true });
    // Invoke geolocation during the user's click; a missing/broken Permissions API must not block it.
    startAttempt();
    try {
      void navigator.permissions?.query({ name: "geolocation" }).then(status => {
        if (settled) return;
        permission = status;
        permission.addEventListener("change", permissionChanged);
        permissionChanged();
      }).catch(() => { /* Browsers without permission introspection still use their position callback. */ });
    } catch { /* Some browsers expose query() but throw for geolocation. */ }
  });
}
