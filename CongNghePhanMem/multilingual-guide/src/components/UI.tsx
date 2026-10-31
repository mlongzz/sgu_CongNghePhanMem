import React from "react";
import {  Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ImageCredit from "./ImageCredit";
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
  return <View style={[styles.card, wide && styles.wideCard]}>
    <PlaceImage uri={place.image} thumbnailUri={place.imageThumbnail} label={place.title} style={[styles.photo,wide && {height:200}]}/>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('Xem chi tiết')} ${place.title}`} onPress={() => router.push(`/place/${place.id}` as never)}>
      <View style={styles.cardBottom}>
        <View style={{flexDirection:'row',justifyContent:'space-between',gap:8}}><Text style={styles.cardCategory}>{t(place.category)}</Text>{location ? <Text style={{color:C.primaryDark,fontSize:12,fontWeight:'700'}}>{distanceKm(location,place).toFixed(1)} km</Text> : null}</View>
        <Text numberOfLines={2} style={styles.cardTitle}>{place.title}</Text>
        <Text numberOfLines={2} style={styles.cardSub}>{place.description[language] || place.subtitle[language]}</Text>
        <View style={styles.infoRow}><Ionicons name="information-circle-outline" size={16} color={C.primaryDark}/><Text style={styles.infoText}>{t('Xem nội dung')}</Text>{place.rating>0 ? <Text style={styles.infoText}> · ★ {place.rating.toFixed(1)}</Text> : null}</View>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:12,marginTop:12,borderTopWidth:1,borderColor:C.border}}><Text style={{color:C.muted,fontSize:11,flex:1}} numberOfLines={1}>{place.district || t('Hệ thống')}</Text><Text style={{color:C.primaryDark,fontSize:12,fontWeight:'700'}}>{t('Xem chi tiết')} ↗</Text></View>
      </View>
    </Pressable>
    <Pressable onPress={()=>toggleFavorite(place.id)} accessibilityRole="button" disabled={authLoading} accessibilityState={{disabled:authLoading,busy:authLoading,selected:isFavorite(place.id)}} accessibilityLabel={t(isFavorite(place.id) ? 'Bỏ lưu địa điểm yêu thích' : 'Lưu địa điểm yêu thích')} style={styles.heart}><Ionicons name={isFavorite(place.id)?'heart':'heart-outline'} size={20} color={isFavorite(place.id)?'#C24151':C.darkBlue}/></Pressable>
    {(place.imageAttribution || place.imageLicense) ? <View style={{paddingHorizontal:16,paddingBottom:12}}><ImageCredit place={place}/></View> : null}
  </View>;
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
  card: {width:280,borderRadius:20,backgroundColor:C.white,overflow:'hidden',marginRight:14,borderWidth:1,borderColor:C.border},
  wideCard:{width:'100%',marginRight:0,marginBottom:16},
  photo:{width:'100%',height:175,backgroundColor:'#E8F1F0'},
  heart:{position:'absolute',top:12,right:12,width:44,height:44,backgroundColor:'rgba(255,255,255,.95)',borderRadius:15,alignItems:'center',justifyContent:'center'},
  cardBottom:{padding:16},
  cardCategory:{fontSize:11,fontWeight:'700',color:C.primaryDark,marginBottom:7},
  cardTitle:{fontSize:18,lineHeight:25,fontWeight:'800',color:C.darkBlue,marginBottom:6},
  cardSub:{fontSize:12,lineHeight:19,color:C.muted,minHeight:38},
  infoRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',marginTop:12,gap:5},
  infoText:{fontSize:11,color:C.muted,fontWeight:'500'},
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
