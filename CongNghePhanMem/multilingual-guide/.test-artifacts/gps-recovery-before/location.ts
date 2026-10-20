import * as Location from "expo-location";
import type { Coordinates } from "./nearby";

/** Native platforms keep expo-location and the existing permission flow. */
export async function getCurrentCoordinates(): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error("Bạn chưa cấp quyền vị trí. Hãy cho phép vị trí trong cài đặt ứng dụng để tìm địa điểm gần bạn.");
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new Error("Thiết bị trả tọa độ GPS không hợp lệ. Hãy thử lại.");
  return { latitude, longitude };
}
