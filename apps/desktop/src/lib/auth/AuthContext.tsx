import { createContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../api/client';
import { commands } from '../tauri/commands';

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
  // True once the launch-time silent-refresh attempt (see the useEffect
  // below) has finished, so App.tsx knows whether "no user yet" means
  // "definitely logged out" or "still checking the keychain".
  ready: boolean;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<string | null>;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null });
  const [ready, setReady] = useState(false);

  // Tokens live in the OS keychain (Rust side), not localStorage -- on
  // launch, ask Rust for them and silently exchange the refresh token for a
  // fresh session before ever showing the login screen. See the desktop
  // design spec's Auth section.
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
      } catch {
        await commands.clearAuthTokens();
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
    setState({ user: result.user, accessToken: result.accessToken });
  }

  function logout() {
    void commands.clearAuthTokens();
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
      return result.accessToken;
    } catch {
      // Refresh token itself is expired/invalid -- a real logout is better
      // than silently failing forever.
      logout();
      return null;
    }
  }

  return (
    <AuthContext.Provider value={{ state, ready, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}
