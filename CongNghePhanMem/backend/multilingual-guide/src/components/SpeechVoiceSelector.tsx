import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import type { Language } from '../data/places';
import { createWebSpeechDriver, matchingSpeechVoices, type SpeechVoice } from '../services/speechPlayer';
import { C } from '../theme/colors';
import { useI18n } from '../hooks/useI18n';

type Props = { language: Language; value?: string; onChange: (identifier?: string) => void };

/** Lists real installed voices only; voice availability never claims a translation exists. */
export default function SpeechVoiceSelector({ language, value, onChange }: Props) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<{ language: Language; voices: SpeechVoice[]; error: string } | null>(null);
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const driver = Platform.OS === 'web' ? createWebSpeechDriver() : Speech;
    const request = new Promise<SpeechVoice[]>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Chưa tải được giọng đọc.')), 7000);
      driver.getAvailableVoicesAsync().then(resolve, reject);
    });
    void request.then(voices => {
      if (active) setResult({ language, voices: matchingSpeechVoices(voices, language), error: '' });
    }).catch(() => {
      if (active) setResult({ language, voices: [], error: 'Chưa tải được giọng đọc.' });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, [language, attempt]);
  const current = result?.language === language ? result : null;
  return <View style={styles.container}>
    <Text style={styles.label}>{t('Giọng đọc')}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Chọn giọng đọc')} accessibilityState={{ expanded }}
      style={styles.choice} onPress={() => setExpanded(previous => !previous)}>
      <Text style={styles.text}>{current?.voices.find(voice => voice.identifier === value)?.name || value || t('Tự động chọn giọng phù hợp')}</Text>
    </Pressable>
    {expanded && (!current ? <ActivityIndicator color={C.primary}/> : <>
      <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled><View style={styles.choices}>
        <Pressable accessibilityRole="radio" accessibilityLabel={t('Tự động chọn giọng phù hợp')} accessibilityState={{ selected: !value }}
          style={[styles.choice, !value && styles.selected]} onPress={() => onChange(undefined)}>
          <Text style={styles.text}>{t('Tự động chọn giọng phù hợp')}</Text>
        </Pressable>
        {current.voices.map(voice => <Pressable key={voice.identifier} accessibilityRole="radio"
          accessibilityLabel={`${voice.name || voice.identifier} (${voice.language})`} accessibilityState={{ selected: value === voice.identifier }}
          style={[styles.choice, value === voice.identifier && styles.selected]} onPress={() => onChange(voice.identifier)}>
          <Text style={styles.text}>{voice.name || voice.identifier} · {voice.language}</Text>
        </Pressable>)}
      </View></ScrollView>
      {!current.voices.length && <Text style={styles.hint}>{t(current.error || 'Thiết bị chưa có giọng đọc cho ngôn ngữ này.')}</Text>}
    </>)}
    <Pressable accessibilityRole="button" accessibilityLabel={t('Tải lại giọng đọc')} onPress={() => { setResult(null); setAttempt(value => value + 1); }}>
      <Text style={styles.refresh}>{t('Tải lại giọng đọc')}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 10, marginBottom: 20 }, label: { fontSize: 13, fontWeight: '700', color: C.ink },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderColor: C.border, borderRadius: 12, backgroundColor: C.white, padding: 10, maxWidth: '100%' },
  selected: { borderColor: C.primary, backgroundColor: C.primarySoft }, text: { color: C.ink, fontSize: 12 },
  hint: { color: C.muted, fontSize: 12 }, refresh: { color: C.primary, fontSize: 12 },
});
