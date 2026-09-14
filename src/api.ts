import Constants from 'expo-constants';
import * as FieldAgent from 'expo-field-agent';
import * as SecureStore from 'expo-secure-store';

import type { Step } from './derive';
import { NATIVE } from './native';

export const API = String(Constants.expoConfig?.extra?.apiUrl ?? '');

const REFRESH_KEY = 'rider.refresh';
const DRIVER_KEY = 'rider.driver';

export type Driver = { id: string; name: string; phone: string };
export type Place = { label: string; latitude: number; longitude: number };
export type Job = {
  id: string;
  customer: string;
  pickup: Place;
  dropoff: Place;
  distanceKm: number;
  fare: number;
  step: Step | null;
};
export type Trip = { id: string; endedAt: number; fare: number; dropoff: string };
export type Earnings = { total: number; week: number; trips: Trip[] };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly payload: any,
  ) {
    super(`HTTP ${status}`);
  }
}

let access: string | null = null;

/**
 * The foreground service POSTs positions with no JavaScript alive, so the
 * header has to live in the plugin's keystore and not in this closure. Every
 * new access token has to be handed over again or the queue fills on 401s.
 */
async function useAccess(token: string): Promise<void> {
  access = token;
  // Sans module natif il n'y a ni keystore ni service pour s'en servir : le
  // jeton reste en mémoire et l'application continue, au lieu de faire échouer
  // une connexion que le serveur vient d'accepter.
  if (NATIVE) await FieldAgent.setAuthHeader(`Bearer ${token}`);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(response.status, payload);
  return payload as T;
}

export async function login(phone: string, password: string): Promise<Driver> {
  const out = await post<{ access: string; refresh: string; driver: Driver }>('/api/auth/login', { phone, password });
  await SecureStore.setItemAsync(REFRESH_KEY, out.refresh);
  await SecureStore.setItemAsync(DRIVER_KEY, JSON.stringify(out.driver));
  await useAccess(out.access);
  return out.driver;
}

/** The refresh endpoint returns a token, not an identity, so the driver is kept next to it. */
export async function restore(): Promise<Driver | null> {
  const [refresh, raw] = await Promise.all([
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(DRIVER_KEY),
  ]);
  if (!refresh || !raw) return null;
  if (!(await renew(refresh))) return null;
  return JSON.parse(raw) as Driver;
}

async function renew(token?: string | null): Promise<boolean> {
  const refresh = token ?? (await SecureStore.getItemAsync(REFRESH_KEY));
  if (!refresh) return false;
  try {
    const out = await post<{ access: string }>('/api/auth/refresh', { refresh });
    await useAccess(out.access);
    return true;
  } catch {
    return false;
  }
}

/** The service POSTs with no JavaScript alive; only JS can renew and re-hand the token. */
export function reauth(): Promise<boolean> {
  return renew();
}

export async function logout(): Promise<void> {
  access = null;
  if (NATIVE) await FieldAgent.setAuthHeader(null);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(DRIVER_KEY);
}

export async function api<T>(path: string, init: RequestInit & { retried?: boolean } = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...init.headers,
    },
  });
  // One retry, and only after the refresh handed the new token to the plugin
  // as well — otherwise the service keeps 401ing until the queue starts losing.
  if (response.status === 401 && !init.retried && (await renew())) {
    return api<T>(path, { ...init, retried: true });
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(response.status, payload);
  return payload as T;
}
