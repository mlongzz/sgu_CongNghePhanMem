import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import MapView, {Marker, Circle, PROVIDER_GOOGLE, type Region} from 'react-native-maps';
import {Ionicons} from '@expo/vector-icons';
import {router} from 'expo-router';
import AutoGuideControl from "./AutoGuideControl";
import PlaceImage from "./PlaceImage";
import {C} from '../theme/colors';
import {useApp} from '../context/AppContext';
import type {Place} from '../data/places';
const INITIAL: Region = {latitude:10.7764,longitude:106.6993,latitudeDelta:.05,longitudeDelta:.05};
const RADII=[1,3,5,10,20];
export default function MapScreen(){
  const mapRef=useRef<MapView>(null);
  const {places,location,radiusKm,setRadiusKm,refreshNearby,loadingPlaces,placesError,language,source}=useApp();
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=places.find(p=>p.id===selectedId)??places[0]??null;
  useEffect(()=>{if(location)mapRef.current?.animateToRegion({latitude:location.latitude,longitude:location.longitude,latitudeDelta:Math.max(.02,radiusKm/55),longitudeDelta:Math.max(.02,radiusKm/55)},600);},[location,radiusKm]);
  const choose=(place:Place)=>{setSelectedId(place.id);mapRef.current?.animateToRegion({latitude:place.latitude,longitude:place.longitude,latitudeDelta:.018,longitudeDelta:.018},400);};
  const directions=()=>{if(!selected)return; void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude}%2C${selected.longitude}&travelmode=walking`).catch(()=>Alert.alert('Lỗi','Không mở được Google Maps.'));};
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.header}><View style={{flex:1}}><Text style={s.overline}>BẢN ĐỒ GPS</Text><Text style={s.title}>Khám phá gần tôi</Text><Text style={s.sub}>{places.length} địa điểm · bán kính {radiusKm} km {source==='demo'?'(demo)':''}</Text></View><Pressable disabled={loadingPlaces} onPress={()=>void refreshNearby()} style={s.locate}>{loadingPlaces?<ActivityIndicator color={C.primary}/>:<Ionicons name="locate" size={22} color={C.primary}/>}</Pressable></View>
    <ScrollView horizontal style={{flexGrow:0}} showsHorizontalScrollIndicator={false} contentContainerStyle={s.radiusList}>{RADII.map(km=><Pressable key={km} onPress={()=>setRadiusKm(km)} style={[s.radius,km===radiusKm&&s.radiusActive]}><Text style={[s.radiusText,km===radiusKm&&s.radiusTextActive]}>{km} km</Text></Pressable>)}</ScrollView>
    <View style={s.mapBox}>
      <MapView provider={Platform.OS==='android'||process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY?PROVIDER_GOOGLE:undefined} ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={location?{latitude:location.latitude,longitude:location.longitude,latitudeDelta:.05,longitudeDelta:.05}:INITIAL} showsCompass showsUserLocation={!!location}>
        {location?<Circle center={location} radius={radiusKm*1000} strokeColor="rgba(23,138,122,.9)" fillColor="rgba(23,138,122,.09)" />:null}
        {places.map(place=><Marker key={place.id} coordinate={{latitude:place.latitude,longitude:place.longitude}} title={place.title} description={place.subtitle[language]} onPress={()=>choose(place)} pinColor={C.primary}/>)}
      </MapView>
      <View style={s.overlay}><Ionicons name="navigate-outline" size={16} color={C.primary}/><Text style={s.overlayText}>{location?'Khu vực quanh vị trí của bạn':'Nhấn định vị để tìm gần bạn'}</Text></View>
    </View>
    {placesError?<Text style={s.error} numberOfLines={2}>{placesError}</Text>:null}
    <AutoGuideControl/><Text style={s.browse}>Các địa điểm tìm được</Text>
    <ScrollView horizontal style={{flexGrow:0}} showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10,paddingBottom:12}}>{places.map(p=><Pressable key={p.id} onPress={()=>choose(p)} style={[s.smallCard,selected?.id===p.id&&s.smallActive]}><PlaceImage uri={p.image} style={s.thumb}/><Text numberOfLines={1} style={s.itemText}>{p.title}</Text></Pressable>)}</ScrollView>
    {selected?<View style={s.selected}><View style={{flex:1}}><Text style={s.selectedCategory}>{selected.category} · {selected.district}</Text><Text style={s.selectedTitle} numberOfLines={2}>{selected.title}</Text></View><Pressable onPress={()=>router.push(`/place/${selected.id}` as never)} style={s.next}><Ionicons name="arrow-forward" size={21} color="#fff"/></Pressable></View>:<Text style={s.error}>Không có địa điểm trong bán kính này.</Text>}
    <Pressable disabled={!selected} onPress={directions} style={[s.directions,!selected&&{opacity:.4}]}><Ionicons name="navigate" size={18} color="#fff"/><Text style={s.directionText}>Chỉ đường trên Google Maps</Text></Pressable>
    {source==='live'?<Text style={s.credit}>© OpenStreetMap contributors · Dữ liệu địa điểm</Text>:null}
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.paper},page:{flexGrow:1,padding:16,paddingBottom:9},header:{flexDirection:'row',alignItems:'center',gap:10},overline:{fontSize:10,color:C.primary,fontWeight:'900',letterSpacing:1.3},title:{fontSize:24,color:C.ink,fontWeight:'900',marginTop:4},sub:{color:C.muted,fontSize:11,marginTop:5},locate:{backgroundColor:C.primarySoft,borderRadius:13,padding:12},radiusList:{gap:8,paddingVertical:12},radius:{borderWidth:1,borderColor:C.border,borderRadius:20,paddingVertical:10,paddingHorizontal:17,backgroundColor:C.white},radiusActive:{backgroundColor:C.primary,borderColor:C.primary},radiusText:{color:C.ink,fontWeight:'800',fontSize:12},radiusTextActive:{color:'#fff'},mapBox:{height:320,minHeight:190,overflow:'hidden',borderRadius:22,backgroundColor:'#DDE9E5'},overlay:{position:'absolute',left:12,top:12,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#fff',padding:10,borderRadius:17},overlayText:{fontSize:10,fontWeight:'700',color:C.primary},error:{color:C.danger,fontSize:11,marginTop:7},browse:{marginTop:13,marginBottom:10,fontSize:15,fontWeight:'800',color:C.ink},smallCard:{width:126,backgroundColor:C.white,borderWidth:1,borderColor:C.border,padding:6,borderRadius:13},smallActive:{borderColor:C.primary,backgroundColor:C.primarySoft},thumb:{width:'100%',height:58,borderRadius:8},itemText:{color:C.ink,fontSize:10,fontWeight:'800',marginTop:6},selected:{flexDirection:'row',gap:12,alignItems:'center',padding:12,backgroundColor:C.white,borderRadius:15,borderColor:C.border,borderWidth:1},selectedCategory:{color:C.primary,fontSize:10,fontWeight:'800'},selectedTitle:{fontSize:14,fontWeight:'900',color:C.ink,marginTop:4},next:{width:40,height:40,backgroundColor:C.primary,alignItems:'center',justifyContent:'center',borderRadius:12},directions:{backgroundColor:C.primary,padding:14,borderRadius:14,flexDirection:'row',justifyContent:'center',gap:10,marginTop:9},directionText:{color:'#fff',fontWeight:'800',fontSize:12},credit:{fontSize:9,color:C.muted,textAlign:'center',marginTop:4}});
