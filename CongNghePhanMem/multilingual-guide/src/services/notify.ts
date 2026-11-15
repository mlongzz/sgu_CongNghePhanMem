import { Alert, Platform } from 'react-native';

export function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(`${title}\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
