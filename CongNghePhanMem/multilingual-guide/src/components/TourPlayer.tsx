import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NarrationContent, Place } from '../data/places';
import { useApp } from '../context/AppContext';
import { useOptimalRoute, type TourState } from '../hooks/useOptimalRoute';
import { useI18n } from '../hooks/useI18n';
import { closingScript, introScript, transitionScript } from '../services/tourScript';
import { C } from '../theme/colors';
import { PrimaryButton } from './auth';
import ChipButton from './ChipButton';
import PlaceImage from './PlaceImage';

const blank = { vi: '', en: '', fr: '', ja: '' };
/** A spoken script (intro, bridge, closing) is played through the same player as a guide. */
const scriptPlace = (id: string, title: string): Place => ({
  id, title, subtitle: blank, description: blank, category: 'Khám phá', district: '', latitude: 0, longitude: 0, image: '', duration: 0, rating: 0,
});

export default function TourPlayer() {
  const { t } = useI18n();
  const { language, speak, stop, speechCompletion, speechStatus, playingId, pauseSpeech, resumeSpeech, canPauseSpeech, speechError } = useApp();
  const { route, tour, fromCenter, setTour, removeStop } = useOptimalRoute();
  const expected = useRef<string | null>(null);
  const started = useRef('');
  const seenCompletion = useRef(speechCompletion?.sequence ?? 0);
  const counter = useRef(0);
  const legs = useMemo(() => route?.legs ?? [], [route]);
  const current = tour ? legs[tour.index]?.place : undefined;

  const say = useCallback((title: string, text: string) => {
    const id = `tour-script-${++counter.current}`;
    expected.current = id;
    stop();
    const content: NarrationContent = { text, language, source: 'description', title };
    void speak(scriptPlace(id, title), content);
  }, [language, speak, stop]);

  /** Move the tour forward once the current narration has finished (or was skipped). */
  const advance = useCallback((from: TourState) => {
    const place = legs[from.index]?.place;
    if (from.phase === 'intro') setTour({ ...from, phase: 'confirm', index: 0 });
    else if (from.phase === 'narrating' && place) {
      if (from.early) setTour({ ...from, phase: 'confirm', early: false, heardEarly: [...new Set([...from.heardEarly, place.id])] });
      else {
        const visited = [...new Set([...from.visited, place.id])];
        setTour({ ...from, visited, phase: from.index >= legs.length - 1 ? 'closing' : 'transition' });
      }
    } else if (from.phase === 'transition') setTour({ ...from, phase: 'confirm', index: from.index + 1 });
    else if (from.phase === 'closing') setTour({ ...from, phase: 'done' });
  }, [legs, setTour]);

  // Start the narration that belongs to the current phase exactly once.
  useEffect(() => {
    if (!tour || !route || !legs.length) return;
    const key = `${tour.phase}:${tour.index}:${tour.early}:${legs.map(leg => leg.place.id).join(',')}`;
    if (started.current === key) return;
    started.current = key;
    if (tour.phase === 'intro') say(t('Mở đầu hành trình'), introScript(legs.map(leg => leg.place), route.start, route.walkingKm, route.walkingMinutes, language));
    else if (tour.phase === 'transition' && legs[tour.index + 1]) say(t('Đường đến điểm tiếp theo'), transitionScript(legs[tour.index].place, legs[tour.index + 1].place, tour.index + 1, legs.length, language));
    else if (tour.phase === 'closing') say(t('Kết thúc hành trình'), closingScript(tour.visited.length, legs.length, language));
    else if (tour.phase === 'narrating' && current) { expected.current = current.id; stop(); void speak(current); }
  }, [tour, route, legs, current, language, say, speak, stop, t]);

  // A finished utterance advances the tour.
  useEffect(() => {
    if (!speechCompletion || speechCompletion.sequence === seenCompletion.current) return;
    seenCompletion.current = speechCompletion.sequence;
    if (tour && speechCompletion.id === expected.current) { expected.current = null; advance(tour); }
  }, [speechCompletion, tour, advance]);

  if (!tour || !route || !legs.length) return null;
  const speaking = playingId !== null && (playingId.startsWith('tour-script-') || playingId === current?.id);
  const skip = () => { expected.current = null; stop(); advance(tour); };
  const end = () => { expected.current = null; stop(); setTour(null); };
  const replay = () => { started.current = ''; setTour({ ...tour }); };
  const total = legs.length;
  const stepLabel = tour.phase === 'done' ? t('Đã hoàn thành') : `${t('Điểm')} ${Math.min(tour.index + 1, total)}/${total}`;
  const phaseLabel = {
    intro: 'Giới thiệu hành trình', confirm: 'Chờ bạn xác nhận', narrating: tour.early ? 'Nghe trước khi đến' : 'Đang thuyết minh',
    transition: 'Đường đến điểm tiếp theo', closing: 'Kết thúc hành trình', done: 'Hành trình đã hoàn thành',
  }[tour.phase];

  return <View testID="tour-player" style={s.card}>
    <View style={s.head}>
      <Ionicons name="headset" size={20} color={C.primary} />
      <Text style={s.title}>{t('Thuyết minh tự động')}</Text>
      <Text style={s.step}>{stepLabel}</Text>
    </View>
    <View style={s.dots}>{legs.map((leg, i) => <View key={leg.place.id} style={[s.dot, tour.visited.includes(leg.place.id) && s.dotDone, i === tour.index && tour.phase !== 'done' && s.dotNow]} />)}</View>
    <Text testID="tour-phase" style={s.phase}>{t(phaseLabel)}</Text>

    {tour.phase === 'confirm' && current ? <View style={s.ask}>
      <PlaceImage uri={current.image} thumbnailUri={current.imageThumbnail} label={current.title} style={s.askImage} />
      <Text accessibilityRole="header" style={s.askTitle}>{t('Bạn chắc chắn đã đến')} {current.title} {t('chưa?')}</Text>
      <Text style={s.askSub}>{t(tour.index === 0 && !fromCenter ? 'Ứng dụng không kiểm tra GPS — hãy xác nhận khi bạn đã đứng tại địa điểm.' : 'Ứng dụng không kiểm tra GPS — chỉ cần bạn xác nhận.')}</Text>
      <PrimaryButton title="Tôi đã đến, bắt đầu thuyết minh" icon="checkmark-circle-outline" onPress={() => setTour({ ...tour, phase: 'narrating', early: false })} />
      {tour.heardEarly.includes(current.id) ? <ChipButton icon="play-skip-forward" tone="ghost" label={t('Đã đến, sang điểm tiếp theo')} onPress={() => advance({ ...tour, phase: 'narrating', early: false })} /> : null}
      <View style={s.row}>
        <ChipButton icon="headset-outline" tone="soft" label={t(tour.heardEarly.includes(current.id) ? 'Nghe lại trước khi đến' : 'Nghe trước khi đến')} onPress={() => setTour({ ...tour, phase: 'narrating', early: true })} />
        <ChipButton icon="trash-outline" tone="danger" label={t('Xóa khỏi hành trình')} accessibilityLabel={`${t('Xóa khỏi hành trình')} ${current.title}`} onPress={() => { stop(); removeStop(current.id); }} />
      </View>
    </View> : null}

    {['intro', 'narrating', 'transition', 'closing'].includes(tour.phase) ? <View style={s.playing}>
      {current && tour.phase === 'narrating' ? <Text style={s.now}>{current.title}</Text> : null}
      {speechError ? <Text accessibilityRole="alert" style={s.error}>{t(speechError)}</Text> : null}
      <View style={s.row}>
        {speaking && canPauseSpeech && speechStatus !== 'loading' ? <ChipButton icon={speechStatus === 'paused' ? 'play' : 'pause'} tone="ghost" label={t(speechStatus === 'paused' ? 'Tiếp tục' : 'Tạm dừng')} onPress={speechStatus === 'paused' ? resumeSpeech : pauseSpeech} /> : null}
        {!speaking ? <ChipButton icon="refresh" tone="ghost" label={t('Phát lại')} onPress={replay} /> : null}
        <ChipButton icon="play-forward" tone="ghost" label={t('Bỏ qua đoạn này')} onPress={skip} />
      </View>
    </View> : null}

    {tour.phase === 'done' ? <Text style={s.done}>{t('Bạn đã ghé')} {tour.visited.length}/{total} {t('điểm. Cảm ơn bạn đã đồng hành!')}</Text> : null}
    <ChipButton icon="stop-circle-outline" tone="danger" label={t(tour.phase === 'done' ? 'Đóng thuyết minh tự động' : 'Dừng thuyết minh tự động')} onPress={end} />
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: '#F0FDFA', borderRadius: 18, borderWidth: 1, borderColor: C.primarySoft, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: C.ink, fontWeight: '800', fontSize: 16 },
  step: { color: C.primaryDark, fontWeight: '800', fontSize: 13 },
  dots: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  dot: { width: 18, height: 6, borderRadius: 3, backgroundColor: C.border },
  dotDone: { backgroundColor: C.success },
  dotNow: { backgroundColor: '#F97316' },
  phase: { color: C.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: .5 },
  ask: { backgroundColor: C.white, borderRadius: 16, padding: 12, gap: 10 },
  askImage: { width: '100%', height: 150, borderRadius: 12 },
  askTitle: { color: C.ink, fontSize: 17, fontWeight: '800', lineHeight: 24 },
  askSub: { color: C.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  playing: { gap: 8 },
  now: { color: C.ink, fontWeight: '800', fontSize: 15 },
  error: { color: C.danger, fontSize: 13 },
  done: { color: C.ink, fontSize: 14, lineHeight: 20 },
});
