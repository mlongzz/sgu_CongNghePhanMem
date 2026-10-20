from pathlib import Path
p=Path('src/components/MapScreen.web.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('  normalizeSearch,','  normalizeSearch,\n  osmExploreKey,')
a=s.index('  const [osmPlaces,');b=s.index('  // Loai trung',a)
s=s[:a]+'''  const [osmRetry, setOsmRetry] = useState(0);
  const [osmState, setOsmState] = useState({ key: "", places: [] as Place[], warning: "", error: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  const coordinates = useMemo(() => typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null, [latitude, longitude]);
  const requestKey = API_BASE_URL && validCoordinate(coordinates) ? `${osmExploreKey(coordinates, radiusKm)}:${osmRetry}` : "";
  const osmPlaces = osmState.key === requestKey ? osmState.places : [];
  const osmWarning = osmState.key === requestKey ? osmState.warning : "";
  const osmError = osmState.key === requestKey ? osmState.error : "";
  const osmLoading = !!requestKey && osmState.key !== requestKey;

  // OSM remains separate from backend POI used by accounts and narration.
  // Delay dispatch briefly so rapid radius changes and Strict Mode cleanup cancel before sending.
  useEffect(() => {
    if (!requestKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // Invocation is inside try: even a stale module throwing synchronously cannot crash React.
          const result = await fetchOsmExploreResult(coordinates, radiusKm, { signal: controller.signal, forceRefresh: osmRetry > 0 });
          if (!controller.signal.aborted) setOsmState({ key: requestKey, places: result.places, warning: result.warning, error: "" });
        } catch (error: unknown) {
          if (!controller.signal.aborted) setOsmState({ key: requestKey, places: [], warning: "", error: error instanceof Error ? error.message : "Không tải được địa điểm OpenStreetMap." });
        }
      })();
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [coordinates, radiusKm, requestKey, osmRetry]);

'''+s[b:]
s=s.replace('    () => [...places, ...extraOsmPlaces],', '''    () => [...places, ...extraOsmPlaces].filter(p => validCoordinate(p) && (!validCoordinate(location) || distanceKm(location, p) <= radiusKm + 0.03)).sort((a, b) => validCoordinate(location) ? distanceKm(location, a) - distanceKm(location, b) : 0),''')
s=s.replace('    [places, extraOsmPlaces],','    [places, extraOsmPlaces, location, radiusKm],')
s=s.replace('  const handleLocate = async () => {','  const handleLocate = async () => {\n    setOsmRetry(v => v + 1);')
s=s.replace('          <Pressable\n            disabled={loadingPlaces}', '          <Pressable\n            accessibilityRole="button"\n            disabled={loadingPlaces}')
s=s.replace('                key={km}\n                onPress', '                key={km}\n                accessibilityRole="button"\n                accessibilityLabel={`Bán kính ${km} km`}\n                accessibilityState={{ selected: radiusKm === km }}\n                onPress')
s=s.replace('          {osmError ? (', '          {!!osmError && <Pressable accessibilityRole="button" onPress={() => setOsmRetry(v => v + 1)} style={s.linkButton}><Text style={s.linkText}>Thử lại OpenStreetMap</Text></Pressable>}\n          {osmError ? (')
s=s.replace('        aria-label="Bản đồ GPS, địa điểm hệ thống và địa điểm OpenStreetMap"', '        role="region"\n        data-testid="places-map"\n        aria-label="Bản đồ GPS, địa điểm hệ thống và địa điểm OpenStreetMap"')
s=s.replace('        {allPlaces.map((p) => (', '        <View testID="nearby-place-list">{allPlaces.map((p) => (')
s=s.replace('        <Text style={s.credit}>', '        </View><Text style={s.credit}>')
p.write_text(s,encoding='utf-8')
