import { AppSettings } from '../types';
import { getSettings } from './storage';

const envRenderUrls =
  typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RENDER_URLS
    ? String((import.meta as any).env.VITE_RENDER_URLS)
        .split(',')
        .map((s: string) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];

const envWorkerUrls =
  typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WORKER_URLS
    ? String((import.meta as any).env.VITE_WORKER_URLS)
        .split(',')
        .map((s: string) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];

const envVercelUrl =
  typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_VERCEL_URL
    ? String((import.meta as any).env.VITE_VERCEL_URL).trim().replace(/\/+$/, '')
    : '';

export const RENDER_SERVER_URLS: string[] =
  envRenderUrls.length > 0
    ? envRenderUrls
    : [
        'https://nikoniko-4.onrender.com',
        'https://nikoniko-dass.onrender.com',
        'https://nikoniko-ju6x.onrender.com'
      ];

export const WORKER_SERVER_URLS: string[] =
  envWorkerUrls.length > 0
    ? envWorkerUrls
    : ['https://niconico-2.na8526130.workers.dev', 'https://niconico.na8526130.workers.dev'];

export const RENDER_SERVER_URL = RENDER_SERVER_URLS[0];
export const CF_WORKER_URL = WORKER_SERVER_URLS[0];

export const QUOTA_EXCEEDED_MESSAGE =
  '本日のサーバー上限に達しました（日本時間 朝9:00 にリセットされます）';
export const LIVE_CAPACITY_FULL_MESSAGE =
  '現在生放送の視聴枠が満員です（通常動画は利用できます）';
export const QUOTA_EXCEEDED_EVENT = 'zero:quota-exceeded';

const AUTO_NODE_KEY = 'zeroAutoNodeBase';
const VIEWER_ID_KEY = 'zeroLiveViewerId';

export interface AutoNodeInfo {
  baseUrl: string;
  label: string;
}

