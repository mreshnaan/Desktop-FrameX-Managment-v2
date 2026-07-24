import { createContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@/lib/shared';
import { apiFetch } from '../api/client';

interface AuthUser { id: string; email: string; name: string; role: Role }
interface AuthState { user: AuthUser | null; accessToken: string | null }

export const AuthContext = createContext<{
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
} | null>(null);

const STORAGE_KEY = 'cue-room-auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) setState(JSON.parse(raw));
  }, []);

  async function login(email: string, password: string) {
    const result = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    const next: AuthState = { user: result.user, accessToken: result.accessToken };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem('cue-room-refresh', result.refreshToken);
    setState(next);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('cue-room-refresh');
    setState({ user: null, accessToken: null });
  }

  return <AuthContext.Provider value={{ state, login, logout }}>{children}</AuthContext.Provider>;
}
