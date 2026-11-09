import React from 'react';
import {Tabs} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {C} from '../../src/theme/colors';

export default function TabLayout() {
  const icons:Record<string, keyof typeof Ionicons.glyphMap> = {index:'compass',map:'map',saved:'heart',profile:'person-circle'};
  return <Tabs screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:C.primary,tabBarInactiveTintColor:C.faint,tabBarLabelStyle:{fontSize:11,fontWeight:'700',marginBottom:4},tabBarStyle:{height:70,paddingTop:7,borderTopWidth:0,backgroundColor:C.white,elevation:10,shadowColor:C.shadow,shadowOpacity:.06,shadowRadius:12},tabBarIcon:({color,focused})=><Ionicons name={focused?icons[route.name]:({index:'compass-outline',map:'map-outline',saved:'heart-outline',profile:'person-circle-outline'} as Record<string,keyof typeof Ionicons.glyphMap>)[route.name]} color={color} size={22}/>})}>
    <Tabs.Screen name="index" options={{title:'Khám phá'}}/>
    <Tabs.Screen name="map" options={{title:'Bản đồ'}}/>
    <Tabs.Screen name="saved" options={{title:'Yêu thích'}}/>
    <Tabs.Screen name="profile" options={{title:'Cá nhân'}}/>
  </Tabs>;
}
