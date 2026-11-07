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
  useWindowDimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Circle, LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapScreen.web.css";
import { distanceKm } from "../services/nearby";
import { mapTiles, OSM_TILES, OSM_ATTRIBUTION } from "../services/mapTiles";
import { imageLicenseUrl } from "../services/imageCredits";

import JourneyProgressCard from "./JourneyProgressCard";
import OptimalRoutePanel, { useRouteProgress } from "./OptimalRoutePanel";
import { C } from "../theme/colors";
import type { Place } from "../data/places";
import { useMapDiscovery } from '../hooks/useMapDiscovery';
import { useI18n } from '../hooks/useI18n';
import { clusterMapPlaces } from '../services/mapClusters';
import { currentJourneyStop, type JourneyProgress } from '../services/journey';
import JourneyPanel from './JourneyPanel';
import { mediaUrl } from './PlaceImage';
import { MapDiagnostics, MapDiscoveryPanel, MapIcon, MapPlaceList, MapSelection, mapSourceLabel, openMapDetail, openMapDirections } from './MapDiscoveryPanel';
import { DISTRICT1_CENTER, DISTRICT1_POLYGON, isInDistrict1 } from '../data/district1';
const FALLBACK_CENTER: [number, number] = [DISTRICT1_CENTER.latitude, DISTRICT1_CENTER.longitude];

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
  progress,
  focusDistrict = true,
}: {
  location: Coordinate | null;
  places: Place[];
  selectedId: string | null;
  radiusKm: number;
  locationLabel: string;
  onSelectPlace: (id: string) => void;
  onOpenDetail: (place: Place) => void;
  accuracy?: number;
  progress: JourneyProgress | null;
  focusDistrict?: boolean;
}) {
  const { t } = useI18n();
  const current = currentJourneyStop(progress);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const cameraKey = useRef("");
  const markerGroupRef = useRef<LayerGroup | null>(null);
  const radiusCircleRef = useRef<Circle | null>(null);
  const districtBoundsRef = useRef<import("leaflet").LatLngBounds | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [zoom, setZoom] = useState(12);
  const [tileNotice, setTileNotice] = useState("");

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
        zoomSnap: 0.25,
      }).setView(FALLBACK_CENTER, 14);
      const config = mapTiles(process.env.EXPO_PUBLIC_MAPTILER_KEY, process.env.EXPO_PUBLIC_MAPTILER_STYLE);
      let failures = 0, fallback = config.provider === 'osm';
      // Free MapTiler accounts require their linked logo as well as text credits.
      const logo=config.provider==='maptiler' ? new L.Control({position:'bottomleft'}) : null;
      if(logo){logo.onAdd=()=>{
        const link=document.createElement('a');link.href='https://www.maptiler.com/';link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','MapTiler');link.style.cssText='display:block;padding:4px;background:#ffffffdd;border-radius:4px';
        const image=document.createElement('img');image.src='https://api.maptiler.com/resources/logo.svg';image.alt='MapTiler logo';image.style.cssText='display:block;width:100px;height:25px';link.appendChild(image);
        L.DomEvent.disableClickPropagation(link);return link;
      };logo.addTo(map);}

      if (fallback) setTileNotice('Đang dùng lớp bản đồ OpenStreetMap dự phòng.');
      const tiles = L.tileLayer(config.url, {maxZoom:19, attribution:config.attribution, keepBuffer:2, updateWhenIdle:true}).addTo(map);
      tiles.on('tileload', () => { failures=0; if (!cancelled) setMapError(''); });
      tiles.on('tileerror', () => {
        if (cancelled || ++failures < 4) return;
        if (!fallback) {
          fallback=true; failures=0; logo?.remove();
          map.attributionControl.removeAttribution(config.attribution);
          tiles.options.attribution=OSM_ATTRIBUTION;
          map.attributionControl.addAttribution(OSM_ATTRIBUTION);
          tiles.setUrl(OSM_TILES);
          setTileNotice('Lớp MapTiler chưa tải được. Đang dùng bản đồ OpenStreetMap dự phòng.');
        } else setMapError('Ảnh nền bản đồ chưa tải được. Vị trí, điểm dừng và danh sách vẫn được giữ.');
      });

      leafletRef.current = L;
      mapRef.current = map;
      map.on('zoomend', () => { if (!cancelled) setZoom(map.getZoom()); });
      // The app covers District 1 only: always show its boundary.
      const district = L.polygon(DISTRICT1_POLYGON as [number, number][], { color: C.primary, weight: 2, opacity: .85, dashArray: '6 6', fillColor: C.primary, fillOpacity: .05, interactive: false }).addTo(map);
      districtBoundsRef.current = district.getBounds();
      map.fitBounds(district.getBounds(), { padding: [12, 12] });
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
    if (!selectedId || !containerRef.current) return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    containerRef.current.scrollIntoView({behavior:reduced ? 'instant' : 'smooth',block:'center',inline:'nearest'});
  },[selectedId]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const markers = markerGroupRef.current;
    if (!ready || !L || !map || !markers) return;
    markers.clearLayers();
    radiusCircleRef.current?.remove();
    radiusCircleRef.current = null;

    if (validCoordinate(location)) {
      // Vong tron mo the hien pham vi tim kiem, khong phai sai so GPS (khong dung khi app bao ca Quan 1).
      if (!focusDistrict) radiusCircleRef.current = L.circle(
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

    const routeStops = progress?.journey.stops ?? [];
    if (routeStops.length > 1) L.polyline(routeStops.map(p => [p.latitude,p.longitude] as [number,number]), { color: C.primaryDark, weight: 3, dashArray: '8 8', className: 'journey-illustration' }).bindTooltip(t('Đường nối minh họa, không phải tuyến đường thực tế.')).addTo(markers);
    routeStops.forEach((place,index) => {
      const done = progress!.completed.includes(place.id), skipped = progress!.skipped.includes(place.id), active = current?.id === place.id;
      const color = done ? '#0f766e' : skipped ? '#94a3b8' : active ? '#f97316' : '#173339';
      const label = document.createElement('span'); label.textContent = String(index+1); label.style.cssText = `display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:${color};color:white;border:3px solid white;font-weight:800;box-shadow:0 2px 7px #17333955`;
      const point = L.marker([place.latitude,place.longitude], { icon: L.divIcon({ className: 'journey-stop-marker', html: label, iconSize:[38,38], iconAnchor:[19,19] }) }).addTo(markers);
      point.getElement()?.setAttribute('data-stop-id',place.id);
      point.getElement()?.setAttribute('data-selected',String(selectedId === place.id));
      point.getElement()?.setAttribute('aria-label',`${index+1}. ${place.title}`);
      if (selectedId === place.id) label.style.outline = '3px solid #2563eb';
      const stopLabel = document.createElement('span'); stopLabel.textContent = `${index+1}. ${place.title}`; point.bindTooltip(stopLabel); point.on('click',()=>onSelectPlace(place.id));
    });
    const validPlaces = places.filter((p) => validCoordinate(p) && !routeStops.some(stop => stop.id === p.id));
    for (const group of clusterMapPlaces(validPlaces, zoom, selectedId)) {
      if (group.places.length > 1) {
        const label = document.createElement('span'); label.textContent = `${group.places.length} ${t('địa điểm')}`;
        const badge = document.createElement('span'); badge.className='mg-cluster'; badge.textContent=String(group.places.length);
        const cluster = L.marker([group.latitude, group.longitude], {title:`${group.places.length} ${t('địa điểm')}`, icon:L.divIcon({className:'poi-cluster',html:badge,iconSize:[46,46],iconAnchor:[23,23]})}).addTo(markers);
        cluster.bindTooltip(label);
        cluster.getElement()?.setAttribute('aria-label',`${t('Mở nhóm')} ${group.places.length} ${t('địa điểm')}`);
        cluster.on('click', () => map.flyToBounds(L.latLngBounds(group.places.map(p=>[p.latitude,p.longitude] as [number,number])),{padding:[40,40],maxZoom:Math.min(18,zoom+3),duration:.55}));
        continue;
      }
      const place = group.places[0];
      const selected = selectedId === place.id;
      const backend = isBackendPlace(place);
      const pin = document.createElement('div'); pin.className='mg-pin';
      pin.style.setProperty('--pin-color', selected ? '#0f766e' : backend ? '#0d9488' : place.source === 'wikipedia' ? '#b45309' : '#7c3aed');
      const glyph = document.createElement('span'); glyph.textContent=backend ? '◆' : place.source === 'wikipedia' ? 'W' : '◇'; pin.appendChild(glyph);
      const marker = L.marker([place.latitude,place.longitude],{title:place.title,icon:L.divIcon({className:'poi-marker',html:pin,iconSize:[36,42],iconAnchor:[18,40],popupAnchor:[0,-34]})}).addTo(markers);
      marker.getElement()?.setAttribute('data-poi-id',place.id);
      marker.getElement()?.setAttribute('data-selected',String(selected));
      marker.getElement()?.setAttribute('data-source',backend ? 'backend' : place.source ?? 'osm');
      // textContent tranh chen HTML tu ten POI cua ben thu ba.
      const tooltip = document.createElement("span");
      tooltip.textContent = `${place.title} (${t(mapSourceLabel(place))})`;
      marker.bindTooltip(tooltip);
      const popup = document.createElement('div'); popup.className='mg-popup';
      const photo = mediaUrl(place.imageThumbnail || place.image);
      if (photo) { const image = document.createElement('img'); image.src = photo; image.alt = place.title; image.loading='lazy'; image.className='mg-popup-photo'; image.referrerPolicy='strict-origin-when-cross-origin'; image.onerror=()=>image.remove(); popup.appendChild(image); }
      const title = document.createElement('strong'); title.textContent = place.title; popup.appendChild(title);
      const meta = document.createElement('p'); meta.textContent = `${t(place.category)} · ${t(mapSourceLabel(place))}`; popup.appendChild(meta);
      if (validCoordinate(location)) { const distance=document.createElement('p'); distance.className='mg-popup-distance'; distance.textContent=`${distanceKm(location,place).toFixed(2)} km · ${t('Khoảng cách đường chim bay')}`; popup.appendChild(distance); }
      if (photo && (place.imageAttribution || place.imageLicense)) {
        const credit=document.createElement('p');credit.className='mg-popup-credit';credit.textContent=`© ${place.imageAttribution ?? 'Wikimedia Commons'} · `;
        const license=imageLicenseUrl(place.imageLicense);
        for (const [text,url] of [[place.imageLicense,license],[t('Nguồn ảnh'),place.imageSourceUrl]]) if(text && url && /^https?:\/\//.test(url)){const link=document.createElement('a');link.textContent=text+' ↗ ';link.href=url;link.target='_blank';link.rel='noopener noreferrer';credit.appendChild(link);}
        popup.appendChild(credit);
      }
      const detail = document.createElement('button'); detail.textContent = t('Xem chi tiết'); detail.onclick = () => onOpenDetail(place); popup.appendChild(detail);
      const directions = document.createElement('button'); directions.textContent = t('Chỉ đường'); directions.style.marginLeft = '8px'; directions.onclick = () => openMapDirections(place, t); popup.appendChild(directions);
      marker.bindPopup(popup);
      if (selected) marker.openPopup();
      marker.on("click", () => onSelectPlace(place.id));
    }

    map.invalidateSize();
  }, [ready, location, places, selectedId, radiusKm, locationLabel, onSelectPlace, onOpenDetail, accuracy, zoom, t, progress, current, focusDistrict]);

  useEffect(() => {
    const L = leafletRef.current; const map = mapRef.current;
    if (!ready || !L || !map) return;
    const validPlaces = places.filter(validCoordinate);
    const selected = validPlaces.find((p) => p.id === selectedId);
    const key=JSON.stringify([selected?.id,location?.latitude,location?.longitude,radiusKm,progress?.journey.id,focusDistrict, !location && !progress && !focusDistrict ? validPlaces.map(p=>p.id) : null]);
    if(cameraKey.current===key)return;
    cameraKey.current=key;
    if (selected) {
      map.setView([selected.latitude, selected.longitude], 15, {
        animate: true,
      });
    } else if (progress?.journey.stops.length) {
      map.fitBounds(L.latLngBounds(progress.journey.stops.map(p=>[p.latitude,p.longitude] as [number,number])),{padding:[35,35],maxZoom:15});
    } else if (focusDistrict && districtBoundsRef.current && (!validCoordinate(location) || !isInDistrict1(location))) {
      // Outside District 1 (or no GPS yet): frame the whole district rather than the user's position.
      map.fitBounds(districtBoundsRef.current, { padding: [12, 12] });
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
  }, [ready, location, places, selectedId, radiusKm, progress, focusDistrict]);

  return (
    <View>
      <div
        ref={containerRef}
        role="region"
        data-testid="places-map"
        aria-label={t('Bản đồ GPS, địa điểm hệ thống, OpenStreetMap và Wikipedia')}
        style={{
          width: "100%",
          height: 'clamp(340px, 55vh, 600px)',
          borderRadius: 17,
          overflow: "hidden",
        }}
      />
      {tileNotice ? <Text testID="tile-provider-notice" style={s.small}>{t(tileNotice)}</Text> : null}
      {mapError ? <Text style={s.error}>{t(mapError)}</Text> : null}
      {!!progress && <Text style={s.small}>{t('Đường nối minh họa, không phải tuyến đường thực tế.')} 🟠 {t('Điểm tiếp theo')} · 🟢 {t('Đã hoàn thành')}</Text>}
      {!ready && !mapError ? (
        <Text style={s.small}>{t('Đang tải bản đồ...')}</Text>
      ) : null}
    </View>
  );
}

export default function MapScreen() {
  const m = useMapDiscovery();
  // A planned optimal route is drawn exactly like a journey (numbered stops and a line), on its own.
  const plannedRoute = useRouteProgress();
  const mapProgress = m.journeyMode ? m.routeProgress : plannedRoute;
  const wide = useWindowDimensions().width >= 1050;
  const { t } = useI18n();
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <View style={s.heading}><View><Text style={s.eyebrow}>{t(m.journeyMode ? 'HÀNH TRÌNH CỦA BẠN' : 'QUẬN 1 · TP. HỒ CHÍ MINH')}</Text><Text style={s.title}>{m.routeProgress?.journey.name ?? t(m.journeyMode ? 'Hành trình khám phá' : 'Khám phá Quận 1')}</Text></View><View style={s.compass}><MapIcon name="compass-outline" size={27} color={C.primary}/></View></View>
    <View style={{flexDirection:wide ? 'row' : 'column',alignItems:'stretch',gap:16}}>
    <View style={wide ? {width:360,flexShrink:0} : undefined}><MapDiscoveryPanel model={m}/>{!m.journeyMode && <OptimalRoutePanel model={m} />}</View>
    <View style={[s.mapCard,wide && {flex:1,minWidth:0}]}>
      <View style={s.mapHeader}><Text style={s.label}>{m.selected ? `${t('Đang chọn:')} ${m.selected.title}` : t('Bản đồ khám phá')}</Text>{m.selected && m.location ? <Pressable accessibilityRole="button" onPress={() => m.selectPlace(null)} style={s.recenter}><MapIcon name="locate" size={17} color={C.primary}/><Text style={s.small}>{t('Vị trí của tôi')}</Text></Pressable> : null}</View>
      <PlacesMap progress={mapProgress} location={m.location} places={m.journeyMode || !plannedRoute ? m.filteredPlaces : []} selectedId={m.selectedId} radiusKm={m.radiusKm} locationLabel={t(m.locationSource === 'manual' ? 'Vị trí đã nhập' : 'Vị trí của tôi')} onSelectPlace={m.selectPlace} onOpenDetail={place => openMapDetail(place, m)} accuracy={m.locationSource === 'gps' ? m.location?.accuracy : undefined} focusDistrict={m.district}/>
      <View style={s.legend}><Text style={s.small}>🔵 {t(m.locationSource === 'manual' ? 'Vị trí mô phỏng' : 'Vị trí của tôi')}</Text><Text style={s.small}>🟢 {t('Hệ thống')}</Text><Text style={s.small}>🟣 OpenStreetMap</Text><Text style={s.small}>🟠 Wikipedia</Text></View>
      <MapSelection model={m}/>
    </View>
    </View>
    <JourneyPanel model={m}/>
    {m.journeyMode && !!m.routeProgress?.journey.stops.length && <View style={{ marginTop: 16 }}><JourneyProgressCard /></View>}
    {!m.journeyMode && <MapPlaceList model={m}/>}
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
  mapCard: { marginTop: 0, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 22 },
  mapHeader: { flexDirection: 'row', gap: 9, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3, marginBottom: 10 },
  label: { color: C.darkBlue, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  recenter: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  legend: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 10 },
  small: { color: C.muted, fontSize: 10, lineHeight: 17 }, error: { color: C.danger, fontSize: 12, lineHeight: 19 },
  credit: { fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 17, marginTop: 20 },
});
