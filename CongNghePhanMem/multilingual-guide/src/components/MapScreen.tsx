import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { DISTRICT1_CENTER, DISTRICT1_POLYGON, isInDistrict1 } from '../data/district1';
import JourneyProgressCard from './JourneyProgressCard';
import OptimalRoutePanel, { useRouteProgress } from './OptimalRoutePanel';
import { MapDiagnostics, MapDiscoveryPanel, MapIcon, MapPlaceList, MapSelection, openMapDetail } from './MapDiscoveryPanel';
import { useMapDiscovery } from '../hooks/useMapDiscovery';
import { useI18n } from '../hooks/useI18n';
import { clusterMapPlaces } from '../services/mapClusters';
import { C } from '../theme/colors';
import { currentJourneyStop } from '../services/journey';
import JourneyPanel from './JourneyPanel';
import PlaceImage from './PlaceImage';
import {distanceKm} from '../services/nearby';

const INITIAL: Region = { ...DISTRICT1_CENTER, latitudeDelta: .05, longitudeDelta: .045 };
const DISTRICT1_COORDINATES = DISTRICT1_POLYGON.map(([latitude, longitude]) => ({ latitude, longitude }));
export default function MapScreen() {
  const map = useRef<MapView>(null);
  const m = useMapDiscovery();
  const { t } = useI18n();
  const plannedRoute = useRouteProgress();
  const progress = m.journeyMode ? m.routeProgress : plannedRoute, current = currentJourneyStop(progress);
  const [zoom, setZoom] = useState(12);
  const groups = useMemo(() => clusterMapPlaces(progress && !m.journeyMode ? [] : m.filteredPlaces.filter(p => !progress?.journey.stops.some(stop => stop.id === p.id)), zoom, m.selectedId), [m.filteredPlaces, zoom, m.selectedId, progress, m.journeyMode]);
  useEffect(() => { if (progress?.journey.stops.length) map.current?.fitToCoordinates(progress.journey.stops, { edgePadding: { top:40,bottom:40,left:40,right:40 }, animated:true }); }, [progress?.journey]);
  useEffect(() => {
    const point = m.selected ?? (m.district && !isInDistrict1(m.location) ? null : m.location);
    if (!point && m.district) { map.current?.animateToRegion(INITIAL, 400); return; }
    if (point) map.current?.animateToRegion({ latitude: point.latitude, longitude: point.longitude,
      latitudeDelta: m.selected ? .018 : Math.max(.02, m.radiusKm / 45), longitudeDelta: m.selected ? .018 : Math.max(.02, m.radiusKm / 45) }, 400);
  }, [m.location, m.selected, m.radiusKm, m.district]);
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.heading}><Text style={s.overline}>{t(m.journeyMode ? 'HÀNH TRÌNH CỦA BẠN' : 'QUẬN 1 · TP. HỒ CHÍ MINH')}</Text><Text style={s.title}>{m.routeProgress?.journey.name ?? t(m.journeyMode ? 'Hành trình khám phá' : 'Khám phá Quận 1')}</Text></View>
    <MapDiscoveryPanel model={m}/>
    {!m.journeyMode && <OptimalRoutePanel model={m} />}
    <View style={s.mapCard}>
      <View style={s.mapHeader}><Text style={s.label}>{m.selected ? m.selected.title : t('Bản đồ khám phá')}</Text>{m.selected && m.location ? <Pressable accessibilityRole="button" accessibilityLabel={t('Vị trí của tôi')} onPress={() => m.selectPlace(null)}><MapIcon name="locate" size={20} color={C.primary}/></Pressable> : null}</View>
      <View style={s.mapBox}>
        <MapView ref={map} provider={Platform.OS === 'android' || process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={m.location && isInDistrict1(m.location) ? { ...INITIAL, ...m.location } : INITIAL} showsCompass showsUserLocation={false} onRegionChangeComplete={region => setZoom(Math.round(Math.log2(360 / Math.max(.00001, region.longitudeDelta))))}>
          <Polygon coordinates={DISTRICT1_COORDINATES} strokeColor={C.primary} strokeWidth={2} fillColor="rgba(13,148,136,.05)" lineDashPattern={[6, 6]} tappable={false} />
          {m.location ? <>{!m.district ? <Circle center={m.location} radius={m.radiusKm * 1000} strokeColor="rgba(13,148,136,.6)" fillColor="rgba(13,148,136,.03)"/> : null}<Marker coordinate={m.location} title={t(m.locationSource === 'manual' ? 'Vị trí mô phỏng' : 'Vị trí của tôi')} pinColor="#2563eb"/>{m.locationSource === 'gps' && typeof m.location.accuracy === 'number' ? <Circle center={m.location} radius={m.location.accuracy} strokeColor="rgba(37,99,235,.5)" fillColor="rgba(37,99,235,.15)"/> : null}</> : null}
          {groups.map(group => group.places.length > 1 ? <Marker key={group.places[0].id} coordinate={group} onPress={() => map.current?.fitToCoordinates(group.places,{edgePadding:{top:45,right:45,bottom:45,left:45},animated:true})}><View style={s.cluster}><Text style={s.clusterText}>{group.places.length}</Text></View></Marker> : <Marker key={group.places[0].id} coordinate={group} title={group.places[0].title} onPress={() => m.selectPlace(group.places[0].id)} pinColor={group.places[0].source === 'backend' ? C.primary : group.places[0].source === 'wikipedia' ? '#d97706' : '#8b5cf6'}><Callout onPress={() => openMapDetail(group.places[0], m)}><View style={{width:230,padding:6,gap:7}}><PlaceImage retryEnabled={false} uri={group.places[0].image} thumbnailUri={group.places[0].imageThumbnail} label={group.places[0].title} style={{width:218,height:110,borderRadius:10}}/><Text style={s.label}>{group.places[0].title}</Text><Text style={s.caption}>{t(group.places[0].category)}{m.location ? ` · ${distanceKm(m.location,group.places[0]).toFixed(2)} km` : ''}</Text>{group.places[0].imageAttribution ? <Text style={s.caption}>{group.places[0].imageAttribution} · {group.places[0].imageLicense}</Text> : null}<Text style={{color:C.primaryDark,fontWeight:'700'}}>{t('Xem chi tiết')} →</Text></View></Callout></Marker>)}
          {progress?.journey.stops.length ? <Polyline coordinates={progress.journey.stops} strokeColor={C.primaryDark} strokeWidth={3} lineDashPattern={[8,8]} /> : null}
          {progress?.journey.stops.map((point,index)=><Marker key={`route-${point.id}`} coordinate={point} title={`${index+1}. ${point.title}`} onPress={() => m.selectPlace(point.id)}><View style={[s.cluster,{backgroundColor:progress.completed.includes(point.id)?C.primary:progress.skipped.includes(point.id)?'#94a3b8':current?.id===point.id?'#f97316':C.darkBlue}]}><Text style={s.clusterText}>{index+1}</Text></View><Callout onPress={()=>openMapDetail(point,m)}><View style={{width:200,gap:8}}><PlaceImage retryEnabled={false} uri={point.image} thumbnailUri={point.imageThumbnail} style={{width:200,height:95,borderRadius:8}}/><Text>{point.title}</Text><Text>{t('Xem chi tiết')} →</Text></View></Callout></Marker>)}
        </MapView>
      </View>
      <View style={s.legend}><Text style={s.caption}>🔵 {t(m.locationSource === 'manual' ? 'Vị trí mô phỏng' : 'Vị trí của tôi')}</Text><Text style={s.caption}>🟢 {t('Hệ thống')}</Text><Text style={s.caption}>🟣 OpenStreetMap</Text><Text style={s.caption}>🟠 Wikipedia</Text></View>
      {!!progress && <Text style={s.caption}>{t('Đường nối minh họa, không phải tuyến đường thực tế.')} 🟠 {t('Điểm tiếp theo')} · 🟢 {t('Đã hoàn thành')}</Text>}
      <MapSelection model={m}/>
    </View>
    <JourneyPanel model={m}/>
    {m.journeyMode && !!progress?.journey.stops.length && <View style={{ marginTop: 16 }}><JourneyProgressCard /></View>}
    {!m.journeyMode && <MapPlaceList model={m}/>}
    <Text style={s.credit}>© OpenStreetMap contributors (ODbL) · Wikipedia contributors. {t('Địa điểm khám phá có nguồn cộng đồng, chưa được Admin kiểm duyệt.')}</Text>
    <MapDiagnostics model={m}/>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, page: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 1120, alignSelf: 'center' }, heading: { marginBottom: 18 }, overline: { color: C.primaryDark, fontSize: 10, fontWeight: '700', letterSpacing: 1.7 }, title: { color: C.darkBlue, fontSize: 27, fontWeight: '800', marginTop: 6 },
  mapCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 22, marginTop: 15 }, mapHeader: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, label: { color: C.darkBlue, fontSize: 13, fontWeight: '700', flexShrink: 1 }, mapBox: { height: 340, borderRadius: 17, overflow: 'hidden' }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }, caption: { color: C.muted, fontSize: 10, lineHeight: 17 }, credit: { fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 17, marginTop: 20 }, cluster: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryDark, borderColor: C.white, borderWidth: 3 }, clusterText: { color: C.white, fontWeight: '700' },
});
