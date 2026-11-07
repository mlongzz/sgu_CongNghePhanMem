import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { LANGS, type Place, type NarrationContent } from '../../src/data/places';
import { useApp } from '../../src/context/AppContext';
import { C } from '../../src/theme/colors';
import PlaceImage from '../../src/components/PlaceImage';
import ImageCredit from '../../src/components/ImageCredit';
import PlaceGallery from '../../src/components/PlaceGallery';
import PlaceReviews from '../../src/components/PlaceReviews';
import { LanguageSelector } from '../../src/components/auth';
import { apiFetch, ApiError } from '../../src/services/api';
import { validateBackendPlace } from '../../src/services/nearby';
import { fetchWikipediaPhotos, type ProviderPhoto } from '../../src/services/providerImages';
import { fetchWikipediaPlace } from '../../src/services/wikipediaContent';
import { resolveNarration, NO_NARRATION } from '../../src/services/narration';
import SpeechVoiceSelector from '../../src/components/SpeechVoiceSelector';
import { useI18n } from '../../src/hooks/useI18n';
import LanguageMenu from '../../src/components/LanguageMenu';
import { openDirections } from '../../src/services/directions';

export default function PlaceDetail() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const { t } = useI18n();
  const databaseId = /^db-[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id.slice(3)));
  const { language, setLanguage, isFavorite, toggleFavorite, playingId, speak, stop, speechError,
    speechStatus, speechRate, setSpeechRate, pauseSpeech, resumeSpeech, canPauseSpeech,
    findPlace, registerPlace, token, user, favoriteError, places, authLoading } = useApp();
  const [voiceChoice, setVoiceChoice] = useState<{ language: typeof language; identifier?: string }>({ language });
  const selectedVoice = voiceChoice.language === language ? voiceChoice.identifier : undefined;
  const [placeLoading, setPlaceLoading] = useState(true);
  const [placeError, setPlaceError] = useState('');
  const [unavailableId, setUnavailableId] = useState('');
  const [retry, setRetry] = useState(0);
  const [contentRetry, setContentRetry] = useState(0);
  const [remotePlace, setRemotePlace] = useState<Place | null>(null);
  const cachedPlace = findPlace(id);
  const p = unavailableId === id ? undefined : remotePlace?.id === id ? remotePlace : cachedPlace;
  const lastVisit = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setPlaceError(''); setPlaceLoading(true);
      try {
        if (databaseId) {
          const value = await apiFetch<unknown>(`/places/${Number(id.slice(3))}`, { signal: controller.signal });
          const result = validateBackendPlace(value);
          if (!result) throw new Error('Máy chủ trả địa điểm không hợp lệ.');
          const unchangedIdentity = cachedPlace && result.title === cachedPlace.title && result.latitude === cachedPlace.latitude && result.longitude === cachedPlace.longitude && result.sourceUrl === cachedPlace.sourceUrl;
          if (!controller.signal.aborted) { setUnavailableId(''); setRemotePlace({ ...result, wikipedia: result.wikipedia ?? (unchangedIdentity ? cachedPlace.wikipedia : undefined), wikipediaUrl: result.wikipediaUrl ?? (unchangedIdentity ? cachedPlace.wikipediaUrl : undefined) }); }
        } else if (!cachedPlace && /^wiki-(vi|en|fr|ja)-\d+$/.test(id)) {
          const result = await fetchWikipediaPlace(id, { signal: controller.signal });
          if (!controller.signal.aborted) setRemotePlace(result);
        }
      } catch (error) { if (!controller.signal.aborted) { if (databaseId && error instanceof ApiError && error.status === 404) setUnavailableId(id); setPlaceError(error instanceof Error ? error.message : 'Không tải được địa điểm.'); } }
      finally { if (!controller.signal.aborted) setPlaceLoading(false); }
    })();
    return () => controller.abort();
  }, [id, databaseId, retry, cachedPlace]);
  useEffect(() => {
    const key = `${user?.id}:${id}`;
    if (token && databaseId && lastVisit.current !== key) {
      lastVisit.current = key;
      void apiFetch(`/history/${Number(id.slice(3))}`, { token, method: 'POST' }).catch(() => { lastVisit.current = ''; });
    }
  }, [id, databaseId, token, user?.id]);
  const [result, setResult] = useState<{ key: string; place: Place; content: NarrationContent | null; error: string } | null>(null);
  const contentKey = `${id}:${language}:${contentRetry}`;
  const currentResult = result?.key === contentKey && result.place === p ? result : null;
  const content = currentResult?.content ?? null;
  const contentError = currentResult?.error ?? '';
  const contentLoading = !!p && !currentResult;
  useEffect(() => {
    if (!p) return;
    const controller = new AbortController();
    void resolveNarration(p, language, { signal: controller.signal, forceRefresh: contentRetry > 0, officialPlaces: places })
      .then(content => {
        if (controller.signal.aborted) return;
        setResult({ key: contentKey, place: p, content, error: '' });
        // Preserve attributed article text for an explicit, visibly cached offline fallback after reload.
        if (content?.source === 'wikipedia' && p.source !== 'backend'
          && (p.narration?.[language]?.text !== content.text || p.narration?.[language]?.sourceUrl !== content.sourceUrl)) {
          registerPlace({ ...p, narration: { ...p.narration, [language]: content } });
        }
      })
      .catch(error => { if (!controller.signal.aborted) setResult({ key: contentKey, place: p, content: null, error: error instanceof Error ? error.message : 'Không tải được nội dung.' }); });
    return () => controller.abort();
  }, [p, language, contentKey, contentRetry, places, registerPlace]);
  const [detailPhoto,setDetailPhoto] = useState<{key:string;photo?:ProviderPhoto}>({key:''});
  useEffect(()=>{
    if (!p || p.image || p.source !== 'wikipedia') return;
    const controller=new AbortController();
    void fetchWikipediaPhotos([p],controller.signal).then(photos=>{if(!controller.signal.aborted)setDetailPhoto({key:p.id,photo:photos[p.id]});});
    return ()=>controller.abort();
  },[p]);
  const photo=detailPhoto.key===p?.id ? detailPhoto.photo : undefined;
  useFocusEffect(useCallback(() => () => stop(), [stop]));
  useEffect(() => () => stop(), [id, stop]);
  if (!p && placeLoading) return <SafeAreaView style={s.safe}><View style={s.missing}><ActivityIndicator size="large" color={C.primary}/><Text style={s.missingSub}>{t('Đang tải địa điểm…')}</Text></View></SafeAreaView>;
  if (!p) return <SafeAreaView style={s.safe}><View style={s.missing}><View style={s.missingIcon}><Ionicons name="location-outline" size={34} color={C.primary}/></View><Text style={s.missingText}>{t(placeError || 'Không tìm thấy địa điểm. Hãy chọn lại từ bản đồ.')}</Text><View style={s.missingActions}><Pressable accessibilityRole="button" style={({ hovered }) => [s.missingBtn, s.missingPrimary, hovered && { backgroundColor: C.primaryDark }]} onPress={() => setRetry(v => v + 1)}><Ionicons name="refresh" size={18} color="#fff"/><Text style={s.missingPrimaryText}>{t('Thử tải lại')}</Text></Pressable><Pressable accessibilityRole="button" style={({ hovered }) => [s.missingBtn, s.missingOutline, hovered && { backgroundColor: C.primarySoft }]} onPress={() => router.canGoBack() ? router.back() : router.replace('/map')}><Ionicons name="map-outline" size={18} color={C.primary}/><Text style={s.missingOutlineText}>{t('Quay lại bản đồ')}</Text></Pressable></View></View></SafeAreaView>;
  const playing = playingId === p.id;
  const isDatabase = databaseId;
  const directions = () => { void openDirections(p, t); };
  const voiceState = playing ? speechStatus === 'paused' ? 'Đang tạm dừng' : speechStatus === 'loading' ? 'Đang chuẩn bị giọng đọc…' : 'Đang phát'
    : contentLoading ? 'Đang tải nội dung thuyết minh…' : !content ? 'Không có nội dung để phát' : speechError ? 'Không thể phát, hãy thử lại' : 'Nhấn nghe để kiểm tra giọng đọc';
  return <View style={s.screen}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 155 }}>
    <View style={s.hero}><PlaceImage uri={photo?.image ?? p.image} thumbnailUri={p.imageThumbnail} label={p.title} style={StyleSheet.absoluteFill}/><LinearGradient colors={['rgba(7,24,35,.5)', 'transparent', 'rgba(10,36,43,.9)']} style={StyleSheet.absoluteFill}/>
      <SafeAreaView style={s.heroActions}><Pressable accessibilityRole="button" accessibilityLabel={t('Quay lại')} onPress={() => router.canGoBack() ? router.back() : router.replace('/map')} style={s.action}><Ionicons name="arrow-back" size={22} color="#fff"/></Pressable>
        <View style={{ flexDirection: 'row', gap: 10 }}><LanguageMenu /><Pressable accessibilityRole="button" disabled={authLoading} accessibilityState={{ disabled: authLoading, busy: authLoading }} accessibilityLabel={t(isFavorite(p.id) ? 'Bỏ lưu địa điểm yêu thích' : 'Lưu địa điểm yêu thích')} onPress={() => { if (!isDatabase) registerPlace(p); toggleFavorite(p.id); }} style={[s.action, authLoading && { opacity: 0.5 }]}><Ionicons name={isFavorite(p.id) ? 'heart' : 'heart-outline'} size={22} color={isFavorite(p.id) ? '#FFB9A3' : '#fff'}/></Pressable></View>
      </SafeAreaView><View style={s.heroCaption}><Text style={s.location}>{p.district}</Text><Text style={s.title}>{p.title}</Text><Text style={s.description}>{p.subtitle[language]}</Text></View>
    </View>
    <View style={s.content}><View style={s.badges}><View style={s.badge}><Text style={s.badgeText}>{t(p.category)}</Text></View><View style={s.badge}><Text style={s.badgeText}>{isDatabase ? t('Địa điểm hệ thống') : p.source === 'wikipedia' ? 'Wikipedia' : p.source === 'wikidata' ? 'Wikidata' : 'OpenStreetMap'}</Text></View></View>
      {Boolean(p.sourceUrl || p.sourceLicense || p.imageAttribution || p.imageLicense) && <View style={{ gap: 7, marginBottom: 20 }}>{Boolean(p.sourceUrl) && <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(p.sourceUrl!).catch(() => {})}><Text style={{ color: C.primary }}>{t('Nguồn địa danh')} ↗</Text></Pressable>}{Boolean(p.sourceLicense) && <Text style={s.voiceSub}>{p.sourceLicense}</Text>}<ImageCredit place={{...p,...photo}}/></View>}
      <LanguageSelector value={language} onChange={value => setLanguage(value as typeof language)}/>
      {!!favoriteError && <Text accessibilityRole="alert" style={{ color: C.danger }}>{favoriteError}</Text>}
      {!!placeError && <Text accessibilityRole="alert" style={{ color: C.danger }}>{placeError} Đang hiển thị thông tin đã lưu.</Text>}
      <Text style={s.section}>{t('Câu chuyện của địa điểm')}</Text>
      {contentLoading ? <View><ActivityIndicator color={C.primary}/><Text>{t('Đang tải nội dung thuyết minh…')}</Text></View> : <Text testID="narration-text" style={s.body}>{content?.text || (contentError ? t(contentError) : t(NO_NARRATION))}</Text>}
      {!contentLoading && !content && <View><Text style={s.body}>{t('Chọn ngôn ngữ khác hoặc thử tải lại nội dung.')}</Text><Pressable accessibilityRole="button" onPress={() => setContentRetry(v => v + 1)}><Text style={{ color: C.primary }}>{t('Thử tải lại nội dung')}</Text></Pressable></View>}
      {content && <View style={{ gap: 8, marginBottom: 20 }}><Text testID="narration-attribution" style={{ color: C.muted }}>{t(content.attribution || (content.source === 'published' ? 'Bài thuyết minh do hệ thống xuất bản.' : 'Nội dung tham khảo; chưa được Admin duyệt.'))}</Text>
        {content.source === 'wikipedia' && <Text style={{ color: C.muted }}>{t('Bản đọc tạm thời từ Wikipedia; chưa được Admin duyệt.')}</Text>}
        {Boolean(content.sourceLicense) && <Text style={{ color: C.muted }}>{content.sourceLicense}</Text>}
        {Boolean(content.sourceUrl) && <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(content.sourceUrl!).catch(() => {})}><Text style={{ color: C.primary }}>{t(content.source === 'wikipedia' ? 'Đọc nguồn gốc và lịch sử tác giả' : 'Xem nguồn thông tin')}</Text></Pressable>}
        {Boolean(content.licenseUrl) && <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(content.licenseUrl!).catch(() => {})}><Text style={{ color: C.primary }}>{t('Giấy phép sử dụng nội dung')}</Text></Pressable>}
      </View>}
      <View style={s.voiceCard}><View style={{ flex: 1 }}><Text style={s.voiceName}>{t('Hướng dẫn viên âm thanh')}</Text><Text testID="narration-status" style={s.voiceSub}>{LANGS.find(l => l.key === language)?.label} · {t(voiceState)}</Text></View></View>
      <SpeechVoiceSelector language={language} value={selectedVoice} onChange={identifier => { stop(); setVoiceChoice({ language, identifier }); }}/>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>{[0.75, 1, 1.25, 1.5].map(rate => <Pressable key={rate} accessibilityRole="button" accessibilityLabel={`${t('Tốc độ')} ${rate}×`} accessibilityState={{ selected: rate === speechRate }} style={[s.badge, rate === speechRate && { backgroundColor: C.primarySoft }]} onPress={() => setSpeechRate(rate)}><Text>{rate}×</Text></Pressable>)}</View>
      <Text style={s.voiceSub}>{t('Đổi tốc độ hoặc ngôn ngữ sẽ dừng bài đang phát. Nhấn Nghe để phát lại.')}</Text>
      {!!speechError && <Text accessibilityRole="alert" style={{ color: C.danger, marginVertical: 18 }}>{t(speechError)}</Text>}
      <Text style={s.section}>{t('Vị trí')}</Text><View style={s.address}><View style={{ flex: 1 }}><Text style={s.addressName}>{p.district}</Text><Text style={s.coordinates}>{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t('Chỉ đường')} onPress={directions}><Ionicons name="open-outline" size={21} color={C.primary}/></Pressable></View>
      {isDatabase && <><PlaceGallery placeId={p.id} placeTitle={p.title} /><PlaceReviews placeId={Number(p.id.slice(3))}/></>}
    </View>
  </ScrollView><View style={s.bottom}>
    <Pressable testID="narration-playback" accessibilityRole="button" disabled={!playing && (!content || contentLoading)} accessibilityLabel={t(playing ? 'Dừng thuyết minh' : 'Nghe thuyết minh')} onPress={() => playing ? stop() : void speak(p, content!, selectedVoice)} style={[s.listen, playing && s.stop, !playing && !content && { opacity: .45 }]}><Ionicons name={playing ? 'stop-circle-outline' : 'play-circle'} size={22} color="#fff"/><Text style={s.listenText}>{t(playing ? 'Dừng thuyết minh' : contentLoading ? 'Đang tải nội dung…' : 'Nghe thuyết minh')}</Text></Pressable>
    {playing && canPauseSpeech && speechStatus !== 'loading' && <Pressable accessibilityRole="button" accessibilityLabel={t(speechStatus === 'paused' ? 'Tiếp tục thuyết minh' : 'Tạm dừng thuyết minh')} onPress={speechStatus === 'paused' ? resumeSpeech : pauseSpeech} style={s.route}><Ionicons name={speechStatus === 'paused' ? 'play' : 'pause'} size={22} color={C.primary}/></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('Chỉ đường')} onPress={directions} style={s.route}><Ionicons name="navigate-outline" size={22} color={C.primary}/></Pressable>
  </View></View>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:C.paper},safe:{flex:1,backgroundColor:C.paper},hero:{height:330,backgroundColor:C.darkBlue},heroActions:{position:'absolute',left:18,right:18,top:5,flexDirection:'row',justifyContent:'space-between'},action:{width:43,height:43,borderRadius:16,backgroundColor:'rgba(12,34,43,.46)',justifyContent:'center',alignItems:'center'},heroCaption:{position:'absolute',bottom:34,left:22,right:22},location:{color:'#C8EFE6',fontWeight:'800',fontSize:12,marginBottom:10},title:{color:'#fff',fontSize:29,fontWeight:'900',lineHeight:36,letterSpacing:-.7},description:{color:'#EDF7F6',marginTop:7,fontSize:13},content:{width:'100%',maxWidth:980,alignSelf:'center',backgroundColor:C.paper,borderTopLeftRadius:25,borderTopRightRadius:25,marginTop:-18,paddingTop:24,paddingHorizontal:22},badges:{flexDirection:'row',gap:8,flexWrap:'wrap',marginBottom:20},badge:{backgroundColor:C.white,borderColor:C.border,borderWidth:1,borderRadius:12,paddingHorizontal:12,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:7},badgeText:{color:C.ink,fontWeight:'800',fontSize:11},section:{fontSize:19,fontWeight:'900',color:C.ink,marginBottom:12},body:{color:'#586D7B',fontSize:14,lineHeight:25,marginBottom:20},voiceCard:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:C.primarySoft,borderRadius:19,padding:15,marginBottom:22},voiceIcon:{width:48,height:48,backgroundColor:C.white,borderRadius:15,alignItems:'center',justifyContent:'center'},voiceName:{fontSize:13,fontWeight:'900',color:C.ink},voiceSub:{fontSize:11,color:C.muted,marginTop:5},address:{backgroundColor:C.white,borderRadius:17,padding:17,flexDirection:'row',alignItems:'center',gap:11,borderWidth:1,borderColor:C.border},addressName:{fontSize:12,fontWeight:'800',color:C.ink},coordinates:{fontSize:10,color:C.muted,marginTop:5},bottom:{position:'absolute',bottom:0,left:0,right:0,width:'100%',maxWidth:980,alignSelf:'center',marginHorizontal:'auto',paddingHorizontal:18,paddingTop:12,paddingBottom:27,backgroundColor:'rgba(255,255,255,.98)',flexDirection:'row',gap:10,borderTopWidth:1,borderTopColor:C.border},listen:{flex:1,backgroundColor:C.primary,height:56,borderRadius:17,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},stop:{backgroundColor:C.darkBlue},listenText:{color:'#fff',fontWeight:'900',fontSize:13},route:{height:56,width:57,backgroundColor:C.primarySoft,borderRadius:17,alignItems:'center',justifyContent:'center'},missing:{flex:1,alignItems:'center',justifyContent:'center',gap:16,padding:28,width:'100%',maxWidth:460,alignSelf:'center'},missingIcon:{width:72,height:72,borderRadius:24,backgroundColor:C.primarySoft,alignItems:'center',justifyContent:'center'},missingText:{fontWeight:'900',fontSize:19,lineHeight:27,color:C.ink,textAlign:'center'},missingSub:{color:C.muted,fontSize:14},missingActions:{width:'100%',gap:10,marginTop:6},missingBtn:{minHeight:50,borderRadius:14,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,paddingHorizontal:18},missingPrimary:{backgroundColor:C.primary},missingOutline:{borderWidth:1.5,borderColor:C.primary},missingPrimaryText:{color:'#fff',fontWeight:'800',fontSize:15},missingOutlineText:{color:C.primary,fontWeight:'800',fontSize:15}});
