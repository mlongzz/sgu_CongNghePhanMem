import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { MapDiscovery } from '../hooks/useMapDiscovery';
import { useJourney } from '../context/JourneyContext';
import { useI18n } from '../hooks/useI18n';
import { PrimaryButton } from './auth';
import { ErrorMessage, LoadingState } from './Screen';
import { openMapDetail, openMapDirections } from './MapDiscoveryPanel';
import { C } from '../theme/colors';

export default function JourneyPanel({ model: m }: { model: MapDiscovery }) {
  const { t } = useI18n(), route = useJourney();
  if (!m.journeyMode) return null;
  const progress = m.routeProgress;
  return <View testID="journey-stops" style={{ padding: 16, gap: 12, backgroundColor: C.white, borderRadius: 16, marginTop: 12 }}>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 18 }}>{progress?.journey.name ?? t('Hành trình khám phá')}</Text>
    {m.journeyLoading ? <LoadingState /> : null}
    <ErrorMessage message={m.journeyError} />
    {!!m.journeyError && m.journeyId !== null && <PrimaryButton title="Thử lại" onPress={m.retryJourney} variant="outline" />}
    {progress && !progress.journey.stops.length && <Text>{t('Hành trình chưa có điểm dừng đã xuất bản.')}</Text>}
    {!!progress?.journey.stops.length && <Text>{t('Ưu tiên điểm đứng trước khi nhiều điểm cùng gần; bạn có thể nghe theo thứ tự linh hoạt.')}</Text>}
    {progress?.journey.stops.map((point, index) => <View key={point.id} style={{ paddingVertical: 10, gap: 8, borderTopWidth: 1, borderColor: C.border }}>
      <Text>{index + 1}. {point.title} · {t(progress.completed.includes(point.id) ? 'Đã nghe xong' : progress.skipped.includes(point.id) ? 'Đã bỏ qua' : 'Chưa nghe xong')}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <PrimaryButton title={`${t('Xem bản đồ')} ${point.title}`} onPress={() => m.selectPlace(point.id)} variant="outline" />
        <PrimaryButton title={`${t('Nghe')} ${point.title}`} onPress={() => void route.play(point)} variant="outline" />
        <PrimaryButton title={`${t('Chi tiết')} ${point.title}`} onPress={() => openMapDetail(point, m)} variant="outline" />
        <PrimaryButton title={`${t('Mở bản đồ ngoài')} ${point.title}`} onPress={() => openMapDirections(point, t)} variant="outline" />
      </View>
    </View>)}
    <PrimaryButton title="Thoát hành trình" onPress={() => { route.end(); router.replace('/map'); }} variant="outline" />
  </View>;
}
