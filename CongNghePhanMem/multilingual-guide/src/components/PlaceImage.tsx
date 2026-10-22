import { useState } from 'react';
import { Image, View, Text, type ImageStyle, type StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../services/api';

export function mediaUrl(value: string) {
  if (value.startsWith('/media/')) return `${API_BASE_URL}${value}`;
  return /^https?:\/\//i.test(value) ? value : '';
}

export default function PlaceImage({ uri, style, label = 'Ảnh địa điểm' }: {
  uri: string; style?: StyleProp<ImageStyle>; label?: string;
}) {
  const [failed, setFailed] = useState('');
  const source = mediaUrl(uri);
  if (!source || failed === source) return <View style={[style, { backgroundColor: '#244C50', justifyContent: 'center', alignItems: 'center' }]}>
    <Ionicons name="image-outline" size={30} color="#C8E9E6" />
    <Text style={{ color: '#E1F5F3', marginTop: 8, fontSize: 12 }}>Chưa có ảnh địa điểm</Text>
  </View>;
  return <Image accessibilityLabel={label} source={{ uri: source }} style={style} resizeMode="cover" onError={() => setFailed(source)} />;
}
