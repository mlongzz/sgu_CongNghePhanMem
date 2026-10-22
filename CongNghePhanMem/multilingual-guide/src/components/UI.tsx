import React from "react";
import {  Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { C } from "../theme/colors";
import { Place } from "../data/places";
import { useApp } from "../context/AppContext";
import PlaceImage from "./PlaceImage";
import { distanceKm } from "../services/nearby";
import { useI18n } from "../hooks/useI18n";

export function Heading({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.heading}>
      <View>
        {eyebrow ? (
          <Text style={styles.eyebrow}>{t(eyebrow).toUpperCase()}</Text>
        ) : null}
        <Text style={styles.headingText}>{t(title)}</Text>
      </View>
      {action ? (
        <Pressable onPress={onAction}>
          <Text style={styles.action}>{t(action)} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export function PlaceCard({
  place,
  wide = false,
}: {
  place: Place;
  wide?: boolean;
}) {
  const { language, isFavorite, toggleFavorite, location, authLoading } = useApp();
  const { t } = useI18n();
  return (
    <Pressable
      onPress={() => router.push(`/place/${place.id}` as never)}
      style={[styles.card, wide && styles.wideCard]}
    >
      <PlaceImage uri={place.image} label={place.title} style={styles.photo} />
      <LinearGradient
        colors={["transparent", "rgba(8,29,45,.82)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.cardTop}>
        <View style={styles.tag}>
          <Ionicons name="location-sharp" size={12} color={C.primary} />
          <Text style={styles.tagText}>{place.district}</Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            toggleFavorite(place.id);
          }}
          accessibilityRole="button"
          disabled={authLoading}
          accessibilityState={{ disabled: authLoading, busy: authLoading }}
          accessibilityLabel={t(isFavorite(place.id) ? "Bỏ lưu địa điểm yêu thích" : "Lưu địa điểm yêu thích")}
          style={styles.heart}
        >
          <Ionicons
            name={isFavorite(place.id) ? "heart" : "heart-outline"}
            size={19}
            color={isFavorite(place.id) ? C.coral : C.white}
          />
        </Pressable>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardCategory}>{t(place.category).toUpperCase()}</Text>
        <Text numberOfLines={2} style={styles.cardTitle}>
          {place.title}
        </Text>
        <Text numberOfLines={1} style={styles.cardSub}>
          {place.subtitle[language]}
        </Text>
        <View style={styles.infoRow}>
          <Ionicons name="headset-outline" size={14} color="#E0F5F4" />
          <Text style={styles.infoText}>{place.duration > 0 ? `${place.duration} min` : t("Thuyết minh đa ngôn ngữ")}</Text>
          {location ? (
            <Text style={styles.infoText}>
              {" "}
              · {distanceKm(location, place).toFixed(1)} km
            </Text>
          ) : null}
          {place.rating > 0 ? (
            <>
              <Ionicons
                name="star"
                size={13}
                color="#FFC875"
                style={{ marginLeft: 12 }}
              />
              <Text style={styles.infoText}>{place.rating.toFixed(1)}</Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
export function EmptyState({
  icon,
  title,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={31} color={C.primary} />
      </View>
      <Text style={styles.emptyTitle}>{t(title)}</Text>
      <Text style={styles.emptyText}>{t(text)}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 17,
  },
  eyebrow: {
    color: C.primary,
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 6,
  },
  headingText: {
    color: C.ink,
    fontWeight: "800",
    fontSize: 23,
    letterSpacing: -0.5,
  },
  action: {
    color: C.primary,
    fontWeight: "700",
    fontSize: 12,
    paddingBottom: 4,
  },
  card: {
    height: 267,
    width: 245,
    borderRadius: 22,
    backgroundColor: C.darkBlue,
    overflow: "hidden",
    marginRight: 14,
  },
  wideCard: { width: "100%", height: 238, marginRight: 0, marginBottom: 14 },
  photo: { width: "100%", height: "100%", position: "absolute" },
  widePhoto: { height: "100%" },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,.94)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  tagText: { color: C.ink, fontSize: 11, fontWeight: "700" },
  heart: {
    width: 44,
    height: 44,
    backgroundColor: "rgba(0,0,0,.28)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 17,
  },
  cardCategory: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
    color: "#93E7DD",
    marginBottom: 7,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: C.white,
    marginBottom: 4,
  },
  cardSub: { fontSize: 12, color: "#E1E9F0" },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 11,
    gap: 4,
  },
  infoText: { fontSize: 11, color: "#EEF6F6", fontWeight: "600" },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    marginTop: 60,
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 23,
    backgroundColor: C.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 17,
  },
  emptyTitle: {
    color: C.ink,
    fontWeight: "800",
    fontSize: 18,
    marginBottom: 8,
  },
  emptyText: { color: C.muted, textAlign: "center", lineHeight: 22 },
});
