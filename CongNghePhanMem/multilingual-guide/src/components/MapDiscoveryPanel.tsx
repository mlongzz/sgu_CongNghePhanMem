import React, { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Place } from '../data/places';
import { C } from '../theme/colors';
import { distanceKm } from '../services/nearby';
import { API_BASE_URL } from '../services/api';
import { MAP_CATEGORIES, type MapDiscovery } from '../hooks/useMapDiscovery';
import { useI18n } from '../hooks/useI18n';
import PlaceImage from './PlaceImage';
import ImageCredit from './ImageCredit';
import PlaceSkeleton from './PlaceSkeleton';
import { openDirections } from '../services/directions';

const subscribe = () => () => {};
const client = () => true;
const server = () => false;
export function MapIcon(props: React.ComponentProps<typeof Ionicons>) {
  const hydrated = useSyncExternalStore(subscribe, client, server);
  return <View style={{ width: props.size, height: props.size }}>{hydrated ? <Ionicons {...props} /> : null}</View>;
}
export function mapSourceLabel(place: Place) { return place.source === 'backend' ? 'Hệ thống' : place.source === 'wikipedia' ? 'Wikipedia' : 'OpenStreetMap'; }
export function openMapDetail(place: Place, model: MapDiscovery) { model.registerPlace(place); router.push(`/place/${place.id}` as never); }
export function openMapDirections(place: Place, t: (text: string) => string) {
  void openDirections(place, t);
}

