import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { apiFetch } from "../src/services/api";
type Journey = { id: number; name: string; description: string; place_ids: number[] };
type Poi = { id: number; name: string; address?: string };
export default function Journeys() {
  const [items, setItems] = useState<Journey[]>([]);
  const [selected, setSelected] = useState<Journey | null>(null);
  const [stops, setStops] = useState<Poi[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const load = useCallback(async () => { setBusy(true); setError(""); try { setItems(await apiFetch<Journey[]>(`/journeys?limit=20&offset=${page * 20}`)); } catch (e) { setError(e instanceof Error ? e.message : "Không tải được hành trình"); } finally { setBusy(false); } }, [page]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const open = async (item: Journey) => {
    setBusy(true); setError("");
    try { const fresh = await apiFetch<Journey>(`/journeys/${item.id}`); const points = await Promise.all(fresh.place_ids.map(id => apiFetch<Poi>(`/places/${id}`))); setSelected(fresh); setStops(points); }
    catch (e) { setError(e instanceof Error ? e.message : "Không tải được điểm dừng"); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={s.page}><Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}><Text style={s.link}>← Quay lại</Text></Pressable><Text style={s.title}>Hành trình khám phá</Text>
    {!!error && <View><Text style={s.error}>{error}</Text><Pressable onPress={() => void load()}><Text style={s.link}>Thử lại</Text></Pressable></View>}
    {busy ? <ActivityIndicator /> : selected ? <View style={s.card}><Text style={s.title}>{selected.name}</Text><Text>{selected.description}</Text>{!stops.length && <Text>Hành trình chưa có điểm dừng.</Text>}{stops.map((stop, index) => <Pressable key={stop.id} style={s.card} onPress={() => router.push(`/place/db-${stop.id}` as never)}><Text style={s.link}>{index + 1}. {stop.name} →</Text><Text>{stop.address}</Text></Pressable>)}<Pressable onPress={() => setSelected(null)}><Text style={s.link}>Danh sách hành trình</Text></Pressable></View> : <>
      {!items.length && <Text>Chưa có hành trình trong trang này.</Text>}{items.map(item => <Pressable key={item.id} style={s.card} onPress={() => void open(item)}><Text style={s.name}>{item.name}</Text><Text>{item.description}</Text><Text style={s.link}>{item.place_ids.length} điểm dừng · Xem hành trình →</Text></Pressable>)}
      <View style={s.row}><Pressable disabled={page === 0} onPress={() => setPage(page - 1)}><Text style={s.link}>← Trước</Text></Pressable><Text>Trang {page + 1}</Text><Pressable disabled={items.length < 20} onPress={() => setPage(page + 1)}><Text style={s.link}>Sau →</Text></Pressable></View></>}
  </ScrollView>;
}
const s = StyleSheet.create({ page: { padding: 24, gap: 22, paddingTop: 50, backgroundColor: "#f3f6f8", flexGrow: 1 }, title: { fontSize: 25, color: "#14353b", fontWeight: "800" }, name: { fontSize: 18, fontWeight: "700", color: "#14353b" }, card: { backgroundColor: "#fff", padding: 20, borderRadius: 14, gap: 14 }, link: { color: "#147b70", fontWeight: "700" }, row: { flexDirection: "row", justifyContent: "space-between" }, error: { color: "#b44747" } });
