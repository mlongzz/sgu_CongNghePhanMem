// FastAPI backend: API được gọi thật khi cấu hình EXPO_PUBLIC_API_URL.
// Lưu ý: điện thoại chạy Expo Go không kết nối được 127.0.0.1 trên máy tính.
const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
export const API_BASE_URL = configured ? configured.replace(/\/$/, '') : '';

export type LoginResponse = {access_token:string;token_type?:string};

export async function apiFetch<T>(path: string, options?: RequestInit & {token?:string}): Promise<T> {
 if(!API_BASE_URL) throw new Error('Chưa cấu hình EXPO_PUBLIC_API_URL. Hãy xem README.md.');
 const {token,headers,...init}=options ?? {};
 const controller = new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try {
  const response=await fetch(`${API_BASE_URL}${path}`,{
   ...init, signal:controller.signal,
   headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},
  });
  let value:unknown=null;
  try{value=await response.json();}catch{/* content may be empty */}
  if(!response.ok){
   const detail=(value && typeof value==='object' && 'detail' in value) ? (value as {detail:unknown}).detail : null;
   const message=typeof detail==='string' ? detail : Array.isArray(detail) ? detail.map(e=>typeof e?.msg==='string'?e.msg:'Dữ liệu không hợp lệ').join('; ') : `HTTP ${response.status}`;
   throw new Error(message);
  }
  return value as T;
 } catch (e) {
  if(e instanceof Error && e.name==='AbortError') throw new Error('Kết nối API quá thời gian 12 giây.');
  if(e instanceof TypeError) throw new Error('Không kết nối được API. Kiểm tra địa chỉ IP, Wi-Fi và FastAPI.');
  throw e;
 } finally {clearTimeout(timeout);}
}

export const checkApi=()=>apiFetch<Record<string,unknown>>('/openapi.json');
export const signIn=(email:string,password:string)=>apiFetch<LoginResponse>('/auth/login',{
 method:'POST',body:JSON.stringify({email,password})
});
export type UserResponse = {id?:number;email?:string;name?:string;preferred_language?:string};
export const getUser=(id:number,token:string)=>apiFetch<UserResponse>(`/users/${id}`,{token});
// Chưa nối danh sách địa điểm tới backend vì schema/route thực tế chưa được xác nhận.

export type AdminStatus = { enabled: boolean };
export function checkAdmin(token:string) {return apiFetch<AdminStatus>('/admin/me',{token});}
export function registerUser(name:string,email:string,password:string,language='vi') {
 return apiFetch<unknown>('/users',{method:'POST',body:JSON.stringify({name,email,password,preferred_language:language})});
}
// Optional server contract; backend must enforce JWT and admin permission.
export function publishGuide(placeId:string,language:string,content:string,token:string) {
 return apiFetch<unknown>(`/admin/places/${encodeURIComponent(placeId.startsWith('db-')?placeId.slice(3):placeId)}/guide-content/${encodeURIComponent(language)}`,{
  method:'PUT',token,body:JSON.stringify({content})
 });
}
export type GuideResponse = {content?:string;language?:string};
export function getGuideContent(placeId:string,language:string){
 return apiFetch<GuideResponse>(`/places/${encodeURIComponent(placeId)}/guide-content?language=${encodeURIComponent(language)}`);
}
