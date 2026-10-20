import React, { useRef, useState } from 'react';
import { Link, Redirect, router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AuthLayout, AuthTextField, PrimaryButton, LanguageSelector, PasswordStrength } from './index';
import { useApp } from '../../context/AppContext';
import { registerUser, signIn } from '../../services/api';
import { validateAuth } from '../../services/authValidation';
import { type Language } from '../../data/places';
import { C } from '../../theme/colors';

export function AuthScreen({ register = false }: { register?: boolean }) {
  const { token, authLoading, isAdmin, loginWithTokens, setLanguage } = useApp();
  const params = useLocalSearchParams<{ registered?: string; email?: string }>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [language, chooseLanguage] = useState('vi');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const submit = async () => {
    if (submitting.current || authLoading) return;
    const next = validateAuth({ register, name, email, password, confirm });
    setErrors(next); setError('');
    if (Object.keys(next).length) return;
    submitting.current = true; setBusy(true);
    try {
      if (register) {
        await registerUser(name.trim(), email.trim(), password, language);
        setLanguage(language as Language);
        router.replace({ pathname: '/login', params: { registered: '1', email: email.trim() } });
      } else {
        const result = await signIn(email.trim(), password);
        if (!result.access_token) throw new Error('Không thể đăng nhập. Vui lòng thử lại.');
        await loginWithTokens(result.access_token, result.refresh_token);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể hoàn tất. Vui lòng thử lại.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (!authLoading && token) return <Redirect href={isAdmin ? '/admin' : '/'} />;
  return <AuthLayout title={register ? 'Bắt đầu hành trình của bạn' : 'Chào mừng trở lại'} subtitle={register ? 'Tạo tài khoản để khám phá những câu chuyện ở mỗi điểm đến.' : 'Đăng nhập để tiếp tục khám phá cùng Multilingual Guide.'}>
    <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ minHeight: 44, justifyContent: 'center', marginBottom: 12 }}><Text style={{ color: C.primary }}>← Quay lại khám phá</Text></Pressable>
    {!register && params.registered === '1' && <Text accessibilityRole="alert" style={{ color: C.primaryDark, backgroundColor: C.successSoft, padding: 14, borderRadius: 12, marginBottom: 18 }}>Đăng ký thành công! Bạn có thể đăng nhập ngay.</Text>}
    {register && <AuthTextField label="Họ và tên" icon="person-outline" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" error={errors.name} editable={!busy} />}
    <AuthTextField label="Địa chỉ email" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" error={errors.email} editable={!busy} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
    <AuthTextField label="Mật khẩu" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry autoComplete={register ? 'new-password' : 'current-password'} error={errors.password} editable={!busy} inputRef={passwordRef} returnKeyType={register ? 'next' : 'go'} onSubmitEditing={() => register ? confirmRef.current?.focus() : void submit()} />
    {register && <><PasswordStrength password={password} /><Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>Sử dụng từ 8 đến 128 ký tự. Thanh đánh giá chỉ mang tính gợi ý.</Text><AuthTextField label="Xác nhận mật khẩu" icon="shield-checkmark-outline" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" error={errors.confirm} editable={!busy} inputRef={confirmRef} returnKeyType="go" onSubmitEditing={() => void submit()} /><LanguageSelector value={language} onChange={v => { if (!busy) chooseLanguage(v); }} /></>}
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: C.danger, backgroundColor: C.dangerSoft, padding: 14, borderRadius: 12, marginBottom: 16 }}>{error}</Text>}
    <PrimaryButton title={register ? 'Tạo tài khoản' : 'Đăng nhập'} loading={busy || authLoading} onPress={() => void submit()} icon="arrow-forward" />
    <View style={{ marginTop: 24, alignItems: 'center', gap: 8 }}><Text style={{ color: C.muted }}>{register ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}</Text><Link href={register ? '/login' : '/register'} replace style={{ color: C.primaryDark, fontWeight: '700', padding: 12 }}>{register ? 'Đăng nhập' : 'Đăng ký ngay'}</Link></View>
  </AuthLayout>;
}
