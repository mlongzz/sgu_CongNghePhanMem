import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { C } from "../src/theme/colors";
import { LANGS, type Language } from "../src/data/places";
import { useApp } from "../src/context/AppContext";
import { checkAdmin, publishGuide } from "../src/services/api";

export default function Admin() {
  const { token, places, language, drafts, saveDraft } = useApp();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [selected, setSelected] = useState("");
  const [selectedLang, setSelectedLang] = useState<Language>(language);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    if (!token) {
      setAllowed(false);
      return;
    }
    checkAdmin(token)
      .then((result) => {
        if (mounted) setAllowed(result.enabled === true);
      })
      .catch((e) => {
        if (mounted) {
          setAllowed(false);
          setError(
            e instanceof Error ? e.message : "Không thể xác nhận quyền Admin.",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [token]);
  const place = useMemo(
    () => places.find((p) => p.id === selected),
    [places, selected],
  );
  function choose(id: string, lang: Language = selectedLang) {
    setSelected(id);
    setSelectedLang(lang);
    const p = places.find((x) => x.id === id);
    // Lấy nội dung thuyết minh của địa danh được chọn
    setContent(drafts[id]?.[lang] ?? p?.description[lang] ?? "");
    // Cập nhật ảnh tương ứng với địa danh
    setImageUrl(p?.image ?? "");
    // Xóa thông báo lỗi cũ
    setError("");
  }
  const save = async () => {
    if (!place || !content.trim()) {
      setError("Hãy chọn địa điểm và nhập nội dung.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveDraft(place.id, selectedLang, content.trim());
      Alert.alert(
        "Đã lưu bản nháp",
        "Nội dung đã lưu trên điện thoại này. Chưa đồng bộ tới máy chủ.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được bản nháp.");
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!place || !token || !content.trim()) return;
    setBusy(true);
    setError("");
    try {
      await publishGuide(place.id, selectedLang, content.trim(), token);
      await saveDraft(place.id, selectedLang, content.trim());
      Alert.alert(
        "Thành công",
        "Backend đã phản hồi thành công khi lưu nội dung.",
      );
    } catch (e) {
      setError(
        "Không đồng bộ được lên PostgreSQL: " +
          (e instanceof Error ? e.message : "lỗi không xác định") +
          ". Backend cần triển khai endpoint PUT /admin/places/{id}/guide-content/{language}.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.page}
      >
        <Pressable onPress={() => router.back()} style={s.back}>
          <Ionicons name="arrow-back" color={C.primary} size={21} />
          <Text style={s.backText}>Quay lại</Text>
        </Pressable>
        <Text style={s.eyebrow}>QUẢN TRỊ HỆ THỐNG</Text>
        <Text style={s.title}>Biên tập thuyết minh</Text>
        {allowed === null ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 60 }} />
        ) : allowed === false ? (
          <View style={s.card}>
            <Ionicons name="lock-closed-outline" size={34} color={C.danger} />
            <Text style={s.notice}>Không có quyền truy cập Admin</Text>
            <Text style={s.desc}>
              Đăng nhập bằng tài khoản quản trị. Quyền được xác minh bằng API
              /admin/me, không được quyết định bởi giao diện.
            </Text>
            {error ? <Text style={s.error}>{error}</Text> : null}
          </View>
        ) : (
          <>
            <Text style={s.desc}>
              Chọn địa điểm, chỉnh nội dung theo ngôn ngữ, rồi lưu bản nháp. Để
              đồng bộ cho tất cả người dùng, backend phải có endpoint quản trị
              được bảo vệ bởi JWT và vai trò Admin.
            </Text>
            <Text style={s.section}>1. Chọn địa danh</Text>
            <ScrollView
              horizontal
              contentContainerStyle={{ gap: 9, paddingVertical: 10 }}
            >
              {places.map((p) => (
                <Pressable
                  key={p.id}
                  style={[s.chip, p.id === selected && s.chipActive]}
                  onPress={() => choose(p.id)}
                >
                  <Text
                    numberOfLines={1}
                    style={[s.chipText, p.id === selected && { color: "#fff" }]}
                  >
                    {p.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={s.section}>2. Ngôn ngữ nội dung</Text>
            <ScrollView
              horizontal
              contentContainerStyle={{ gap: 9, paddingVertical: 12 }}
            >
              {LANGS.map((l) => (
                <Pressable
                  key={l.key}
                  onPress={() => choose(selected, l.key)}
                  style={[s.chip, l.key === selectedLang && s.chipActive]}
                >
                  <Text
                    style={[
                      s.chipText,
                      l.key === selectedLang && { color: "#fff" },
                    ]}
                  >
                    {l.flag} {l.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={s.section}>3. Hình ảnh địa danh</Text>
            <TextInput
              style={s.imageInput}
              placeholder="Nhập URL hình ảnh địa danh..."
              placeholderTextColor={C.faint}
              value={imageUrl}
              onChangeText={setImageUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {imageUrl ? (
              <Text style={s.desc}>URL hiện tại: {imageUrl}</Text>
            ) : (
              <Text style={s.desc}>Địa danh chưa có hình ảnh.</Text>
            )}
            <Text style={s.section}>4. Bài thuyết minh</Text>
            <TextInput
              multiline
              textAlignVertical="top"
              placeholder="Chọn địa điểm để chỉnh nội dung..."
              placeholderTextColor={C.faint}
              value={content}
              onChangeText={setContent}
              style={s.textArea}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Pressable
              disabled={busy || !place}
              onPress={() => void save()}
              style={[s.button, { opacity: busy || !place ? 0.7 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="save-outline" size={20} color="#fff" />
              )}
              <Text style={s.buttonText}>Lưu bản nháp trên điện thoại</Text>
            </Pressable>
            <Pressable
              disabled={busy || !place}
              onPress={() => void publish()}
              style={[
                s.button,
                s.secondary,
                { opacity: busy || !place ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name="cloud-upload-outline"
                size={20}
                color={C.primary}
              />
              <Text style={[s.buttonText, { color: C.primary }]}>
                Đồng bộ lên máy chủ FastAPI
              </Text>
            </Pressable>
            <Text style={s.desc}>
              Lưu ý: nút Đồng bộ yêu cầu backend có endpoint tương ứng. Bản nháp
              cục bộ không tự xuất hiện trên điện thoại người khác.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  page: { padding: 22, paddingBottom: 90 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 22,
  },
  backText: { color: C.primary, fontWeight: "800" },
  eyebrow: {
    fontWeight: "900",
    fontSize: 10,
    color: C.primary,
    letterSpacing: 2,
  },
  title: { fontWeight: "900", fontSize: 28, color: C.ink, marginVertical: 10 },
  card: {
    padding: 25,
    backgroundColor: C.white,
    borderRadius: 18,
    alignItems: "center",
    marginTop: 25,
  },
  notice: { fontSize: 18, fontWeight: "900", color: C.ink, marginVertical: 14 },
  desc: { fontSize: 12, lineHeight: 21, color: C.muted, marginTop: 10 },
  section: {
    fontSize: 15,
    fontWeight: "900",
    color: C.ink,
    marginTop: 24,
    marginBottom: 6,
  },
  chip: {
    maxWidth: 210,
    backgroundColor: C.white,
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 12, fontWeight: "800", color: C.ink },
  textArea: {
    height: 200,
    backgroundColor: C.white,
    padding: 16,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 17,
    color: C.ink,
    fontSize: 13,
    lineHeight: 22,
  },
  error: { color: C.danger, fontSize: 12, marginTop: 13, lineHeight: 20 },
  button: {
    backgroundColor: C.primary,
    borderRadius: 16,
    marginTop: 17,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  secondary: { backgroundColor: C.primarySoft, marginTop: 10 },
  buttonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  imageInput: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: C.ink,
    marginTop: 10,
  },
});
