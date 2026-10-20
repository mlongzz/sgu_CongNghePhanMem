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
  TextInput,
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
import { fetchWikipediaNearby, wikipediaNearbyKey } from "../services/wikipedia";
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

function sourceLabel(place: Place): string {
  return isBackendPlace(place) ? "Hệ thống" : place.source === "wikipedia" ? "Wikipedia" : "OpenStreetMap";
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
  locationLabel,
  onSelectPlace,
}: {
  location: Coordinate | null;
  places: Place[];
  selectedId: string | null;
  radiusKm: number;
  locationLabel: string;
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
        .bindTooltip(locationLabel)
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
        fillColor: selected ? "#f97316" : backend ? "#128a7a" : place.source === "wikipedia" ? "#d97706" : "#8b5cf6",
        fillOpacity: 1,
        className: "poi-marker",
      }).addTo(markers);
      marker.getElement()?.setAttribute("data-poi-id", place.id);
      // textContent tranh chen HTML tu ten POI cua ben thu ba.
      const tooltip = document.createElement("span");
      tooltip.textContent = `${place.title} (${sourceLabel(place)})`;
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
  }, [ready, location, places, selectedId, radiusKm, locationLabel, onSelectPlace]);

  return (
    <View>
      <div
        ref={containerRef}
        role="region"
        data-testid="places-map"
        aria-label="Bản đồ GPS, địa điểm hệ thống, OpenStreetMap và Wikipedia"
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
    locationSource,
    locationProgress,
    cancelLocation,
    radiusKm,
    setRadiusKm,
    refreshNearby,
    loadingPlaces,
    placesError,
    placesWarning,
    nearbyStatus,
  } = useApp();
  const [osmRetry, setOsmRetry] = useState(0);
  const [osmProgress, setOsmProgress] = useState({ key: "", radiusKm: 0, attempt: 0, totalAttempts: 0 });
  const [osmState, setOsmState] = useState({ key: "", places: [] as Place[], warning: "", error: "" });
  // A GPS search activates the fallback. An explicit opt-out lasts for this mounted screen.
  // Opening the screen alone never acquires or sends a location.
  const [wikiMode, setWikiMode] = useState<"auto" | "on" | "off">("auto");
  const wikiEnabled = wikiMode === "on";
  const [wikiRetry, setWikiRetry] = useState(0);
  const [wikiState, setWikiState] = useState({ key: "", places: [] as Place[], warning: "", error: "" });
  const [showManualLocation, setShowManualLocation] = useState(false);
  const [manualLatitude, setManualLatitude] = useState("");
  const [manualLongitude, setManualLongitude] = useState("");
  const [manualError, setManualError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  const coordinates = useMemo(() => typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null, [latitude, longitude]);
  const requestKey = API_BASE_URL && validCoordinate(coordinates) ? `${osmExploreKey(coordinates, radiusKm)}:${osmRetry}` : "";
  const osmPlaces = useMemo(() => osmState.key === requestKey ? osmState.places : [], [osmState.key, osmState.places, requestKey]);
  const osmWarning = osmState.key === requestKey ? osmState.warning : "";
  const osmError = osmState.key === requestKey ? osmState.error : "";
  const osmLoading = !!requestKey && osmState.key !== requestKey;
  const activeOsmProgress = requestKey && osmProgress.key === requestKey ? osmProgress : null;
  const isLocating = nearbyStatus === "locating";
  const wikiKey = wikiEnabled && !isLocating && nearbyStatus !== "location-error" && validCoordinate(coordinates) ? `${wikipediaNearbyKey(coordinates, radiusKm)}:${wikiRetry}` : "";
  const wikiPlaces = useMemo(() => wikiKey && wikiState.key === wikiKey ? wikiState.places : [], [wikiKey, wikiState.key, wikiState.places]);
  const wikiLoading = !!wikiKey && wikiState.key !== wikiKey;
  const wikiError = wikiKey && wikiState.key === wikiKey ? wikiState.error : "";
  const wikiWarning = wikiKey && wikiState.key === wikiKey ? wikiState.warning : "";

  // OSM remains separate from backend POI used by accounts and narration.
  // Delay dispatch briefly so rapid radius changes and Strict Mode cleanup cancel before sending.
  useEffect(() => {
    if (!requestKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // Invocation is inside try: even a stale module throwing synchronously cannot crash React.
          const result = await fetchOsmExploreResult(coordinates, radiusKm, {
            signal: controller.signal,
            forceRefresh: osmRetry > 0,
            onProgress: progress => {
              if (!controller.signal.aborted) setOsmProgress({ ...progress, key: requestKey });
            },
          });
          if (!controller.signal.aborted) setOsmState({ key: requestKey, places: result.places, warning: result.warning, error: "" });
        } catch (error: unknown) {
          if (!controller.signal.aborted) setOsmState({ key: requestKey, places: [], warning: "", error: error instanceof Error ? error.message : "Không tải được địa điểm OpenStreetMap." });
        }
      })();
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [coordinates, radiusKm, requestKey, osmRetry]);

  useEffect(() => {
    if (!wikiKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchWikipediaNearby(coordinates, radiusKm, { signal: controller.signal, forceRefresh: wikiRetry > 0 });
          if (!controller.signal.aborted) setWikiState({ key: wikiKey, places: result.places, warning: result.warning, error: "" });
        } catch (error) {
          if (!controller.signal.aborted) setWikiState({ key: wikiKey, places: [], warning: "", error: error instanceof Error ? error.message : "Không tải được địa điểm Wikipedia." });
        }
      })();
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [wikiKey, coordinates, radiusKm, wikiRetry]);

  const allPlaces = useMemo(() => {
    const combined: Place[] = [];
    for (const place of [...places, ...osmPlaces, ...wikiPlaces]) {
      if (!validCoordinate(place) || (validCoordinate(location) && distanceKm(location, place) > radiusKm + 0.03)) continue;
      if (combined.some(p => p.id === place.id || (!isBackendPlace(place) && normalizeSearch(p.title).trim() === normalizeSearch(place.title).trim() && distanceKm(p, place) < 0.15))) continue;
      combined.push(place);
    }
    return combined.sort((a, b) => validCoordinate(location) ? distanceKm(location, a) - distanceKm(location, b) : 0);
  }, [places, osmPlaces, wikiPlaces, location, radiusKm]);
  const selected = allPlaces.find((p) => p.id === selectedId) ?? null;
  const selectPlace = useCallback((id: string) => setSelectedId(id), []);
  const handleLocate = async () => {
    setOsmRetry(v => v + 1);
    if (wikiMode !== "off") {
      setWikiMode("on");
      setWikiRetry(v => v + 1);
    }
    setSelectedId(null);
    await refreshNearby();
  };
  const handleWikipediaSearch = async () => {
    setWikiMode("on");
    setWikiRetry(v => v + 1);
    if (!location || nearbyStatus === "location-error") await refreshNearby();
  };
  const handleManualSearch = async () => {
    const parse = (text: string) => {
      const value = text.trim().replace(",", ".");
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
    };
    const input = { latitude: parse(manualLatitude), longitude: parse(manualLongitude) };
    if (!validCoordinate(input)) {
      setManualError("Nhập vĩ độ từ -90 đến 90 và kinh độ từ -180 đến 180, bằng số thập phân.");
      return;
    }
    setManualError("");
    setSelectedId(null);
    setWikiMode("on");
    setWikiRetry(v => v + 1);
    await refreshNearby({ coordinates: input });
  };
  const gpsButtonLabel = isLocating ? "Đang lấy GPS..." : loadingPlaces ? "Đang tìm địa điểm..." : "Dùng GPS và tìm địa danh";
  const locationLabel = locationSource === "manual" ? "Vị trí đã nhập" : "Vị trí của tôi";

  // Khong bao gio dieu huong osm-* den /place/{id}: Backend chi chap nhan ID DB.
  const officialPlaces = allPlaces.filter(isBackendPlace);
  const communityPlaces = allPlaces.filter((p) => !isBackendPlace(p));
  const visibleOsmPlaces = communityPlaces.filter(p => p.source !== "wikipedia");
  const visibleWikiPlaces = communityPlaces.filter(p => p.source === "wikipedia");
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
          OpenStreetMap màu tím · Wikipedia màu cam.
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
            accessibilityLabel={gpsButtonLabel}
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
              {gpsButtonLabel}
            </Text>
          </Pressable>
          <Text style={s.small}>{wikiMode === "off"
            ? "Wikipedia đang tắt. GPS vẫn tìm địa điểm từ các nguồn còn lại."
            : "Bấm GPS để lấy vị trí thật và tự tìm địa điểm, kể cả Wikipedia dự phòng. Tọa độ GPS và bán kính tìm kiếm được gửi đến vi.wikipedia.org khi tìm."}</Text>
          {isLocating ? <View style={{ gap: 6 }}>
            <Text testID="gps-progress" style={s.small}>{locationProgress}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Hủy lấy GPS" onPress={cancelLocation} style={s.linkButton}>
              <Text style={s.linkText}>Hủy lấy GPS</Text>
            </Pressable>
          </View> : null}
          <Text style={s.small}>
            GPS: {location ? locationSource === "manual" ? `Không dùng GPS · Vị trí đã nhập (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})` : `Đã có vị trí (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})` : "Chưa có vị trí"} · Hệ thống:{" "}
            {officialPlaces.length} · Khám phá: {communityPlaces.length} · Bán
            kính: {radiusKm} km
          </Text>
          {!location && nearbyStatus === "idle" ? <Text style={s.small}>Chưa bắt đầu tìm kiếm. Nhấn “Dùng GPS và tìm địa danh” một lần để tự lấy vị trí và tìm địa điểm quanh bạn.</Text> : null}
          {placesError ? (
            <Text style={s.error}>{nearbyStatus === "location-error" ? "GPS" : API_BASE_URL ? "FastAPI" : "OpenStreetMap"}: {placesError}</Text>
          ) : null}
          {API_BASE_URL ? <Text testID="backend-poi-status" style={s.small}>FastAPI: {backendStatus}</Text> : null}
          {placesWarning ? <Text style={s.small}>{placesWarning}</Text> : null}
          {osmPending ? (
            <Text style={s.small}>
              Đang tìm OpenStreetMap trong {activeOsmProgress?.radiusKm ?? radiusKm} km…
              {activeOsmProgress ? ` Lượt ${activeOsmProgress.attempt}/${activeOsmProgress.totalAttempts}.` : ""}
              {activeOsmProgress && activeOsmProgress.radiusKm < radiusKm ? ` Đang tìm dự phòng trong ${activeOsmProgress.radiusKm} km gần bạn vì lượt tìm trước không hoàn tất.` : ""}
              {" "}Có thể mất khoảng {radiusKm > 6 ? 36 : 26} giây nếu phải thử máy chủ dự phòng.
              {radiusKm > 6 ? " Nếu truy vấn chậm, hệ thống sẽ thử lại trong 5 km. Bạn có thể chọn bán kính nhỏ hơn ngay." : ""}
            </Text>
          ) : null}
          {osmComplete ? <Text style={s.small}>OpenStreetMap: Đã phản hồi · {visibleOsmPlaces.length} POI khám phá đang hiển thị.</Text> : null}
          {osmWarning ? <Text style={s.small}>{osmWarning}</Text> : null}
          {!!osmError && <Pressable accessibilityRole="button" onPress={() => setOsmRetry(v => v + 1)} style={s.linkButton}><Text style={s.linkText}>Thử lại OpenStreetMap</Text></Pressable>}
          {osmError ? (
            <Text style={s.error}>
              OpenStreetMap: {osmError.replace(/[.\s]+$/u, "")}. Các nguồn khác vẫn hiển thị nếu có.
            </Text>
          ) : null}
          <Text style={s.small}>
            Nguồn POI đang hiển thị: {[officialPlaces.length ? "FastAPI" : "", visibleOsmPlaces.length ? "OpenStreetMap" : "", visibleWikiPlaces.length ? "Wikipedia" : ""].filter(Boolean).join(" và ") || "Chưa có POI"}
          </Text>
          <Text style={s.label}>Nguồn dự phòng: Wikipedia</Text>
          <Text style={s.small}>Cung cấp địa điểm quanh vị trí GPS của bạn. Nguồn này tự tìm khi bạn bấm GPS; bạn có thể làm mới hoặc tắt bên dưới.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={wikiEnabled ? "Làm mới Wikipedia" : "Tìm bằng Wikipedia"}
            disabled={isLocating || wikiLoading} style={s.linkButton}
            onPress={() => void handleWikipediaSearch()}>
            <Text style={s.linkText}>{isLocating && wikiEnabled ? "Đang lấy GPS để tìm Wikipedia..." : wikiLoading ? "Đang tìm Wikipedia..." : wikiEnabled ? "Làm mới Wikipedia" : "Tìm bằng Wikipedia"}</Text>
          </Pressable>
          {wikiMode !== "off" ? <Pressable accessibilityRole="button" onPress={() => setWikiMode("off")} style={s.linkButton}><Text style={s.linkText}>Tắt Wikipedia</Text></Pressable> : null}
          {!location ? <Text style={s.small}>Nút này sẽ yêu cầu vị trí nếu bạn chưa cấp quyền. Chọn Cho phép khi trình duyệt hỏi.</Text> : null}
          {wikiError ? <Text style={s.error}>Wikipedia: {wikiError}</Text> : null}
          {wikiKey && wikiState.key === wikiKey && !wikiError ? <Text style={s.small}>Wikipedia: Đã phản hồi · {visibleWikiPlaces.length} địa điểm đang hiển thị.</Text> : null}
          {wikiWarning ? <Text style={s.small}>{wikiWarning}</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => setShowManualLocation(v => !v)} style={s.linkButton}><Text style={s.linkText}>{showManualLocation ? "Ẩn nhập tọa độ" : "Nhập tọa độ thay cho GPS"}</Text></Pressable>
          {showManualLocation ? <View style={{ gap: 8 }}>
            <Text style={s.small}>Dùng khi GPS bị chặn hoặc thiết bị không xác định được vị trí. Tọa độ sẽ được dùng để tìm Wikipedia và các nguồn bản đồ, không được coi là GPS thiết bị.</Text>
            <TextInput accessibilityLabel="Vĩ độ tìm kiếm" placeholder="Vĩ độ (-90 đến 90)" keyboardType="decimal-pad" value={manualLatitude} onChangeText={setManualLatitude} style={s.coordinateInput} />
            <TextInput accessibilityLabel="Kinh độ tìm kiếm" placeholder="Kinh độ (-180 đến 180)" keyboardType="decimal-pad" value={manualLongitude} onChangeText={setManualLongitude} style={s.coordinateInput} />
            {manualError ? <Text style={s.error}>{manualError}</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => void handleManualSearch()} style={s.linkButton}><Text style={s.linkText}>Dùng tọa độ và tìm Wikipedia</Text></Pressable>
          </View> : null}
        </View>

        <AutoGuideControl />

        <View style={s.card}>
          <View style={s.mapHeader}>
            <Text style={s.label}>
              {selected
                ? `Đang chọn: ${selected.title}`
                : locationSource === "manual" ? "Bản đồ và vị trí đã nhập" : "Bản đồ và vị trí của tôi"}
            </Text>
            {location && selected ? (
              <Pressable
                style={s.myLocationButton}
                onPress={() => setSelectedId(null)}
              >
                <MapIcon name="locate" size={16} color="#fff" />
                <Text style={s.myLocationText}>{locationLabel}</Text>
              </Pressable>
            ) : null}
          </View>
          <PlacesMap
            location={location}
            places={allPlaces}
            selectedId={selectedId}
            radiusKm={radiusKm}
            locationLabel={locationLabel}
            onSelectPlace={selectPlace}
          />
          <View style={s.legend}>
            <Text style={s.legendText}>{locationSource === "manual" ? "🔵 Vị trí đã nhập" : "🔵 GPS của tôi"}</Text>
            <Text style={s.legendText}>🟢 POI chính thức</Text>
            <Text style={s.legendText}>🟣 POI OpenStreetMap</Text>
            <Text style={s.legendText}>🟠 Wikipedia</Text>
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
                  {selected.source === "wikipedia" && selected.sourceUrl ? <Pressable accessibilityRole="button" style={s.linkButton} onPress={() => void Linking.openURL(selected.sourceUrl!).catch(() => {})}><Text style={s.linkText}>Đọc bài viết Wikipedia →</Text></Pressable> : null}
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
          {allPlaces.length === 0 && location && !loadingPlaces && !osmPending && !wikiLoading ? (
            <Text style={s.small}>
              {placesError || osmError || wikiError
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
                {sourceLabel(p)} ·{" "}
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
          thuyết minh được quản lý riêng bởi hệ thống. Địa điểm Wikipedia dẫn đến bài viết gốc của cộng đồng Wikipedia.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  coordinateInput: { borderWidth: 1, borderColor: C.faint, borderRadius: 10, padding: 12, color: C.ink, backgroundColor: C.white },
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
