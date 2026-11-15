import { Pressable, Text, View } from 'react-native';
import { C } from '../theme/colors';

export type ErrorScreenKind = 'error' | 'notFound';

const copy: Record<ErrorScreenKind, { title: string; message: string; action: string }> = {
  error: {
    title: 'Đã xảy ra lỗi',
    message: 'Ứng dụng gặp sự cố không mong muốn. Hãy thử lại.',
    action: 'Thử lại',
  },
  notFound: {
    title: 'Không tìm thấy trang',
    message: 'Trang bạn mở không tồn tại hoặc đã được di chuyển.',
    action: 'Về Trang chủ',
  },
};

export default function ErrorScreen({ kind, t, onAction }: { kind: ErrorScreenKind; t: (text: string) => string; onAction: () => void }) {
  const text = copy[kind];
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, backgroundColor: C.paper }}>
    <Text accessibilityRole="header" style={{ color: C.ink, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{t(text.title)}</Text>
    <Text style={{ color: C.muted, lineHeight: 22, textAlign: 'center' }}>{t(text.message)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t(text.action)} onPress={onAction} style={{ backgroundColor: C.primary, paddingVertical: 13, paddingHorizontal: 22, borderRadius: 12 }}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>{t(text.action)}</Text>
    </Pressable>
  </View>;
}
