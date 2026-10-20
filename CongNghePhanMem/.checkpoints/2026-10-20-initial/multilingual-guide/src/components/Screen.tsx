import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../theme/colors';

export const panel: StyleProp<ViewStyle> = { padding: 18, backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.border, gap: 12 };
export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 60, gap: 20, width: '100%', maxWidth: 860, alignSelf: 'center' }}>
    <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: C.primaryDark }}>← Quay lại</Text></Pressable>
    <Text accessibilityRole="header" style={{ color: C.ink, fontSize: 27, fontWeight: '800' }}>{title}</Text>{children}
  </ScrollView></SafeAreaView>;
}
export function LoadingState() { return <View style={{ padding: 28, alignItems: 'center', gap: 12 }}><ActivityIndicator color={C.primary} /><Text style={{ color: C.muted }}>Đang tải…</Text></View>; }
export function ErrorMessage({ message }: { message: string }) { return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: C.danger, lineHeight: 22 }}>{message}</Text> : null; }
