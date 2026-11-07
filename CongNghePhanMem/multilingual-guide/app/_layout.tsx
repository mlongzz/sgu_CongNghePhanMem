import React from 'react';
import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {AppProvider} from '../src/context/AppContext';
import {JourneyProvider} from '../src/context/JourneyContext';
import {C} from '../src/theme/colors';
import PresenceBoundary from '../src/components/PresenceBoundary';
import {useFonts} from 'expo-font';
import {Ionicons} from '@expo/vector-icons';
import {installWebGlobalStyles} from '../src/theme/webGlobalStyles';

installWebGlobalStyles();

export default function RootLayout(){
  // Register icon glyphs during static rendering, before their first client render.
  useFonts(Ionicons.font);
  return <AppProvider><JourneyProvider><PresenceBoundary><StatusBar style="dark" /><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:C.paper}}} /></PresenceBoundary></JourneyProvider></AppProvider>;
}
