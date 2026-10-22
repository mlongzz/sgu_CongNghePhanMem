import React from 'react';
import {Tabs} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {C} from '../../src/theme/colors';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LanguageMenu from '../../src/components/LanguageMenu';
import { useI18n } from '../../src/hooks/useI18n';

export default function TabLayout() {
  const { t } = useI18n();
  const icons:Record<string, keyof typeof Ionicons.glyphMap> = {index:'compass',map:'map',saved:'heart',profile:'person-circle'};
  return <View style={{ flex: 1, backgroundColor: C.paper }}><SafeAreaView edges={['top']} style={{ backgroundColor: C.white }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 4 }}><Text style={{ color: C.ink, fontWeight: '800', fontSize: 15 }}>◈ Multilingual Guide</Text><LanguageMenu /></View></SafeAreaView><Tabs screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:C.primary,tabBarInactiveTintColor:C.faint,tabBarLabelStyle:{fontSize:11,fontWeight:'700',marginBottom:4},tabBarStyle:{height:70,paddingTop:7,borderTopWidth:0,backgroundColor:C.white,elevation:10,shadowColor:C.shadow,shadowOpacity:.06,shadowRadius:12},tabBarIcon:({color,focused})=><Ionicons name={focused?icons[route.name]:({index:'compass-outline',map:'map-outline',saved:'heart-outline',profile:'person-circle-outline'} as Record<string,keyof typeof Ionicons.glyphMap>)[route.name]} color={color} size={22}/>})}>
    <Tabs.Screen name="index" options={{title:t('Khám phá')}}/>
    <Tabs.Screen name="map" options={{title:t('Bản đồ')}}/>
    <Tabs.Screen name="saved" options={{title:t('Yêu thích')}}/>
    <Tabs.Screen name="profile" options={{title:t('Cá nhân')}}/>
  </Tabs></View>;
}
