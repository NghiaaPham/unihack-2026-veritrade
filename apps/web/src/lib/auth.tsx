'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  /** False during SSR and the first client render, so guarded pages never flash. */
  ready: boolean;
  signIn: (result: AuthResult) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

// localStorage is the store; same-tab writes notify through this set, other tabs via `storage`.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function notify() {
  for (const l of listeners) l();
}

const readRaw = () => window.localStorage.getItem(SESSION_STORAGE_KEY);
const noServerSession = () => undefined;

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // `undefined` means "not hydrated yet"; `null` means "no session stored".
  const raw = useSyncExternalStore<string | null | undefined>(subscribe, readRaw, noServerSession);
  const session = useMemo(() => (raw === undefined ? null : parseSession(raw)), [raw]);

  const signIn = useCallback((result: AuthResult) => {
    const next: Session = { ...result, expiresAt: Date.now() + result.expiresIn * 1000 };
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    notify();
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    notify();
  }, []);

  const value = useMemo(
    () => ({ session, ready: raw !== undefined, signIn, signOut }),
    [session, raw, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Redirects to /login when there is no live session; renders nothing until known. */
export function RequireAuth({
  children,
  role,
}: {
  children: ReactNode;
  role?: 'supplier' | 'financier';
}) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace(`/login${role ? `?role=${role}` : ''}`);
  }, [ready, session, router, role]);

  if (!ready || !session) return null;
  return <>{children}</>;
}
