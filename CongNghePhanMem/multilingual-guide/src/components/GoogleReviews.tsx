import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../services/api';
import { useApp } from '../context/AppContext';
import { useI18n } from '../hooks/useI18n';
import { C } from '../theme/colors';

type GoogleReview = { author: string; author_url?: string | null; author_photo?: string | null; rating: number; text: string; relative_time?: string; url?: string | null };
type GoogleResult = { configured: boolean; google_maps_uri: string; rating: number | null; user_rating_count: number | null; reviews: GoogleReview[]; error?: string };

const open = (url?: string | null) => { if (url?.startsWith('https://')) void Linking.openURL(url).catch(() => {}); };
const Stars = ({ value, size = 15 }: { value: number; size?: number }) => <View style={{ flexDirection: 'row' }}>
  {[1, 2, 3, 4, 5].map(i => <Ionicons key={i} name={value >= i - 0.25 ? 'star' : value >= i - 0.75 ? 'star-half' : 'star-outline'} size={size} color="#F4B400" />)}
</View>;

/** Ratings and reviews from Google Maps (Places API), always attributed and linked to Google Maps. */
export default function GoogleReviews({ placeId }: { placeId: number }) {
  const { t } = useI18n();
  const { language } = useApp();
  const [data, setData] = useState<{ key: string; value: GoogleResult | null }>({ key: '', value: null });
  const key = `${placeId}:${language}`;
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<GoogleResult>(`/places/${placeId}/google-reviews?language=${language}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData({ key, value }); })
      .catch(() => { if (!controller.signal.aborted) setData({ key, value: null }); });
    return () => controller.abort();
  }, [placeId, language, key]);
  const result = data.key === key ? data.value : null;
  if (!result) return null;
  const hasRating = typeof result.rating === 'number';
  return <View testID="google-reviews" style={s.card}>
    <View style={s.head}>
      <Text style={s.brand}><Text style={{ color: '#4285F4' }}>G</Text><Text style={{ color: '#EA4335' }}>o</Text><Text style={{ color: '#FBBC05' }}>o</Text><Text style={{ color: '#4285F4' }}>g</Text><Text style={{ color: '#34A853' }}>l</Text><Text style={{ color: '#EA4335' }}>e</Text></Text>
      <Text style={s.title}>{t('Đánh giá trên Google Maps')}</Text>
    </View>
    {hasRating ? <View style={s.summary}>
      <Text style={s.score}>{result.rating!.toFixed(1)}</Text>
      <View style={{ gap: 4 }}>
        <Stars value={result.rating!} size={18} />
        {typeof result.user_rating_count === 'number' ? <Text style={s.count}>{result.user_rating_count.toLocaleString(language === 'vi' ? 'vi-VN' : language)} {t('lượt đánh giá')}</Text> : null}
      </View>
    </View> : <Text style={s.empty}>{t(result.configured ? (result.error ? 'Chưa tải được đánh giá từ Google lúc này.' : 'Google chưa có đánh giá cho địa điểm này.') : 'Xem điểm và đánh giá thực tế của du khách trên Google Maps.')}</Text>}
    {result.reviews.map((review, index) => <View key={`${review.author}-${index}`} style={s.review}>
      <View style={s.author}>
        {review.author_photo ? <Image source={{ uri: review.author_photo }} style={s.avatar} accessibilityIgnoresInvertColors /> : <View style={[s.avatar, s.avatarBlank]}><Text style={s.avatarText}>{review.author.slice(0, 1).toUpperCase()}</Text></View>}
        <View style={{ flex: 1 }}>
          <Pressable accessibilityRole="link" disabled={!review.author_url} onPress={() => open(review.author_url)}><Text style={s.name}>{review.author}</Text></Pressable>
          <View style={s.meta}><Stars value={review.rating} size={12} />{review.relative_time ? <Text style={s.time}>{review.relative_time}</Text> : null}</View>
        </View>
      </View>
      {review.text ? <Text style={s.text} numberOfLines={6}>{review.text}</Text> : null}
    </View>)}
    <Pressable accessibilityRole="link" onPress={() => open(result.google_maps_uri)} style={({ hovered }) => [s.link, hovered && { backgroundColor: C.paper }]}>
      <Ionicons name="logo-google" size={16} color={C.primaryDark} />
      <Text style={s.linkText}>{t(result.reviews.length ? 'Xem tất cả đánh giá trên Google Maps' : 'Mở đánh giá trên Google Maps')}</Text>
      <Ionicons name="open-outline" size={15} color={C.primaryDark} />
    </Pressable>
    <Text style={s.attribution}>{t('Nguồn: Google Maps. Nội dung đánh giá thuộc về người viết.')}</Text>
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { fontSize: 18, fontWeight: '800' },
  title: { color: C.ink, fontSize: 16, fontWeight: '800' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  score: { fontSize: 38, fontWeight: '900', color: C.ink },
  count: { color: C.muted, fontSize: 12 },
  empty: { color: C.muted, fontSize: 13, lineHeight: 19 },
  review: { borderTopWidth: 1, borderColor: C.border, paddingTop: 12, gap: 8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarBlank: { backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.primaryDark, fontWeight: '800' },
  name: { color: C.ink, fontWeight: '700', fontSize: 13 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  time: { color: C.muted, fontSize: 11 },
  text: { color: '#425466', fontSize: 13, lineHeight: 20 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 12, minHeight: 44 },
  linkText: { color: C.primaryDark, fontWeight: '700', fontSize: 13 },
  attribution: { color: C.faint, fontSize: 10, textAlign: 'center' },
});
