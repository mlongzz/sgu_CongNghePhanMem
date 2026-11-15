export type RestoreOutcome = 'expired' | 'unverified';

export const SESSION_UNVERIFIED_NOTICE = 'Chưa xác minh được phiên đăng nhập do lỗi kết nối. Hãy kiểm tra mạng và thử lại.';

export function restoreOutcome(error: unknown): RestoreOutcome {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401 ? 'expired' : 'unverified';
}
