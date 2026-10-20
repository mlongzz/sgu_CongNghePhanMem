import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch } from '../services/api';
import PlaceImage from '../components/PlaceImage';
import { C } from '../theme/colors';

export default function PlaceImageEditor({ placeId, uri, token, onSaved }: {
  placeId: number; uri: string; token: string; onSaved: (uri: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const upload = async () => {
    if (busy) return;
    setError('');
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (selected.canceled) return;
      setBusy(true);
      const asset = selected.assets[0];
      const blob = asset.file ?? await (await fetch(asset.uri)).blob();
      if (blob.size > 5 * 1024 * 1024) throw new Error('Ảnh cần nhỏ hơn 5 MB.');
      const value = await apiFetch<{ image_url: string }>(`/admin/places/${placeId}/image`, {
        token, method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
      });
      onSaved(value.image_url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không tải được ảnh.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await apiFetch(`/admin/places/${placeId}/image`, { token, method: 'DELETE' }); onSaved(''); setConfirm(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không xóa được ảnh.'); }
    finally { setBusy(false); }
  };
  const button = { backgroundColor: C.primaryDark, padding: 12, borderRadius: 10, opacity: busy ? 0.5 : 1 };
  return <View style={{ gap: 12, marginVertical: 16 }}>
    <PlaceImage uri={uri} style={{ width: '100%', height: 180, borderRadius: 12 }} />
    <Text style={{ color: C.muted }}>JPEG, PNG hoặc WebP · tối đa 5 MB, 16 megapixel. Các nút dưới đây lưu ảnh ngay.</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void upload()} style={button}><Text style={{ color: '#fff' }}>{busy ? 'Đang xử lý…' : 'Chọn ảnh và lưu ngay'}</Text></Pressable>
    {!!uri && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirm(!confirm)}><Text style={{ color: C.danger }}>Gỡ ảnh khỏi địa điểm</Text></Pressable>}
    {confirm && <View style={{ gap: 12 }}><Text>Xác nhận gỡ ảnh hiện tại?</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove()} style={button}><Text style={{ color: '#fff' }}>Xác nhận gỡ ảnh</Text></Pressable></View>}
    {!!error && <Text accessibilityRole="alert" style={{ color: C.danger }}>{error}</Text>}
  </View>;
}
