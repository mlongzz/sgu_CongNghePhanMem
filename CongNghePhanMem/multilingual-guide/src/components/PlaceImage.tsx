import { useI18n } from '../hooks/useI18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View, Text, Pressable, ActivityIndicator, StyleSheet, type ImageStyle, type StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../services/api';

export function mediaUrl(value: string) {
  if (value.startsWith('/media/')) return `${API_BASE_URL}${value}`;
  return /^https?:\/\//i.test(value) ? value : '';
}

export type ImageLoadStatus = 'missing' | 'loading' | 'loaded' | 'unavailable';

type Props = {
  uri: string;
  thumbnailUri?: string | null;
  localPreview?: boolean;
  retryEnabled?: boolean;
  style?: StyleProp<ImageStyle>;
  label?: string;
  onStatusChange?: (status: ImageLoadStatus) => void;
};

export default function PlaceImage({ uri, thumbnailUri, localPreview = false, ...props }: Props) {
  const full = localPreview && /^(?:blob:|file:|content:|data:image\/(?:jpeg|png|webp);base64,)/.test(uri) ? uri : mediaUrl(uri);
  const thumbnail = mediaUrl(thumbnailUri ?? '');
  // A changed source pair starts a new load, including URLs that failed for a previous place.
  return <PlaceImageSource key={JSON.stringify([full, thumbnail, Boolean(uri || thumbnailUri)])} full={full} thumbnail={thumbnail} hasUrl={Boolean(uri || thumbnailUri)} {...props} />;
}

function PlaceImageSource({ full, thumbnail, hasUrl, retryEnabled = true, style, label = 'Ảnh địa điểm', onStatusChange }: Omit<Props, 'uri' | 'thumbnailUri' | 'localPreview'> & { full: string; thumbnail: string; hasUrl: boolean }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const source = [thumbnail, full].find(url => url && !failed.includes(url)) ?? '';
  const markFailed = useCallback((url: string) => setFailed(previous => previous.includes(url) ? previous : [...previous, url]), []);
  const markLoaded = useCallback(() => setLoaded(true), []);
  const status: ImageLoadStatus = !source ? (hasUrl ? 'unavailable' : 'missing') : loaded ? 'loaded' : 'loading';
  useEffect(() => { onStatusChange?.(status); }, [onStatusChange, status]);
  const dimensions = StyleSheet.flatten(style);
  const compact = typeof dimensions?.width === 'number' && dimensions.width < 100;
  if (!source) return <View style={[style, { backgroundColor: '#E7F2F0', justifyContent: 'center', alignItems: 'center', overflow:'hidden' }]}>
    <Ionicons name="image-outline" size={compact ? 20 : 30} color="#5B8C86" />
    {!compact && <Text style={{ color: '#4B6F70', marginTop: 8, fontSize: 12 }}>{t(hasUrl ? 'Không tải được ảnh địa điểm' : 'Chưa có ảnh địa điểm')}</Text>}
    {!compact && retryEnabled && Boolean(full || thumbnail) ? <Pressable accessibilityRole="button" accessibilityLabel={t('Thử tải ảnh')} onPress={() => { setLoaded(false); setAttempt(value => value + 1); setFailed([]); }} style={{padding:10,minHeight:44,justifyContent:'center'}}><Text style={{color:'#0F766E',fontSize:11,fontWeight:'700'}}>{t('Thử tải ảnh')}</Text></Pressable> : null}
  </View>;
  return <View style={[style,{overflow:'hidden',backgroundColor:'#E7F2F0'}]}>
    <ImageRequest key={JSON.stringify([source, attempt])} source={source} label={label} onFailure={markFailed} onSuccess={markLoaded} />
  </View>;
}

function ImageRequest({ source, label, onFailure, onSuccess }: { source: string; label: string; onFailure: (url: string) => void; onSuccess: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const settled = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(() => {
      if (!settled.current) { settled.current = true; onFailure(source); }
    }, 12_000);
    return () => { active.current = false; clearTimeout(timer); };
  }, [source, onFailure]);
  return <>
    <Image accessibilityLabel={label} source={{ uri: source }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={() => {
      if (active.current && !settled.current) { settled.current = true; setLoaded(true); onSuccess(); }
    }} onError={() => {
      if (active.current && !settled.current) { settled.current = true; onFailure(source); }
    }} />
    {!loaded ? <View pointerEvents="none" style={[StyleSheet.absoluteFill,{alignItems:'center',justifyContent:'center'}]}><ActivityIndicator size="small" color="#5B8C86"/></View> : null}
  </>;
}
