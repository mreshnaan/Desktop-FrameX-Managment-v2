import { createContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, ApiError } from '../api/client';
import { commands } from '../tauri/commands';

// Only a 401 (genuinely invalid/expired/tampered token) should clear the
// stored session -- a transient failure must not log the user out.
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
  // True once the launch-time silent-refresh attempt has finished.
  ready: boolean;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<string | null>;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null });
  const [ready, setReady] = useState(false);

  // Tokens live in the OS keychain, not localStorage -- ask Rust for them on
  // launch and silently exchange the refresh token before showing login.
  useEffect(() => {
    (async () => {
      const tokens = await commands.getAuthTokens();
      if (!tokens) {
        setReady(true);
        return;
      }
      try {
        const result = await apiFetch<{ user: AuthUser; accessToken: string }>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
        setState({ user: result.user, accessToken: result.accessToken });
        void commands.setCurrentActor(result.user.id);
      } catch (e) {
        if (isGenuinelyInvalidRefreshToken(e)) await commands.clearAuthTokens();
      } finally {
        setReady(true);
      }
    })();
  }, []);

  async function login(username: string, pin: string) {
    const result = await apiFetch<{ user: AuthUser; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, pin }),
    });
    await commands.storeAuthTokens(result.accessToken, result.refreshToken);
    await commands.setCurrentActor(result.user.id);
    setState({ user: result.user, accessToken: result.accessToken });
  }

  function logout() {
    void commands.clearAuthTokens();
    void commands.clearCurrentActor();
    setState({ user: null, accessToken: null });
  }

  async function refreshAccessToken(): Promise<string | null> {
    const tokens = await commands.getAuthTokens();
    if (!tokens) {
      logout();
      return null;
    }
    try {
      const result = await apiFetch<{ user: AuthUser; accessToken: string }>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      setState({ user: result.user, accessToken: result.accessToken });
      void commands.setCurrentActor(result.user.id);
      return result.accessToken;
    } catch (e) {
      if (isGenuinelyInvalidRefreshToken(e)) logout();
      return null;
    }
  }

  return (
    <AuthContext.Provider value={{ state, ready, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}
