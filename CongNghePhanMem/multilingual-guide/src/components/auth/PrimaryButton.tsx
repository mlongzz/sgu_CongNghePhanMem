import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme/colors';
import { useI18n } from '../../hooks/useI18n';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'outline';
}

export default function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  icon,
  variant = 'primary',
}: PrimaryButtonProps) {
  const { t } = useI18n();
  const isDisabled = disabled || loading;
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed, hovered }) => [
        styles.button,
        isPrimary ? styles.primaryBg : styles.outlineBg,
        isDisabled && styles.disabled,
        pressed && (isPrimary ? styles.primaryPressed : styles.outlinePressed),
        hovered && !isDisabled && (isPrimary ? styles.primaryHover : styles.outlineHover),
      ]}
      accessibilityRole="button"
      accessibilityLabel={t(title)}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : C.primary} size="small" />
      ) : (
        <>
          <Text style={[styles.text, !isPrimary && styles.outlineText]}>{t(title)}</Text>
          {icon && <Ionicons name={icon} size={18} color={isPrimary ? '#fff' : C.primary} />}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  primaryBg: { backgroundColor: C.primary },
  outlineBg: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: C.primary,
  },
  disabled: { opacity: 0.5 },
  primaryPressed: { backgroundColor: C.primaryDark },
  outlinePressed: { backgroundColor: C.primarySoft },
  primaryHover: { backgroundColor: C.primaryDark },
  outlineHover: { backgroundColor: C.primarySoft },
  text: { fontSize: 15, fontWeight: '800', color: '#fff', textAlign: 'center' },
  outlineText: { color: C.primary },
});
