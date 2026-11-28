// Cloudflare Worker: ZERO-ニコ動 3台Render分散・Vercel予備・1.5秒生放送キャッシュ・Base64サムネキャッシュ・Cron維持
const DEFAULT_RENDER_ORIGINS = [
  'https://nikoniko-4.onrender.com',
  'https://nikoniko-dass.onrender.com',
  'https://nikoniko-ju6x.onrender.com',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With, X-Viewer-Id',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Edge-Cache, X-Origin-Node',
};

const QUOTA_MSG = '本日のサーバー上限に達しました（日本時間 朝9:00 にリセットされます）';
const inFlightLiveFetches = new Map();

function getUpstreamOrigins(env) {
  const raw = String(env?.RENDER_ORIGINS || env?.RENDER_ORIGIN || '').trim();
  const list = raw
    ? raw.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
    : [...DEFAULT_RENDER_ORIGINS];
  const vercelOrigin = String(env?.VERCEL_ORIGIN || '').trim().replace(/\/+$/, '');
  if (vercelOrigin && !list.includes(vercelOrigin)) {
    list.push(vercelOrigin);
  }
  return list.length > 0 ? list : [...DEFAULT_RENDER_ORIGINS];
}

function hashPickIndex(seed, len) {
  if (len <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % len;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function buildForwardHeaders(request) {
  const forwardHeaders = new Headers();
  for (const key of ['accept', 'accept-language', 'content-type', 'range', 'authorization', 'user-agent', 'x-viewer-id']) {
    const val = request.headers.get(key);
    if (val) forwardHeaders.set(key, val);
  }
  if (!forwardHeaders.has('user-agent')) {
    forwardHeaders.set('user-agent', 'ZERO-Nico-Worker/2.1');
  }
  return forwardHeaders;
}

function decorateCorsHeaders(upstreamHeaders, extra = {}) {
  const respHeaders = new Headers(upstreamHeaders);
  for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);
  for (const [k, v] of Object.entries(extra)) respHeaders.set(k, v);
  respHeaders.delete('content-security-policy');
  respHeaders.delete('x-frame-options');
  respHeaders.delete('set-cookie');
  return respHeaders;
}

async function fetchWithOriginFailover(origins, buildTargetUrl, request, startIdx = 0) {
  const method = request.method.toUpperCase();
  const canRetryBody = method === 'GET' || method === 'HEAD';
  const forwardHeaders = buildForwardHeaders(request);

  let lastResp = null;
  let lastErr = null;
  const maxAttempts = canRetryBody ? origins.length : 1;

  for (let i = 0; i < maxAttempts; i++) {
    const origin = origins[(startIdx + i) % origins.length];
    try {
      const upstream = await fetch(buildTargetUrl(origin), {
        method,
        headers: forwardHeaders,
        body: canRetryBody ? undefined : request.body,
        redirect: 'follow',
      });
      if (upstream.status === 429) {
        return jsonResponse({ ok: false, success: false, code: 'QUOTA_EXCEEDED', error: QUOTA_MSG }, 429);
      }
      if ((upstream.status === 502 || upstream.status === 503 || upstream.status === 504) && i + 1 < maxAttempts) {
        lastResp = upstream;
        continue;
      }
      const hdrs = decorateCorsHeaders(upstream.headers, { 'X-Origin-Node': origin });
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: hdrs,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastResp) return lastResp;
  return jsonResponse({ ok: false, success: false, error: lastErr?.message || '中継先エラー' }, 502);
}

// 生放送HLS (1.5〜2秒共有キャッシュ) & サムネBase64 (900秒共有キャッシュ)
async function proxyEdgeCached(request, origins, buildTargetUrl, ctx, seedKey = '', ttlSec = 2) {
  if (request.method.toUpperCase() !== 'GET') {
    return fetchWithOriginFailover(origins, buildTargetUrl, request, 0);
  }

  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete('_t');
  cacheUrl.searchParams.delete('vid');
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: decorateCorsHeaders(cached.headers, { 'X-Edge-Cache': 'HIT' }),
      });
    }
  } catch {}

  const startIdx = seedKey ? hashPickIndex(seedKey, origins.length) : 0;
  const flightKey = cacheUrl.toString();
  if (!inFlightLiveFetches.has(flightKey)) {
    const work = (async () => {
      try {
        const upstream = await fetchWithOriginFailover(origins, buildTargetUrl, request, startIdx);
        const buf = await upstream.arrayBuffer();
        return {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: Array.from(upstream.headers.entries()),
          body: buf,
        };
      } finally {
        setTimeout(() => inFlightLiveFetches.delete(flightKey), 150);
      }
    })();
    inFlightLiveFetches.set(flightKey, work);
  }

  const result = await inFlightLiveFetches.get(flightKey);
  const cacheSec = result.status >= 200 && result.status < 300 ? ttlSec : 0;
  const response = new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: decorateCorsHeaders(new Headers(result.headers), {
      'Cache-Control': cacheSec > 0 ? `public, max-age=${Math.min(cacheSec, 60)}, s-maxage=${cacheSec}` : 'no-store',
      'X-Edge-Cache': 'MISS',
    }),
  });
  if (cacheSec > 0 && ctx?.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  }
  return response;
}

