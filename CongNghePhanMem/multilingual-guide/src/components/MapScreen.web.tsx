/**
 * Ban do Web: GPS nguoi dung + POI FastAPI + POI OpenStreetMap.
 * Community POI can open a detail and read attributed content.
 * Only database IDs are sent to account/history/review APIs.
 */
import React, {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Circle, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

import AutoGuideControl from "./AutoGuideControl";
import { C } from "../theme/colors";
import type { Place } from "../data/places";
import { useMapDiscovery } from '../hooks/useMapDiscovery';
import { useI18n } from '../hooks/useI18n';
import { clusterMapPlaces } from '../services/mapClusters';
import { MapDiagnostics, MapDiscoveryPanel, MapIcon, MapPlaceList, MapSelection, mapSourceLabel, openMapDetail, openMapDirections } from './MapDiscoveryPanel';
const FALLBACK_CENTER: [number, number] = [10.7764, 106.6993];

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

function PlacesMap({
  location,
  places,
  selectedId,
  radiusKm,
  locationLabel,
  onSelectPlace,
  onOpenDetail,
  accuracy,
}: {
  location: Coordinate | null;
  places: Place[];
  selectedId: string | null;
  radiusKm: number;
  locationLabel: string;
  onSelectPlace: (id: string) => void;
  onOpenDetail: (place: Place) => void;
  accuracy?: number;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerGroupRef = useRef<LayerGroup | null>(null);
  const radiusCircleRef = useRef<Circle | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [zoom, setZoom] = useState(12);

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
      map.on('zoomend', () => { if (!cancelled) setZoom(map.getZoom()); });
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
          color: C.primary,
          weight: 1,
          opacity: 0.5,
          fillOpacity: 0.025,
        },
      ).addTo(map);
      if (typeof accuracy === 'number' && accuracy > 0) L.circle([location.latitude, location.longitude], {
        radius: accuracy, color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: .12,
        className: 'gps-accuracy-circle',
      }).addTo(markers);
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
    for (const group of clusterMapPlaces(validPlaces, zoom, selectedId)) {
      if (group.places.length > 1) {
        const label = document.createElement('span'); label.textContent = `${group.places.length} ${t('địa điểm')}`;
        const cluster = L.marker([group.latitude, group.longitude], { icon: L.divIcon({ className: 'poi-cluster', html: `<span style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;background:#0F766E;color:white;font:700 13px sans-serif;border:3px solid white;box-shadow:0 3px 12px #142D4240">${group.places.length}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }) }).addTo(markers);
        cluster.bindTooltip(label); cluster.on('click', () => map.setView([group.latitude, group.longitude], Math.min(18, zoom + 2)));
        continue;
      }
      const place = group.places[0];
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
      tooltip.textContent = `${place.title} (${t(mapSourceLabel(place))})`;
      marker.bindTooltip(tooltip);
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = place.title; popup.appendChild(title);
      const meta = document.createElement('p'); meta.textContent = `${t(place.category)} · ${t(mapSourceLabel(place))}`; popup.appendChild(meta);
      const detail = document.createElement('button'); detail.textContent = t('Xem chi tiết'); detail.onclick = () => onOpenDetail(place); popup.appendChild(detail);
      const directions = document.createElement('button'); directions.textContent = t('Chỉ đường'); directions.style.marginLeft = '8px'; directions.onclick = () => openMapDirections(place); popup.appendChild(directions);
      marker.bindPopup(popup);
      if (selected) marker.openPopup();
      marker.on("click", () => onSelectPlace(place.id));
    }

    map.invalidateSize();
  }, [ready, location, places, selectedId, radiusKm, locationLabel, onSelectPlace, onOpenDetail, accuracy, zoom, t]);

  useEffect(() => {
    const L = leafletRef.current; const map = mapRef.current;
    if (!ready || !L || !map) return;
    const validPlaces = places.filter(validCoordinate);
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
  }, [ready, location, places, selectedId, radiusKm]);

  return (
    <View>
      <div
        ref={containerRef}
        role="region"
        data-testid="places-map"
        aria-label={t('Bản đồ GPS, địa điểm hệ thống, OpenStreetMap và Wikipedia')}
        style={{
          width: "100%",
          height: 'clamp(300px, 47vh, 520px)',
          borderRadius: 17,
          overflow: "hidden",
        }}
      />
      {mapError ? <Text style={s.error}>{t(mapError)}</Text> : null}
      {!ready && !mapError ? (
        <Text style={s.small}>{t('Đang tải bản đồ...')}</Text>
      ) : null}
    </View>
  );
}

export default function MapScreen() {
  const m = useMapDiscovery();
  const { t } = useI18n();
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.heading}><View><Text style={s.eyebrow}>{t('HÀNH TRÌNH CỦA BẠN')}</Text><Text style={s.title}>{t('Khám phá quanh bạn')}</Text></View><View style={s.compass}><MapIcon name="compass-outline" size={27} color={C.primary}/></View></View>
    <MapDiscoveryPanel model={m}/>
    <View style={s.mapCard}>
      <View style={s.mapHeader}><Text style={s.label}>{m.selected ? `${t('Đang chọn:')} ${m.selected.title}` : t('Bản đồ khám phá')}</Text>{m.selected && m.location ? <Pressable accessibilityRole="button" onPress={() => m.selectPlace(null)} style={s.recenter}><MapIcon name="locate" size={17} color={C.primary}/><Text style={s.small}>{t('Vị trí của tôi')}</Text></Pressable> : null}</View>
      <PlacesMap location={m.location} places={m.filteredPlaces} selectedId={m.selectedId} radiusKm={m.radiusKm} locationLabel={t(m.locationSource === 'manual' ? 'Vị trí đã nhập' : 'Vị trí của tôi')} onSelectPlace={m.selectPlace} onOpenDetail={place => openMapDetail(place, m)} accuracy={m.locationSource === 'gps' ? m.location?.accuracy : undefined}/>
      <View style={s.legend}><Text style={s.small}>🔵 {t(m.locationSource === 'manual' ? 'Vị trí mô phỏng' : 'Vị trí của tôi')}</Text><Text style={s.small}>🟢 {t('Hệ thống')}</Text><Text style={s.small}>🟣 OpenStreetMap</Text><Text style={s.small}>🟠 Wikipedia</Text></View>
      <MapSelection model={m}/>
    </View>
    <AutoGuideControl candidates={m.allPlaces}/>
    <MapPlaceList model={m}/>
    <Text style={s.credit}>© OpenStreetMap contributors (ODbL) · Wikipedia contributors. {t('Địa điểm khám phá có nguồn cộng đồng, chưa được Admin kiểm duyệt.')}</Text>
    <MapDiagnostics model={m}/>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  page: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16, paddingBottom: 44 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  eyebrow: { fontSize: 10, fontWeight: '700', color: C.primaryDark, letterSpacing: 1.8 },
  title: { fontSize: 28, fontWeight: '800', color: C.darkBlue, marginTop: 6 },
  compass: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#EFFAF8', alignItems: 'center', justifyContent: 'center' },
  mapCard: { marginTop: 15, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 22 },
  mapHeader: { flexDirection: 'row', gap: 9, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3, marginBottom: 10 },
  label: { color: C.darkBlue, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  recenter: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  legend: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 10 },
  small: { color: C.muted, fontSize: 10, lineHeight: 17 }, error: { color: C.danger, fontSize: 12, lineHeight: 19 },
  credit: { fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 17, marginTop: 20 },
});
