import { Redirect } from 'expo-router';
import { ActivityIndicator, View, Text } from 'react-native';
import { useApp } from '../src/context/AppContext';
import Dashboard from '../src/admin/Dashboard';
export default function Admin() {
  const { token, authLoading, isAdmin } = useApp();
  if (authLoading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}><ActivityIndicator /><Text>Đang kiểm tra phiên đăng nhập…</Text></View>;
  if (!token) return <Redirect href="/login" />;
  if (!isAdmin) return <Redirect href="/" />;
  return <Dashboard />;
}
