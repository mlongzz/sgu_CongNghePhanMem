import React from 'react';
import {SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {PlaceCard, EmptyState} from '../../src/components/UI';
import {useApp} from '../../src/context/AppContext';
import {C} from '../../src/theme/colors';
export default function Saved(){
 const {favorites, places: allPlaces}=useApp(); const places=allPlaces.filter(p=>favorites.includes(p.id));
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
 <View style={s.icon}><Ionicons name="heart" size={21} color={C.primary}/></View>
 <Text style={s.subtitle}>BỘ SƯU TẬP CỦA BẠN</Text><Text style={s.title}>Địa điểm yêu thích</Text><Text style={s.info}>{places.length} địa điểm đã lưu để khám phá sau.</Text>
 {places.length ? <View style={s.list}>{places.map(p=><PlaceCard key={p.id} place={p} wide/>)}</View> : <EmptyState icon="heart-outline" title="Chưa có điểm đến yêu thích" text="Nhấn vào biểu tượng trái tim tại các địa điểm để lưu và quay lại bất cứ lúc nào."/>}
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.paper},page:{padding:22,paddingTop:28,paddingBottom:100},icon:{height:46,width:46,borderRadius:15,backgroundColor:C.primarySoft,justifyContent:'center',alignItems:'center',marginBottom:21},subtitle:{color:C.primary,fontSize:10,fontWeight:'900',letterSpacing:2,marginBottom:7},title:{color:C.ink,fontWeight:'900',fontSize:27,letterSpacing:-.8},info:{color:C.muted,fontSize:13,marginTop:8},list:{marginTop:25}});