export function MapDiscoveryPanel({ model: m }: { model: MapDiscovery }) {
  const { t } = useI18n();
  const gpsLabel = m.isLocating ? 'Đang lấy GPS...' : m.loadingPlaces ? 'Đang tìm địa điểm...' : 'Dùng GPS và tìm địa danh';
  // An OpenStreetMap snapshot that was never synced is a server setting, not a failure the visitor can retry.
  const osmNotSynced = /chưa được đồng bộ/.test(m.osm.error);
  const partialFailure = m.nearbyStatus === 'error' || (!!m.osm.error && !osmNotSynced) || !!m.wiki.error;
  const loading = !m.isLocating && (m.loadingPlaces || m.osmLoading || m.wikiLoading || m.photosLoading);
  return <View style={s.panel}>
    {!m.journeyMode && <>
    <View style={s.search}>
      <MapIcon name="search-outline" size={20} color={C.muted} />
      <TextInput value={m.query} onChangeText={m.setQuery} accessibilityLabel={t('Tìm địa danh')} placeholder={t('Tìm địa điểm ở Quận 1')} placeholderTextColor={C.muted} style={s.searchInput} />
      {m.query ? <Pressable accessibilityRole="button" accessibilityLabel={t('Xóa tìm kiếm')} onPress={() => m.setQuery('')}><MapIcon name="close-circle" size={19} color={C.muted}/></Pressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories}>
      {MAP_CATEGORIES.map(category => <Pressable key={category} accessibilityRole="button" accessibilityLabel={`${t('Danh mục')} ${t(category)}`} accessibilityState={{ selected: m.category === category }} onPress={() => m.setCategory(category)} style={[s.category, m.category === category && s.categoryActive]}><Text style={[s.categoryText, m.category === category && s.categoryTextActive]}>{t(category)}</Text></Pressable>)}
    </ScrollView>
    </>}
    <View style={s.locationRow}>
      <View style={s.locationIcon}><MapIcon name="location" color={C.primary} size={22}/></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.locationTitle}>{t(m.districtFallback ? 'Đang xem toàn bộ Quận 1' : m.locationSource === 'manual' ? 'Vị trí mô phỏng' : m.locationStale ? 'Vị trí gần nhất' : 'Vị trí hiện tại')}</Text>
        <Text testID="location-summary" style={s.caption}>{m.districtFallback ? t(m.location && !m.locationStale ? 'Bạn đang ở ngoài Quận 1 · Hiển thị các điểm trong quận' : 'Bật GPS khi đến Quận 1 để tìm điểm gần bạn nhất') : t(m.locationStale ? 'GPS đã cũ. Định vị lại để cập nhật địa điểm quanh bạn.' : m.location ? m.locationSource === 'manual' ? 'Tọa độ kiểm thử · Không dùng GPS' : 'Đã xác định vị trí thiết bị' : 'Chưa có vị trí · Bật GPS để khám phá')}{m.locationSource === 'gps' && typeof m.location?.accuracy === 'number' ? ` · GPS ±${Math.round(m.location.accuracy)} m` : ''}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t(gpsLabel)} disabled={m.loadingPlaces} onPress={() => void m.locate()} style={[s.locate, m.loadingPlaces && { opacity: .65 }]}>
        {m.loadingPlaces ? <ActivityIndicator color="#fff" size="small"/> : <MapIcon name="locate" size={18} color="#fff"/>}
        <Text style={s.locateText}>{t(m.isLocating ? 'Đang định vị' : m.location ? 'Định vị lại' : 'Bật GPS')}</Text>
      </Pressable>
    </View>
    {m.locationSource === 'gps' && (m.location?.accuracy ?? 0) > 50 ? <Text testID="map-gps-accuracy-warning" style={s.hint}>{t('GPS chưa chính xác. Khoảng cách chỉ gần đúng; hãy định vị lại ở nơi thoáng hơn.')}</Text> : null}
    {/* The guide always covers all of District 1; the radius picker remains only for the legacy wide-area test mode. */}
    {!m.journeyMode && !m.district && <View style={s.radiusRow}><Text style={s.radiusLabel}>{t('Bán kính')}</Text><View style={s.radii}>{m.radii.map(km => <Pressable key={km} accessibilityRole="button" accessibilityLabel={`${t('Bán kính')} ${km} km`} accessibilityState={{ selected: m.radiusKm === km }} onPress={() => m.changeRadius(km)} style={[s.radius, m.radiusKm === km && s.radiusActive]}><Text style={[s.radiusText, m.radiusKm === km && s.radiusTextActive]}>{km} km</Text></Pressable>)}</View></View>}
    {m.isLocating ? <View style={s.notice}><ActivityIndicator size="small" color={C.primary}/><Text testID="gps-progress" style={[s.caption, { flex: 1 }]}>{t(m.locationProgress)}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Hủy lấy GPS')} onPress={m.cancelLocation}><Text style={s.action}>{t('Hủy')}</Text></Pressable></View> : null}
    {m.nearbyStatus === 'location-error' && m.placesError ? <Text style={s.error}>GPS: {m.placesError}</Text> : null}
    {loading ? <View style={s.notice}><ActivityIndicator size="small" color={C.primary}/><Text testID="map-loading" style={s.caption}>{t('Đang cập nhật địa điểm…')}</Text></View> : null}
    {partialFailure ? <View style={s.notice}><MapIcon name="cloud-offline-outline" size={17} color={C.muted}/><Text style={[s.caption, { flex: 1 }]}>{t(m.allPlaces.length ? 'Không thể cập nhật một số nguồn địa danh. Bạn vẫn có thể khám phá các địa điểm hiện có.' : 'Chưa tải được dữ liệu địa danh. Kiểm tra kết nối và thử lại.')}</Text><Pressable accessibilityRole="button" onPress={m.retrySources}><Text style={s.action}>{t('Thử lại')}</Text></Pressable></View> : null}
    {m.osm.stale ? <Text style={s.hint}>{t('Một số địa điểm đang dùng dữ liệu đã lưu, chưa cập nhật được.')} <Text onPress={m.retrySources} style={s.action}>{t('Thử lại')}</Text></Text> : null}
    {m.osm.warning && !m.osm.stale && /Tạm hiển thị/.test(m.osm.warning) ? <Text style={s.hint}>{t('Một nguồn khám phá chưa bao phủ hết bán kính. Bạn có thể thử cập nhật lại.')}</Text> : null}
    {m.coveragePartial ? <Text testID="coverage-notice" style={s.hint}>{t('Dữ liệu mới bao phủ một phần bán kính đã chọn.')} {typeof m.wiki.searchedRadiusKm === 'number' ? `Wikipedia: ${m.wiki.searchedRadiusKm}/${m.radiusKm} km. ` : ''}{typeof m.osm.searchedRadiusKm === 'number' ? `OpenStreetMap: ${m.osm.searchedRadiusKm}/${m.radiusKm} km.` : ''}</Text> : null}
    {m.wiki.warning && m.radiusKm > 10 ? <Text style={s.hint}>{t('Wikipedia đang tìm trong phạm vi tối đa 10 km.')}</Text> : null}
    {!m.location && !m.districtFallback && m.nearbyStatus === 'idle' ? <Text style={s.hint}>{t('Chưa bắt đầu tìm kiếm. Bật GPS để xem địa danh gần bạn.')}</Text> : null}
    <Text style={s.privacy}>{t(m.journeyMode ? 'Tọa độ được gửi đến máy chủ khi cập nhật GPS. Chế độ hành trình không truy vấn nguồn khám phá cộng đồng.' : m.wikiMode === 'off' ? 'Khi bật GPS, tọa độ và bán kính được gửi đến máy chủ để tìm địa danh. Wikipedia đang tắt.' : 'Khi bật GPS, tọa độ và bán kính được gửi đến máy chủ và Wikipedia để tìm địa danh.')}</Text>
  </View>;
}

