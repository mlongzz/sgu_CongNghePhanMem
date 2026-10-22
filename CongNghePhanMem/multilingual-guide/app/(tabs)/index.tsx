import React, { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { C } from "../../src/theme/colors";
import { PlaceCard, Heading } from "../../src/components/UI";
import type { Category } from "../../src/data/places";
import { filterPlaces } from "../../src/services/nearby";
import { useApp } from "../../src/context/AppContext";
import { useI18n } from "../../src/hooks/useI18n";

const FILTERS: ("Tất cả" | Category)[] = [
  "Tất cả",
  "Lịch sử",
  "Kiến trúc",
  "Văn hóa",
  "Khám phá",
];

export default function Home() {
  const {
    language,
    favorites,
    places,
    loadingPlaces,
    placesError,
    placesWarning,
    location,
    refreshCatalog,
  } = useApp();
  const { t } = useI18n();
  useFocusEffect(useCallback(() => { void refreshCatalog(); }, [refreshCatalog]));
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(40);
  const [category, setCategory] = useState<"Tất cả" | Category>("Tất cả");
  const filtered = useMemo(
    () => filterPlaces(places, deferredQuery, category, language),
    [places, category, deferredQuery, language],
  );
  const featured = places.slice(0, 4);
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.page}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.topLine}>
          <View>
            <Text style={s.eyebrow}>{t('XIN CHÀO, NHÀ KHÁM PHÁ ✨')}</Text>
            <Text style={s.greeting}>
              {t('Sẵn sàng đi đâu?')} <Text style={s.spark}>✦</Text>
            </Text>
          </View>
          <Pressable onPress={() => router.push("/profile")} style={s.avatar}>
            <Ionicons name="person-outline" size={23} color={C.primary} />
          </Pressable>
        </View>
        <Pressable onPress={() => router.push("/journeys" as never)} style={s.gpsButton}>
          <Text style={s.gpsButtonText}>{t('Khám phá hành trình và điểm dừng →')}</Text>
        </Pressable>

        <View style={s.hero}>
          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1533676802871-eca1ae998cd5?w=1300&q=85",
            }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={["rgba(13,39,53,.3)", "rgba(9,40,48,.92)"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.heroTop}>
            <Ionicons name="location" size={14} color="#9BF0D5" />
            <Text style={s.heroCity}>{t('KHÁM PHÁ QUANH BẠN')}</Text>
            <View style={s.heroPill}>
              <Ionicons name="sparkles" color="#fff" size={12} />
              <Text style={s.heroPillText}>Audio Guide</Text>
            </View>
          </View>
          <View style={s.heroContent}>
            <Text style={s.heroKicker}>
              {t('TRẢI NGHIỆM THÀNH PHỐ THEO CÁCH CỦA BẠN')}
            </Text>
            <Text style={s.heroTitle}>{t('Mỗi nơi chốn,\nmột câu chuyện.')}</Text>
            <Text style={s.heroSubtitle}>
              {t('Tự do khám phá cùng thuyết minh đa ngôn ngữ.')}
            </Text>
            <Pressable onPress={() => router.push("/map")} style={s.heroButton}>
              <Text style={s.heroButtonText}>{t('Bắt đầu khám phá')}</Text>
              <Ionicons name="arrow-forward" color={C.ink} size={17} />
            </Pressable>
          </View>
        </View>

        <View style={s.statStrip}>
          <View style={s.stat}>
            <View style={[s.statIcon, { backgroundColor: "#E6F5F3" }]}>
              <Ionicons name="location-outline" size={20} color={C.primary} />
            </View>
            <View>
              <Text style={s.statNumber}>{places.length} {t('địa điểm')}</Text>
              <Text style={s.statText}>{t('Đang chờ bạn')}</Text>
            </View>
          </View>
          <View style={s.verticalDivider} />
          <View style={s.stat}>
            <View style={[s.statIcon, { backgroundColor: "#FFF0E7" }]}>
              <Ionicons name="heart-outline" size={20} color={C.coral} />
            </View>
            <View>
              <Text style={s.statNumber}>{favorites.length} {t('đã lưu')}</Text>
              <Text style={s.statText}>{t('Yêu thích của bạn')}</Text>
            </View>
          </View>
        </View>

        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={22} color={C.muted} />
          <TextInput
            value={query}
            onChangeText={value => { setQuery(value); setVisibleCount(40); }}
            placeholder={t('Tìm địa điểm, di tích, văn hóa...')}
            accessibilityLabel={t('Tìm địa điểm, di tích, văn hóa...')}
            placeholderTextColor={C.faint}
            style={s.search}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={19} color={C.faint} />
            </Pressable>
          ) : (
            <Ionicons name="options-outline" size={21} color={C.primary} />
          )}
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push('/map')} style={s.gpsPanel}>
          <View style={s.gpsHeading}><Ionicons name="navigate-circle" size={30} color={C.primary} /><View style={{ flex: 1 }}><Text style={s.gpsTitle}>{t('Tìm địa danh quanh vị trí của tôi')}</Text><Text style={s.gpsCaption}>{location ? t('Vị trí hiện tại') + (typeof location.accuracy === 'number' ? ` · GPS ±${Math.round(location.accuracy)} m` : '') : t('Cho phép vị trí để tìm địa danh quanh bạn.')}</Text></View><Ionicons name="arrow-forward" size={20} color={C.primary} /></View>
        </Pressable>
        {placesError ? <Text accessibilityRole="alert" style={s.gpsError}>{placesError}</Text> : null}
        {placesWarning ? <Text style={s.sourceText}>{placesWarning}</Text> : null}
        {loadingPlaces && <Text style={s.sourceText}>{t('Đang tải địa điểm...')}</Text>}
        {!query && category === "Tất cả" ? (
          <>
            <Heading
              eyebrow="DÀNH CHO BẠN"
              title="Điểm đến nổi bật"
              action="Xem bản đồ"
              onAction={() => router.push("/map")}
            />
            <FlatList
              horizontal
              data={featured}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => <PlaceCard place={item} />}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsHorizontalScrollIndicator={false}
            />
          </>
        ) : null}
        <View style={{ marginTop: 27 }}>
          <Heading eyebrow="LỰA CHỌN HÀNH TRÌNH" title="Khám phá địa điểm" />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.categories}
        >
          {FILTERS.map((item) => (
            <Pressable
              key={item}
              onPress={() => { setCategory(item); setVisibleCount(40); }}
              style={[s.category, category === item && s.categoryActive]}
            >
              <Text
                style={[
                  s.categoryText,
                  category === item && s.categoryActiveText,
                ]}
              >
                {t(item)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ marginTop: 17 }}>
          {filtered.length ? (
            filtered.slice(0, visibleCount).map((place) => (
              <View key={place.id}>
                <PlaceCard place={place} wide />
              </View>
            ))
          ) : (
            <View style={s.noResults}>
              <Ionicons name="search" size={27} color={C.primary} />
              <Text style={s.noTitle}>{t('Chưa tìm thấy địa điểm')}</Text>
              <Text style={s.noCopy}>
                {t('Thử từ khóa, danh mục khác hoặc tăng bán kính tìm kiếm nhé.')}
              </Text>
              <Pressable
                onPress={() => {
                  setQuery("");
                  setCategory("Tất cả");
                }}
              >
                <Text style={s.reset}>{t('Xóa bộ lọc')}</Text>
              </Pressable>
            </View>
          )}
        </View>
        {visibleCount < filtered.length && <Pressable accessibilityRole="button" onPress={() => setVisibleCount(v => v + 40)} style={s.gpsButton}><Text style={s.gpsButtonText}>{t('Xem thêm')}</Text></Pressable>}
        <Text style={s.foot}>{t('KHÁM PHÁ • LẮNG NGHE • KẾT NỐI')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  page: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 98, width: "100%", maxWidth: 1120, alignSelf: "center" },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  eyebrow: {
    color: C.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  greeting: {
    fontSize: 24,
    fontWeight: "900",
    color: C.ink,
    letterSpacing: -0.6,
  },
  spark: { color: C.coral },
  avatar: {
    width: 43,
    height: 43,
    borderRadius: 15,
    backgroundColor: C.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    height: 320,
    backgroundColor: "#193B44",
    borderRadius: 26,
    overflow: "hidden",
    marginBottom: 20,
  },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 5, padding: 20 },
  heroCity: {
    color: "#D5FFF5",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  heroPill: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,.19)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroPillText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  heroContent: { position: "absolute", bottom: 22, left: 22, right: 22 },
  heroKicker: {
    color: "#A8E9D9",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginBottom: 10,
  },
  heroTitle: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  heroSubtitle: {
    color: "#E0ECEB",
    fontSize: 12,
    marginTop: 8,
    marginBottom: 17,
    lineHeight: 19,
  },
  heroButton: {
    alignSelf: "flex-start",
    backgroundColor: "#D4F3E9",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  heroButtonText: { color: C.ink, fontSize: 12, fontWeight: "800" },
  statStrip: {
    flexDirection: "row",
    backgroundColor: C.white,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 27,
    borderWidth: 1,
    borderColor: C.border,
  },
  stat: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  statIcon: {
    height: 38,
    width: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statNumber: { fontWeight: "800", fontSize: 12, color: C.ink },
  statText: { fontSize: 10, color: C.muted, marginTop: 3 },
  verticalDivider: {
    width: 1,
    backgroundColor: C.border,
    marginHorizontal: 12,
  },
  searchWrap: {
    height: 55,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: C.white,
    gap: 11,
    borderColor: C.border,
    borderWidth: 1,
    marginBottom: 26,
  },
  search: { flex: 1, fontSize: 13, color: C.ink },
  categories: { gap: 9, paddingRight: 15 },
  category: {
    paddingHorizontal: 17,
    paddingVertical: 11,
    backgroundColor: C.white,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: C.border,
  },
  categoryActive: { backgroundColor: C.primary, borderColor: C.primary },
  categoryText: { fontSize: 12, fontWeight: "700", color: C.muted },
  categoryActiveText: { color: "#fff" },
  gpsPanel: {
    backgroundColor: C.white,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: C.border,
    padding: 15,
    marginBottom: 24,
  },
  gpsHeading: { flexDirection: "row", gap: 10, alignItems: "center" },
  gpsTitle: { color: C.ink, fontWeight: "900", fontSize: 14 },
  gpsCaption: { color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  gpsButton: {
    backgroundColor: C.primary,
    paddingVertical: 13,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 9,
  },
  gpsButtonText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  sourceText: {
    fontSize: 10,
    marginTop: 10,
    color: C.muted,
    textAlign: "center",
  },
  gpsError: { color: C.danger, fontSize: 11, marginTop: 11, lineHeight: 17 },
  noResults: {
    alignItems: "center",
    padding: 38,
    backgroundColor: C.white,
    borderRadius: 20,
  },
  noTitle: { fontSize: 17, fontWeight: "800", color: C.ink, marginTop: 12 },
  noCopy: { color: C.muted, marginTop: 5, textAlign: "center" },
  reset: { color: C.primary, fontWeight: "800", marginTop: 16 },
  foot: {
    textAlign: "center",
    color: C.faint,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 3,
    marginTop: 28,
  },
});
