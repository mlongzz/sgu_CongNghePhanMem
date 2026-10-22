import React from "react";
import { Linking, Pressable, Text } from "react-native";
export default function GoogleMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  return <Pressable onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`)}><Text>Mở Google Maps · {latitude}, {longitude}</Text></Pressable>;
}
