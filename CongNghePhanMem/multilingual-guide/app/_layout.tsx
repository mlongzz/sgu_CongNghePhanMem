import React from 'react';
import {Stack, type ErrorBoundaryProps} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {AppProvider} from '../src/context/AppContext';
import {JourneyProvider} from '../src/context/JourneyContext';
import {C} from '../src/theme/colors';
import PresenceBoundary from '../src/components/PresenceBoundary';
import {useFonts} from 'expo-font';
import {Ionicons} from '@expo/vector-icons';
import ErrorScreen from '../src/components/ErrorScreen';
import {useStoredLanguage} from '../src/hooks/useStoredLanguage';
import {translateUi} from '../src/services/i18n';
import {installWebGlobalStyles} from '../src/theme/webGlobalStyles';

installWebGlobalStyles();

export function ErrorBoundary({retry}:ErrorBoundaryProps){
  const language=useStoredLanguage();
  return <ErrorScreen kind="error" t={text=>translateUi(language,text)} onAction={()=>{void retry();}} />;
}

export default function RootLayout(){
  // Register icon glyphs during static rendering, before their first client render.
  useFonts(Ionicons.font);
  return <AppProvider><JourneyProvider><PresenceBoundary><StatusBar style="dark" /><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:C.paper}}} /></PresenceBoundary></JourneyProvider></AppProvider>;
}
