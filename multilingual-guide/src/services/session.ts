import * as SecureStore from 'expo-secure-store';
const KEY='mg_token_v3';
export function getSessionToken(){return SecureStore.getItemAsync(KEY);}
export async function writeSessionToken(token:string|null){if(token)await SecureStore.setItemAsync(KEY,token);else await SecureStore.deleteItemAsync(KEY);}
