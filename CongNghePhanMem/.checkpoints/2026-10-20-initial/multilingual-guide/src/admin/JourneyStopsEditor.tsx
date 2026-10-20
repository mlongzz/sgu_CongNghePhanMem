import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { apiFetch } from '../services/api';
import { C } from '../theme/colors';
import { ErrorMessage } from '../components/Screen';

type Option = { id: number; name: string };
export default function JourneyStopsEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<Option[]>([]); const [query, setQuery] = useState(''); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: Option[] = [];
        for (let offset = 0; ; offset += 100) {
          const page = await apiFetch<Option[]>(`/places?limit=100&offset=${offset}`);
          if (!alive) return;
          all.push(...page); if (page.length < 100) break;
        }
        setOptions(all);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Không tải được địa điểm.'); }
    })();
    return () => { alive = false; };
  }, []);
  const ids = value.split(',').map(v => Number(v.trim())).filter(v => Number.isInteger(v) && v > 0);
  const update = (next: number[]) => onChange(next.join(', '));
  const move = (index: number, delta: number) => {
    const next = [...ids]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; update(next);
  };
  return <View style={{ gap: 10, marginTop: 16 }}><Text style={{ fontWeight: '700', color: C.ink }}>Các điểm dừng theo thứ tự</Text><ErrorMessage message={error} />
    {!ids.length && <Text style={{ color: C.muted }}>Chọn địa điểm để bắt đầu hành trình.</Text>}
    {ids.map((id, index) => <View key={id} style={{ padding: 12, gap: 8, backgroundColor: C.paper, borderRadius: 10 }}><Text>{index + 1}. {options.find(p => p.id === id)?.name ?? `Địa điểm #${id}`}</Text><View style={{ flexDirection: 'row', gap: 20 }}><Pressable accessibilityRole="button" disabled={index === 0} onPress={() => move(index, -1)}><Text style={{ color: index === 0 ? C.muted : C.primaryDark }}>↑ Lên</Text></Pressable><Pressable accessibilityRole="button" disabled={index === ids.length - 1} onPress={() => move(index, 1)}><Text style={{ color: index === ids.length - 1 ? C.muted : C.primaryDark }}>↓ Xuống</Text></Pressable><Pressable accessibilityRole="button" onPress={() => update(ids.filter(v => v !== id))}><Text style={{ color: C.danger }}>Bỏ điểm dừng</Text></Pressable></View></View>)}
    <TextInput value={query} onChangeText={setQuery} accessibilityLabel="Tìm địa điểm để thêm vào hành trình" placeholder="Tìm địa điểm để thêm…" style={{ padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 10 }} />
    {options.filter(p => !ids.includes(p.id) && p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 20).map(p => <Pressable accessibilityRole="button" key={p.id} onPress={() => update([...ids, p.id])} style={{ padding: 12, backgroundColor: C.primarySoft, borderRadius: 10 }}><Text style={{ color: C.primaryDark }}>＋ {p.name}</Text></Pressable>)}
  </View>;
}
