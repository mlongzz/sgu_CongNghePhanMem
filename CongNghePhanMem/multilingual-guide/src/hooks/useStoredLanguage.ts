import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANGS, type Language } from '../data/places';

export const LANGUAGE_STORAGE_KEY = 'mg_language_v2';

export function useStoredLanguage(): Language {
  const [language, setLanguage] = useState<Language>('vi');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then(value => {
      const match = LANGS.find(item => item.key === value);
      if (active && match) setLanguage(match.key);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return language;
}
