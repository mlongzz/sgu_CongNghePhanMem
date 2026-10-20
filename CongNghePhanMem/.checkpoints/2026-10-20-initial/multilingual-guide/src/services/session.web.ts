// Web: persist session in sessionStorage so page refresh retains login.
// sessionStorage is safer than localStorage — cleared when the tab closes.
const ACCESS_KEY = 'mg_access_token_v3';
const REFRESH_KEY = 'mg_refresh_token_v3';

export async function getSessionToken(): Promise<string | null> {
  try { return sessionStorage.getItem(ACCESS_KEY); } catch { return null; }
}

export async function writeSessionToken(token: string | null): Promise<void> {
  try {
    if (token) sessionStorage.setItem(ACCESS_KEY, token);
    else sessionStorage.removeItem(ACCESS_KEY);
  } catch { /* SSR or restricted context */ }
}

export async function getRefreshToken(): Promise<string | null> {
  try { return sessionStorage.getItem(REFRESH_KEY); } catch { return null; }
}

export async function writeRefreshToken(token: string | null): Promise<void> {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch { /* SSR or restricted context */ }
}
