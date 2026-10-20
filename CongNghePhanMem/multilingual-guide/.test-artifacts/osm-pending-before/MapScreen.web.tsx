/**
 * Ban do Web: GPS nguoi dung + POI FastAPI + POI OpenStreetMap.
 * POI OpenStreetMap chi hien thi tren ban do: KHONG gui ID osm-* vao API,
 * trang chi tiet, yeu thich, lich su hay thuyet minh tu dong.
 * MapScreen.tsx tren Android/iOS khong bi thay doi.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { Circle, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

import AutoGuideControl from "./AutoGuideControl";
import { C } from "../theme/colors";
import { useApp } from "../context/AppContext";
import type { Place } from "../data/places";
import { API_BASE_URL } from "../services/api";
import {
  distanceKm,
  fetchOsmExploreResult,
  normalizeSearch,
  osmExploreKey,
} from "../services/nearby";

const RADII = [1, 3, 5, 10, 20];
const FALLBACK_CENTER: [number, number] = [10.7764, 106.6993];

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Icon fonts may already be cached on the client but absent during static rendering.
// Keep the first client render identical to the server, then render the real icons.
function MapIcon(props: React.ComponentProps<typeof Ionicons>) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  return <View style={{ width: props.size, height: props.size }}>{hydrated ? <Ionicons {...props} /> : null}</View>;
}
type Coordinate = { latitude: number; longitude: number };

function validCoordinate(
  point: Coordinate | null | undefined,
): point is Coordinate {
  return Boolean(
    point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180,
  );
}

function isBackendPlace(place: Place): boolean {
  // ID db- do validateBackendPlace sinh ra; osm-* KHONG phai ID database.
  return place.id.startsWith("db-");
}

function openExternalMap(place: Coordinate): void {
  const lat = place.latitude.toFixed(6);
  const lon = place.longitude.toFixed(6);
  const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
  void Linking.openURL(link).catch(() => {});
}

function PlacesMap({
  location,
  places,
  selectedId,
  radiusKm,
  onSelectPlace,
}: {
  location: Coordinate | null;
  places: Place[];
  selectedId: string | null;
  radiusKm: number;
  onSelectPlace: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerGroupRef = useRef<LayerGroup | null>(null);
  const radiusCircleRef = useRef<Circle | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let frame: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const initialize = async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView(FALLBACK_CENTER, 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      leafletRef.current = L;
      mapRef.current = map;
      markerGroupRef.current = L.layerGroup().addTo(map);
      setReady(true);
      frame = window.requestAnimationFrame(() => { if (!cancelled) map.invalidateSize(); });
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => { if (!cancelled) map.invalidateSize(); });
        resizeObserver.observe(containerRef.current);
      }
    };
    void initialize().catch(() => {
      if (!cancelled)
        setMapError(
          "Không tải được bản đồ. Kiểm tra kết nối mạng rồi tải lại trang.",
        );
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      markerGroupRef.current = null;
      radiusCircleRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const markers = markerGroupRef.current;
    if (!ready || !L || !map || !markers) return;
    markers.clearLayers();
    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;

    if (validCoordinate(location)) {
      // Vong tron mo the hien pham vi tim kiem, khong phai sai so GPS.
      radiusCircleRef.current = L.circle(
        [location.latitude, location.longitude],
        {
          radius: radiusKm * 1000,
          color: "#2563eb",
          weight: 1,
          opacity: 0.5,
          fillOpacity: 0.025,
        },
      ).addTo(map);
      L.circleMarker([location.latitude, location.longitude], {
        radius: 10,
        color: "#fff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
        className: "user-location-marker",
      })
        .bindTooltip("Vị trí của tôi")
        .addTo(markers);
    }

    const validPlaces = places.filter((p) => validCoordinate(p));
    for (const place of validPlaces) {
      const selected = selectedId === place.id;
      const backend = isBackendPlace(place);
      const marker = L.circleMarker([place.latitude, place.longitude], {
        radius: selected ? 11 : 8,
        color: "#fff",
        weight: 2,
        fillColor: selected ? "#f97316" : backend ? "#128a7a" : "#8b5cf6",
        fillOpacity: 1,
        className: "poi-marker",
      }).addTo(markers);
      marker.getElement()?.setAttribute("data-poi-id", place.id);
      // textContent tranh chen HTML tu ten POI cua ben thu ba.
      const tooltip = document.createElement("span");
      tooltip.textContent = `${place.title} (${backend ? "Hệ thống" : "OpenStreetMap"})`;
      marker.bindTooltip(tooltip);
      marker.on("click", () => onSelectPlace(place.id));
    }

    const selected = validPlaces.find((p) => p.id === selectedId);
    if (selected) {
      map.setView([selected.latitude, selected.longitude], 15, {
        animate: true,
      });
    } else if (validCoordinate(location)) {
      const zoom =
        radiusKm <= 1
          ? 15
          : radiusKm <= 3
            ? 14
            : radiusKm <= 5
              ? 13
              : radiusKm <= 10
                ? 12
                : 11;
      map.setView([location.latitude, location.longitude], zoom, {
        animate: true,
      });
    } else if (validPlaces.length) {
      const bounds = L.latLngBounds(
        validPlaces.map((p) => [p.latitude, p.longitude] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
    map.invalidateSize();
  }, [ready, location, places, selectedId, radiusKm, onSelectPlace]);

  return (
    <View>
      <div
        ref={containerRef}
        role="region"
        data-testid="places-map"
        aria-label="Bản đồ GPS, địa điểm hệ thống và địa điểm OpenStreetMap"
        style={{
          width: "100%",
          height: 390,
          borderRadius: 12,
          overflow: "hidden",
        }}
      />
      {mapError ? <Text style={s.error}>{mapError}</Text> : null}
      {!ready && !mapError ? (
        <Text style={s.small}>Đang tải bản đồ...</Text>
      ) : null}
    </View>
  );
}

export default function MapScreen() {
  const {
    places, // AppContext chi chua POI phu hop voi API chinh khi da cau hinh FastAPI.
    location,
    radiusKm,
    setRadiusKm,
    refreshNearby,
    loadingPlaces,
    placesError,
    placesWarning,
    nearbyStatus,
  } = useApp();
  const [osmRetry, setOsmRetry] = useState(0);
  const [osmState, setOsmState] = useState({ key: "", places: [] as Place[], warning: "", error: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  const coordinates = useMemo(() => typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null, [latitude, longitude]);
  const requestKey = API_BASE_URL && validCoordinate(coordinates) ? `${osmExploreKey(coordinates, radiusKm)}:${osmRetry}` : "";
  const osmPlaces = useMemo(() => osmState.key === requestKey ? osmState.places : [], [osmState.key, osmState.places, requestKey]);
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

  // Loai trung giua POI chinh thuc va POI kham pha (ten giong + khoang cach rat gan).
  const extraOsmPlaces = useMemo(
    () =>
      osmPlaces.filter(
        (osm) =>
          !places.some(
            (official) =>
              normalizeSearch(official.title).trim() ===
                normalizeSearch(osm.title).trim() &&
              distanceKm(official, osm) < 0.15,
          ),
      ),
    [osmPlaces, places],
  );

  const allPlaces = useMemo(
    () => [...places, ...extraOsmPlaces].filter(p => validCoordinate(p) && (!validCoordinate(location) || distanceKm(location, p) <= radiusKm + 0.03)).sort((a, b) => validCoordinate(location) ? distanceKm(location, a) - distanceKm(location, b) : 0),
    [places, extraOsmPlaces, location, radiusKm],
  );
  const selected = allPlaces.find((p) => p.id === selectedId) ?? null;
  const selectPlace = useCallback((id: string) => setSelectedId(id), []);
  const handleLocate = async () => {
    setOsmRetry(v => v + 1);
    setSelectedId(null);
    await refreshNearby();
  };

  // Khong bao gio dieu huong osm-* den /place/{id}: Backend chi chap nhan ID DB.
  const officialPlaces = allPlaces.filter(isBackendPlace);
  const communityPlaces = allPlaces.filter((p) => !isBackendPlace(p));
  const backendStatus = nearbyStatus === "success"
    ? `Đã phản hồi · ${officialPlaces.length} POI chính thức.`
    : nearbyStatus === "loading" ? "Đang tìm POI chính thức..."
    : nearbyStatus === "error" ? "Không tải được POI chính thức."
    : nearbyStatus === "locating" ? "Đang chờ vị trí GPS."
    : "Chưa tìm POI quanh vị trí GPS.";
  const osmPending = API_BASE_URL ? osmLoading : nearbyStatus === "loading";
  const osmComplete = API_BASE_URL ? !!requestKey && osmState.key === requestKey && !osmError : nearbyStatus === "success";

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.page}>
        <Text style={s.eyebrow}>KHÁM PHÁ THEO VỊ TRÍ</Text>
        <Text style={s.title}>Địa danh quanh bạn</Text>
        <Text style={s.text}>
          GPS màu xanh dương · Địa điểm hệ thống màu xanh lá · Điểm khám phá
          OpenStreetMap màu tím.
        </Text>

        <View style={s.card}>
          <Text style={s.label}>Bán kính tìm kiếm</Text>
          <View style={s.radii}>
            {RADII.map((km) => (
              <Pressable
                key={km}
                accessibilityRole="button"
                accessibilityLabel={`Bán kính ${km} km`}
                accessibilityState={{ selected: radiusKm === km }}
                onPress={() => {
                  setSelectedId(null);
                  setRadiusKm(km);
                  if (location) void refreshNearby({ radiusKm: km, reuseLocation: true });
                }}
                style={[s.radius, radiusKm === km && s.active]}
              >
                <Text
                  style={{
                    color: radiusKm === km ? "#fff" : C.primary,
                    fontWeight: "800",
                  }}
                >
                  {km} km
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={loadingPlaces ? "Đang lấy GPS..." : "Dùng GPS và tìm địa danh"}
            disabled={loadingPlaces}
            onPress={() => void handleLocate()}
            style={s.button}
          >
            {loadingPlaces ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <MapIcon name="locate" color="#fff" size={18} />
            )}
            <Text style={s.buttonText}>
              {loadingPlaces ? "Đang lấy GPS..." : "Dùng GPS và tìm địa danh"}
            </Text>
          </Pressable>
          <Text style={s.small}>
            GPS: {location ? "Đã có vị trí" : "Chưa có vị trí"} · Hệ thống:{" "}
            {officialPlaces.length} · Khám phá: {communityPlaces.length} · Bán
            kính: {radiusKm} km
          </Text>
          {placesError ? (
            <Text style={s.error}>{nearbyStatus === "location-error" ? "GPS" : API_BASE_URL ? "FastAPI" : "OpenStreetMap"}: {placesError}</Text>
          ) : null}
          {API_BASE_URL ? <Text testID="backend-poi-status" style={s.small}>FastAPI: {backendStatus}</Text> : null}
          {placesWarning ? <Text style={s.small}>{placesWarning}</Text> : null}
          {osmPending ? (
            <Text style={s.small}>
              Đang tìm OpenStreetMap trong {radiusKm} km… Có thể mất khoảng {radiusKm > 6 ? 36 : 26} giây nếu phải thử máy chủ dự phòng.
              {radiusKm > 6 ? " Nếu truy vấn chậm, hệ thống sẽ thử lại trong 5 km. Bạn có thể chọn bán kính nhỏ hơn ngay." : ""}
            </Text>
          ) : null}
          {osmComplete ? <Text style={s.small}>OpenStreetMap: Đã phản hồi · {communityPlaces.length} POI khám phá đang hiển thị.</Text> : null}
          {osmWarning ? <Text style={s.small}>{osmWarning}</Text> : null}
          {!!osmError && <Pressable accessibilityRole="button" onPress={() => setOsmRetry(v => v + 1)} style={s.linkButton}><Text style={s.linkText}>Thử lại OpenStreetMap</Text></Pressable>}
          {osmError ? (
            <Text style={s.error}>
              OpenStreetMap: {osmError}. Địa điểm hệ thống vẫn hiển thị nếu có.
            </Text>
          ) : null}
          <Text style={s.small}>
            Nguồn POI đang hiển thị: {[officialPlaces.length ? "FastAPI" : "", communityPlaces.length ? "OpenStreetMap" : ""].filter(Boolean).join(" và ") || "Chưa có POI"}
          </Text>
        </View>

        <AutoGuideControl />

        <View style={s.card}>
          <View style={s.mapHeader}>
            <Text style={s.label}>
              {selected
                ? `Đang chọn: ${selected.title}`
                : "Bản đồ và vị trí của tôi"}
            </Text>
            {location && selected ? (
              <Pressable
                style={s.myLocationButton}
                onPress={() => setSelectedId(null)}
              >
                <MapIcon name="locate" size={16} color="#fff" />
                <Text style={s.myLocationText}>Vị trí của tôi</Text>
              </Pressable>
            ) : null}
          </View>
          <PlacesMap
            location={location}
            places={allPlaces}
            selectedId={selectedId}
            radiusKm={radiusKm}
            onSelectPlace={selectPlace}
          />
          <View style={s.legend}>
            <Text style={s.legendText}>🔵 GPS của tôi</Text>
            <Text style={s.legendText}>🟢 POI chính thức</Text>
            <Text style={s.legendText}>🟣 POI OpenStreetMap</Text>
          </View>
          {selected ? (
            <View style={s.selection}>
              <Text style={s.placeTitle}>{selected.title}</Text>
              <Text style={s.small}>
                {selected.category} · {selected.district}
              </Text>
              {isBackendPlace(selected) ? (
                <Pressable
                  style={s.linkButton}
                  onPress={() => router.push(`/place/${selected.id}` as never)}
                >
                  <Text style={s.linkText}>
                    Xem chi tiết / thuyết minh chính thức →
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Text style={s.osmNote}>
                    Địa điểm cộng đồng · Chưa có bài thuyết minh đã kiểm duyệt.
                  </Text>
                  <Pressable
                    style={s.linkButton}
                    onPress={() => openExternalMap(selected)}
                  >
                    <Text style={s.linkText}>
                      Mở vị trí trên OpenStreetMap →
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
          {allPlaces.length === 0 && location && !loadingPlaces && !osmPending ? (
            <Text style={s.small}>
              {placesError || osmError
                ? "Chưa tải đủ dữ liệu địa điểm. Hãy thử lại hoặc kiểm tra kết nối."
                : "Chưa tìm thấy địa điểm trong bán kính đã chọn. Bạn có thể thử bán kính lớn hơn."}
            </Text>
          ) : null}
        </View>

        <Text style={s.label}>Địa điểm quanh bạn ({allPlaces.length})</Text>
        <View testID="nearby-place-list">{allPlaces.map((p) => (
          <View key={p.id} style={s.place}>
            <View style={{ flex: 1 }}>
              <Text style={s.placeTitle}>{p.title}</Text>
              <Text style={s.small}>
                {isBackendPlace(p) ? "Hệ thống" : "OpenStreetMap"} ·{" "}
                {p.category} ·{" "}
                {location
                  ? `${distanceKm(location, p).toFixed(1)} km`
                  : "Chưa xác định GPS"}
              </Text>
            </View>
            {isBackendPlace(p) ? (
              <Pressable
                accessibilityLabel={`Chi tiết ${p.title}`}
                onPress={() => router.push(`/place/${p.id}` as never)}
                style={s.round}
              >
                <MapIcon name="book-outline" size={19} color={C.primary} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={`Xem bản đồ ${p.title}`}
              onPress={() => setSelectedId(p.id)}
              style={s.round}
            >
              <MapIcon name="locate-outline" size={19} color={C.primary} />
            </Pressable>
            <Pressable
              accessibilityLabel={`Mở bản đồ ngoài ${p.title}`}
              onPress={() => openExternalMap(p)}
              style={s.round}
            >
              <MapIcon name="map-outline" size={19} color={C.primary} />
            </Pressable>
          </View>
        ))}
        </View><Text style={s.credit}>
          © OpenStreetMap contributors (ODbL). POI OSM chỉ để khám phá; nội dung
          thuyết minh được quản lý riêng bởi hệ thống.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  page: { padding: 22, paddingBottom: 100 },
  eyebrow: {
    fontSize: 10,
    color: C.primary,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: C.ink,
    marginTop: 9,
    marginBottom: 10,
  },
  text: { fontSize: 13, lineHeight: 22, color: C.muted, marginBottom: 16 },
  card: {
    backgroundColor: C.white,
    borderRadius: 20,
    padding: 17,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  },
  label: { fontWeight: "900", color: C.ink, marginBottom: 13 },
  radii: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  radius: { backgroundColor: C.primarySoft, padding: 12, borderRadius: 15 },
  active: { backgroundColor: C.primary },
  button: {
    backgroundColor: C.primary,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    padding: 15,
  },
  buttonText: { color: "#fff", fontWeight: "900" },
  error: { color: C.danger, fontSize: 12, lineHeight: 20, marginTop: 12 },
  mapHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  myLocationButton: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  myLocationText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  small: { fontSize: 11, color: C.muted, marginTop: 7 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  legendText: { fontSize: 11, color: C.muted },
  selection: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.primarySoft,
  },
  osmNote: { fontSize: 11, color: C.muted, marginTop: 8 },
  linkButton: { marginTop: 10 },
  linkText: { fontSize: 12, color: C.primary, fontWeight: "800" },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.white,
    marginBottom: 10,
  },
  placeTitle: { color: C.ink, fontWeight: "900", fontSize: 13 },
  round: { backgroundColor: C.primarySoft, borderRadius: 12, padding: 12 },
  credit: {
    textAlign: "center",
    fontSize: 10,
    color: C.muted,
    marginTop: 16,
    lineHeight: 16,
  },
});
