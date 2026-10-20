import React from "react";
import { View } from "react-native";
export default function GoogleMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  const bbox = [Math.max(-180, longitude - 0.015), Math.max(-90, latitude - 0.01), Math.min(180, longitude + 0.015), Math.min(90, latitude + 0.01)].join(',');
  const source = key ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${latitude},${longitude}` : `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude},${longitude}`;
  return <View style={{ height: 360, borderRadius: 16, overflow: "hidden" }}><iframe title="Vị trí POI trên Google Maps" width="100%" height="360" style={{ border: 0 }} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen
    src={source} /></View>;
}
