import { Alert, Linking, Platform } from 'react-native';

type Destination = { latitude: number; longitude: number };
type Translate = (text: string) => string;

/** Construct a Maps URL for the selected destination, without including the user's location. */
export function directionsUrl({ latitude, longitude }: Destination): string {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error('Invalid destination');
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude}%2C${longitude}&travelmode=walking`;
}

/** Open on the user's explicit action; report a rejected link or blocked browser popup. */
export async function openDirections(destination: Destination, t: Translate): Promise<boolean> {
  try {
    const url = directionsUrl(destination);
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') throw new Error('Browser unavailable');
      const opened = window.open(url, '_blank');
      if (!opened) throw new Error('Popup blocked');
      opened.opener = null;
    } else {
      await Linking.openURL(url);
    }
    return true;
  } catch {
    const message = t(Platform.OS === 'web'
      ? 'Không thể mở chỉ đường. Hãy cho phép cửa sổ mới và thử lại.'
      : 'Không thể mở chỉ đường. Hãy kiểm tra ứng dụng bản đồ và thử lại.');
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(message);
    else Alert.alert(t('Lỗi'), message);
    return false;
  }
}
