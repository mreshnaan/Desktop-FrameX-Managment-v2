import { createContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, ApiError } from '../api/client';

// The server rejects a refresh token with 401 specifically when it's
// genuinely invalid/expired/tampered (see apps/api's auth.routes.ts) --
// that's the only case a stored session should be cleared. Any other
// failure (network blip, api unreachable, 5xx) must leave the stored
// refresh token alone so the next attempt can still succeed; treating every
// failure the same would log a user out over a transient hiccup.
function isGenuinelyInvalidRefreshToken(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: { id: string; name: string };
  permissions: string[];
}
interface AuthState { user: AuthUser | null; accessToken: string | null }

export const AuthContext = createContext<{
  state: AuthState;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => void;
  // Exchanges the stored refresh token for a fresh access token, updating both
  // React state and localStorage. Returns the new access token on success, or
  // null when the refresh token is missing/expired/invalid (in which case the
  // session is cleared and the user is dropped back to the login screen).
  refreshAccessToken: () => Promise<string | null>;
} | null>(null);

const STORAGE_KEY = 'cue-room-auth';
const REFRESH_KEY = 'cue-room-refresh';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      setState(JSON.parse(raw));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function login(username: string, pin: string) {
    const result = await apiFetch<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, pin }),
    });
    const next: AuthState = { user: result.user, accessToken: result.accessToken };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem(REFRESH_KEY, result.refreshToken);
    setState(next);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setState({ user: null, accessToken: null });
  }

  async function refreshAccessToken(): Promise<string | null> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) {
      logout();
      return null;
    }
    try {
      const result = await apiFetch<{ user: AuthUser; accessToken: string }>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      const next: AuthState = { user: result.user, accessToken: result.accessToken };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setState(next);
      return result.accessToken;
    } catch (e) {
      // Only a genuinely invalid/expired refresh token warrants a real
      // logout -- a transient failure (network blip, api briefly down) must
      // not wipe a still-valid stored session.
      if (isGenuinelyInvalidRefreshToken(e)) logout();
      return null;
    }
  }

  return (
    <AuthContext.Provider value={{ state, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}
