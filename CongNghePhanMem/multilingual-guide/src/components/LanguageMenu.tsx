import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useI18n } from '../hooks/useI18n';
import { LANGS } from '../data/places';
import { C } from '../theme/colors';

export default function LanguageMenu() {
  const { language, setLanguage } = useApp();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Chọn ngôn ngữ')} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={s.trigger}>
      <Ionicons name="globe-outline" size={20} color={C.primaryDark} /><Text style={s.code}>{language.toUpperCase()}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.overlay}><View accessibilityViewIsModal style={s.dialog}>
        <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{t('Chọn ngôn ngữ')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Đóng')} onPress={() => setOpen(false)} style={s.close}><Ionicons name="close" size={23} color={C.ink} /></Pressable></View>
        {LANGS.map(lang => <Pressable key={lang.key} accessibilityRole="radio" accessibilityState={{ selected: language === lang.key }} accessibilityLabel={lang.label} onPress={() => { setLanguage(lang.key); setOpen(false); }} style={[s.option, language === lang.key && s.selected]}><Text style={s.label}>{lang.label}</Text>{language === lang.key && <Ionicons name="checkmark" size={22} color={C.primary} />}</Pressable>)}
      </View></View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  trigger: { minHeight: 44, paddingHorizontal: 12, gap: 7, flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: C.primarySoft },
  code: { color: C.primaryDark, fontSize: 12, fontWeight: '800' },
  overlay: { flex: 1, backgroundColor: 'rgba(12,36,48,.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: C.white, borderRadius: 24, padding: 22, gap: 9 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: C.ink, fontSize: 19, fontWeight: '800', flex: 1 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  option: { minHeight: 50, borderRadius: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selected: { backgroundColor: C.primarySoft },
  label: { color: C.ink, fontWeight: '600', fontSize: 15 },
});
