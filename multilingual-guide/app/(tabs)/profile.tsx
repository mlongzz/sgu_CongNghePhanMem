import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { C } from "../../src/theme/colors";
import { LANGS } from "../../src/data/places";
import { useApp } from "../../src/context/AppContext";
import { API_BASE_URL, checkApi, checkAdmin } from "../../src/services/api";

export default function Profile() {
  const { language, setLanguage, token, setToken, favorites, stop } = useApp();
  const [health, setHealth] = useState<
    "checking" | "online" | "offline" | "not-configured"
  >("checking");
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const ping = async () => {
    if (!API_BASE_URL) {
      setHealth("not-configured");
      return;
    }
    setHealth("checking");
    try {
      await checkApi();
      setHealth("online");
      setError("");
    } catch (e) {
      setHealth("offline");
      setError(e instanceof Error ? e.message : "Lỗi kết nối không xác định");
    }
  };
  useEffect(() => {
    void ping();
  }, []);
  useEffect(() => {
    let mounted = true;
    if (!token) {
      setIsAdmin(false);
      return;
    }
    void checkAdmin(token)
      .then((x) => {
        if (mounted) setIsAdmin(x.enabled === true);
      })
      .catch(() => {
        if (mounted) setIsAdmin(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.page}>
        <Text style={s.overline}>CÀI ĐẶT & CÁ NHÂN</Text>
        <Text style={s.title}>Không gian của bạn</Text>
        <View style={s.account}>
          <View style={s.accountIcon}>
            <Ionicons name="person" size={32} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.accountTitle}>
              {token ? "Đã đăng nhập" : "Nhà khám phá"}
            </Text>
            <Text style={s.accountSub}>
              {token
                ? "Bạn đang có phiên đăng nhập API"
                : "Đăng nhập để sử dụng tài khoản cá nhân"}
            </Text>
          </View>
        </View>
        {token ? (
          <Pressable
            onPress={() => {
              setToken(null);
              Alert.alert("Đã đăng xuất", "Phiên đăng nhập đã được xóa.");
            }}
            style={s.login}
          >
            <Ionicons name="log-out-outline" size={18} color={C.primary} />
            <Text style={s.loginText}>Đăng xuất</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.push("/login")} style={s.login}>
            <Ionicons name="log-in-outline" size={19} color={C.primary} />
            <Text style={s.loginText}>Đăng nhập với FastAPI</Text>
            <Ionicons name="arrow-forward" size={17} color={C.primary} />
          </Pressable>
        )}

        {token && isAdmin ? (
          <Pressable onPress={() => router.push("/admin")} style={s.login}>
            <Ionicons name="settings-outline" size={19} color={C.primary} />
            <Text style={s.loginText}>Quản trị viên · Biên tập nội dung</Text>
            <Ionicons name="arrow-forward" color={C.primary} size={17} />
          </Pressable>
        ) : null}
        <Text style={s.section}>Ngôn ngữ thuyết minh</Text>
        <Text style={s.hint}>
          Chọn một ngôn ngữ. Giọng đọc sẽ thay đổi theo lựa chọn.
        </Text>
        <View style={s.panel}>
          {LANGS.map((lang, i) => (
            <Pressable
              key={lang.key}
              onPress={() => {
                stop();
                setLanguage(lang.key);
              }}
              style={[s.langRow, i !== LANGS.length - 1 && s.rowBorder]}
            >
              <Text style={s.flag}>{lang.flag}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.langName}>{lang.label}</Text>
                <Text style={s.langCode}>{lang.voice}</Text>
              </View>
              <Ionicons
                name={
                  language === lang.key ? "radio-button-on" : "radio-button-off"
                }
                size={22}
                color={language === lang.key ? C.primary : C.faint}
              />
            </Pressable>
          ))}
        </View>

        <Text style={s.section}>Trạng thái hệ thống</Text>
        <View style={s.panel}>
          <View style={s.infoRow}>
            <Ionicons name="server-outline" size={22} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.langName}>Máy chủ FastAPI</Text>
              <Text style={s.langCode} numberOfLines={1}>
                {API_BASE_URL || "Chưa cấu hình EXPO_PUBLIC_API_URL"}
              </Text>
            </View>
            {health === "checking" ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : (
              <View
                style={[
                  s.statusDot,
                  {
                    backgroundColor:
                      health === "online"
                        ? "#3CB88C"
                        : health === "offline"
                          ? C.danger
                          : C.faint,
                  },
                ]}
              />
            )}
          </View>
          <View style={s.serverBar}>
            <Text
              style={[
                s.status,
                {
                  color:
                    health === "online"
                      ? C.primary
                      : health === "offline"
                        ? C.danger
                        : C.muted,
                },
              ]}
            >
              {health === "checking"
                ? "Đang kiểm tra..."
                : health === "online"
                  ? "● Máy chủ phản hồi tốt"
                  : health === "offline"
                    ? "● Chưa kết nối được máy chủ"
                    : "○ Chế độ demo offline"}
            </Text>
            <Pressable onPress={() => void ping()}>
              <Text style={s.tryAgain}>Kiểm tra lại</Text>
            </Pressable>
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>
        <View style={s.footnote}>
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={C.muted}
          />
          <Text style={s.note}>
            Hiện có {favorites.length} địa điểm yêu thích. Dữ liệu GPS đến từ
            OpenStreetMap; bản nháp quản trị chỉ lưu trên máy này cho tới khi
            đồng bộ FastAPI thành công.
          </Text>
        </View>
        <Text style={s.copyright}>MULTILINGUAL GUIDE • 2026</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  page: { padding: 22, paddingTop: 28, paddingBottom: 100 },
  overline: {
    color: C.primary,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  title: {
    color: C.ink,
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.6,
    marginBottom: 23,
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.darkBlue,
    borderRadius: 22,
    padding: 18,
  },
  accountIcon: {
    width: 58,
    height: 58,
    backgroundColor: "#227E83",
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  accountTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  accountSub: { color: "#D0E2E6", fontSize: 11, marginTop: 5, lineHeight: 16 },
  login: {
    backgroundColor: C.primarySoft,
    marginTop: 11,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 15,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  loginText: { fontWeight: "800", color: C.primary, fontSize: 13 },
  section: {
    marginTop: 27,
    marginBottom: 7,
    fontSize: 17,
    fontWeight: "900",
    color: C.ink,
  },
  hint: { fontSize: 12, lineHeight: 19, color: C.muted, marginBottom: 14 },
  panel: {
    backgroundColor: C.white,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  flag: { fontSize: 25 },
  langName: { fontSize: 13, fontWeight: "800", color: C.ink },
  langCode: { fontSize: 11, color: C.muted, marginTop: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  serverBar: {
    borderTopColor: C.border,
    borderTopWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  status: { fontSize: 11, fontWeight: "800" },
  tryAgain: { fontSize: 11, color: C.primary, fontWeight: "800" },
  error: {
    fontSize: 10,
    color: C.danger,
    marginHorizontal: 16,
    marginBottom: 15,
  },
  footnote: {
    flexDirection: "row",
    gap: 8,
    marginTop: 17,
    alignItems: "flex-start",
  },
  note: { flex: 1, fontSize: 11, color: C.muted, lineHeight: 18 },
  copyright: {
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 2,
    color: C.faint,
    marginTop: 30,
  },
});
