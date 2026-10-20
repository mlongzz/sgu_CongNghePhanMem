import React, { useEffect, useState } from 'react';
import {
  Animated,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../../theme/colors';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}

const BREAKPOINT = 768;

function DecorativePanel() {
  const icons: { name: keyof typeof Ionicons.glyphMap; size: number; top: string; left: string; opacity: number; rotate: string }[] = [
    { name: 'airplane', size: 38, top: '12%', left: '15%', opacity: 0.15, rotate: '-15deg' },
    { name: 'compass-outline', size: 52, top: '25%', left: '65%', opacity: 0.12, rotate: '20deg' },
    { name: 'map-outline', size: 44, top: '48%', left: '10%', opacity: 0.1, rotate: '10deg' },
    { name: 'globe-outline', size: 60, top: '60%', left: '55%', opacity: 0.08, rotate: '-5deg' },
    { name: 'camera-outline', size: 32, top: '78%', left: '25%', opacity: 0.12, rotate: '25deg' },
    { name: 'location-outline', size: 36, top: '35%', left: '40%', opacity: 0.1, rotate: '-20deg' },
    { name: 'restaurant-outline', size: 28, top: '85%', left: '70%', opacity: 0.1, rotate: '15deg' },
    { name: 'bed-outline', size: 30, top: '15%', left: '80%', opacity: 0.08, rotate: '-10deg' },
  ];

  return (
    <LinearGradient colors={[C.primaryDark, C.primary, '#14B8A6']} style={panelStyles.container}>
      {icons.map((icon, i) => (
        <View
          key={i}
          style={[
            panelStyles.floatingIcon,
            { top: icon.top as unknown as number, left: icon.left as unknown as number, opacity: icon.opacity, transform: [{ rotate: icon.rotate }] },
          ]}
        >
          <Ionicons name={icon.name} size={icon.size} color="#fff" />
        </View>
      ))}
      <View style={panelStyles.content}>
        <View style={panelStyles.logoBox}>
          <Ionicons name="earth" size={48} color="#fff" />
        </View>
        <Text style={panelStyles.appName}>Multilingual Guide</Text>
        <Text style={panelStyles.tagline}>Khám phá thế giới{'\n'}qua từng câu chuyện</Text>
        <View style={panelStyles.divider} />
        <Text style={panelStyles.features}>🗺️ Bản đồ tương tác • 🎧 Thuyết minh AI{'\n'}🌍 Đa ngôn ngữ • 📍 Khám phá lân cận</Text>
      </View>
    </LinearGradient>
  );
}

function MobileHeader() {
  return (
    <View style={mobileStyles.header}>
      <LinearGradient
        colors={[C.primary, C.primaryDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={mobileStyles.logoGradient}
      >
        <Ionicons name="earth" size={28} color="#fff" />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={mobileStyles.appName}>Multilingual Guide</Text>
        <Text style={mobileStyles.tagline}>Khám phá thế giới qua từng câu chuyện</Text>
      </View>
    </View>
  );
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  const [fadeAnim] = useState(() => new Animated.Value(1));
  const [slideAnim] = useState(() => new Animated.Value(0));
  const { width } = useWindowDimensions();
  const isWide = width >= BREAKPOINT;

  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(20);
    const animation = Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [fadeAnim, slideAnim]);

  const formContent = (
    <Animated.View testID="auth-form" style={[styles.formContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }, isWide && styles.formContainerWide]}>
      {!isWide && <MobileHeader />}
      <View style={styles.formHeader}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {children}
    </Animated.View>
  );

  const keyboardBehavior = Platform.OS === 'ios' ? 'padding' as const : Platform.OS === 'android' ? 'height' as const : undefined;

  if (isWide) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.desktopRow}>
          <View style={styles.desktopLeft}>
            <DecorativePanel />
          </View>
          <KeyboardAvoidingView behavior={keyboardBehavior} style={styles.desktopRight}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.desktopScroll}
              showsVerticalScrollIndicator={false}
            >
              {formContent}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={keyboardBehavior} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.mobileScroll}
          showsVerticalScrollIndicator={false}
        >
          {formContent}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  desktopRow: { flex: 1, flexDirection: 'row' },
  desktopLeft: { flex: 1, minWidth: 360, maxWidth: 520 },
  desktopRight: { flex: 1, backgroundColor: C.paper },
  desktopScroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  mobileScroll: { flexGrow: 1, padding: 24, paddingTop: 16, paddingBottom: 40 },
  formContainer: { width: '100%' },
  formContainerWide: { maxWidth: 440 },
  formHeader: { marginBottom: 28 },
  title: { fontSize: 28, fontWeight: '800', color: C.ink, letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: C.muted, lineHeight: 22 },
});

const panelStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  floatingIcon: { position: 'absolute' },
  content: { alignItems: 'center', zIndex: 1, padding: 40 },
  logoBox: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  appName: { fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: -0.5, marginBottom: 12 },
  tagline: { fontSize: 18, color: 'rgba(255,255,255,0.9)', textAlign: 'center', lineHeight: 28, fontWeight: '500' },
  divider: { width: 50, height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, marginVertical: 24 },
  features: { fontSize: 13, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 22 },
});

const mobileStyles = StyleSheet.create({
  header: { flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 32 },
  logoGradient: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  appName: { fontSize: 18, fontWeight: '800', color: C.ink },
  tagline: { fontSize: 12, color: C.muted, marginTop: 2 },
});
