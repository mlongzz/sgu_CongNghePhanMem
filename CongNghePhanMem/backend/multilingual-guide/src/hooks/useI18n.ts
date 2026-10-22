import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { translateUi } from '../services/i18n';

export function useI18n() {
  const { language } = useApp();
  const t = useCallback((text: string) => translateUi(language, text), [language]);
  return { t, language };
}