function getSessionStore(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function getConfiguredVercelUrl(): string {
  try {
    const saved = String(getSettings()?.vercelApiUrl || '').trim().replace(/\/+$/, '');
    if (saved && /^https?:\/\//i.test(saved)) return saved;
  } catch {}
  if (envVercelUrl && /^https?:\/\//i.test(envVercelUrl)) return envVercelUrl;
  return '';
}

export function getLiveViewerId(): string {
  const store = getSessionStore();
  if (!store) return `v_${Math.random().toString(36).slice(2, 10)}`;
  const existing = store.getItem(VIEWER_ID_KEY);
  if (existing) return existing;
  const created = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    store.setItem(VIEWER_ID_KEY, created);
  } catch {}
  return created;
}

export function getDistributedCandidates(): AutoNodeInfo[] {
  const isHostedOnVercel =
    typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app');
  const list: AutoNodeInfo[] = [
    {
      baseUrl: '',
      label: isHostedOnVercel ? 'Vercel API (同一オリジン)' : 'メインサーバー (同一オリジン)'
    }
  ];
  WORKER_SERVER_URLS.forEach((u, i) => {
    list.push({
      baseUrl: u,
      label: `Cloudflare Worker #${i + 1} (${u.replace(/^https?:\/\//, '')})`
    });
  });
  RENDER_SERVER_URLS.forEach((u, i) => {
    list.push({
      baseUrl: u,
      label: `Render #${i + 1} (${u.replace(/^https?:\/\//, '')})`
    });
  });
  const vercelUrl = getConfiguredVercelUrl();
  if (vercelUrl && !list.some((item) => item.baseUrl === vercelUrl)) {
    list.push({
      baseUrl: vercelUrl,
      label: `Vercel API (${vercelUrl.replace(/^https?:\/\//, '')})`
    });
  }
  return list;
}

export function getAutoNodeDisplayInfo(): AutoNodeInfo {
  const candidates = getDistributedCandidates();
  const store = getSessionStore();
  const saved = store?.getItem(AUTO_NODE_KEY);
  if (saved !== null) {
    const matched = candidates.find((c) => c.baseUrl === saved);
    if (matched) return matched;
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)] || candidates[0];
  try {
    store?.setItem(AUTO_NODE_KEY, picked.baseUrl);
  } catch {}
  return picked;
}

export function rerollAutoNode(excludeBaseUrl?: string): AutoNodeInfo {
  const candidates = getDistributedCandidates();
  const filtered =
    excludeBaseUrl !== undefined
      ? candidates.filter((c) => c.baseUrl !== excludeBaseUrl)
      : candidates;
  const pool = filtered.length > 0 ? filtered : candidates;
  const picked = pool[Math.floor(Math.random() * pool.length)] || candidates[0];
  try {
    getSessionStore()?.setItem(AUTO_NODE_KEY, picked.baseUrl);
  } catch {}
  return picked;
}

export function resolveApiBaseUrl(method?: AppSettings['apiRouteMethod']): string {
  if (method === 'render') return RENDER_SERVER_URLS[0];
  if (method === 'render2') return RENDER_SERVER_URLS[1] || RENDER_SERVER_URLS[0];
  if (method === 'render3') return RENDER_SERVER_URLS[2] || RENDER_SERVER_URLS[0];
  if (method === 'worker') return CF_WORKER_URL;
  if (method === 'vercel') return getConfiguredVercelUrl();
  if (method === 'direct') return '';
  return getAutoNodeDisplayInfo().baseUrl;
}

export function buildApiUrl(path: string, method?: AppSettings['apiRouteMethod']): string {
  if (!path.startsWith('/')) return path;
  const base = resolveApiBaseUrl(method);
  return base ? `${base}${path}` : path;
}

export function isQuotaExceededResponse(status: number, bodyText?: string): boolean {
  if (status === 429) return true;
  if (!bodyText) return false;
  const low = bodyText.toLowerCase();
  return (
    low.includes('quota_exceeded') ||
    low.includes('error 1015') ||
    low.includes('error 1027') ||
    low.includes('daily request limit') ||
    (low.includes('workers.dev') && low.includes('limit')) ||
    low.includes('本日のサーバー上限に達しました')
  );
}

export function emitQuotaExceeded(message: string = QUOTA_EXCEEDED_MESSAGE): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(QUOTA_EXCEEDED_EVENT, { detail: { message } }));
  } catch {}
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
  method: AppSettings['apiRouteMethod'] = 'auto'
): Promise<Response> {
  if (!path.startsWith('/')) {
    return fetch(path, init);
  }

  if (method !== 'auto') {
    const base = resolveApiBaseUrl(method);
    const resp = await fetch(base ? `${base}${path}` : path, init);
    if (resp.status === 429) {
      emitQuotaExceeded();
    }
    return resp;
  }

  const candidates = getDistributedCandidates();
  const current = getAutoNodeDisplayInfo();
  const ordered = [
    current,
    ...candidates.filter((c) => c.baseUrl !== current.baseUrl)
  ];

  let lastResp: Response | null = null;
  let lastErr: unknown = null;
  let sawQuota = false;

  for (let i = 0; i < Math.min(4, ordered.length); i++) {
    const node = ordered[i];
    const target = node.baseUrl ? `${node.baseUrl}${path}` : path;
    try {
      const resp = await fetch(target, init);
      lastResp = resp;
      if (resp.status === 429) {
        sawQuota = true;
        rerollAutoNode(node.baseUrl);
        continue;
      }
      if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
        const cloned = resp.clone();
        const txt = await cloned.text().catch(() => '');
        if (txt.includes('LIVE_CAPACITY_FULL')) {
          return resp;
        }
        if (isQuotaExceededResponse(resp.status, txt)) {
          sawQuota = true;
        }
        rerollAutoNode(node.baseUrl);
        continue;
      }
      if (node.baseUrl !== current.baseUrl) {
        try {
          getSessionStore()?.setItem(AUTO_NODE_KEY, node.baseUrl);
        } catch {}
      }
      return resp;
    } catch (err) {
      lastErr = err;
      rerollAutoNode(node.baseUrl);
    }
  }

  if (sawQuota) {
    emitQuotaExceeded();
  }
  if (lastResp) return lastResp;
  throw lastErr || new Error('サーバーへの接続に失敗しました');
}