async function pingAllOriginsHealth(env) {
  const origins = getUpstreamOrigins(env);
  return Promise.all(
    origins.map(async (origin) => {
      const started = Date.now();
      try {
        const res = await fetch(`${origin}/api/health`, {
          method: 'GET',
          headers: { 'User-Agent': 'ZERO-Nico-Worker-KeepAlive/2.1' },
        });
        const text = await res.text();
        return { origin, ok: res.ok, status: res.status, ms: Date.now() - started, body: text.slice(0, 200) };
      } catch (err) {
        return { origin, ok: false, status: 502, ms: Date.now() - started, error: err?.message || String(err) };
      }
    })
  );
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' } });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const origins = getUpstreamOrigins(env);

    // 1. Worker単体ヘルスチェック（東京エッジ応答）
    if (path === '/' || path === '/health') {
      return jsonResponse({
        ok: true,
        status: 'ok',
        service: 'zero-nico-worker',
        edge: request.cf?.colo || 'CF',
        renderOrigins: origins,
      });
    }

    // 2. 全Render・Vercelサーバーの稼働確認＆起こし用
    if (path === '/ping-render') {
      const results = await pingAllOriginsHealth(env);
      const anyOk = results.some((r) => r.ok);
      return jsonResponse({ ok: anyOk, results }, anyOk ? 200 : 502);
    }

    // 3. Base64サムネ取得は15分(900秒)エッジキャッシュ
    if (path === '/api/thumb-base64' || path === '/api/nico-base64') {
      return proxyEdgeCached(
        request,
        origins,
        (origin) => `${origin}${path}${url.search}`,
        ctx,
        url.searchParams.get('url') || path,
        900
      );
    }

    // 4. 生放送 master.m3u8 (1.5秒〜2秒共有キャッシュ + 3台Renderハッシュ分散)
    const masterMatch = path.match(/^\/live\/([^/]+)\/master\.m3u8$/i);
    if (masterMatch) {
      const liveId = decodeURIComponent(masterMatch[1]);
      return proxyEdgeCached(
        request,
        origins,
        (origin) => `${origin}/api/tools/nikoniko/live/${encodeURIComponent(liveId)}/master.m3u8${url.search}`,
        ctx,
        liveId,
        2
      );
    }

    // 5. 生放送 HLS セグメント・サブプレイリスト (1.5秒〜2秒共有キャッシュ)
    const proxyMatch = path.match(/^\/live\/([^/]+)\/proxy$/i);
    if (proxyMatch) {
      const liveId = decodeURIComponent(proxyMatch[1]);
      const params = new URLSearchParams(url.search);
      if (!params.get('id')) params.set('id', liveId);
      const qs = params.toString();
      return proxyEdgeCached(
        request,
        origins,
        (origin) => `${origin}/api/nico/live/hls/proxy?${qs}`,
        ctx,
        liveId,
        2
      );
    }

    if (path.startsWith('/api/nico/live/hls/')) {
      const liveMatch = path.match(/\/(lv\d+)\//i) || [null, url.searchParams.get('id') || 'live'];
      return proxyEdgeCached(
        request,
        origins,
        (origin) => `${origin}${path}${url.search}`,
        ctx,
        String(liveMatch[1] || 'live'),
        2
      );
    }

    // 5.5 漢字・検索変換（Google日本語IME＋ニコニコ公式サジェストをWorkerエッジで直接処理）
    if (path === '/api/search/convert') {
      const raw = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      const hiraQuery = String(url.searchParams.get('hira') || raw).trim().slice(0, 120);
      if (!raw && !hiraQuery) {
        return jsonResponse({ ok: true, raw: '', hira: '', primary: '', candidates: [] });
      }

      const hiraClauses = hiraQuery.split(/\s+/).filter(Boolean).join(',');
      const hasKana = /[\u3041-\u309f\u30a1-\u30ff]/.test(hiraQuery);

      const fetchIme = async () => {
        if (!hasKana || !hiraClauses) return [];
        try {
          const resp = await fetch(
            `https://www.google.com/transliterate?langpair=ja-Hira|ja&text=${encodeURIComponent(hiraClauses)}`
          );
          if (!resp.ok) return [];
          const data = await resp.json();
          if (!Array.isArray(data) || data.length === 0) return [];
          if (data.length === 1 && Array.isArray(data[0]?.[1])) {
            return data[0][1].map((s) => String(s)).filter(Boolean).slice(0, 8);
          }
          const hadSpace = /\s/.test(hiraQuery);
          const sep = hadSpace ? ' ' : '';
          const segChoices = data.map((seg) =>
            Array.isArray(seg?.[1]) && seg[1].length > 0
              ? seg[1].map((s) => String(s)).filter(Boolean)
              : [String(seg?.[0] || '')]
          );
          const out = [];
          for (let k = 0; k < 4; k++) {
            const joined = segChoices.map((c) => c[k] || c[0] || '').join(sep).trim();
            if (joined) out.push(joined);
          }
          for (let sIdx = 0; sIdx < segChoices.length; sIdx++) {
            for (let altIdx = 1; altIdx < Math.min(4, segChoices[sIdx].length); altIdx++) {
              const varied = segChoices.map((c, i) => (i === sIdx ? c[altIdx] : c[0] || '')).join(sep).trim();
              if (varied) out.push(varied);
            }
          }
          return Array.from(new Set(out)).filter(Boolean).slice(0, 10);
        } catch {
          return [];
        }
      };

      const fetchNicoSuggest = async (term) => {
        if (!term) return [];
        try {
          const resp = await fetch(`https://sug.search.nicovideo.jp/suggestion/complete/${encodeURIComponent(term)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          if (!resp.ok) return [];
          const json = await resp.json();
          return Array.isArray(json?.candidates) ? json.candidates.map((c) => String(c)).filter(Boolean).slice(0, 12) : [];
        } catch {
          return [];
        }
      };

      const [imeList, nicoFromHira, nicoFromRaw] = await Promise.all([
        fetchIme(),
        fetchNicoSuggest(hiraQuery || raw),
        raw && raw !== hiraQuery ? fetchNicoSuggest(raw) : Promise.resolve([]),
      ]);
      const extraTargets = Array.from(new Set([imeList[0], imeList[1]].filter((t) => Boolean(t && t !== hiraQuery && t !== raw))));
      const nicoFromImeLists = extraTargets.length > 0 ? await Promise.all(extraTargets.map((t) => fetchNicoSuggest(t))) : [];

      const seen = new Set();
      const candidates = [];
      const pushCand = (text, kind) => {
        const clean = String(text || '').trim();
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        candidates.push({ text: clean, kind });
      };
      imeList.slice(0, 8).forEach((t) => pushCand(t, 'ime'));
      nicoFromImeLists.forEach((arr) => arr.forEach((t) => pushCand(t, 'nico')));
      nicoFromHira.forEach((t) => pushCand(t, 'nico'));
      nicoFromRaw.forEach((t) => pushCand(t, 'nico'));

      const primary = imeList[0] || nicoFromHira[0] || nicoFromRaw[0] || hiraQuery || raw;
      return jsonResponse(
        { ok: true, raw, hira: hiraQuery, primary, candidates: candidates.slice(0, 25) },
        200,
        { 'Cache-Control': 'public, max-age=300, s-maxage=300' }
      );
    }

    // 6. 一般API全転送（3台Render分散＆自動フェイルオーバー）
    if (path.startsWith('/api/')) {
      const seed = `${path}:${url.searchParams.get('q') || url.searchParams.get('url') || Date.now()}`;
      return fetchWithOriginFailover(
        origins,
        (origin) => `${origin}${path}${url.search}`,
        request,
        hashPickIndex(seed, origins.length)
      );
    }

    return jsonResponse({ ok: false, error: 'Not Found', path }, 404);
  },

  // Render 3台の15分スリープ防止 Cron Trigger (*/10 * * * *)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingAllOriginsHealth(env));
  },
};
