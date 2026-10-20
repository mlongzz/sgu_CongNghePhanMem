import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme/colors';

const LANGUAGES = [
  { key: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { key: 'en', label: 'English', flag: '🇬🇧' },
  { key: 'fr', label: 'Français', flag: '🇫🇷' },
  { key: 'ja', label: '日本語', flag: '🇯🇵' },
];

interface LanguageSelectorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
}

export default function LanguageSelector({
  value,
  onChange,
  label = 'Ngôn ngữ ưu tiên',
  error,
}: LanguageSelectorProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {LANGUAGES.map((lang) => {
          const selected = value === lang.key;
          return (
            <Pressable
              key={lang.key}
              onPress={() => onChange(lang.key)}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={lang.label}
            >
              <Text style={styles.flag}>{lang.flag}</Text>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {lang.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={C.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', color: C.ink, marginBottom: 8, marginLeft: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.white,
  },
  chipSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  flag: { fontSize: 16 },
  chipText: { fontSize: 13, fontWeight: '600', color: C.ink },
  chipTextSelected: { color: '#fff' },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    marginLeft: 2,
  },
  errorText: { fontSize: 12, color: C.danger, flex: 1 },
});
