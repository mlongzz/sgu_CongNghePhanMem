import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import AutoGuideControl from './AutoGuideControl';
import { MapDiagnostics, MapDiscoveryPanel, MapIcon, MapPlaceList, MapSelection, openMapDetail } from './MapDiscoveryPanel';
import { useMapDiscovery } from '../hooks/useMapDiscovery';
import { useI18n } from '../hooks/useI18n';
import { clusterMapPlaces } from '../services/mapClusters';
import { C } from '../theme/colors';

const INITIAL: Region = { latitude: 10.7764, longitude: 106.6993, latitudeDelta: .05, longitudeDelta: .05 };
export default function MapScreen() {
  const map = useRef<MapView>(null);
  const m = useMapDiscovery();
  const { t } = useI18n();
  const [zoom, setZoom] = useState(12);
  const groups = useMemo(() => clusterMapPlaces(m.filteredPlaces, zoom, m.selectedId), [m.filteredPlaces, zoom, m.selectedId]);
  useEffect(() => {
    const point = m.selected ?? m.location;
    if (point) map.current?.animateToRegion({ latitude: point.latitude, longitude: point.longitude,
      latitudeDelta: m.selected ? .018 : Math.max(.02, m.radiusKm / 45), longitudeDelta: m.selected ? .018 : Math.max(.02, m.radiusKm / 45) }, 400);
  }, [m.location, m.selected, m.radiusKm]);
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.heading}><Text style={s.overline}>{t('HÀNH TRÌNH CỦA BẠN')}</Text><Text style={s.title}>{t('Khám phá quanh bạn')}</Text></View>
    <MapDiscoveryPanel model={m}/>
    <View style={s.mapCard}>
      <View style={s.mapHeader}><Text style={s.label}>{m.selected ? m.selected.title : t('Bản đồ khám phá')}</Text>{m.selected && m.location ? <Pressable accessibilityRole="button" accessibilityLabel={t('Vị trí của tôi')} onPress={() => m.selectPlace(null)}><MapIcon name="locate" size={20} color={C.primary}/></Pressable> : null}</View>
      <View style={s.mapBox}>
        <MapView ref={map} provider={Platform.OS === 'android' || process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={m.location ? { ...INITIAL, ...m.location } : INITIAL} showsCompass showsUserLocation={false} onRegionChangeComplete={region => setZoom(Math.round(Math.log2(360 / Math.max(.00001, region.longitudeDelta))))}>
          {m.location ? <><Circle center={m.location} radius={m.radiusKm * 1000} strokeColor="rgba(13,148,136,.6)" fillColor="rgba(13,148,136,.03)"/><Marker coordinate={m.location} title={t(m.locationSource === 'manual' ? 'Vị trí mô phỏng' : 'Vị trí của tôi')} pinColor="#2563eb"/>{m.locationSource === 'gps' && typeof m.location.accuracy === 'number' ? <Circle center={m.location} radius={m.location.accuracy} strokeColor="rgba(37,99,235,.5)" fillColor="rgba(37,99,235,.15)"/> : null}</> : null}
          {groups.map(group => group.places.length > 1 ? <Marker key={group.places[0].id} coordinate={group} onPress={() => map.current?.animateToRegion({ latitude: group.latitude, longitude: group.longitude, latitudeDelta: .01, longitudeDelta: .01 }, 400)}><View style={s.cluster}><Text style={s.clusterText}>{group.places.length}</Text></View></Marker> : <Marker key={group.places[0].id} coordinate={group} title={group.places[0].title} onPress={() => m.selectPlace(group.places[0].id)} pinColor={group.places[0].source === 'backend' ? C.primary : group.places[0].source === 'wikipedia' ? '#d97706' : '#8b5cf6'}><Callout onPress={() => openMapDetail(group.places[0], m)}><View style={{ maxWidth: 240, padding: 5 }}><Text style={s.label}>{group.places[0].title}</Text><Text style={s.caption}>{t('Xem chi tiết')} →</Text></View></Callout></Marker>)}
        </MapView>
      </View>
      <View style={s.legend}><Text style={s.caption}>🔵 {t(m.locationSource === 'manual' ? 'Vị trí mô phỏng' : 'Vị trí của tôi')}</Text><Text style={s.caption}>🟢 {t('Hệ thống')}</Text><Text style={s.caption}>🟣 OpenStreetMap</Text><Text style={s.caption}>🟠 Wikipedia</Text></View>
      <MapSelection model={m}/>
    </View>
    <AutoGuideControl candidates={m.allPlaces}/>
    <MapPlaceList model={m}/>
    <Text style={s.credit}>© OpenStreetMap contributors (ODbL) · Wikipedia contributors. {t('Địa điểm khám phá có nguồn cộng đồng, chưa được Admin kiểm duyệt.')}</Text>
    <MapDiagnostics model={m}/>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, page: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 1120, alignSelf: 'center' }, heading: { marginBottom: 18 }, overline: { color: C.primaryDark, fontSize: 10, fontWeight: '700', letterSpacing: 1.7 }, title: { color: C.darkBlue, fontSize: 27, fontWeight: '800', marginTop: 6 },
  mapCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 22, marginTop: 15 }, mapHeader: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, label: { color: C.darkBlue, fontSize: 13, fontWeight: '700', flexShrink: 1 }, mapBox: { height: 340, borderRadius: 17, overflow: 'hidden' }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }, caption: { color: C.muted, fontSize: 10, lineHeight: 17 }, credit: { fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 17, marginTop: 20 }, cluster: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primaryDark, borderColor: C.white, borderWidth: 3 }, clusterText: { color: C.white, fontWeight: '700' },
});
