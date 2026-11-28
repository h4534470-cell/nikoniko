import { AppSettings } from '../types';

export const RENDER_SERVER_URL = 'https://nikoniko-4.onrender.com';
export const CF_WORKER_URL = 'https://niconico-2.na8526130.workers.dev';

export function resolveApiBaseUrl(method?: AppSettings['apiRouteMethod']): string {
  if (method === 'render') return RENDER_SERVER_URL;
  if (method === 'worker') return CF_WORKER_URL;
  return '';
}

export function buildApiUrl(path: string, method?: AppSettings['apiRouteMethod']): string {
  if (!path.startsWith('/')) return path;
  const base = resolveApiBaseUrl(method);
  return base ? `${base}${path}` : path;
}
