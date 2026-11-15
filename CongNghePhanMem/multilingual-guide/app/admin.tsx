import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, View, Text } from 'react-native';
import { useApp } from '../src/context/AppContext';
import { useI18n } from '../src/hooks/useI18n';
import Dashboard from '../src/admin/Dashboard';
export default function Admin() {
  const { token, authLoading, isAdmin, sessionUnverified, sessionNotice, retrySession } = useApp();
  const { t } = useI18n();
  if (authLoading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}><ActivityIndicator /><Text>{t('Đang kiểm tra phiên đăng nhập…')}</Text></View>;
  if (!token && sessionUnverified) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}><Text accessibilityRole="alert" style={{ textAlign: 'center' }}>{t(sessionNotice)}</Text><Pressable accessibilityRole="button" onPress={retrySession}><Text style={{ fontWeight: '700' }}>{t('Thử lại')}</Text></Pressable></View>;
  if (!token) return <Redirect href="/login" />;
  if (!isAdmin) return <Redirect href="/" />;
  return <Dashboard />;
}
