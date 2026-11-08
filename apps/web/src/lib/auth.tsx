'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { SESSION_STORAGE_KEY } from './api';
import type { AuthResult } from './types';

export interface Session extends AuthResult {
  /** Epoch ms; the API token lifetime is `expiresIn` seconds from issue. */
  expiresAt: number;
}

interface AuthState {
  session: Session | null;
  ready: boolean;
  signIn: (result: AuthResult) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

const subscribeNoop = () => () => {};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // False during SSR and the first client render, so guarded pages never flash.
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    setSession(readSession());
    setReady(true);
  }, [hydrated]);

  const signIn = useCallback((result: AuthResult) => {
    const next: Session = { ...result, expiresAt: Date.now() + result.expiresIn * 1000 };
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, ready, signIn, signOut }),
    [session, ready, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Redirects to /login when there is no live session; renders nothing until known. */
export function RequireAuth({ children, role }: { children: ReactNode; role?: 'supplier' | 'financier' }) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace(`/login${role ? `?role=${role}` : ''}`);
  }, [ready, session, router, role]);

  if (!ready || !session) return null;
  return <>{children}</>;
}
