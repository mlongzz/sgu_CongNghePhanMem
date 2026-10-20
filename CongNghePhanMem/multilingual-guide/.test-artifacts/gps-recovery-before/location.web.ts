import type { Coordinates } from "./nearby";

const TIMEOUT_MS = 15_000;

/** Ask for GPS directly, including browsers without the Permissions API. Never substitutes a fixed location. */
export function getCurrentCoordinates(): Promise<Coordinates> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return Promise.reject(new Error("GPS chỉ khả dụng khi mở ứng dụng trong trình duyệt."));
  if (window.isSecureContext === false) return Promise.reject(new Error("Trình duyệt chặn GPS trên HTTP của địa chỉ mạng LAN. Trên máy tính này, hãy mở ứng dụng bằng localhost hoặc dùng HTTPS."));
  if (!navigator.geolocation?.getCurrentPosition) return Promise.reject(new Error("Trình duyệt không hỗ trợ lấy vị trí. Bạn có thể nhập tọa độ để tìm địa điểm."));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (coordinates?: Coordinates, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(coordinates!);
    };
    // The watchdog also bounds implementations that never invoke either browser callback.
    const timeout = () => finish(undefined, new Error("Chưa nhận được GPS sau 15 giây. Hãy cho phép vị trí, bật dịch vụ vị trí của thiết bị rồi thử lại, hoặc nhập tọa độ."));
    const timer = setTimeout(timeout, TIMEOUT_MS);
    try {
      navigator.geolocation.getCurrentPosition(position => {
        const latitude = position.coords?.latitude;
        const longitude = position.coords?.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          finish(undefined, new Error("Trình duyệt trả tọa độ GPS không hợp lệ. Hãy thử lại hoặc nhập tọa độ."));
          return;
        }
        finish({ latitude, longitude });
      }, error => {
        if (error.code === 3) { timeout(); return; }
        finish(undefined, new Error(error.code === 1
          ? "Bạn chưa cấp quyền vị trí. Bấm biểu tượng bên trái thanh địa chỉ, cho phép Vị trí rồi thử lại; hoặc nhập tọa độ."
          : "Không xác định được GPS. Hãy bật dịch vụ vị trí của thiết bị và cho phép trình duyệt sử dụng, hoặc nhập tọa độ."));
      }, { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 });
    } catch {
      finish(undefined, new Error("Không gọi được GPS trong trình duyệt. Hãy kiểm tra quyền vị trí hoặc nhập tọa độ."));
    }
  });
}
