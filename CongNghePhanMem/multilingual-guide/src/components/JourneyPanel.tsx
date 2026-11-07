import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { MapDiscovery } from '../hooks/useMapDiscovery';
import { useJourney } from '../context/JourneyContext';
import { useI18n } from '../hooks/useI18n';
import { PrimaryButton } from './auth';
import ChipButton from './ChipButton';
import { ErrorMessage, LoadingState } from './Screen';
import { openMapDetail, openMapDirections } from './MapDiscoveryPanel';
import { C } from '../theme/colors';

export default function JourneyPanel({ model: m }: { model: MapDiscovery }) {
  const { t } = useI18n(), route = useJourney();
  if (!m.journeyMode) return null;
  const progress = m.routeProgress;
  const stops = progress?.journey.stops ?? [];
  return <View testID="journey-stops" style={s.panel}>
    <View style={s.header}>
      <View style={s.headerIcon}><Ionicons name="flag" size={18} color={C.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={s.title}>{progress?.journey.name ?? t('Hành trình khám phá')}</Text>
        {!!stops.length && <Text style={s.sub}>{stops.length} {t('điểm dừng')}</Text>}
      </View>
    </View>
    {m.journeyLoading ? <LoadingState /> : null}
    <ErrorMessage message={m.journeyError} />
    {!!m.journeyError && m.journeyId !== null && <PrimaryButton title="Thử lại" onPress={m.retryJourney} variant="outline" />}
    {progress && !stops.length && <Text style={s.hint}>{t('Hành trình chưa có điểm dừng đã xuất bản.')}</Text>}
    {!!stops.length && <Text style={s.hint}>{t('Ưu tiên điểm đứng trước khi nhiều điểm cùng gần; bạn có thể nghe theo thứ tự linh hoạt.')}</Text>}
    {progress && stops.map((point, index) => {
      const done = progress.completed.includes(point.id), skipped = progress.skipped.includes(point.id);
      const status = done ? 'Đã nghe xong' : skipped ? 'Đã bỏ qua' : 'Chưa nghe xong';
      return <View key={point.id} style={s.stop}>
        <View style={s.stopHead}>
          <View style={[s.num, done && s.numDone, skipped && s.numSkip]}>
            {done ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text style={[s.numText, skipped && { color: C.muted }]}>{index + 1}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={s.stopTitle}>{point.title}</Text>
            <Text style={[s.status, done && { color: C.success }]}>{t(status)}</Text>
          </View>
        </View>
        <View style={s.actions}>
          <ChipButton icon="locate-outline" label={t('Bản đồ')} accessibilityLabel={`${t('Xem bản đồ')} ${point.title}`} onPress={() => m.selectPlace(point.id)} tone="ghost" />
          <ChipButton icon="play" label={t('Nghe')} accessibilityLabel={`${t('Nghe')} ${point.title}`} onPress={() => void route.play(point)} tone="solid" />
          <ChipButton icon="information-circle-outline" label={t('Chi tiết')} accessibilityLabel={`${t('Chi tiết')} ${point.title}`} onPress={() => openMapDetail(point, m)} tone="ghost" />
          <ChipButton icon="navigate-outline" label={t('Chỉ đường')} accessibilityLabel={`${t('Mở bản đồ ngoài')} ${point.title}`} onPress={() => openMapDirections(point, t)} tone="ghost" />
        </View>
      </View>;
    })}
    <ChipButton icon="exit-outline" label={t('Thoát hành trình')} onPress={() => { route.end(); router.replace('/map'); }} tone="danger" />
  </View>;
}

const s = StyleSheet.create({
  panel: { padding: 18, gap: 12, backgroundColor: C.white, borderRadius: 20, marginTop: 12, borderWidth: 1, borderColor: C.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '800', fontSize: 18, color: C.ink },
  sub: { color: C.muted, fontSize: 12, marginTop: 2 },
  hint: { color: C.muted, fontSize: 13, lineHeight: 19 },
  stop: { paddingTop: 14, gap: 10, borderTopWidth: 1, borderColor: C.border },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  num: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.darkBlue, alignItems: 'center', justifyContent: 'center' },
  numDone: { backgroundColor: C.success },
  numSkip: { backgroundColor: C.border },
  numText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  stopTitle: { color: C.ink, fontWeight: '700', fontSize: 15 },
  status: { color: C.muted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 44 },
});
