import React from 'react';
import {ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {router} from 'expo-router';
import {C} from '../theme/colors';
import {useApp} from '../context/AppContext';
import {distanceKm} from '../services/nearby';
const RADII=[1,3,5,10,20];
export default function MapScreen(){
  const {places,location,radiusKm,setRadiusKm,refreshNearby,loadingPlaces,placesError,source}=useApp();
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <Text style={s.eyebrow}>KHÁM PHÁ THEO VỊ TRÍ</Text><Text style={s.title}>Địa danh quanh bạn</Text>
    <Text style={s.text}>Chọn bán kính và bấm Tìm địa điểm. Phiên bản web sử dụng danh sách và liên kết Google Maps; bản đồ ghim tương tác hiển thị trên iOS/Android.</Text>
    <View style={s.card}><Text style={s.label}>Bán kính từ GPS</Text><View style={s.radii}>{RADII.map(km=><Pressable key={km} onPress={()=>setRadiusKm(km)} style={[s.radius,radiusKm===km&&s.active]}><Text style={{color:radiusKm===km?'#fff':C.primary,fontWeight:'800'}}>{km} km</Text></Pressable>)}</View>
      <Pressable disabled={loadingPlaces} onPress={()=>void refreshNearby()} style={s.button}>{loadingPlaces?<ActivityIndicator color="#fff"/>:<Ionicons name="locate" color="#fff" size={18}/>}<Text style={s.buttonText}>{loadingPlaces?'Đang tìm...':'Dùng GPS và tìm địa danh'}</Text></Pressable>
      {placesError?<Text style={s.error}>{placesError}</Text>:null}
      <Text style={s.small}>Kết quả: {places.length} · nguồn: {source==='live'?'OpenStreetMap/Backend':'mẫu hoặc dự phòng'}</Text>
    </View>
    {places.map(p=><View key={p.id} style={s.place}><View style={{flex:1}}><Text style={s.placeTitle}>{p.title}</Text><Text style={s.small}>{p.category} · {location?distanceKm(location,p).toFixed(1)+' km':'Chưa xác định GPS'}</Text></View><Pressable onPress={()=>router.push(`/place/${p.id}` as never)} style={s.round}><Ionicons name="book-outline" size={19} color={C.primary}/></Pressable><Pressable onPress={()=>void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.latitude+','+p.longitude)}`)} style={s.round}><Ionicons name="map-outline" size={19} color={C.primary}/></Pressable></View>)}
    {source==='live'?<Text style={s.credit}>© OpenStreetMap contributors (ODbL)</Text>:null}
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.paper},page:{padding:22,paddingBottom:100},eyebrow:{fontSize:10,color:C.primary,fontWeight:'900',letterSpacing:2},title:{fontSize:26,fontWeight:'900',color:C.ink,marginTop:9,marginBottom:10},text:{fontSize:13,lineHeight:22,color:C.muted,marginBottom:16},card:{backgroundColor:C.white,borderRadius:20,padding:17,borderWidth:1,borderColor:C.border,marginBottom:20},label:{fontWeight:'900',color:C.ink,marginBottom:13},radii:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:18},radius:{backgroundColor:C.primarySoft,padding:12,borderRadius:15},active:{backgroundColor:C.primary},button:{backgroundColor:C.primary,flexDirection:'row',gap:10,alignItems:'center',justifyContent:'center',borderRadius:13,padding:15},buttonText:{color:'#fff',fontWeight:'900'},small:{fontSize:11,color:C.muted,marginTop:5},error:{color:C.danger,fontSize:12,lineHeight:20,marginTop:12},place:{flexDirection:'row',alignItems:'center',gap:10,padding:13,borderWidth:1,borderColor:C.border,borderRadius:14,backgroundColor:C.white,marginBottom:10},placeTitle:{color:C.ink,fontWeight:'900',fontSize:13},round:{backgroundColor:C.primarySoft,borderRadius:12,padding:12},credit:{textAlign:'center',fontSize:10,color:C.muted,marginTop:16}});