export function MapSelection({ model: m }: { model: MapDiscovery }) {
  const { t } = useI18n();
  const place = m.selected;
  if (!place) return null;
  return <View style={s.selection}>
    <View style={{ flex: 1, minWidth: 0 }}><Text style={s.placeTitle}>{place.title}</Text><Text style={s.caption}>{t(place.category)} · {t(mapSourceLabel(place))}</Text></View>
    <Pressable accessibilityRole="button" onPress={() => openMapDetail(place, m)} style={s.secondary}><Text style={s.action}>{t('Xem chi tiết')}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => openMapDirections(place, t)} style={s.secondary}><MapIcon name="navigate-outline" size={18} color={C.primary}/><Text style={s.action}>{t('Chỉ đường')}</Text></Pressable>
    {place.source !== 'backend' && place.sourceUrl ? <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(place.sourceUrl!).catch(() => {})}><Text style={s.action}>{t(place.source === 'wikipedia' ? 'Đọc bài viết Wikipedia →' : 'Mở vị trí trên OpenStreetMap →')}</Text></Pressable> : null}
  </View>;
}

export function MapPlaceList({ model: m }: { model: MapDiscovery }) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(18);
  return <View>
    <View style={s.listHeader}><Text style={s.listTitle}>{t(m.district ? 'Địa điểm Quận 1' : 'Địa điểm quanh bạn')}</Text><Text style={s.caption}>{m.filteredPlaces.length} {t('địa điểm')}</Text></View>
    {!m.filteredPlaces.length && (m.loadingPlaces || m.osmLoading || m.wikiLoading || m.photosLoading) ? <PlaceSkeleton count={2}/> : null}
    <View testID="nearby-place-list" style={s.list}>
      {m.filteredPlaces.slice(0, limit).map(place => <View key={place.id} style={[s.place, m.selectedId === place.id && { borderColor: C.primary }]}>
        <PlaceImage uri={place.image} thumbnailUri={place.imageThumbnail} label={place.title} style={s.thumbnail}/>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.placeMeta}><Text style={s.categoryText}>{t(place.category)}</Text><Text style={s.distance}>{m.location ? `${distanceKm(m.location, place).toFixed(1)} km` : ''}</Text></View>
          <Text style={s.placeTitle} numberOfLines={2}>{place.title}</Text>
          <Text style={s.description} numberOfLines={2}>{place.description[m.language] || place.subtitle[m.language]}</Text>
          <Text style={s.source}>{t(mapSourceLabel(place))} · {t(place.source === 'backend' && place.narration?.[m.language]?.source === 'published' ? 'Thuyết minh đã duyệt' : place.wikipedia || place.source === 'wikipedia' || place.wikipediaUrl ? 'Có nội dung tham khảo' : 'Xem nội dung')}</Text>
          <ImageCredit place={place}/>
          <View style={s.placeActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('Chi tiết')} ${place.title}`} onPress={() => openMapDetail(place, m)}><Text style={s.action}>{t('Xem chi tiết')} →</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('Xem bản đồ')} ${place.title}`} onPress={() => m.selectPlace(place.id)}><MapIcon name="locate-outline" size={19} color={C.primary}/></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('Mở bản đồ ngoài')} ${place.title}`} onPress={() => openMapDirections(place, t)}><MapIcon name="navigate-outline" size={19} color={C.primary}/></Pressable>
          </View>
        </View>
      </View>)}
    </View>
    {!m.filteredPlaces.length && !m.loadingPlaces && !m.osmLoading && !m.wikiLoading && !m.photosLoading ? <View style={s.empty}><MapIcon name="compass-outline" size={30} color={C.primary}/><Text style={s.caption}>{t(m.locationStale ? 'GPS đã cũ. Định vị lại để cập nhật địa điểm quanh bạn.' : !m.location ? 'Bật GPS để bắt đầu hành trình.' : m.allPlaces.length ? (m.hiddenCount && !m.visiblePlaces.length ? 'Chưa có điểm du lịch có ảnh trong khu vực này. Tắt bớt bộ lọc hoặc thử bán kính lớn hơn.' : 'Không có địa điểm phù hợp. Thử từ khóa hoặc danh mục khác.') : m.outcome === 'source-error' ? 'Chưa tải đủ dữ liệu địa điểm. Hãy thử lại hoặc kiểm tra kết nối.' : m.outcome === 'partial-empty' ? 'Chưa tìm thấy địa điểm trong phần dữ liệu đã có; một phần bán kính chưa được bao phủ.' : 'Chưa tìm thấy địa điểm trong bán kính đã chọn. Bạn có thể thử bán kính lớn hơn.')}</Text></View> : null}
    {m.filteredPlaces.length > limit ? <Pressable accessibilityRole="button" onPress={() => setLimit(value => value + 18)} style={s.more}><Text style={s.action}>{t('Xem thêm địa điểm')}</Text></Pressable> : null}
  </View>;
}

/** Hidden from production unless diagnostics was explicitly enabled in the build. */
export function MapDiagnostics({ model: m }: { model: MapDiscovery }) {
  if (!__DEV__ && process.env.EXPO_PUBLIC_ENABLE_DIAGNOSTICS !== '1') return null;
  return <MapDiagnosticsContent model={m} />;
}

/** Always collapsed initially, including builds that explicitly enable diagnostics. */
function MapDiagnosticsContent({ model: m }: { model: MapDiscovery }) {
  const [manual, setManual] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [manualError, setManualError] = useState('');
  const official = m.officialCount;
  const osmCount = m.allPlaces.filter(place => place.source === 'osm').length;
  const wikiCount = m.allPlaces.filter(place => place.source === 'wikipedia').length;
  const backendStatus = m.nearbyStatus === 'success' ? `Đã phản hồi · ${official} POI chính thức.` : m.nearbyStatus === 'loading' ? 'Đang tìm POI chính thức...' : m.nearbyStatus === 'error' ? 'Không tải được POI chính thức.' : m.nearbyStatus === 'locating' ? 'Đang chờ vị trí GPS.' : 'Chưa tìm POI quanh vị trí GPS.';
  const manualSearch = async () => {
    const parse = (text: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim().replace(',', '.')) ? Number(text.trim().replace(',', '.')) : NaN;
    const coordinates = { latitude: parse(latitude), longitude: parse(longitude) };
    if (!Number.isFinite(coordinates.latitude) || Math.abs(coordinates.latitude) > 90 || !Number.isFinite(coordinates.longitude) || Math.abs(coordinates.longitude) > 180) { setManualError('Nhập vĩ độ từ -90 đến 90 và kinh độ từ -180 đến 180, bằng số thập phân.'); return; }
    setManualError(''); m.selectPlace(null); m.setWikiMode('on');
    await m.refreshNearby({ coordinates });
  };
  return <View style={s.diagnostics}>
    <Pressable accessibilityRole="button" accessibilityLabel="Developer Diagnostics" accessibilityState={{ expanded: m.diagnostics }} onPress={() => m.setDiagnostics(!m.diagnostics)} style={s.diagnosticsToggle}><MapIcon name="code-slash-outline" size={15} color={C.muted}/><Text style={s.caption}>Công cụ nâng cao · nhập tọa độ thủ công</Text><MapIcon name={m.diagnostics ? 'chevron-up' : 'chevron-down'} size={15} color={C.muted}/></Pressable>
    {m.diagnostics ? <View testID="developer-diagnostics" style={s.diagnosticsBody}>
      <Text style={s.caption}>GPS: {m.location ? m.locationSource === 'manual' ? `Không dùng GPS · Vị trí đã nhập (${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)})` : `Đã có vị trí (${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)})` : 'Chưa có vị trí'} · Bán kính: {m.radiusKm} km</Text>
      {API_BASE_URL ? <Text testID="backend-poi-status" style={s.caption}>FastAPI: {backendStatus}</Text> : null}
      {m.nearbyStatus === 'error' && m.placesError ? <Text style={s.caption}>FastAPI: {m.placesError}</Text> : null}
      {m.placesWarning ? <Text style={s.caption}>{m.placesWarning}</Text> : null}
      <Text style={s.caption}>Hệ thống: {official} · OpenStreetMap: {osmCount} · Wikipedia: {wikiCount}</Text>
      <Text style={s.caption}>Nguồn POI đang hiển thị: {[official ? 'FastAPI' : '', osmCount ? 'OpenStreetMap' : '', wikiCount ? 'Wikipedia' : ''].filter(Boolean).join(' và ') || 'Chưa có POI'}</Text>
      {m.osmLoading ? <Text style={s.caption}>Đang đọc dữ liệu OpenStreetMap đã lưu trong {m.radiusKm} km qua FastAPI…</Text> : null}
      {m.osmKey && m.osm.key === m.osmKey && !m.osm.error ? <Text style={s.caption}>OpenStreetMap: {m.osm.stale ? 'Đang dùng dữ liệu đã lưu' : 'Đã phản hồi'} · {osmCount} POI khám phá đang hiển thị.</Text> : null}
      {m.osm.warning ? <Text style={s.caption}>{m.osm.warning}</Text> : null}
      {m.osm.error ? <Text style={s.caption}>OpenStreetMap: {m.osm.error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={m.retryOsm}><Text style={s.action}>Thử lại OpenStreetMap</Text></Pressable>
      {m.wikiLoading ? <Text style={s.caption}>Đang tìm Wikipedia...</Text> : null}
      {m.wikiKey && m.wiki.key === m.wikiKey && !m.wiki.error ? <Text style={s.caption}>Wikipedia: Đã phản hồi · {wikiCount} địa điểm đang hiển thị.</Text> : null}
      {m.wiki.warning ? <Text style={s.caption}>{m.wiki.warning}</Text> : null}
      {m.wiki.error ? <Text style={s.caption}>Wikipedia: {m.wiki.error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={m.wikiMode === 'on' ? 'Làm mới Wikipedia' : 'Tìm bằng Wikipedia'} disabled={m.isLocating || m.wikiLoading} onPress={() => void m.searchWikipedia()}><Text style={s.action}>{m.wikiMode === 'on' ? 'Làm mới Wikipedia' : 'Tìm bằng Wikipedia'}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => m.setWikiMode(m.wikiMode === 'off' ? 'on' : 'off')}><Text style={s.action}>{m.wikiMode === 'off' ? 'Bật Wikipedia' : 'Tắt Wikipedia'}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setManual(!manual)}><Text style={s.action}>{manual ? 'Ẩn nhập tọa độ' : 'Nhập tọa độ thay cho GPS'}</Text></Pressable>
      {manual ? <View style={{ gap: 10 }}><Text style={s.caption}>Tọa độ mô phỏng chỉ dùng kiểm thử, không được coi là GPS thiết bị.</Text><TextInput accessibilityLabel="Vĩ độ tìm kiếm" placeholder="Vĩ độ (-90 đến 90)" keyboardType="decimal-pad" value={latitude} onChangeText={setLatitude} style={s.manualInput}/><TextInput accessibilityLabel="Kinh độ tìm kiếm" placeholder="Kinh độ (-180 đến 180)" keyboardType="decimal-pad" value={longitude} onChangeText={setLongitude} style={s.manualInput}/>{manualError ? <Text style={s.error}>{manualError}</Text> : null}<Pressable accessibilityRole="button" onPress={() => void manualSearch()}><Text style={s.action}>Dùng tọa độ và tìm Wikipedia</Text></Pressable></View> : null}
    </View> : null}
  </View>;
}

const s = StyleSheet.create({
  panel: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 16, gap: 13 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.paper, borderRadius: 13, paddingHorizontal: 12, minHeight: 44, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, minWidth: 0, color: C.ink, paddingVertical: 12, fontSize: 14 },
  categories: { gap: 7 }, category: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.paper }, categoryActive: { backgroundColor: C.primarySoft }, categoryText: { fontSize: 11, color: C.muted, fontWeight: '600' }, categoryTextActive: { color: C.primaryDark },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, locationIcon: { width: 42, height: 42, backgroundColor: '#EFFAF8', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, locationTitle: { color: C.darkBlue, fontSize: 14, fontWeight: '700' }, caption: { color: C.muted, fontSize: 11, lineHeight: 18 },
  locate: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12 }, locateText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  radiusRow: { gap: 9 }, radiusLabel: { color: C.ink, fontWeight: '600', fontSize: 12 }, radii: { flexDirection: 'row', gap: 5, borderRadius: 12, padding: 4, backgroundColor: C.paper }, radius: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 9, borderRadius: 9 }, radiusActive: { backgroundColor: C.darkBlue }, radiusText: { fontSize: 12, fontWeight: '600', color: C.muted }, radiusTextActive: { color: C.white },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: C.paper }, hint: { fontSize: 11, color: C.muted, lineHeight: 18 }, privacy: { fontSize: 10, lineHeight: 16, color: C.muted }, error: { color: C.danger, fontSize: 12, lineHeight: 19 }, action: { color: C.primaryDark, fontSize: 12, fontWeight: '700' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 15 }, listTitle: { color: C.darkBlue, fontSize: 18, fontWeight: '700' }, list: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  place: { flexDirection: 'column', gap: 12, flexGrow: 1, flexBasis: 360, maxWidth: '100%', minWidth: 0, padding: 12, backgroundColor: C.white, borderRadius: 17, borderWidth: 1, borderColor: C.border }, thumbnail: { width: '100%', height: 174, borderRadius: 12 }, imagePlaceholder: { width: 64, minHeight: 90, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#EFFAF8' }, placeMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, marginBottom: 4 }, distance: { color: C.primaryDark, fontSize: 11, fontWeight: '700' }, placeTitle: { color: C.darkBlue, fontSize: 17, fontWeight: '700', lineHeight: 24 }, description: { color: C.muted, fontSize: 12, lineHeight: 20, marginTop: 4 }, source: { color: C.muted, fontSize: 10, marginTop: 6 }, placeActions: { flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 8, minHeight:44, borderTopWidth:1, borderColor:C.border, paddingTop:8 },
  selection: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', backgroundColor: '#EFFAF8', borderRadius: 14, padding: 13, marginTop: 12 }, secondary: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 9 }, empty: { alignItems: 'center', gap: 12, padding: 30, backgroundColor: C.white, borderRadius: 18 }, more: { alignItems: 'center', padding: 16 },
  diagnostics: { marginTop: 18 }, diagnosticsToggle: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }, diagnosticsBody: { backgroundColor: '#F1F5F9', padding: 15, borderRadius: 15, gap: 10 }, manualInput: { color: C.ink, backgroundColor: C.white, borderColor: C.border, borderWidth: 1, borderRadius: 10, padding: 12 },
});
