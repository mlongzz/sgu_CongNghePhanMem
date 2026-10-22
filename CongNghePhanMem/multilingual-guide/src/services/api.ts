// FastAPI backend: API được gọi thật khi cấu hình EXPO_PUBLIC_API_URL.
// Lưu ý: điện thoại chạy Expo Go không kết nối được 127.0.0.1 trên máy tính.
const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
export const API_BASE_URL = configured ? configured.replace(/\/$/, "") : "";

export type LoginResponse = { access_token: string; refresh_token: string; token_type?: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
let recoverSession: ((token: string) => Promise<string | null>) | null = null;
export function setSessionRecovery(handler: typeof recoverSession) { recoverSession = handler; }

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { token?: string },
  retried = false,
): Promise<T> {
  if (!API_BASE_URL)
    throw new Error("Dịch vụ hiện chưa sẵn sàng. Vui lòng thử lại sau.");
  const { token, headers, ...init } = options ?? {};
  if (init.signal?.aborted) { const error = new Error('Đã hủy yêu cầu.'); error.name = 'AbortError'; throw error; }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  init.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
    let value: unknown = null;
    try {
      value = await response.json();
    } catch {
      /* content may be empty */
    }
    if (controller.signal.aborted) { const error = new Error('Đã hủy yêu cầu.'); error.name = 'AbortError'; throw error; }
    if (response.status === 401 && token && !retried && recoverSession) {
      const next = await recoverSession(token);
      if (controller.signal.aborted) { const error = new Error('Đã hủy yêu cầu.'); error.name = 'AbortError'; throw error; }
      if (next) return apiFetch<T>(path, { ...options, token: next }, true);
    }
    if (!response.ok) {
      const detail =
        value && typeof value === "object" && "detail" in value
          ? (value as { detail: unknown }).detail
          : null;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail
                .map((e) =>
                  typeof e?.msg === "string" ? e.msg : "Dữ liệu không hợp lệ",
                )
                .join("; ")
            : `HTTP ${response.status}`;
      const friendly: Record<string, string> = {
        "Invalid email or password": "Email hoặc mật khẩu không đúng.",
        "Email already registered": "Email này đã được đăng ký.",
        "Token has expired": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
        "Place not found": "Địa điểm này không còn tồn tại.",
        "Guide content not found for this language": "Chưa có thuyết minh cho ngôn ngữ này. Hãy chọn ngôn ngữ khác.",
        "You have already reviewed this place": "Bạn đã đánh giá địa điểm này. Hãy cập nhật đánh giá hiện có.",
        "Place already favorited": "Địa điểm đã nằm trong danh sách yêu thích.",
        "Image must be at most 5 MB": "Ảnh cần nhỏ hơn hoặc bằng 5 MB.",
        "Image exceeds 16 megapixels": "Ảnh vượt quá 16 megapixel. Hãy giảm kích thước ảnh.",
        "Choose a JPEG, PNG or WebP image": "Vui lòng chọn ảnh JPEG, PNG hoặc WebP.",
        "The file is not a valid image": "Tệp đã chọn không phải ảnh hợp lệ.",
      };
      throw new ApiError(friendly[message] ?? (response.status >= 500 ? "Dịch vụ đang gặp sự cố. Vui lòng thử lại sau." : message), response.status);
    }
    return value as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      if (init.signal?.aborted) { const error = new Error('Đã hủy yêu cầu.'); error.name = 'AbortError'; throw error; }
      throw new Error("Kết nối quá thời gian chờ. Vui lòng thử lại.");
    }
    if (e instanceof TypeError)
      throw new Error(
        "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.",
      );
    throw e;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', cancel);
  }
}

export const checkApi = () =>
  apiFetch<Record<string, unknown>>("/openapi.json");
export const signIn = (email: string, password: string) =>
  apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
export type UserResponse = {
  id: number;
  email: string;
  full_name: string;
  language: string;
  role: string;
  created_at: string;
};
export const getUser = (id: number, token: string) =>
  apiFetch<UserResponse>(`/users/${id}`, { token });

export function getUserProfile(token: string, recover = true) {
  return apiFetch<UserResponse>('/users/me', { token }, !recover);
}

export function refreshTokens(refreshToken: string) {
  return apiFetch<LoginResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export type AdminStatus = { enabled: boolean };
export function checkAdmin(token: string, recover = true) {
  return apiFetch<AdminStatus>("/admin/me", { token }, !recover);
}
export function registerUser(
  name: string,
  email: string,
  password: string,
  language = "vi",
) {
  return apiFetch<unknown>("/users", {
    method: "POST",
    body: JSON.stringify({
      full_name: name,
      email,
      password,
      language,
    }),
  });
}
// Optional server contract; backend must enforce JWT and admin permission.
export function publishGuide(
  placeId: string,
  language: string,
  content: string,
  token: string,
) {
  return apiFetch<unknown>(
    `/admin/places/${encodeURIComponent(placeId.startsWith("db-") ? placeId.slice(3) : placeId)}/guide-content/${encodeURIComponent(language)}`,
    {
      method: "PUT",
      token,
      body: JSON.stringify({ content, title: `Guide ${placeId}`, language_code: language, publication_status: 'published' }),
    },
  );
}
export type GuideResponse = { content?: string; language?: string; language_code?: string };
export function getGuideContent(placeId: string, language: string, options?: { signal?: AbortSignal }) {
  return apiFetch<GuideResponse>(
    `/places/${encodeURIComponent(placeId)}/guide-content?language=${encodeURIComponent(language)}`,
    options,
  );
}
