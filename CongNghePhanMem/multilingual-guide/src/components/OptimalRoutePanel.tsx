import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MapDiscovery } from '../hooks/useMapDiscovery';
import { ROUTE_SIZES, useOptimalRoute } from '../hooks/useOptimalRoute';
import { useI18n } from '../hooks/useI18n';
import { googleMapsRouteUrl, parseStopCount, type OptimalRoute } from '../services/optimalRoute';
import type { JourneyProgress } from '../services/journey';
import { C } from '../theme/colors';
import { PrimaryButton } from './auth';
import ChipButton from './ChipButton';
import PlaceImage from './PlaceImage';
import { openMapDetail } from './MapDiscoveryPanel';
import TourPlayer from './TourPlayer';

/** Shows a planned route on the map with the same numbered markers and line as a journey. */
export function routeAsProgress(route: OptimalRoute | null, name: string, visited: string[] = []): JourneyProgress | null {
  if (!route) return null;
  return { journey: { id: 0, name, description: '', stops: route.legs.map(leg => leg.place), raw: {}, unavailable: 0, image: '' }, completed: visited, skipped: [], status: 'active' };
}

export function useRouteProgress(): JourneyProgress | null {
  const { route, tour } = useOptimalRoute();
  const { t } = useI18n();
  const name = t('Hành trình tối ưu');
  const visited = tour?.visited;
  return useMemo(() => routeAsProgress(route, name, visited), [route, name, visited]);
}

const km = (value: number) => value.toFixed(1);

