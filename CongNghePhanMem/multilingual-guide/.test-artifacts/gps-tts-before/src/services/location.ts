import * as Location from "expo-location";
import type { Coordinates } from "./nearby";
import type { LocationRequestOptions } from "./locationOptions";

/** Native platforms keep expo-location and the existing permission flow. */
export async function getCurrentCoordinates({ signal, onProgress }: LocationRequestOptions = {}): Promise<Coordinates> {
  if (signal?.aborted) throw new Error("Đã hủy lấy vị trí.");
  onProgress?.("Đang xin quyền vị trí của thiết bị...");
  const permission = await Location.requestForegroundPermissionsAsync();
  if (signal?.aborted) throw new Error("Đã hủy lấy vị trí.");
  if (!permission.granted) throw new Error("Bạn chưa cấp quyền vị trí. Hãy cho phép vị trí trong cài đặt ứng dụng để tìm địa điểm gần bạn.");
  onProgress?.("Đang lấy vị trí của thiết bị...");
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  if (signal?.aborted) throw new Error("Đã hủy lấy vị trí.");
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new Error("Thiết bị trả tọa độ GPS không hợp lệ. Hãy thử lại.");
  return { latitude, longitude };
}
