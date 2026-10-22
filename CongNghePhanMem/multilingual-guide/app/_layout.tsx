import React from 'react';
import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {AppProvider} from '../src/context/AppContext';
import {C} from '../src/theme/colors';

export default function RootLayout(){
  return <AppProvider><StatusBar style="dark" /><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:C.paper}}} /></AppProvider>;
}
