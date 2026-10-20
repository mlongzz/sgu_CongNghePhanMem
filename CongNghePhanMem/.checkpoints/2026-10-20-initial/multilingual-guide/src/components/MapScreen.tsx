import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import MapView, {Marker, Circle, PROVIDER_GOOGLE, type Region} from 'react-native-maps';
import {Ionicons} from '@expo/vector-icons';
import {router, useFocusEffect} from 'expo-router';
import AutoGuideControl from "./AutoGuideControl";
import PlaceImage from "./PlaceImage";
import {C} from '../theme/colors';
import {useApp} from '../context/AppContext';
import type {Place} from '../data/places';
import {API_BASE_URL} from '../services/api';
import {fetchOsmExploreResult, osmExploreKey} from '../services/nearby';
import {fetchWikipediaNearby, wikipediaNearbyKey} from '../services/wikipedia';
import {mergeNearbyPlaces} from '../services/nearbyMerge';
const INITIAL: Region = {latitude:10.7764,longitude:106.6993,latitudeDelta:.05,longitudeDelta:.05};
const RADII=[1,3,5,10,20];
export default function MapScreen(){
  const mapRef=useRef<MapView>(null);
  const {places,location,locationSource,locationProgress,nearbyStatus,cancelLocation,radiusKm,setRadiusKm,refreshNearby,loadingPlaces,placesError,language,registerPlace}=useApp();
  const [focused,setFocused]=useState(true);
  const [active,setActive]=useState(AppState.currentState==='active');
  const acquiring=useRef(false);
  const cancelPendingGps=useCallback(()=>{if(acquiring.current){acquiring.current=false;cancelLocation();}},[cancelLocation]);
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>{setFocused(false);cancelPendingGps();};},[cancelPendingGps]));
  useEffect(()=>{const listener=AppState.addEventListener('change',state=>{setActive(state==='active');if(state!=='active')cancelPendingGps();});return()=>listener.remove();},[cancelPendingGps]);
  const [wikiMode,setWikiMode]=useState<'auto'|'on'|'off'>('auto');
  const [retry,setRetry]=useState(0);
  const [osm,setOsm]=useState({key:'',places:[] as Place[],warning:'',error:''});
  const [wiki,setWiki]=useState({key:'',places:[] as Place[],warning:'',error:''});
  const latitude=location?.latitude; const longitude=location?.longitude;
  const coordinates=useMemo(()=>typeof latitude==='number'&&typeof longitude==='number'?{latitude,longitude}:null,[latitude,longitude]);
  const isLocating=nearbyStatus==='locating';
  useEffect(()=>{acquiring.current=isLocating;},[isLocating]);
  const canSearch=focused&&active&&!isLocating&&nearbyStatus!=='location-error'&&!!coordinates;
  const osmKey=canSearch&&API_BASE_URL?`${osmExploreKey(coordinates!,radiusKm)}:${retry}`:'';
  const wikiKey=canSearch&&wikiMode==='on'?`${wikipediaNearbyKey(coordinates!,radiusKm)}:${retry}`:'';
  useEffect(()=>{
    if(!osmKey||!coordinates)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{void(async()=>{
      try {const result=await fetchOsmExploreResult(coordinates,radiusKm,{signal:controller.signal});if(!controller.signal.aborted)setOsm({key:osmKey,places:result.places,warning:result.warning,error:''});}
      catch(error){if(!controller.signal.aborted)setOsm({key:osmKey,places:[],warning:'',error:error instanceof Error?error.message:'Không tải được OpenStreetMap.'});}
    })();},150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[coordinates,radiusKm,osmKey]);
  useEffect(()=>{
    if(!wikiKey||!coordinates)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{void(async()=>{
      try {const result=await fetchWikipediaNearby(coordinates,radiusKm,{signal:controller.signal});if(!controller.signal.aborted)setWiki({key:wikiKey,places:result.places,warning:result.warning,error:''});}
      catch(error){if(!controller.signal.aborted)setWiki({key:wikiKey,places:[],warning:'',error:error instanceof Error?error.message:'Không tải được Wikipedia.'});}
    })();},150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[coordinates,radiusKm,wikiKey]);
  const osmPlaces=useMemo(()=>osmKey&&osm.key===osmKey?osm.places:[],[osmKey,osm.key,osm.places]);
  const wikiPlaces=useMemo(()=>wikiKey&&wiki.key===wikiKey?wiki.places:[],[wikiKey,wiki.key,wiki.places]);
  const allPlaces=useMemo(()=>mergeNearbyPlaces([places,osmPlaces,wikiPlaces],location,radiusKm),[places,osmPlaces,wikiPlaces,location,radiusKm]);
  const osmLoading=!!osmKey&&osm.key!==osmKey;
  const wikiLoading=!!wikiKey&&wiki.key!==wikiKey;
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=allPlaces.find(p=>p.id===selectedId)??allPlaces[0]??null;
  const locate=async()=>{setSelectedId(null);setRetry(v=>v+1);if(wikiMode!=='off')setWikiMode('on');await refreshNearby();};
  const searchWikipedia=async()=>{setWikiMode('on');setRetry(v=>v+1);if(!location||nearbyStatus==='location-error')await refreshNearby();};
  useEffect(()=>{if(location)mapRef.current?.animateToRegion({latitude:location.latitude,longitude:location.longitude,latitudeDelta:Math.max(.02,radiusKm/55),longitudeDelta:Math.max(.02,radiusKm/55)},600);},[location,radiusKm]);
  const choose=(place:Place)=>{setSelectedId(place.id);mapRef.current?.animateToRegion({latitude:place.latitude,longitude:place.longitude,latitudeDelta:.018,longitudeDelta:.018},400);};
  const directions=()=>{if(!selected)return; void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude}%2C${selected.longitude}&travelmode=walking`).catch(()=>Alert.alert('Lỗi','Không mở được Google Maps.'));};
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.header}><View style={{flex:1}}><Text style={s.overline}>BẢN ĐỒ GPS</Text><Text style={s.title}>Khám phá gần tôi</Text><Text style={s.sub}>{allPlaces.length} địa điểm · bán kính {radiusKm} km</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Dùng GPS và tìm địa danh" disabled={loadingPlaces} onPress={()=>void locate()} style={s.locate}>{loadingPlaces?<ActivityIndicator color={C.primary}/>:<Ionicons name="locate" size={22} color={C.primary}/>}</Pressable></View>
    <ScrollView horizontal style={{flexGrow:0}} showsHorizontalScrollIndicator={false} contentContainerStyle={s.radiusList}>{RADII.map(km=><Pressable key={km} accessibilityRole="button" accessibilityLabel={`Bán kính ${km} km`} onPress={()=>{setSelectedId(null);setRadiusKm(km);if(location&&!isLocating)void refreshNearby({radiusKm:km,reuseLocation:true});}} style={[s.radius,km===radiusKm&&s.radiusActive]}><Text style={[s.radiusText,km===radiusKm&&s.radiusTextActive]}>{km} km</Text></Pressable>)}</ScrollView>
    <Text style={s.sub}>{location?locationSource==='manual'?'Vị trí đã nhập · Không dùng GPS':`GPS: Đã có vị trí${typeof location.accuracy==='number'?` · Sai số khoảng ${Math.round(location.accuracy)} m`:''}${location.timestamp?` · Lấy lúc ${new Date(location.timestamp).toLocaleTimeString()}`:''}`:'GPS: Chưa có vị trí'}</Text>
    {locationSource==='gps'&&typeof location?.accuracy==='number'&&location.accuracy>100?<Text style={s.sub}>Vị trí có sai số lớn; khoảng cách và danh sách địa điểm chỉ mang tính gần đúng. Có thể lấy GPS lại ở nơi thoáng hơn.</Text>:null}
    {isLocating?<View><Text style={s.sub}>{locationProgress}</Text><Pressable accessibilityRole="button" onPress={cancelLocation}><Text style={s.error}>Hủy lấy GPS</Text></Pressable></View>:null}
    <View style={s.mapBox}>
      <MapView provider={Platform.OS==='android'||process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY?PROVIDER_GOOGLE:undefined} ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={location?{latitude:location.latitude,longitude:location.longitude,latitudeDelta:.05,longitudeDelta:.05}:INITIAL} showsCompass showsUserLocation={!!location}>
        {location?<Circle center={location} radius={radiusKm*1000} strokeColor="rgba(23,138,122,.9)" fillColor="rgba(23,138,122,.09)" />:null}
        {allPlaces.map(place=><Marker key={place.id} coordinate={{latitude:place.latitude,longitude:place.longitude}} title={place.title} description={place.subtitle[language]} onPress={()=>choose(place)} pinColor={place.source==='backend'?C.primary:place.source==='wikipedia'?'#d97706':'#8b5cf6'}/>)}
      </MapView>
      <View style={s.overlay}><Ionicons name="navigate-outline" size={16} color={C.primary}/><Text style={s.overlayText}>{location?'Khu vực quanh vị trí của bạn':'Nhấn định vị để tìm gần bạn'}</Text></View>
    </View>
    {placesError?<Text style={s.error}>{nearbyStatus==='location-error'?'GPS':'FastAPI'}: {placesError}</Text>:null}
    <Text style={s.sub}>Hệ thống: {allPlaces.filter(p=>p.source==='backend').length} · OpenStreetMap: {allPlaces.filter(p=>p.source==='osm').length} · Wikipedia: {allPlaces.filter(p=>p.source==='wikipedia').length}</Text>
    {osmLoading?<Text style={s.sub}>Đang đọc dữ liệu OpenStreetMap đã lưu...</Text>:null}
    {osm.key===osmKey&&osm.warning?<Text style={s.sub}>{osm.warning}</Text>:null}
    {osm.key===osmKey&&osm.error?<Text style={s.error}>OpenStreetMap: {osm.error}</Text>:null}
    <Text style={s.sub}>Wikipedia là nguồn bổ sung. Khi tìm, tọa độ và bán kính được gửi đến vi.wikipedia.org; bài viết chưa được Admin kiểm duyệt.</Text>
    {wikiLoading?<Text style={s.sub}>Đang tìm Wikipedia...</Text>:null}
    {wiki.key===wikiKey&&wiki.warning?<Text style={s.sub}>{wiki.warning}</Text>:null}
    {wiki.key===wikiKey&&wiki.error?<Text style={s.error}>Wikipedia: {wiki.error}</Text>:null}
    <View style={{flexDirection:'row',gap:16,marginVertical:10}}><Pressable accessibilityRole="button" disabled={isLocating||wikiLoading} onPress={()=>void searchWikipedia()}><Text style={s.selectedCategory}>{wikiMode==='on'?'Tìm lại Wikipedia':'Tìm bằng Wikipedia'}</Text></Pressable>{wikiMode==='on'?<Pressable accessibilityRole="button" onPress={()=>setWikiMode('off')}><Text style={s.selectedCategory}>Tắt Wikipedia</Text></Pressable>:null}</View>
    <AutoGuideControl candidates={allPlaces}/><Text style={s.browse}>Các địa điểm tìm được</Text>
    <ScrollView horizontal style={{flexGrow:0}} showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10,paddingBottom:12}}>{allPlaces.map(p=><Pressable key={p.id} onPress={()=>choose(p)} style={[s.smallCard,selected?.id===p.id&&s.smallActive]}><PlaceImage uri={p.image} style={s.thumb}/><Text numberOfLines={1} style={s.itemText}>{p.title}</Text></Pressable>)}</ScrollView>
    {selected?<View style={s.selected}><View style={{flex:1}}><Text style={s.selectedCategory}>{selected.category} · {selected.source==='backend'?'Hệ thống':selected.source==='wikipedia'?'Wikipedia':'OpenStreetMap'}</Text><Text style={s.selectedTitle} numberOfLines={2}>{selected.title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Xem và nghe ${selected.title}`} onPress={()=>{registerPlace(selected);router.push(`/place/${selected.id}` as never);}} style={s.next}><Ionicons name="arrow-forward" size={21} color="#fff"/></Pressable></View>:<Text style={s.error}>{!location?'Nhấn định vị để tìm địa điểm quanh bạn.':isLocating||loadingPlaces||osmLoading||wikiLoading?'Đang tìm địa điểm...':'Không có địa điểm trong bán kính này.'}</Text>}
    <Pressable disabled={!selected} onPress={directions} style={[s.directions,!selected&&{opacity:.4}]}><Ionicons name="navigate" size={18} color="#fff"/><Text style={s.directionText}>Chỉ đường trên Google Maps</Text></Pressable>
    {osmPlaces.length?<Text style={s.credit}>© OpenStreetMap contributors · ODbL</Text>:null}
    {wikiPlaces.length?<Text style={s.credit}>© Wikipedia contributors · Nội dung bài viết có ghi nguồn tại màn hình chi tiết.</Text>:null}
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.paper},page:{flexGrow:1,padding:16,paddingBottom:9},header:{flexDirection:'row',alignItems:'center',gap:10},overline:{fontSize:10,color:C.primary,fontWeight:'900',letterSpacing:1.3},title:{fontSize:24,color:C.ink,fontWeight:'900',marginTop:4},sub:{color:C.muted,fontSize:11,marginTop:5},locate:{backgroundColor:C.primarySoft,borderRadius:13,padding:12},radiusList:{gap:8,paddingVertical:12},radius:{borderWidth:1,borderColor:C.border,borderRadius:20,paddingVertical:10,paddingHorizontal:17,backgroundColor:C.white},radiusActive:{backgroundColor:C.primary,borderColor:C.primary},radiusText:{color:C.ink,fontWeight:'800',fontSize:12},radiusTextActive:{color:'#fff'},mapBox:{height:320,minHeight:190,overflow:'hidden',borderRadius:22,backgroundColor:'#DDE9E5'},overlay:{position:'absolute',left:12,top:12,flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#fff',padding:10,borderRadius:17},overlayText:{fontSize:10,fontWeight:'700',color:C.primary},error:{color:C.danger,fontSize:11,marginTop:7},browse:{marginTop:13,marginBottom:10,fontSize:15,fontWeight:'800',color:C.ink},smallCard:{width:126,backgroundColor:C.white,borderWidth:1,borderColor:C.border,padding:6,borderRadius:13},smallActive:{borderColor:C.primary,backgroundColor:C.primarySoft},thumb:{width:'100%',height:58,borderRadius:8},itemText:{color:C.ink,fontSize:10,fontWeight:'800',marginTop:6},selected:{flexDirection:'row',gap:12,alignItems:'center',padding:12,backgroundColor:C.white,borderRadius:15,borderColor:C.border,borderWidth:1},selectedCategory:{color:C.primary,fontSize:10,fontWeight:'800'},selectedTitle:{fontSize:14,fontWeight:'900',color:C.ink,marginTop:4},next:{width:40,height:40,backgroundColor:C.primary,alignItems:'center',justifyContent:'center',borderRadius:12},directions:{backgroundColor:C.primary,padding:14,borderRadius:14,flexDirection:'row',justifyContent:'center',gap:10,marginTop:9},directionText:{color:'#fff',fontWeight:'800',fontSize:12},credit:{fontSize:9,color:C.muted,textAlign:'center',marginTop:4}});
