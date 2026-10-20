import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme/colors';

interface AuthTextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  secureTextEntry?: boolean;
  error?: string;
  editable?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  inputRef?: React.RefObject<TextInput | null>;
}

export default function AuthTextField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  secureTextEntry = false,
  error,
  editable = true,
  onSubmitEditing,
  returnKeyType,
  inputRef,
}: AuthTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const fallbackRef = useRef<TextInput>(null);
  const ref = inputRef || fallbackRef;

  const borderColor = error ? C.danger : focused ? C.primary : C.border;
  const shadowStyle = focused && !error
    ? { shadowColor: C.primary, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 }
    : {};

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.fieldWrapper, { borderColor }, shadowStyle]}>
        {icon && (
          <Ionicons
            name={icon}
            size={20}
            color={focused ? C.primary : C.muted}
            style={styles.leftIcon}
          />
        )}
        <TextInput
          ref={ref}
          style={[styles.input, !icon && { paddingLeft: 16 }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.faint}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          autoComplete={autoComplete}
          secureTextEntry={secureTextEntry && !passwordVisible}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          accessibilityLabel={label}
          accessibilityHint={placeholder}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setPasswordVisible(!passwordVisible)}
            style={styles.eyeButton}
            accessibilityLabel={passwordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            accessibilityRole="button"
          >
            <Ionicons
              name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={C.muted}
            />
          </Pressable>
        )}
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={C.danger} />
          <Text style={styles.errorText} accessibilityRole="alert">{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '700', color: C.ink, marginBottom: 7, marginLeft: 2 },
  fieldWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 14,
    height: 54,
  },
  leftIcon: { marginLeft: 14, marginRight: 10 },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: C.ink,
    paddingRight: 14,
  },
  eyeButton: {
    paddingHorizontal: 14,
    height: '100%',
    justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    marginLeft: 2,
  },
  errorText: { fontSize: 12, color: C.danger, flex: 1 },
});
