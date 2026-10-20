import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { LANGS, type Place, type NarrationContent } from '../../src/data/places';
import { useApp } from '../../src/context/AppContext';
import { C } from '../../src/theme/colors';
import PlaceImage from '../../src/components/PlaceImage';
import PlaceReviews from '../../src/components/PlaceReviews';
import { LanguageSelector } from '../../src/components/auth';
import { apiFetch } from '../../src/services/api';
import { validateBackendPlace } from '../../src/services/nearby';
import { fetchWikipediaPlace } from '../../src/services/wikipediaContent';
import { resolveNarration, NO_NARRATION } from '../../src/services/narration';

export default function PlaceDetail() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const id = typeof routeId === 'string' ? routeId : '';
  const { language, setLanguage, isFavorite, toggleFavorite, playingId, speak, stop, speechError,
    speechStatus, speechRate, setSpeechRate, pauseSpeech, resumeSpeech, canPauseSpeech,
    findPlace, token, user, favoriteError, places } = useApp();
  const [placeLoading, setPlaceLoading] = useState(true);
  const [placeError, setPlaceError] = useState('');
  const [retry, setRetry] = useState(0);
  const [contentRetry, setContentRetry] = useState(0);
  const [remotePlace, setRemotePlace] = useState<Place | null>(null);
  const cachedPlace = findPlace(id);
  const p = remotePlace?.id === id ? remotePlace : cachedPlace;
  const lastVisit = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setPlaceError(''); setPlaceLoading(true);
      try {
        if (/^db-\d+$/.test(id)) {
          const value = await apiFetch<unknown>(`/places/${Number(id.slice(3))}`, { signal: controller.signal });
          const result = validateBackendPlace(value);
          if (!result) throw new Error('Máy chủ trả địa điểm không hợp lệ.');
          if (!controller.signal.aborted) setRemotePlace({ ...result, wikipedia: result.wikipedia ?? cachedPlace?.wikipedia, wikipediaUrl: result.wikipediaUrl ?? cachedPlace?.wikipediaUrl });
        } else if (!cachedPlace && /^wiki-(vi|en|fr|ja)-\d+$/.test(id)) {
          const result = await fetchWikipediaPlace(id, { signal: controller.signal });
          if (!controller.signal.aborted) setRemotePlace(result);
        }
      } catch (error) { if (!controller.signal.aborted) setPlaceError(error instanceof Error ? error.message : 'Không tải được địa điểm.'); }
      finally { if (!controller.signal.aborted) setPlaceLoading(false); }
    })();
    return () => controller.abort();
  }, [id, retry, cachedPlace]);
  useEffect(() => {
    const key = `${user?.id}:${id}`;
    if (token && /^db-\d+$/.test(id) && lastVisit.current !== key) {
      lastVisit.current = key;
      void apiFetch(`/history/${Number(id.slice(3))}`, { token, method: 'POST' }).catch(() => { lastVisit.current = ''; });
    }
  }, [id, token, user?.id]);
  const [result, setResult] = useState<{ key: string; content: NarrationContent | null; error: string } | null>(null);
  const contentKey = `${id}:${language}:${contentRetry}`;
  const content = result?.key === contentKey ? result.content : null;
  const contentError = result?.key === contentKey ? result.error : '';
  const contentLoading = !!p && result?.key !== contentKey;
  useEffect(() => {
    if (!p) return;
    const controller = new AbortController();
    void resolveNarration(p, language, { signal: controller.signal, forceRefresh: contentRetry > 0, officialPlaces: places })
      .then(content => { if (!controller.signal.aborted) setResult({ key: contentKey, content, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key: contentKey, content: null, error: error instanceof Error ? error.message : 'Không tải được nội dung.' }); });
    return () => controller.abort();
  }, [p, language, contentKey, contentRetry, places]);
  useFocusEffect(useCallback(() => () => stop(), [stop]));
  useEffect(() => () => stop(), [id, stop]);
  if (!p && placeLoading) return <SafeAreaView style={s.safe}><View style={s.missing}><ActivityIndicator color={C.primary}/><Text>Đang tải địa điểm…</Text></View></SafeAreaView>;
  if (!p) return <SafeAreaView style={s.safe}><View style={s.missing}><Text style={s.missingText}>{placeError || 'Không tìm thấy địa điểm. Hãy chọn lại từ bản đồ.'}</Text><Pressable accessibilityRole="button" onPress={() => setRetry(v => v + 1)}><Text>Thử tải lại</Text></Pressable><Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/map')}><Text>Quay lại bản đồ</Text></Pressable></View></SafeAreaView>;
  const playing = playingId === p.id;
  const isDatabase = /^db-\d+$/.test(p.id);
  const directions = () => { void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.latitude}%2C${p.longitude}&travelmode=walking`).catch(() => Alert.alert('Lỗi', 'Không thể mở chỉ đường.')); };
  return <View style={s.screen}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 155 }}>
    <View style={s.hero}><PlaceImage uri={p.image} label={p.title} style={StyleSheet.absoluteFill}/><LinearGradient colors={['rgba(7,24,35,.5)', 'transparent', 'rgba(10,36,43,.9)']} style={StyleSheet.absoluteFill}/>
      <SafeAreaView style={s.heroActions}><Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.canGoBack() ? router.back() : router.replace('/map')} style={s.action}><Ionicons name="arrow-back" size={22} color="#fff"/></Pressable>
        {isDatabase && <Pressable accessibilityRole="button" accessibilityLabel={isFavorite(p.id) ? 'Bỏ lưu địa điểm yêu thích' : 'Lưu địa điểm yêu thích'} onPress={() => toggleFavorite(p.id)} style={s.action}><Ionicons name={isFavorite(p.id) ? 'heart' : 'heart-outline'} size={22} color={isFavorite(p.id) ? '#FFB9A3' : '#fff'}/></Pressable>}
      </SafeAreaView><View style={s.heroCaption}><Text style={s.location}>{p.district}</Text><Text style={s.title}>{p.title}</Text><Text style={s.description}>{p.subtitle[language]}</Text></View>
    </View>
    <View style={s.content}><View style={s.badges}><View style={s.badge}><Text style={s.badgeText}>{p.category}</Text></View><View style={s.badge}><Text style={s.badgeText}>{isDatabase ? 'Địa điểm hệ thống' : p.source === 'wikipedia' ? 'Wikipedia' : p.source === 'wikidata' ? 'Wikidata' : 'OpenStreetMap'}</Text></View></View>
      <LanguageSelector value={language} onChange={value => setLanguage(value as typeof language)}/>
      {!!favoriteError && <Text accessibilityRole="alert" style={{ color: C.danger }}>{favoriteError}</Text>}
      {!!placeError && <Text accessibilityRole="alert" style={{ color: C.danger }}>{placeError} Đang hiển thị thông tin đã lưu.</Text>}
      <Text style={s.section}>Câu chuyện của địa điểm</Text>
      {contentLoading ? <View><ActivityIndicator color={C.primary}/><Text>Đang tải nội dung thuyết minh…</Text></View> : <Text testID="narration-text" style={s.body}>{content?.text || contentError || NO_NARRATION}</Text>}
      {!contentLoading && !content && <View><Text style={s.body}>Chưa có nội dung phù hợp bằng {LANGS.find(l => l.key === language)?.label}. Bạn có thể chọn ngôn ngữ khác hoặc thử tải lại.</Text><Pressable accessibilityRole="button" onPress={() => setContentRetry(v => v + 1)}><Text style={{ color: C.primary }}>Thử tải lại nội dung</Text></Pressable></View>}
      {content && <View style={{ gap: 8, marginBottom: 20 }}><Text testID="narration-attribution" style={{ color: C.muted }}>{content.attribution || (content.source === 'published' ? 'Bài thuyết minh do hệ thống xuất bản.' : 'Nội dung tham khảo; chưa được Admin duyệt.')}</Text>
        {content.source === 'wikipedia' && <Text style={{ color: C.muted }}>Bản đọc tạm thời từ Wikipedia; chưa được Admin duyệt.</Text>}
        {content.sourceUrl && <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(content.sourceUrl!).catch(() => {})}><Text style={{ color: C.primary }}>Đọc nguồn gốc và lịch sử tác giả</Text></Pressable>}
        {content.licenseUrl && <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(content.licenseUrl!).catch(() => {})}><Text style={{ color: C.primary }}>Giấy phép sử dụng nội dung</Text></Pressable>}
      </View>}
      <View style={s.voiceCard}><View style={{ flex: 1 }}><Text style={s.voiceName}>Hướng dẫn viên âm thanh</Text><Text style={s.voiceSub}>{LANGS.find(l => l.key === language)?.label} · {playing ? speechStatus === 'paused' ? 'Đang tạm dừng' : speechStatus === 'loading' ? 'Đang chuẩn bị giọng đọc…' : 'Đang phát' : 'Sẵn sàng'}</Text></View></View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>{[0.75, 1, 1.25, 1.5].map(rate => <Pressable key={rate} accessibilityRole="button" accessibilityLabel={`Tốc độ ${rate}×`} accessibilityState={{ selected: rate === speechRate }} style={[s.badge, rate === speechRate && { backgroundColor: C.primarySoft }]} onPress={() => setSpeechRate(rate)}><Text>{rate}×</Text></Pressable>)}</View>
      <Text style={s.voiceSub}>Đổi tốc độ hoặc ngôn ngữ sẽ dừng bài đang phát. Nhấn Nghe để phát lại.</Text>
      {!!speechError && <Text accessibilityRole="alert" style={{ color: C.danger, marginVertical: 18 }}>{speechError} Bạn có thể nhấn Nghe để thử lại.</Text>}
      <Text style={s.section}>Vị trí</Text><View style={s.address}><View style={{ flex: 1 }}><Text style={s.addressName}>{p.district}</Text><Text style={s.coordinates}>{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</Text></View><Pressable onPress={directions}><Ionicons name="open-outline" size={21} color={C.primary}/></Pressable></View>
      {isDatabase && <PlaceReviews placeId={Number(p.id.slice(3))}/>}
    </View>
  </ScrollView><View style={s.bottom}>
    <Pressable accessibilityRole="button" disabled={!playing && (!content || contentLoading)} accessibilityLabel={playing ? 'Dừng thuyết minh' : 'Nghe thuyết minh'} onPress={() => playing ? stop() : void speak(p, content!)} style={[s.listen, playing && s.stop, !playing && !content && { opacity: .45 }]}><Ionicons name={playing ? 'stop-circle-outline' : 'play-circle'} size={22} color="#fff"/><Text style={s.listenText}>{playing ? 'Dừng thuyết minh' : contentLoading ? 'Đang tải nội dung…' : 'Nghe thuyết minh'}</Text></Pressable>
    {playing && canPauseSpeech && speechStatus !== 'loading' && <Pressable accessibilityRole="button" accessibilityLabel={speechStatus === 'paused' ? 'Tiếp tục thuyết minh' : 'Tạm dừng thuyết minh'} onPress={speechStatus === 'paused' ? resumeSpeech : pauseSpeech} style={s.route}><Ionicons name={speechStatus === 'paused' ? 'play' : 'pause'} size={22} color={C.primary}/></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel="Chỉ đường" onPress={directions} style={s.route}><Ionicons name="navigate-outline" size={22} color={C.primary}/></Pressable>
  </View></View>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:C.paper},safe:{flex:1,backgroundColor:C.paper},hero:{height:390,backgroundColor:C.darkBlue},heroActions:{position:'absolute',left:18,right:18,top:5,flexDirection:'row',justifyContent:'space-between'},action:{width:43,height:43,borderRadius:16,backgroundColor:'rgba(12,34,43,.46)',justifyContent:'center',alignItems:'center'},heroCaption:{position:'absolute',bottom:34,left:22,right:22},location:{color:'#C8EFE6',fontWeight:'800',fontSize:12,marginBottom:10},title:{color:'#fff',fontSize:29,fontWeight:'900',lineHeight:36,letterSpacing:-.7},description:{color:'#EDF7F6',marginTop:7,fontSize:13},content:{backgroundColor:C.paper,borderTopLeftRadius:25,borderTopRightRadius:25,marginTop:-18,paddingTop:24,paddingHorizontal:22},badges:{flexDirection:'row',gap:8,flexWrap:'wrap',marginBottom:27},badge:{backgroundColor:C.white,borderColor:C.border,borderWidth:1,borderRadius:12,paddingHorizontal:12,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:7},badgeText:{color:C.ink,fontWeight:'800',fontSize:11},section:{fontSize:19,fontWeight:'900',color:C.ink,marginBottom:12},body:{color:'#586D7B',fontSize:14,lineHeight:25,marginBottom:27},voiceCard:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:C.primarySoft,borderRadius:19,padding:15,marginBottom:31},voiceIcon:{width:48,height:48,backgroundColor:C.white,borderRadius:15,alignItems:'center',justifyContent:'center'},voiceName:{fontSize:13,fontWeight:'900',color:C.ink},voiceSub:{fontSize:11,color:C.muted,marginTop:5},address:{backgroundColor:C.white,borderRadius:17,padding:17,flexDirection:'row',alignItems:'center',gap:11,borderWidth:1,borderColor:C.border},addressName:{fontSize:12,fontWeight:'800',color:C.ink},coordinates:{fontSize:10,color:C.muted,marginTop:5},bottom:{position:'absolute',bottom:0,left:0,right:0,paddingHorizontal:18,paddingTop:12,paddingBottom:27,backgroundColor:'rgba(255,255,255,.98)',flexDirection:'row',gap:10,borderTopWidth:1,borderTopColor:C.border},listen:{flex:1,backgroundColor:C.primary,height:56,borderRadius:17,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},stop:{backgroundColor:C.darkBlue},listenText:{color:'#fff',fontWeight:'900',fontSize:13},route:{height:56,width:57,backgroundColor:C.primarySoft,borderRadius:17,alignItems:'center',justifyContent:'center'},missing:{flex:1,alignItems:'center',justifyContent:'center',gap:15},missingText:{fontWeight:'900',fontSize:18,color:C.ink}});
