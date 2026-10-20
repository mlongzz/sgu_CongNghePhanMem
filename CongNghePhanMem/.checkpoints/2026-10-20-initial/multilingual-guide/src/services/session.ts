import * as SecureStore from 'expo-secure-store';
const ACCESS_KEY = 'mg_token_v3';
const REFRESH_KEY = 'mg_refresh_token_v3';

export function getSessionToken() { return SecureStore.getItemAsync(ACCESS_KEY); }
export async function writeSessionToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(ACCESS_KEY, token);
  else await SecureStore.deleteItemAsync(ACCESS_KEY);
}
export function getRefreshToken() { return SecureStore.getItemAsync(REFRESH_KEY); }
export async function writeRefreshToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
}