export default function OptimalRoutePanel({ model: m }: { model: MapDiscovery }) {
  const { t } = useI18n();
  const { route, size, busy, error, fromCenter, maxStops, tour, setSize, loadMax, plan, clear, removeStop, setTour } = useOptimalRoute();
  const [waitingGps, setWaitingGps] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  useEffect(() => { loadMax(); }, [loadMax]);
  const max = maxStops ?? 0;
  const customCheck = custom && max ? parseStopCount(customText, max) : { value: null, error: '' };
  const count = custom ? customCheck.value ?? undefined : undefined;
  const gps = m.location && !m.locationStale ? { latitude: m.location.latitude, longitude: m.location.longitude } : null;
  const gpsFailed = waitingGps && m.nearbyStatus === 'location-error';

  // Plan as soon as the GPS request started by the button returns a position.
  useEffect(() => {
    if (!waitingGps || !gps || m.isLocating) return;
    void plan(gps, count).then(() => setWaitingGps(false));
  }, [waitingGps, gps?.latitude, gps?.longitude, m.isLocating, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (custom && (!max || customCheck.error)) return;
    if (gps) { void plan(gps, count); return; }
    setWaitingGps(true);
    void m.locate();
  };
  const loading = busy || (waitingGps && m.isLocating);
  const sizeLabel = (value: number) => value ? `${value} ${t('điểm')}` : t('Tất cả');

  return <View testID="optimal-route" style={s.card}>
    <View style={s.head}>
      <View style={s.icon}><Ionicons name="navigate" size={20} color="#fff" /></View>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={s.title}>{t('Hành trình tối ưu từ vị trí của bạn')}</Text>
        <Text style={s.sub}>{t('Lấy GPS của bạn và sắp xếp thứ tự tham quan các điểm Quận 1 sao cho quãng đường đi bộ ngắn nhất.')}</Text>
      </View>
    </View>

    <Text style={s.label}>{t('Số điểm muốn tham quan')}</Text>
    <View style={s.sizes}>
      {ROUTE_SIZES.map(value => {
        const on = !custom && size === value;
        return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={sizeLabel(value)}
          onPress={() => { setCustom(false); setSize(value); }} style={({ hovered }) => [s.size, on && s.sizeOn, hovered && !on && { backgroundColor: C.paper }]}>
          <Text style={[s.sizeText, on && { color: '#fff' }]}>{value === 0 && max ? `${t('Tất cả')} (${max})` : sizeLabel(value)}</Text>
        </Pressable>;
      })}
      <Pressable accessibilityRole="radio" accessibilityState={{ checked: custom }} aria-checked={custom} accessibilityLabel={t('Khác')}
        onPress={() => setCustom(true)} style={({ hovered }) => [s.size, custom && s.sizeOn, hovered && !custom && { backgroundColor: C.paper }]}>
        <Text style={[s.sizeText, custom && { color: '#fff' }]}>{t('Khác')}</Text>
      </Pressable>
    </View>
    {custom ? <View style={{ gap: 6 }}>
      <TextInput testID="route-custom-count" accessibilityLabel={t('Số điểm muốn tham quan')} value={customText} onChangeText={value => setCustomText(value.replace(/[^0-9-]/g, '').slice(0, 4))}
        keyboardType="number-pad" inputMode="numeric" placeholder={max ? `${t('Từ 1 đến')} ${max}` : '…'} placeholderTextColor={C.faint}
        style={[s.input, !!customText && !!customCheck.error && { borderColor: C.danger }]} />
      <Text testID="route-custom-hint" style={[s.note, !!customText && !!customCheck.error && { color: C.danger }]}>{customText && customCheck.error ? t(customCheck.error) : max ? `${t('Nhập từ 1 đến')} ${max} ${t('điểm')}.` : t('Đang tải danh sách địa điểm…')}</Text>
    </View> : null}

    <PrimaryButton title={route ? 'Lập lại hành trình tối ưu' : 'Lập hành trình tối ưu'} icon="navigate-outline" loading={loading} disabled={custom && (!max || !!customCheck.error)} onPress={start} />
    {loading && waitingGps ? <Text style={s.note}>{t('Đang lấy vị trí GPS của bạn…')}</Text> : null}
    {gpsFailed ? <View style={s.warn}>
      <Text style={s.warnText}>{t('Không lấy được GPS. Bạn có thể lập hành trình xuất phát từ trung tâm Quận 1.')}</Text>
      <ChipButton icon="flag-outline" label={t('Xuất phát từ trung tâm Quận 1')} onPress={() => { setWaitingGps(false); void plan(null); }} />
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text> : null}

    {route ? <View style={{ gap: 12 }}>
      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statValue}>{route.legs.length}</Text><Text style={s.statLabel}>{t('điểm dừng')}</Text></View>
        <View style={s.stat}><Text style={s.statValue}>≈ {km(route.walkingKm)} km</Text><Text style={s.statLabel}>{t('đi bộ')}</Text></View>
        <View style={s.stat}><Text style={s.statValue}>~{route.walkingMinutes}′</Text><Text style={s.statLabel}>{t('thời gian đi')}</Text></View>
      </View>
      <Text style={s.note}>{t('Ước tính theo đường chim bay × 1,3, tốc độ 4,5 km/h; chưa tính thời gian tham quan.')}</Text>

      {tour ? <TourPlayer /> : <PrimaryButton title="Bắt đầu thuyết minh tự động" icon="headset-outline" onPress={() => setTour({ phase: 'intro', index: 0, visited: [], heardEarly: [], early: false })} />}
      {!tour ? <Text style={s.note}>{t('Ứng dụng đọc lời giới thiệu, hỏi bạn đã đến từng điểm chưa rồi mới thuyết minh, và dẫn đường sang điểm tiếp theo.')}</Text> : null}

      <View style={s.origin}>
        <View style={s.originDot} />
        <Text style={s.originText}>{t(fromCenter ? 'Xuất phát: trung tâm Quận 1' : 'Xuất phát: vị trí của bạn')}</Text>
      </View>
      {route.legs.map((leg, index) => <View key={leg.place.id} style={s.leg}>
        <View style={s.num}><Text style={s.numText}>{index + 1}</Text></View>
        <PlaceImage uri={leg.place.image} thumbnailUri={leg.place.imageThumbnail} label={leg.place.title} style={s.thumb} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text numberOfLines={2} style={s.legTitle}>{leg.place.title}</Text>
          <Text style={s.legMeta}>+{km(leg.legKm)} km · {t('tổng')} {km(leg.cumulativeKm)} km</Text>
          <View style={s.legActions}>
            <ChipButton icon="headset-outline" tone="solid" label={t('Nghe & xem')} accessibilityLabel={`${t('Nghe & xem')} ${leg.place.title}`} onPress={() => openMapDetail(leg.place, m)} />
            <ChipButton icon="locate-outline" tone="ghost" label={t('Bản đồ')} accessibilityLabel={`${t('Xem bản đồ')} ${leg.place.title}`} onPress={() => m.selectPlace(leg.place.id)} />
            <ChipButton icon="trash-outline" tone="danger" label={t('Xóa')} accessibilityLabel={`${t('Xóa khỏi hành trình')} ${leg.place.title}`} onPress={() => removeStop(leg.place.id)} />
          </View>
        </View>
      </View>)}

      <PrimaryButton title="Chỉ đường đi bộ trên Google Maps" icon="walk-outline" variant="outline" onPress={() => void Linking.openURL(googleMapsRouteUrl(route)).catch(() => {})} />
      {route.legs.length > 10 ? <Text style={s.note}>{t('Google Maps chỉ nhận tối đa 10 điểm đầu tiên của hành trình.')}</Text> : null}
      <ChipButton icon="close-circle-outline" tone="danger" label={t('Xóa hành trình')} onPress={clear} />
    </View> : null}
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.white, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 18, gap: 12, marginTop: 16 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.ink, fontSize: 18, fontWeight: '800' },
  sub: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  label: { color: C.ink, fontSize: 13, fontWeight: '700' },
  sizes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  size: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white },
  sizeOn: { backgroundColor: C.darkBlue, borderColor: C.darkBlue },
  sizeText: { color: C.ink, fontWeight: '700', fontSize: 13 },
  input: { minHeight: 46, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: C.ink, backgroundColor: C.white },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  warn: { backgroundColor: '#FFF7ED', borderRadius: 14, padding: 12, gap: 10 },
  warnText: { color: '#9A3412', fontSize: 13, lineHeight: 19 },
  error: { color: C.danger, fontSize: 13 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: C.primarySoft, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  statValue: { color: C.primaryDark, fontSize: 17, fontWeight: '900' },
  statLabel: { color: C.primaryDark, fontSize: 11, marginTop: 2 },
  origin: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8 },
  originDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#2563EB', borderWidth: 3, borderColor: '#BFDBFE' },
  originText: { color: C.ink, fontWeight: '700', fontSize: 13 },
  leg: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingTop: 12, borderTopWidth: 1, borderColor: C.border },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.darkBlue, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  numText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  legTitle: { color: C.ink, fontSize: 15, fontWeight: '700' },
  legMeta: { color: C.muted, fontSize: 12 },
  legActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
