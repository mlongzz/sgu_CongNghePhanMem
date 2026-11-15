import React from 'react';
import { router } from 'expo-router';
import ErrorScreen from '../src/components/ErrorScreen';
import { useI18n } from '../src/hooks/useI18n';

export default function NotFound() {
  const { t } = useI18n();
  return <ErrorScreen kind="notFound" t={t} onAction={() => router.replace('/')} />;
}
