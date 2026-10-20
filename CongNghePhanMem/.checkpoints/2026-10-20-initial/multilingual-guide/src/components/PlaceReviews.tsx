import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../services/api';
import { useApp } from '../context/AppContext';
import { C } from '../theme/colors';
import { PrimaryButton } from './auth';
import { LoadingState, ErrorMessage, panel } from './Screen';

type Review = { id: number; user_id: number; rating: number; comment: string | null };
export default function PlaceReviews({ placeId }: { placeId: number }) {
  const { token, user } = useApp();
  const [reviews, setReviews] = useState<Review[]>([]); const [mine, setMine] = useState<Review | null>(null);
  const [summary, setSummary] = useState<{ average_rating: number | null; review_count: number } | null>(null);
  const [rating, setRating] = useState(5); const [comment, setComment] = useState(''); const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false); const [notice, setNotice] = useState(''); const seq = useRef(0);
  const load = useCallback(async () => {
    const current = ++seq.current;
    setBusy(true); setError('');
    try {
      const [rows, stats, own] = await Promise.all([
        apiFetch<Review[]>(`/places/${placeId}/reviews?limit=10&offset=${page * 10}`),
        apiFetch<NonNullable<typeof summary>>(`/places/${placeId}/reviews/summary`),
        token ? apiFetch<Review | null>(`/places/${placeId}/reviews/me`, { token }) : Promise.resolve(null),
      ]);
      if (current !== seq.current) return;
      setReviews(rows); setSummary(stats); setMine(own); setRating(own?.rating ?? 5); setComment(own?.comment ?? '');
    } catch (e) { if (current === seq.current) setError(e instanceof Error ? e.message : 'Không tải được đánh giá.'); }
    finally { if (current === seq.current) setBusy(false); }
  }, [placeId, page, token]);
  useEffect(() => { const counter = seq; const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); counter.current++; }; }, [load]);
  const save = async (remove = false) => {
    if (!token || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await apiFetch(`/places/${placeId}/reviews${mine ? `/${mine.id}` : ''}`, { token, method: remove ? 'DELETE' : mine ? 'PUT' : 'POST', ...(remove ? {} : { body: JSON.stringify({ rating, comment: comment.trim() || null }) }) });
      setConfirm(false); setNotice(remove ? 'Đã xóa đánh giá.' : 'Đã lưu đánh giá.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Không lưu được đánh giá.'); }
    finally { setSaving(false); }
  };
  return <View style={{ gap: 16, marginVertical: 24 }}><Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>Đánh giá từ du khách</Text>
    {summary && <Text style={{ color: C.muted }}>{summary.average_rating === null ? 'Chưa có đánh giá' : `${summary.average_rating.toFixed(1)} / 5 · ${summary.review_count} đánh giá`}</Text>}
    <ErrorMessage message={error} />{!!notice && <Text accessibilityRole="alert">{notice}</Text>}
    {busy ? <LoadingState /> : reviews.map(row => <View key={row.id} style={panel}><Text style={{ fontWeight: '700' }}>{row.user_id === user?.id ? 'Bạn' : 'Du khách'} · {'★'.repeat(row.rating)}{'☆'.repeat(5 - row.rating)}</Text>{!!row.comment && <Text style={{ lineHeight: 23, color: C.muted }}>{row.comment}</Text>}</View>)}
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><PrimaryButton title="← Trước" disabled={busy || saving || page === 0} onPress={() => setPage(v => v - 1)} variant="outline" /><PrimaryButton title="Sau →" disabled={busy || saving || reviews.length < 10} onPress={() => setPage(v => v + 1)} variant="outline" /></View>
    {token ? <View style={panel}><Text style={{ fontWeight: '700', color: C.ink }}>{mine ? 'Cập nhật đánh giá của bạn' : 'Chia sẻ trải nghiệm'}</Text>
      <View style={{ flexDirection: 'row' }}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} sao`} accessibilityState={{ selected: rating === value }} disabled={busy || saving} onPress={() => setRating(value)} style={{ padding: 8 }}><Ionicons name={value <= rating ? 'star' : 'star-outline'} color="#B77912" size={25} /></Pressable>)}</View>
      <TextInput accessibilityLabel="Nội dung đánh giá" placeholder="Điều gì khiến bạn nhớ về nơi này?" multiline maxLength={2000} editable={!busy && !saving} value={comment} onChangeText={setComment} style={{ minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, color: C.ink }} />
      <PrimaryButton title={mine ? 'Cập nhật đánh giá' : 'Gửi đánh giá'} loading={saving} disabled={busy} onPress={() => void save()} />
      {!!mine && <PrimaryButton title="Xóa đánh giá của tôi" disabled={busy || saving} variant="outline" onPress={() => setConfirm(!confirm)} />}
      {confirm && <><Text>Xác nhận xóa đánh giá này?</Text><PrimaryButton title="Xác nhận xóa" disabled={saving} onPress={() => void save(true)} /></>}
    </View> : <Link href="/login" style={{ color: C.primaryDark, padding: 12 }}>Đăng nhập để viết đánh giá →</Link>}
  </View>;
}
