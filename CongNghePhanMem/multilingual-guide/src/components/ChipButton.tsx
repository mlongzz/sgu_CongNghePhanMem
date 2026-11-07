import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme/colors';

type Props = {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Full accessible name; defaults to the visible label. */
  accessibilityLabel?: string;
  tone?: 'soft' | 'solid' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
};

/** Compact pill button used for secondary actions in dense panels. */
export default function ChipButton({ label, onPress, icon, accessibilityLabel, tone = 'soft', disabled, loading, testID }: Props) {
  const fg = tone === 'solid' ? '#fff' : tone === 'danger' ? C.danger : C.primaryDark;
  const off = disabled || loading;
  return <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: !!off, busy: !!loading }}
    disabled={off}
    onPress={onPress}
    style={({ pressed, hovered }) => [s.chip, s[tone], (pressed || hovered) && !off && s[`${tone}Hover`], off && { opacity: .5 }]}
  >
    {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
    <Text numberOfLines={1} style={[s.text, { color: fg }]}>{label}</Text>
  </Pressable>;
}

const s = StyleSheet.create({
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 1 },
  text: { fontSize: 13, fontWeight: '700' },
  soft: { backgroundColor: C.primarySoft },
  softHover: { backgroundColor: '#B5F5E8' },
  solid: { backgroundColor: C.primary },
  solidHover: { backgroundColor: C.primaryDark },
  ghost: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border },
  ghostHover: { backgroundColor: C.paper },
  danger: { backgroundColor: C.dangerSoft },
  dangerHover: { backgroundColor: '#FEE2E2' },
});
