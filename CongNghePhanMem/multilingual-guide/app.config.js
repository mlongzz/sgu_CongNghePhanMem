module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ['expo-image-picker', { photosPermission: 'Cho phép chọn ảnh địa điểm để quản trị nội dung.', cameraPermission: false, microphonePermission: false }],
    ['react-native-maps', {
      ...(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ? { androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY } : {}),
      ...(process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ? { iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY } : {}),
    }],
  ],
});
