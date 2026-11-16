export type RestoreOutcome = 'expired' | 'unverified';

export const SESSION_UNVERIFIED_NOTICE = 'Chưa xác minh được phiên đăng nhập do lỗi kết nối. Hãy kiểm tra mạng và thử lại.';

export function restoreOutcome(error: unknown): RestoreOutcome {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401 ? 'expired' : 'unverified';
}

export interface RotatedTokens { access_token: string; refresh_token: string }

export interface RotationDeps {
  refreshTokens: (refresh: string) => Promise<RotatedTokens>;
  writeSessionToken: (token: string | null) => Promise<void>;
  writeRefreshToken: (token: string | null) => Promise<void>;
}

export async function refreshAndPersist(refresh: string, deps: RotationDeps): Promise<RotatedTokens> {
  const result = await deps.refreshTokens(refresh);
  await Promise.all([deps.writeSessionToken(result.access_token), deps.writeRefreshToken(result.refresh_token)]);
  return result;
}
