import express from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

const NODE_SERVER = process.env.NODE_SERVER || 'https://muratube.hospitaldelninodif.gob.mx';
const YT_DLP_BIN = path.resolve('bin/yt-dlp');
let ytDlpBootstrapPromise: Promise<string> | null = null;

async function ensureYtDlp(): Promise<string> {
  if (fs.existsSync(YT_DLP_BIN)) {
    try {
      fs.chmodSync(YT_DLP_BIN, 0o755);
      return YT_DLP_BIN;
    } catch {}
  }
  if (ytDlpBootstrapPromise) return ytDlpBootstrapPromise;

  ytDlpBootstrapPromise = (async () => {
    const binDir = path.dirname(YT_DLP_BIN);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }
    const tmpBin = `${YT_DLP_BIN}.downloading`;
    const resp = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', {
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    });
    if (!resp.ok) {
      throw new Error(`Failed to download yt-dlp: HTTP ${resp.status}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(tmpBin, buf);
    fs.chmodSync(tmpBin, 0o755);
    fs.renameSync(tmpBin, YT_DLP_BIN);
    return YT_DLP_BIN;
  })().finally(() => {
    ytDlpBootstrapPromise = null;
  });

  return ytDlpBootstrapPromise;
}

function sanitizeId(raw: string): string {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'video';
}

function normalizeTargetUrl(input: string, platformHint?: string): string {
  const trimmed = String(input || '').trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid URL protocol');
    }
    return parsed.toString();
  }
  if (/^(sm|so|nm)\d+$/i.test(trimmed)) {
    return `https://www.nicovideo.jp/watch/${trimmed}`;
  }
  return `https://www.nicovideo.jp/watch/${encodeURIComponent(trimmed)}`;
}

function buildDownloadArgs(targetUrl: string, format: string, quality: string, outTemplate: string): string[] {
  const qNum = Math.min(2160, Math.max(144, parseInt(String(quality), 10) || 1080));
  const fmt = (format || 'mp4').toLowerCase();

  if (fmt === 'mp3') {
    return [
      '--no-playlist',
      '--newline',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      targetUrl,
      '-o', outTemplate
    ];
  }
  if (fmt === 'webm') {
    return [
      '--no-playlist',
      '--newline',
      '-f', `bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
      '--recode-video', 'webm',
      targetUrl,
      '-o', outTemplate
    ];
  }
  if (fmt === 'mkv') {
    return [
      '--no-playlist',
      '--newline',
      '-f', `bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
      '--merge-output-format', 'mkv',
      targetUrl,
      '-o', outTemplate
    ];
  }
  if (fmt === 'avi') {
    return [
      '--no-playlist',
      '--newline',
      '-f', `bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
      '--recode-video', 'avi',
      targetUrl,
      '-o', outTemplate
    ];
  }
  // mp4 / iphone / android (H.264/AAC faststart MP4)
  return [
    '--no-playlist',
    '--newline',
    '-f', `bestvideo[height<=${qNum}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=${qNum}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
    '--merge-output-format', 'mp4',
    '--postprocessor-args', 'Merger+ffmpeg:-movflags +faststart',
    targetUrl,
    '-o', outTemplate
  ];
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use('/videos', express.static('public/videos'));

  // CORS middleware matching muratube
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Range,range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Content-Length,Accept-Ranges');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Real Live Search Engine Helpers (Niconico Snapshot API v2 + YouTube Live Search)
  function formatSecToDuration(sec: number): string {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function searchNiconicoSnapshot(opts: {
    q?: string;
    sort?: string;
    order?: string;
    page?: number;
    limit?: number;
    genre?: string;
    recentDays?: number;
  }) {
    const q = (opts.q || '').trim();
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(50, Math.max(1, opts.limit || 20));
    const offset = (page - 1) * limit;
    const sign = opts.order === 'a' ? '+' : '-';

    const sortMap: Record<string, string> = {
      v: `${sign}viewCounter`,
      f: `${sign}startTime`,
      r: `${sign}commentCounter`,
      m: `${sign}mylistCounter`,
      l: `${sign}likeCounter`
    };
    const sortExpr = sortMap[opts.sort || 'v'] || '-viewCounter';

    const params = new URLSearchParams();
    params.set('q', q);
    if (q) {
      params.set('targets', 'title,description,tags');
    }
    params.set(
      'fields',
      'contentId,title,userId,channelId,viewCounter,lengthSeconds,thumbnailUrl,startTime,commentCounter,mylistCounter,likeCounter,genre,tags'
    );
    params.set('_sort', sortExpr);
    params.set('_offset', String(offset));
    params.set('_limit', String(limit));
    params.set('_context', 'mura-nico-player');

    if (opts.genre && opts.genre !== 'all' && opts.genre !== 'classics') {
      const genreMap: Record<string, string> = {
        game: 'ゲーム',
        anime: 'アニメ',
        music_sound: '音楽・サウンド',
        entertainment: 'エンターテイメント',
        dance: 'ダンス'
      };
      if (opts.genre === 'vocaloid') {
        if (!q) {
          params.set('q', 'VOCALOID');
          params.set('targets', 'tagsExact');
        }
      } else if (genreMap[opts.genre]) {
        params.set('filters[genre][0]', genreMap[opts.genre]);
      }
    }

    if (opts.recentDays && opts.recentDays > 0) {
      const since = new Date(Date.now() - opts.recentDays * 24 * 60 * 60 * 1000);
      params.set('filters[startTime][gte]', since.toISOString().slice(0, 19) + '+00:00');
    }

    const url = `https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'mura-nico-player/1.0 (https://nicovideo.jp)',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(7000)
    });

    if (!resp.ok) {
      throw new Error(`Niconico Snapshot API HTTP ${resp.status}`);
    }

    const json = await resp.json();
    const totalCount = Number(json?.meta?.totalCount || 0);
    const rows = Array.isArray(json?.data) ? json.data : [];

    const items = rows.map((row: any) => {
      const id = String(row.contentId || '');
      const uploadedAt = row.startTime
        ? String(row.startTime).slice(0, 10).replace(/-/g, '/')
        : '2026/01/01';
      return {
        id,
        title: String(row.title || `動画 ${id}`),
        channel: row.channelId ? `公式チャンネル (${row.channelId})` : (row.userId ? `ユーザー ${row.userId}` : 'ニコニコ動画'),
        channel_url: row.channelId
          ? `https://ch.nicovideo.jp/ch${row.channelId}`
          : (row.userId ? `https://www.nicovideo.jp/user/${row.userId}` : ''),
        channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
        thumbnail: row.thumbnailUrl || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, '')}/${id.replace(/\D/g, '')}`,
        duration: formatSecToDuration(row.lengthSeconds),
        views: Number(row.viewCounter || 0),
        url: `https://www.nicovideo.jp/watch/${id}`,
        platform: 'niconico' as const,
        category: row.genre || '総合',
        description: row.tags ? `タグ: ${row.tags}` : '',
        uploadedAt,
        likeCount: Number(row.likeCounter || 0),
        commentCount: Number(row.commentCounter || 0),
        subscribers: 50000,
        nicoId: id
      };
    });

    return {
      items,
      total: totalCount || items.length,
      hasNext: offset + items.length < totalCount
    };
  }

  function parseJapaneseCountText(text: string): number {
    const clean = String(text || '').replace(/,/g, '').trim();
    const m = clean.match(/([\d.]+)\s*(億|万|K|M)?/i);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    const unit = (m[2] || '').toUpperCase();
    if (unit === '億') return Math.round(num * 100000000);
    if (unit === '万') return Math.round(num * 10000);
    if (unit === 'M') return Math.round(num * 1000000);
    if (unit === 'K') return Math.round(num * 1000);
    return Math.round(num);
  }

  // Proxy handler mirroring https://github.com/kimura38/muratube
  const handleMuratubeAction = async (action: string, req: express.Request, res: express.Response) => {
    if (action === 'search') {
      const q = String(req.query.q || '').trim();
      const sort = String(req.query.sort || 'v');
      const order = String(req.query.order || 'd');
      const rawPage = parseInt(String(req.query.page || '1'), 10);
      const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
      try {
        const result = await searchNiconicoSnapshot({ q, sort, order, page, limit: 20 });
        return res.json({
          ok: true,
          success: true,
          platform: 'niconico',
          query: q,
          total: result.total,
          hasNext: result.hasNext,
          videos: result.items,
          items: result.items
        });
      } catch (err: any) {
        return res.status(502).json({ ok: false, success: false, error: err?.message || 'Search failed', videos: [], items: [] });
      }
    }

    if (action === 'recommend') {
      try {
        const result = await searchNiconicoSnapshot({ q: '', sort: 'v', order: 'd', page: 1, limit: 24, recentDays: 7 });
        return res.json({ ok: true, success: true, videos: result.items, items: result.items, total: result.items.length });
      } catch (err: any) {
        return res.status(502).json({ ok: false, success: false, error: err?.message || 'Recommend failed', videos: [], items: [] });
      }
    }

    let targetUrl = '';
    let method = req.method || 'GET';

    if (action === 'health') {
      return res.json({ ok: true, status: 'ok', search: 'ready', ytDlp: fs.existsSync(YT_DLP_BIN) });
    } else if (action === 'shorts') {
      targetUrl = `${NODE_SERVER}/api/shorts?platform=niconico`;
    } else if (action === 'extract') {
      const query = req.query.id
        ? `id=${encodeURIComponent((req.query.id as string) || '')}`
        : `url=${encodeURIComponent((req.query.url as string) || '')}`;
      targetUrl = `${NODE_SERVER}/api/extract?${query}&ip=${encodeURIComponent((req.query.ip as string) || '')}&platform=niconico`;
    } else if (action === 'visit') {
      targetUrl = `${NODE_SERVER}/api/visit`;
    } else if (action === 'announcements') {
      targetUrl = `${NODE_SERVER}/api/announcements`;
    } else if (action === 'channel') {
      targetUrl = `${NODE_SERVER}/api/channel?url=${encodeURIComponent((req.query.url as string) || '')}&offset=${encodeURIComponent((req.query.offset as string) || '0')}&limit=${encodeURIComponent((req.query.limit as string) || '30')}`;
    } else if (action === 'channel-info') {
      targetUrl = `${NODE_SERVER}/api/channel-info?url=${encodeURIComponent((req.query.url as string) || '')}&offset=${encodeURIComponent((req.query.offset as string) || '0')}&limit=${encodeURIComponent((req.query.limit as string) || '30')}`;
    } else if (action === 'comments') {
      targetUrl = `${NODE_SERVER}/api/comments?url=${encodeURIComponent((req.query.url as string) || '')}&offset=${encodeURIComponent((req.query.offset as string) || '0')}&limit=${encodeURIComponent((req.query.limit as string) || '10')}&pageToken=${encodeURIComponent((req.query.pageToken as string) || '')}`;
    } else if (action === 'comment-replies') {
      targetUrl = `${NODE_SERVER}/api/comment-replies?url=${encodeURIComponent((req.query.url as string) || '')}&parentId=${encodeURIComponent((req.query.parentId as string) || '')}`;
    } else if (action === 'channel-avatar') {
      targetUrl = `${NODE_SERVER}/api/channel-avatar?url=${encodeURIComponent((req.query.url as string) || '')}`;
    } else if (action === 'channel-banner') {
      targetUrl = `${NODE_SERVER}/api/channel-banner?url=${encodeURIComponent((req.query.url as string) || '')}`;
    } else if (action === 'nico-base64') {
      targetUrl = `${NODE_SERVER}/api/nico-base64?url=${encodeURIComponent((req.query.url as string) || '')}`;
    } else if (action === 'thumb-base64') {
      targetUrl = `${NODE_SERVER}/api/thumb-base64?url=${encodeURIComponent((req.query.url as string) || '')}`;
    } else if (action === 'media-link') {
      targetUrl = `${NODE_SERVER}/api/media-link?url=${encodeURIComponent((req.query.url as string) || '')}`;
    } else if (action === 'nico-comments') {
      targetUrl = `${NODE_SERVER}/api/nico-comments?id=${encodeURIComponent((req.query.id as string) || '')}`;
    } else if (action === 'reviews') {
      targetUrl = `${NODE_SERVER}/api/reviews?deviceId=${encodeURIComponent((req.query.deviceId as string) || '')}`;
    } else if (action === 'review-save') {
      targetUrl = `${NODE_SERVER}/api/review-save?rating=${encodeURIComponent((req.query.rating as string) || '')}&comment=${encodeURIComponent((req.query.comment as string) || '')}&deviceId=${encodeURIComponent((req.query.deviceId as string) || '')}`;
    } else if (action === 'job-start') {
      let query = `url=${encodeURIComponent((req.query.url as string) || '')}&type=${encodeURIComponent((req.query.type as string) || '')}`;
      if (req.query.height) query += `&height=${encodeURIComponent(req.query.height as string)}`;
      if (req.query.v_id) query += `&v_id=${encodeURIComponent(req.query.v_id as string)}`;
      if (req.query.a_id) query += `&a_id=${encodeURIComponent(req.query.a_id as string)}`;
      if (req.query.withComments) query += `&withComments=${encodeURIComponent(req.query.withComments as string)}`;
      targetUrl = `${NODE_SERVER}/api/job-start?${query}`;
    } else if (action === 'job-progress') {
      targetUrl = `${NODE_SERVER}/api/job-progress?id=${encodeURIComponent((req.query.id as string) || '')}`;
    } else if (action === 'job-cancel') {
      targetUrl = `${NODE_SERVER}/api/job-cancel?id=${encodeURIComponent((req.query.id as string) || '')}`;
      method = 'POST';
    } else if (action === 'job-file') {
      targetUrl = `${NODE_SERVER}/api/job-file?id=${encodeURIComponent((req.query.id as string) || '')}&type=${encodeURIComponent((req.query.type as string) || '')}&download=${encodeURIComponent((req.query.download as string) || '')}`;
    } else if (action === 'proxy') {
      targetUrl = `${NODE_SERVER}/api/proxy?url=${encodeURIComponent((req.query.url as string) || '')}&platform=${encodeURIComponent((req.query.platform as string) || '')}&relayBase=${encodeURIComponent((req.query.relayBase as string) || '')}`;
    }

    if (!targetUrl) {
      return res.status(400).json({ error: 'Invalid action: ' + action });
    }

    const client = targetUrl.startsWith('https:') ? https : http;
    const reqHeaders: Record<string, string | string[] | undefined> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };

    if (req.headers.range) {
      reqHeaders['Range'] = req.headers.range;
    }

    const options: https.RequestOptions = {
      method,
      headers: reqHeaders
    };

    const proxyReq = client.request(targetUrl, options, (proxyRes) => {
      // Forward status and headers
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Muratube Proxy Error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Muratube Server Error', detail: err.message });
      }
    });

    proxyReq.end();
  };

  // 1. Support root query style matching kimura38/muratube server.js: /?action=...
  app.use('/', (req, res, next) => {
    if (req.query.action && typeof req.query.action === 'string') {
      return handleMuratubeAction(req.query.action, req, res);
    }
    next();
  });

  // 2. Support direct /api/:action endpoints
  app.all('/api/:action', (req, res, next) => {
    const action = req.params.action;
    // Reserved internal endpoints
    if (action === 'video' || action === 'nico' || action === 'dl' || action === 'download' || action === 'freemake') {
      return next();
    }
    return handleMuratubeAction(action, req, res);
  });

  // 3. Fallback / status endpoints for legacy player compatibility
  app.get('/api/video/status/:id', (req, res) => {
    // Instant ready - never stall on 15%
    return res.json({
      ready: true,
      percent: 100,
      stage: 'ready'
    });
  });

  interface HlsSession {
    m3u8Url: string;
    headers: string;
    cookieHeader: string;
    timestamp: number;
  }
  const nicoHlsSessionCache = new Map<string, HlsSession>();

  async function getLiveNicoStream(id: string, quality: string = '720'): Promise<HlsSession | null> {
    const qKey = String(quality || '720').replace(/\D/g, '') || '720';
    const cacheKey = `${id}:${qKey}`;
    const cached = nicoHlsSessionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 1000 * 60 * 15) {
      return cached;
    }
    try {
      const htmlRes = await fetch(`https://www.nicovideo.jp/watch/${id}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
        },
        signal: AbortSignal.timeout(8000)
      });
      const htmlCookies = htmlRes.headers.getSetCookie ? htmlRes.headers.getSetCookie() : [htmlRes.headers.get('set-cookie')];
      const cookieHeader = htmlCookies.filter((c): c is string => typeof c === 'string').map(c => c.split(';')[0]).join('; ');
      const html = await htmlRes.text();
      const m = html.match(/name="server-response"[^>]*content="([^"]+)"/) || html.match(/content="([^"]+)"[^>]*name="server-response"/);
      if (!m) return null;
      const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const parsed = JSON.parse(raw);
      const w = parsed.data?.response?.['$watchV4'];
      const media = w?.data?.media;
      const accessRightKey = media?.accessRightKey;
      const trackId = w?.data?.client?.watchTrackId;
      if (!accessRightKey || !trackId || !media?.contents?.videos?.length) return null;

      const availableVideos = media.contents.videos.filter((v: any) => v.isAvailable);
      const targetHeight = parseInt(qKey, 10) || 720;
      const extractHeight = (vidId: string) => {
        const hm = String(vidId || '').match(/(\d+)p/);
        return hm ? parseInt(hm[1], 10) : 360;
      };
      const sortedVideos = [...(availableVideos.length ? availableVideos : media.contents.videos)].sort(
        (a: any, b: any) => extractHeight(b.id) - extractHeight(a.id)
      );
      const vChoice =
        sortedVideos.find((v: any) => extractHeight(v.id) <= targetHeight) ||
        sortedVideos[sortedVideos.length - 1] ||
        media.contents.videos[0];
      const aChoice = media.contents.audios.find((a: any) => a.isAvailable) || media.contents.audios[0];

      const postRes = await fetch(`https://nvapi.nicovideo.jp/v1/watch/${id}/access-rights/hls?actionTrackId=${trackId}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;charset=utf-8',
          'Content-Type': 'application/json',
          'X-Access-Right-Key': accessRightKey,
          'X-Request-With': 'https://www.nicovideo.jp',
          'X-Frontend-Id': '6',
          'X-Frontend-Version': '0',
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Origin': 'https://www.nicovideo.jp',
          'Referer': `https://www.nicovideo.jp/watch/${id}`
        },
        body: JSON.stringify({ outputs: [[vChoice.id, aChoice.id]] }),
        signal: AbortSignal.timeout(6000)
      });
      if (!postRes.ok) return null;
      const postCookies = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [postRes.headers.get('set-cookie')];
      const allCookies = [...htmlCookies, ...postCookies].filter((c): c is string => typeof c === 'string').map(c => c.split(';')[0]).join('; ');
      const json = await postRes.json();
      const m3u8Url = json.data?.contentUrl;
      if (!m3u8Url) return null;
      const headers = `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nReferer: https://www.nicovideo.jp/\r\nCookie: ${allCookies}\r\n`;
      const session = { m3u8Url, headers, cookieHeader: allCookies, timestamp: Date.now() };
      nicoHlsSessionCache.set(cacheKey, session);
      return session;
    } catch (err) {
      console.error('getLiveNicoStream error:', err);
      return null;
    }
  }

  // Master HLS playlist for iOS Safari & hls.js
  app.get('/api/nico/hls/:id/master.m3u8', async (req, res) => {
    const id = req.params.id;
    const quality = String(req.query.quality || req.query.q || '720');
    const session = await getLiveNicoStream(id, quality);
    if (!session) {
      return res.status(502).json({ error: '動画ストリームを取得できませんでした' });
    }
    try {
      const resp = await fetch(session.m3u8Url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.nicovideo.jp/',
          'Cookie': session.cookieHeader
        }
      });
      if (!resp.ok) return res.status(resp.status).send('Upstream playlist error');
      let text = await resp.text();
      // Rewrite URIs in master playlist
      text = text.replace(/(URI=")([^"]+)(")/g, (_match, p1, uri, p3) => {
        return `${p1}/api/nico/hls/proxy?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(uri)}${p3}`;
      });
      text = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return `/api/nico/hls/proxy?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(trimmed)}`;
        }
        return line;
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(text);
    } catch (err: any) {
      console.error('HLS master error:', err);
      return res.status(500).send(err.message);
    }
  });

  // Media sub-playlist proxy
  app.get('/api/nico/hls/proxy', async (req, res) => {
    const id = req.query.id as string;
    const url = req.query.url as string;
    const quality = String(req.query.q || '720');
    if (!url || !id) return res.status(400).send('Missing params');

    const session = await getLiveNicoStream(id, quality);
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.nicovideo.jp/',
          'Cookie': session ? session.cookieHeader : ''
        }
      });
      if (!resp.ok) return res.status(resp.status).send('Upstream media playlist error');
      let text = await resp.text();
      // Rewrite MAP URI and segment URIs
      text = text.replace(/(URI=")([^"]+)(")/g, (_match, p1, uri, p3) => {
        return `${p1}/api/nico/hls/segment?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(uri)}${p3}`;
      });
      text = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          return `/api/nico/hls/segment?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(trimmed)}`;
        }
        return line;
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(text);
    } catch (err: any) {
      console.error('HLS proxy error:', err);
      return res.status(500).send(err.message);
    }
  });

  // HLS segment proxy with Range support for iOS Safari
  app.get('/api/nico/hls/segment', async (req, res) => {
    const id = req.query.id as string;
    const url = req.query.url as string;
    const quality = String(req.query.q || '720');
    if (!url || !id) return res.status(400).send('Missing params');

    const session = await getLiveNicoStream(id, quality);
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.nicovideo.jp/',
      'Origin': 'https://www.nicovideo.jp'
    };
    if (session) {
      headers['Cookie'] = session.cookieHeader;
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range as string;
    }

    try {
      const resp = await fetch(url, { headers });
      const buf = Buffer.from(await resp.arrayBuffer());

      res.status(resp.status);
      res.setHeader('Content-Type', resp.headers.get('content-type') || 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Length', buf.length);
      const cr = resp.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);

      return res.end(buf);
    } catch (err: any) {
      console.error('Segment proxy error:', err);
      if (!res.headersSent) res.status(500).end();
    }
  });

  // Freemake Real-Time Stream Playback Engine (HLS + HTTP Range Proxy + ffmpeg Live Remux)
  interface FreemakeStreamEntry {
    mode: 'hls' | 'proxy' | 'remux';
    title: string;
    thumbnail: string;
    durationString: string;
    uploader: string;
    webpageUrl: string;
    hlsUrl?: string;
    directUrl?: string;
    videoUrl?: string;
    audioUrl?: string;
    httpHeaders?: Record<string, string>;
    qualities: string[];
    timestamp: number;
  }
  const freemakeStreamCache = new Map<string, FreemakeStreamEntry>();

  function extractNicoIdFromUrl(input: string): string | null {
    const m = String(input || '').match(/\b((?:sm|so|nm)\d+)\b/i);
    return m ? m[1].toLowerCase() : null;
  }

  async function resolveFreemakeStream(targetUrl: string, quality: string = '720'): Promise<FreemakeStreamEntry> {
    const qNum = Math.min(2160, Math.max(144, parseInt(String(quality), 10) || 720));
    const cacheKey = `${targetUrl}::${qNum}`;
    const cached = freemakeStreamCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 1000 * 60 * 15) {
      return cached;
    }

    const ytDlpBin = await ensureYtDlp();
    const rawJson = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      const proc = spawn(ytDlpBin, ['-J', '--no-playlist', '--no-warnings', targetUrl]);
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('ストリーム情報の取得がタイムアウトしました。'));
      }, 25000);
      proc.stdout.on('data', (d) => chunks.push(d));
      proc.stderr.on('data', (d) => errChunks.push(d));
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
        else reject(new Error(Buffer.concat(errChunks).toString('utf8').slice(0, 350) || `yt-dlp exited ${code}`));
      });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const info = JSON.parse(rawJson);
    const entry = Array.isArray(info.entries) && info.entries.length > 0 ? info.entries[0] : info;
    const formats: any[] = Array.isArray(entry.formats) ? entry.formats : [];
    const durSec = Number(entry.duration || 0);
    const mins = Math.floor(durSec / 60);
    const secs = Math.floor(durSec % 60);

    const qualities = Array.from(
      new Set(
        formats
          .filter((f) => f.height && f.vcodec && f.vcodec !== 'none')
          .map((f) => String(f.height))
      )
    ).sort((a, b) => Number(b) - Number(a));

    const httpHeaders: Record<string, string> = {};
    const sampleHeaders = entry.http_headers || formats[0]?.http_headers || {};
    if (sampleHeaders['User-Agent']) httpHeaders['User-Agent'] = sampleHeaders['User-Agent'];
    if (sampleHeaders['Referer']) httpHeaders['Referer'] = sampleHeaders['Referer'];

    // 1. Prefer combined progressive HTTP MP4/WebM stream (instant Range seeking!)
    const progressiveCandidates = formats
      .filter(
        (f) =>
          f.url &&
          f.vcodec && f.vcodec !== 'none' &&
          f.acodec && f.acodec !== 'none' &&
          !String(f.protocol || '').includes('m3u8')
      )
      .sort((a, b) => (Number(b.height || 0) - Number(a.height || 0)));

    const progressive =
      progressiveCandidates.find((f) => (Number(f.height || 0) <= qNum) && f.ext === 'mp4') ||
      progressiveCandidates.find((f) => Number(f.height || 0) <= qNum) ||
      progressiveCandidates[progressiveCandidates.length - 1];

    if (progressive) {
      const result: FreemakeStreamEntry = {
        mode: 'proxy',
        title: String(entry.title || 'ストリーム動画'),
        thumbnail: String(entry.thumbnail || ''),
        durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : '--:--'),
        uploader: String(entry.uploader || entry.channel || entry.extractor_key || 'Web'),
        webpageUrl: String(entry.webpage_url || targetUrl),
        directUrl: progressive.url,
        httpHeaders: progressive.http_headers || httpHeaders,
        qualities: qualities.length ? qualities : ['720', '480', '360'],
        timestamp: Date.now()
      };
      freemakeStreamCache.set(cacheKey, result);
      return result;
    }

    // 2. Check combined HLS m3u8 manifest
    const hlsCandidates = formats
      .filter(
        (f) =>
          f.url &&
          String(f.protocol || '').includes('m3u8') &&
          f.vcodec && f.vcodec !== 'none' &&
          f.acodec && f.acodec !== 'none'
      )
      .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));

    const hlsFmt =
      hlsCandidates.find((f) => Number(f.height || 0) <= qNum) ||
      hlsCandidates[hlsCandidates.length - 1];

    if (hlsFmt) {
      const result: FreemakeStreamEntry = {
        mode: 'hls',
        title: String(entry.title || 'ストリーム動画'),
        thumbnail: String(entry.thumbnail || ''),
        durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : '--:--'),
        uploader: String(entry.uploader || entry.channel || entry.extractor_key || 'Web'),
        webpageUrl: String(entry.webpage_url || targetUrl),
        hlsUrl: hlsFmt.url,
        httpHeaders: hlsFmt.http_headers || httpHeaders,
        qualities: qualities.length ? qualities : ['720', '480', '360'],
        timestamp: Date.now()
      };
      freemakeStreamCache.set(cacheKey, result);
      return result;
    }

    // 3. Separate video + audio -> live ffmpeg fragmented MP4 remux stream
    const vCandidates = formats
      .filter((f) => f.url && f.vcodec && f.vcodec !== 'none')
      .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
    const vPick =
      vCandidates.find((f) => Number(f.height || 0) <= qNum && String(f.vcodec).startsWith('avc1')) ||
      vCandidates.find((f) => Number(f.height || 0) <= qNum) ||
      vCandidates[vCandidates.length - 1];
    const aPick = formats
      .filter((f) => f.url && f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
      .sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0))[0];

    if (!vPick) {
      throw new Error('再生可能なストリームが見つかりませんでした。');
    }

    const result: FreemakeStreamEntry = {
      mode: 'remux',
      title: String(entry.title || 'ストリーム動画'),
      thumbnail: String(entry.thumbnail || ''),
      durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : '--:--'),
      uploader: String(entry.uploader || entry.channel || entry.extractor_key || 'Web'),
      webpageUrl: String(entry.webpage_url || targetUrl),
      videoUrl: vPick.url,
      audioUrl: aPick?.url,
      httpHeaders: vPick.http_headers || httpHeaders,
      qualities: qualities.length ? qualities : ['720', '480', '360'],
      timestamp: Date.now()
    };
    freemakeStreamCache.set(cacheKey, result);
    return result;
  }

  app.get('/api/freemake/stream-info', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const quality = String(req.query.quality || '720').replace(/\D/g, '') || '720';
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: 'URLを指定してください。' });
    }

    let targetUrl = '';
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: '有効なURLを指定してください。' });
    }

    // Fast path for Niconico: native/hls.js HLS stream with quality selection
    const nicoId = extractNicoIdFromUrl(targetUrl);
    if (nicoId) {
      const session = await getLiveNicoStream(nicoId, quality);
      if (session) {
        return res.json({
          ok: true,
          mode: 'hls',
          platform: 'niconico',
          streamUrl: `/api/nico/hls/${encodeURIComponent(nicoId)}/master.m3u8?quality=${encodeURIComponent(quality)}`,
          qualities: ['720', '480', '360']
        });
      }
    }

    try {
      const resolved = await resolveFreemakeStream(targetUrl, quality);
      const streamUrl =
        resolved.mode === 'hls'
          ? `/api/freemake/hls/master.m3u8?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}`
          : `/api/freemake/stream?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}`;
      return res.json({
        ok: true,
        mode: resolved.mode,
        title: resolved.title,
        thumbnail: resolved.thumbnail,
        durationString: resolved.durationString,
        uploader: resolved.uploader,
        streamUrl,
        qualities: resolved.qualities
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      return res.status(502).json({
        ok: false,
        error: msg || 'ストリームの取得に失敗しました。'
      });
    }
  });

  app.get('/api/freemake/hls/master.m3u8', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const quality = String(req.query.quality || '720');
    if (!rawUrl) return res.status(400).send('Missing url');
    try {
      const targetUrl = normalizeTargetUrl(rawUrl);
      const resolved = await resolveFreemakeStream(targetUrl, quality);
      if (!resolved.hlsUrl) return res.status(404).send('No HLS stream');
      const resp = await fetch(resolved.hlsUrl, { headers: resolved.httpHeaders || {} });
      if (!resp.ok) return res.status(resp.status).send('Upstream HLS error');
      let text = await resp.text();
      const base = resolved.hlsUrl;
      text = text.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
        const abs = new URL(uri, base).toString();
        return `${p1}/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}&target=${encodeURIComponent(abs)}${p3}`;
      });
      text = text.split('\n').map((line) => {
        const t = line.trim();
        if (t && !t.startsWith('#')) {
          const abs = new URL(t, base).toString();
          return `/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}&target=${encodeURIComponent(abs)}`;
        }
        return line;
      }).join('\n');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(text);
    } catch (err: any) {
      return res.status(502).send(err?.message || 'HLS error');
    }
  });

  app.get('/api/freemake/hls/proxy', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const target = String(req.query.target || '').trim();
    const quality = String(req.query.quality || '720');
    if (!rawUrl || !target) return res.status(400).send('Missing params');
    try {
      const targetUrl = normalizeTargetUrl(rawUrl);
      const resolved = await resolveFreemakeStream(targetUrl, quality);
      const headers: Record<string, string> = { ...(resolved.httpHeaders || {}) };
      if (req.headers.range) headers['Range'] = String(req.headers.range);
      const resp = await fetch(target, { headers });
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('mpegurl') || target.includes('.m3u8')) {
        let text = await resp.text();
        text = text.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
          const abs = new URL(uri, target).toString();
          return `${p1}/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}&target=${encodeURIComponent(abs)}${p3}`;
        });
        text = text.split('\n').map((line) => {
          const t = line.trim();
          if (t && !t.startsWith('#')) {
            const abs = new URL(t, target).toString();
            return `/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}&target=${encodeURIComponent(abs)}`;
          }
          return line;
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(text);
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      res.status(resp.status);
      res.setHeader('Content-Type', ct || 'video/mp2t');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', buf.length);
      const cr = resp.headers.get('content-range');
      if (cr) res.setHeader('Content-Range', cr);
      return res.end(buf);
    } catch (err: any) {
      if (!res.headersSent) return res.status(502).send(err?.message || 'Proxy error');
    }
  });

  app.get('/api/freemake/stream', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const quality = String(req.query.quality || '720').replace(/\D/g, '') || '720';
    if (!rawUrl) return res.status(400).send('Missing url');

    let targetUrl = '';
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).send('Invalid url');
    }

    try {
      const resolved = await resolveFreemakeStream(targetUrl, quality);

      if (resolved.mode === 'proxy' && resolved.directUrl) {
        const headers: Record<string, string> = { ...(resolved.httpHeaders || {}) };
        if (req.headers.range) {
          headers['Range'] = String(req.headers.range);
        }
        const upstream = await fetch(resolved.directUrl, { headers });
        res.status(upstream.status);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
        res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
        const cl = upstream.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);
        const cr = upstream.headers.get('content-range');
        if (cr) res.setHeader('Content-Range', cr);
        if (!upstream.body) return res.end();
        const reader = upstream.body.getReader();
        req.on('close', () => {
          reader.cancel().catch(() => {});
        });
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        return res.end();
      }

      if (resolved.videoUrl) {
        const ffArgs: string[] = [];
        const headerStr = Object.entries(resolved.httpHeaders || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n');
        if (headerStr) {
          ffArgs.push('-headers', `${headerStr}\r\n`);
        }
        ffArgs.push('-i', resolved.videoUrl);
        if (resolved.audioUrl) {
          if (headerStr) ffArgs.push('-headers', `${headerStr}\r\n`);
          ffArgs.push('-i', resolved.audioUrl);
        }
        ffArgs.push(
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
          '-f', 'mp4',
          'pipe:1'
        );
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache');
        const ff = spawn('ffmpeg', ffArgs);
        ff.stdout.pipe(res);
        req.on('close', () => {
          try { ff.kill('SIGKILL'); } catch {}
        });
        ff.on('error', () => {
          if (!res.headersSent) res.status(500).end();
        });
        return;
      }

      return res.status(404).send('No playable stream found');
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(502).json({ ok: false, error: err?.message || 'Freemake stream failed' });
      }
    }
  });

  const activeDownloads = new Map<string, Promise<boolean>>();

  async function fetchOrGetVideo(id: string, customUrl?: string): Promise<string | null> {
    const safeId = sanitizeId(id);
    const videosDir = path.resolve('public/videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }
    const targetFile = path.join(videosDir, `${safeId}.mp4`);
    if (fs.existsSync(targetFile)) {
      return targetFile;
    }

    if (activeDownloads.has(safeId)) {
      const ok = await activeDownloads.get(safeId)!;
      return ok && fs.existsSync(targetFile) ? targetFile : null;
    }

    const task = (async () => {
      try {
        const targetUrl = customUrl
          ? normalizeTargetUrl(customUrl)
          : normalizeTargetUrl(id);

        const ytDlpBin = await ensureYtDlp();
        const tempOut = path.join(videosDir, `${safeId}.temp.mp4`);

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ytDlpBin, [
            '-f', 'bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best',
            '--merge-output-format', 'mp4',
            '--postprocessor-args', 'Merger+ffmpeg:-movflags +faststart',
            '--no-playlist',
            targetUrl,
            '-o', tempOut
          ]);
          proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(tempOut)) {
              fs.renameSync(tempOut, targetFile);
              resolve();
            } else {
              reject(new Error(`yt-dlp exited with code ${code}`));
            }
          });
          proc.on('error', reject);
        });
        return true;
      } catch (err) {
        console.error('fetchOrGetVideo error:', err);
        return false;
      } finally {
        activeDownloads.delete(safeId);
      }
    })();

    activeDownloads.set(safeId, task);
    const ok = await task;
    return ok && fs.existsSync(targetFile) ? targetFile : null;
  }

  app.get('/api/video/stream/:id', async (req, res) => {
    const safeId = sanitizeId(req.params.id);
    const customUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    const targetFile = path.resolve('public/videos', `${safeId}.mp4`);
    if (fs.existsSync(targetFile)) {
      return res.sendFile(targetFile, { acceptRanges: true });
    }

    // Download on-demand via yt-dlp and serve with full Range support
    const downloaded = await fetchOrGetVideo(req.params.id, customUrl);
    if (downloaded && fs.existsSync(downloaded)) {
      return res.sendFile(downloaded, { acceptRanges: true });
    }

    return res.status(502).json({ error: '動画を取得できませんでした' });
  });

  // Freemake-style Real yt-dlp + ffmpeg Inspector & Job Downloader
  interface DownloadJob {
    id: string;
    url: string;
    title: string;
    format: string;
    quality: string;
    status: 'preparing' | 'downloading' | 'converting' | 'done' | 'error' | 'cancelled';
    percent: number;
    totalSize: string;
    speed: string;
    eta: string;
    stage: string;
    filePath?: string;
    fileName?: string;
    fileSize?: number;
    error?: string;
    process?: ChildProcess;
    createdAt: number;
  }

  const downloadJobs = new Map<string, DownloadJob>();

  // Periodic cleanup of completed/stale jobs older than 1 hour
  setInterval(() => {
    const cutoff = Date.now() - 1000 * 60 * 60;
    for (const [jobId, job] of downloadJobs.entries()) {
      if (job.createdAt < cutoff) {
        if (job.filePath && fs.existsSync(job.filePath)) {
          try { fs.unlinkSync(job.filePath); } catch {}
        }
        downloadJobs.delete(jobId);
      }
    }
  }, 1000 * 60 * 10);

  // Inspect any video URL with yt-dlp -J
  app.post('/api/dl/inspect', async (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: '動画URLを入力してください。' });
    }

    let targetUrl = '';
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: '有効なURL（http:// または https://、または sm番号）を入力してください。' });
    }

    try {
      const ytDlpBin = await ensureYtDlp();
      const rawJson = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        const proc = spawn(ytDlpBin, [
          '-J',
          '--no-playlist',
          '--no-warnings',
          targetUrl
        ]);
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error('動画情報の解析がタイムアウトしました。'));
        }, 35000);
        proc.stdout.on('data', (d) => chunks.push(d));
        proc.stderr.on('data', (d) => errChunks.push(d));
        proc.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve(Buffer.concat(chunks).toString('utf8'));
          } else {
            const errStr = Buffer.concat(errChunks).toString('utf8');
            reject(new Error(errStr.slice(0, 300) || `yt-dlp exited with code ${code}`));
          }
        });
        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      const info = JSON.parse(rawJson);
      const entry = Array.isArray(info.entries) && info.entries.length > 0 ? info.entries[0] : info;
      const formats = Array.isArray(entry.formats) ? entry.formats : [];
      const durSec = Number(entry.duration || 0);

      const estimateBytes = (f: any): number => {
        if (!f) return 0;
        if (f.filesize) return Number(f.filesize);
        if (f.filesize_approx) return Number(f.filesize_approx);
        const kbps = Number(f.tbr || f.vbr || f.abr || 0);
        if (kbps > 0 && durSec > 0) {
          return Math.round((kbps * 1000 * durSec) / 8);
        }
        return 0;
      };

      const bestAudio = formats
        .filter((f: any) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
        .sort((a: any, b: any) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
      const audioBytes = estimateBytes(bestAudio);

      const heightMap = new Map<number, number>();
      for (const f of formats) {
        if (f.height && f.vcodec && f.vcodec !== 'none') {
          const h = Number(f.height);
          const sz = estimateBytes(f);
          const prev = heightMap.get(h) || 0;
          if (sz > prev || !heightMap.has(h)) {
            heightMap.set(h, sz);
          }
        }
      }

      const sortedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);
      const heightLabel = (h: number) => {
        if (h >= 2160) return `4K Ultra HD (${h}p)`;
        if (h >= 1440) return `2K QHD (${h}p)`;
        if (h >= 1080) return `Full HD (${h}p)`;
        if (h >= 720) return `HD (${h}p)`;
        if (h >= 480) return `標準 (${h}p)`;
        return `軽量 (${h}p)`;
      };

      const qualities = sortedHeights.length > 0
        ? sortedHeights.map((h) => {
            const vBytes = heightMap.get(h) || 0;
            const totalBytes = vBytes > 0 ? vBytes + audioBytes : 0;
            return {
              value: String(h),
              label: heightLabel(h),
              sizeMb: totalBytes > 0 ? Number((totalBytes / (1024 * 1024)).toFixed(1)) : null
            };
          })
        : [
            { value: '1080', label: 'Full HD (1080p)', sizeMb: null },
            { value: '720', label: 'HD (720p)', sizeMb: null },
            { value: '480', label: '標準 (480p)', sizeMb: null },
            { value: '360', label: '軽量 (360p)', sizeMb: null }
          ];

      const mins = Math.floor(durSec / 60);
      const secs = Math.floor(durSec % 60);

      return res.json({
        ok: true,
        info: {
          id: sanitizeId(entry.id || entry.display_id || 'video'),
          rawId: String(entry.id || entry.display_id || ''),
          title: String(entry.title || '無題の動画'),
          uploader: String(entry.uploader || entry.channel || entry.extractor_key || '動画サイト'),
          extractor: String(entry.extractor_key || entry.extractor || 'Web'),
          thumbnail: String(entry.thumbnail || ''),
          duration: durSec,
          durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : '--:--'),
          webpageUrl: String(entry.webpage_url || targetUrl),
          qualities,
          audioSizeMb: audioBytes > 0 ? Number((audioBytes / (1024 * 1024)).toFixed(1)) : null
        }
      });
    } catch (err: any) {
      console.error('/api/dl/inspect error:', err);
      return res.status(502).json({
        ok: false,
        error: err?.message || '動画情報の取得に失敗しました。URLをご確認のうえ再度お試しください。'
      });
    }
  });

  // Start real yt-dlp + ffmpeg download job
  app.post('/api/dl/start', async (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    const format = String(req.body?.format || 'mp4').toLowerCase();
    const quality = String(req.body?.quality || '720');
    const title = String(req.body?.title || 'video').trim();

    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: 'URLが指定されていません。' });
    }

    let targetUrl = '';
    try {
      targetUrl = normalizeTargetUrl(rawUrl, req.body?.platform);
    } catch {
      return res.status(400).json({ ok: false, error: '無効なURLです。' });
    }

    const allowedFormats = new Set(['mp4', 'mp3', 'webm', 'mkv', 'avi', 'iphone', 'android']);
    const safeFormat = allowedFormats.has(format) ? format : 'mp4';
    const ext = safeFormat === 'iphone' || safeFormat === 'android' ? 'mp4' : safeFormat;
    const jobId = crypto.randomBytes(8).toString('hex');

    const dlDir = path.resolve('/tmp/muratube_downloads');
    if (!fs.existsSync(dlDir)) {
      fs.mkdirSync(dlDir, { recursive: true });
    }

    const outTemplate = path.join(dlDir, `${jobId}.%(ext)s`);
    const safeTitle = title.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || 'video';
    const downloadFileName = safeFormat === 'mp3'
      ? `${safeTitle}.mp3`
      : `${safeTitle}_${quality}p.${ext}`;

    const job: DownloadJob = {
      id: jobId,
      url: targetUrl,
      title: safeTitle,
      format: safeFormat,
      quality,
      status: 'preparing',
      percent: 0,
      totalSize: '',
      speed: '',
      eta: '',
      stage: 'yt-dlp を準備中...',
      fileName: downloadFileName,
      createdAt: Date.now()
    };
    downloadJobs.set(jobId, job);

    // Run asynchronously
    (async () => {
      try {
        const ytDlpBin = await ensureYtDlp();
        const args = buildDownloadArgs(targetUrl, safeFormat, quality, outTemplate);
        job.stage = '動画ストリームを取得中...';
        job.status = 'downloading';

        const child = spawn(ytDlpBin, args);
        job.process = child;

        const handleOutputLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          const dlMatch = trimmed.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([^\s]+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/);
          if (dlMatch) {
            const pct = Math.min(94, Math.max(job.percent, Math.round(parseFloat(dlMatch[1]))));
            job.status = 'downloading';
            job.percent = pct;
            job.totalSize = dlMatch[2] || job.totalSize;
            job.speed = dlMatch[3] || job.speed;
            job.eta = dlMatch[4] || '';
            job.stage = '動画・音声をダウンロード中...';
          } else if (trimmed.includes('[Merger]') || trimmed.includes('[ExtractAudio]') || trimmed.includes('[VideoConvertor]') || trimmed.includes('[ffmpeg]')) {
            job.status = 'converting';
            job.percent = Math.max(job.percent, 95);
            job.stage = safeFormat === 'mp3'
              ? 'MP3音声を抽出中 (ffmpeg)...'
              : `${ext.toUpperCase()}形式へ変換・結合中 (ffmpeg)...`;
          }
        };

        let stdoutBuf = '';
        child.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString('utf8');
          const lines = stdoutBuf.split(/\r?\n|\r/);
          stdoutBuf = lines.pop() || '';
          lines.forEach(handleOutputLine);
        });

        let stderrText = '';
        child.stderr.on('data', (chunk) => {
          const txt = chunk.toString('utf8');
          stderrText += txt;
          txt.split(/\r?\n|\r/).forEach(handleOutputLine);
        });

        child.on('close', (code) => {
          job.process = undefined;
          if (job.status === 'cancelled') {
            const files = fs.readdirSync(dlDir).filter((f) => f.startsWith(`${jobId}.`));
            files.forEach((f) => { try { fs.unlinkSync(path.join(dlDir, f)); } catch {} });
            return;
          }

          const files = fs.readdirSync(dlDir).filter((f) => f.startsWith(`${jobId}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
          const preferred = files.find((f) => f.endsWith(`.${ext}`)) || files[0];

          if (code === 0 && preferred) {
            const fullPath = path.join(dlDir, preferred);
            const stat = fs.statSync(fullPath);
            job.filePath = fullPath;
            job.fileSize = stat.size;
            job.percent = 100;
            job.status = 'done';
            job.stage = '完了！端末へ保存できます';
          } else {
            job.status = 'error';
            job.error = stderrText.trim().slice(-240) || `ダウンロードに失敗しました (code ${code})`;
            job.stage = 'エラーが発生しました';
          }
        });

        child.on('error', (err) => {
          job.process = undefined;
          job.status = 'error';
          job.error = err.message;
          job.stage = '実行エラー';
        });
      } catch (err: any) {
        job.status = 'error';
        job.error = err?.message || 'ダウンロードを開始できませんでした';
        job.stage = 'エラー';
      }
    })();

    return res.json({ ok: true, jobId });
  });

  app.get('/api/dl/progress/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'ジョブが見つかりません。' });
    }
    return res.json({
      ok: true,
      id: job.id,
      status: job.status,
      percent: job.percent,
      totalSize: job.totalSize,
      speed: job.speed,
      eta: job.eta,
      stage: job.stage,
      fileName: job.fileName,
      fileSize: job.fileSize,
      error: job.error
    });
  });

  app.get('/api/dl/file/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job || job.status !== 'done' || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(404).json({ ok: false, error: 'ファイルがまだ準備できていません。' });
    }
    const filename = job.fileName || path.basename(job.filePath);
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_') || 'download';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    return res.sendFile(job.filePath);
  });

  app.post('/api/dl/cancel/:jobId', (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) {
      return res.json({ ok: true });
    }
    job.status = 'cancelled';
    if (job.process) {
      try {
        job.process.kill('SIGTERM');
      } catch {}
    }
    return res.json({ ok: true });
  });

  const deleteDownloadJobHandler = (req: express.Request, res: express.Response) => {
    const jobId = sanitizeId(req.params.jobId);
    const job = downloadJobs.get(jobId);
    if (job) {
      job.status = 'cancelled';
      if (job.process) {
        try {
          job.process.kill('SIGTERM');
        } catch {}
      }
      if (job.filePath && fs.existsSync(job.filePath)) {
        try {
          fs.unlinkSync(job.filePath);
        } catch {}
      }
      downloadJobs.delete(jobId);
    }
    const dlDir = path.resolve('/tmp/muratube_downloads');
    if (fs.existsSync(dlDir)) {
      try {
        const files = fs.readdirSync(dlDir).filter((f) => f.startsWith(`${jobId}.`));
        files.forEach((f) => {
          try {
            fs.unlinkSync(path.join(dlDir, f));
          } catch {}
        });
      } catch {}
    }
    return res.json({ ok: true, deleted: true, jobId });
  };

  app.delete('/api/dl/job/:jobId', deleteDownloadJobHandler);
  app.post('/api/dl/delete/:jobId', deleteDownloadJobHandler);

  // Real yt-dlp Video and Audio Downloader Endpoint (direct URL compatibility)
  app.get('/api/download/:id', async (req, res) => {
    const safeId = sanitizeId(req.params.id);
    const quality = (req.query.quality as string) || '720';
    const rawType = String(req.query.type || 'mp4').toLowerCase();
    const allowedFormats = new Set(['mp4', 'mp3', 'webm', 'mkv', 'avi', 'iphone', 'android']);
    const type = allowedFormats.has(rawType) ? rawType : 'mp4';
    const ext = type === 'iphone' || type === 'android' ? 'mp4' : type;

    const customUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let targetUrl = '';
    try {
      targetUrl = customUrl
        ? normalizeTargetUrl(customUrl, req.query.platform as string)
        : normalizeTargetUrl(req.params.id, req.query.platform as string);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const dlDir = path.resolve('/tmp/muratube_downloads');
    if (!fs.existsSync(dlDir)) {
      fs.mkdirSync(dlDir, { recursive: true });
    }

    const outTemplate = path.join(dlDir, `${safeId}_${quality}_${type}.%(ext)s`);
    const expectedFile = path.join(dlDir, `${safeId}_${quality}_${type}.${ext}`);

    if (fs.existsSync(expectedFile)) {
      return res.download(expectedFile, `[muraにこ]_${safeId}.${ext}`);
    }

    try {
      const ytDlpBin = await ensureYtDlp();
      const args = buildDownloadArgs(targetUrl, type, quality, outTemplate);
      const child = spawn(ytDlpBin, args);
      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(expectedFile)) {
          return res.download(expectedFile, `[muraにこ]_${safeId}_${quality}p.${ext}`);
        }
        const files = fs.readdirSync(dlDir);
        const found = files.find((f) => f.startsWith(`${safeId}_${quality}_${type}`) && !f.endsWith('.part'));
        if (found) {
          return res.download(path.join(dlDir, found), `[muraにこ]_${found}`);
        }
        if (!res.headersSent) {
          return res.status(500).json({ error: `yt-dlp download failed (code ${code})` });
        }
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Fallback video catalog when upstream Muratube server returns 502
  const FALLBACK_VIDEOS = [
    {
      id: 'sm40320938',
      title: '【最高画質/最高音質】Official髭男dism - ミックスナッツ MV',
      channel: 'Official髭男dism',
      channel_url: 'https://www.nicovideo.jp/watch/sm40320938',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/40320938/40320938',
      duration: '03:49',
      views: 4829100,
      url: 'https://www.nicovideo.jp/watch/sm40320938',
      platform: 'niconico',
      category: '音楽',
      description: 'TVアニメ『SPY×FAMILY』オープニング主題歌 Official髭男dism - ミックスナッツ MV',
      uploadedAt: '2022/04/15',
      likeCount: 129400,
      commentCount: 8420,
      subscribers: 450000,
      nicoId: 'sm40320938'
    },
    {
      id: 'sm9',
      title: '新・豪血寺一族 -煩悩解放 - レッツゴー！陰陽師',
      channel: '中の',
      channel_url: 'https://www.nicovideo.jp/user/4',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/9/9',
      duration: '05:20',
      views: 23104343,
      url: 'https://www.nicovideo.jp/watch/sm9',
      platform: 'niconico',
      category: '音楽',
      description: 'レッツゴー！陰陽師（フルコーラスバージョン）',
      uploadedAt: '2007/03/06',
      likeCount: 183219,
      commentCount: 5120000,
      subscribers: 197823,
      nicoId: 'sm9'
    },
    {
      id: 'sm1097445',
      title: '【初音ミク】みくみくにしてあげる♪【してやんよ】',
      channel: 'ika',
      channel_url: 'https://www.nicovideo.jp/user/70391',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/1097445/1097445',
      duration: '01:39',
      views: 17322896,
      url: 'https://www.nicovideo.jp/watch/sm1097445',
      platform: 'niconico',
      category: '音楽',
      description: 'おまえら、みっくみくにしてやんよ。',
      uploadedAt: '2007/09/20',
      likeCount: 231390,
      commentCount: 3420000,
      subscribers: 101379,
      nicoId: 'sm1097445'
    },
    {
      id: 'sm1715919',
      title: '初音ミク　が　オリジナル曲を歌ってくれたよ「メルト」',
      channel: 'ryo',
      channel_url: 'https://www.nicovideo.jp/user/317063',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/1715919/1715919',
      duration: '04:16',
      views: 17191729,
      url: 'https://www.nicovideo.jp/watch/sm1715919',
      platform: 'niconico',
      category: '音楽',
      description: '恋と戦争においてはあらゆる戦術が許される',
      uploadedAt: '2007/12/07',
      likeCount: 311258,
      commentCount: 2840000,
      subscribers: 109990,
      nicoId: 'sm1715919'
    },
    {
      id: 'sm15630734',
      title: '『初音ミク』千本桜『オリジナル曲PV』',
      channel: '黒うさ',
      channel_url: 'https://www.nicovideo.jp/user/449061',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/15630734/15630734.34480305',
      duration: '04:04',
      views: 18769865,
      url: 'https://www.nicovideo.jp/watch/sm15630734',
      platform: 'niconico',
      category: '音楽',
      description: '千本桜 夜ニ紛レ 君ノ声モ届カナイヨ',
      uploadedAt: '2011/09/17',
      likeCount: 333674,
      commentCount: 2190000,
      subscribers: 450574,
      nicoId: 'sm15630734'
    },
    {
      id: 'sm8628149',
      title: '【東方】Bad Apple!!　ＰＶ【影絵】',
      channel: 'あにら',
      channel_url: 'https://www.nicovideo.jp/user/10731211',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/8628149/8628149',
      duration: '03:39',
      views: 31445518,
      url: 'https://www.nicovideo.jp/watch/sm8628149',
      platform: 'niconico',
      category: '東方',
      description: 'Bad Apple!! feat. nomico 影絵PV',
      uploadedAt: '2009/10/27',
      likeCount: 674218,
      commentCount: 3950000,
      subscribers: 347089,
      nicoId: 'sm8628149'
    },
    {
      id: 'sm2057168',
      title: 'M.C.ドナルドはダンスに夢中なのか？最終鬼畜道化師ドナルド・Ｍ',
      channel: 'みくる',
      channel_url: 'https://www.nicovideo.jp/user/921777',
      channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: 'https://nicovideo.cdn.nimg.jp/thumbnails/2057168/2057168',
      duration: '03:19',
      views: 15420000,
      url: 'https://www.nicovideo.jp/watch/sm2057168',
      platform: 'niconico',
      category: 'MAD',
      description: 'らんらんるー！',
      uploadedAt: '2008/01/16',
      likeCount: 198000,
      commentCount: 1800000,
      subscribers: 89000,
      nicoId: 'sm2057168'
    }
  ];

  // 4. Dedicated Self-Contained Search & Ranking APIs (Niconico)
  const NICO_API_HEADERS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'X-Frontend-Id': '6',
    'X-Frontend-Version': '0',
    'Referer': 'https://www.nicovideo.jp/',
    'Origin': 'https://www.nicovideo.jp'
  };

  const watchV3Cache = new Map<string, { data: any; timestamp: number }>();

  async function fetchNicoWatchV3Guest(id: string): Promise<any | null> {
    const cleanId = sanitizeId(id);
    const cached = watchV3Cache.get(cleanId);
    if (cached && Date.now() - cached.timestamp < 1000 * 60 * 5) {
      return cached.data;
    }
    const trackId = `${crypto.randomBytes(5).toString('hex')}_${Date.now()}`;
    try {
      const resp = await fetch(
        `https://www.nicovideo.jp/api/watch/v3_guest/${encodeURIComponent(cleanId)}?actionTrackId=${encodeURIComponent(trackId)}`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6000) }
      );
      if (!resp.ok) return null;
      const json = await resp.json();
      if (json?.meta?.status === 200 && json?.data) {
        watchV3Cache.set(cleanId, { data: json.data, timestamp: Date.now() });
        return json.data;
      }
    } catch (err) {
      console.warn('watch/v3_guest error:', err);
    }
    return null;
  }

  function decodeXmlEntities(str: string): string {
    return String(str || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function stripHtmlTags(str: string): string {
    return decodeXmlEntities(String(str || ''))
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  function extractXmlTag(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? decodeXmlEntities(m[1].trim()) : '';
  }

  function mapNvapiEssentialToVideo(raw: any) {
    const ess = raw?.essential || raw?.content || raw || {};
    const id = String(ess.id || '');
    const owner = ess.owner || {};
    const ownerId = owner.id ? String(owner.id) : '';
    const isChannel = owner.ownerType === 'channel' || ess.isChannelVideo;
    const thumbObj = ess.thumbnail || {};
    const thumb = thumbObj.nHdUrl || thumbObj.largeUrl || thumbObj.middleUrl || thumbObj.url ||
      `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, '')}/${id.replace(/\D/g, '')}`;
    const registeredAt = ess.registeredAt
      ? String(ess.registeredAt).slice(0, 10).replace(/-/g, '/')
      : '2026/01/01';
    return {
      id,
      nicoId: id,
      title: String(ess.title || `動画 ${id}`),
      channel: String(owner.name || 'ニコニコ動画'),
      userId: !isChannel ? ownerId : undefined,
      channelId: isChannel ? ownerId : undefined,
      channel_url: ownerId
        ? (isChannel ? `https://ch.nicovideo.jp/${ownerId.startsWith('ch') ? ownerId : `ch${ownerId}`}` : `https://www.nicovideo.jp/user/${ownerId}`)
        : '',
      channelAvatar: owner.iconUrl || 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
      thumbnail: thumb,
      duration: formatSecToDuration(Number(ess.duration || 0)),
      views: Number(ess.count?.view || 0),
      commentCount: Number(ess.count?.comment || 0),
      mylistCount: Number(ess.count?.mylist || 0),
      likeCount: Number(ess.count?.like || 0),
      url: `https://www.nicovideo.jp/watch/${id}`,
      platform: 'niconico' as const,
      category: '総合',
      description: String(ess.shortDescription || ''),
      uploadedAt: registeredAt,
      subscribers: 0
    };
  }

  const NICO_COLOR_MAP: Record<string, string> = {
    white: '#ffffff',
    red: '#ff3333',
    pink: '#ff8080',
    orange: '#ffc000',
    yellow: '#ffff00',
    green: '#00ff00',
    cyan: '#00ffff',
    blue: '#3399ff',
    purple: '#cc66ff',
    black: '#333333',
    white2: '#cccc99',
    niconicowhite: '#cccc99',
    red2: '#cc0033',
    truered: '#cc0033',
    pink2: '#ff33cc',
    orange2: '#ff6600',
    passionorange: '#ff6600',
    yellow2: '#999900',
    madyellow: '#999900',
    green2: '#00cc66',
    elementalgreen: '#00cc66',
    cyan2: '#00cccc',
    blue2: '#3399ff',
    marineblue: '#3399ff',
    purple2: '#6633cc',
    nobleviolet: '#6633cc',
    black2: '#666666'
  };

  function parseNicoCommands(commands: string[] = []): { color: string; position: 'ue' | 'shita' | 'naka'; size: 'big' | 'small' | 'medium' } {
    let color = '#ffffff';
    let position: 'ue' | 'shita' | 'naka' = 'naka';
    let size: 'big' | 'small' | 'medium' = 'medium';
    for (const cmd of commands) {
      const lower = String(cmd || '').toLowerCase();
      if (lower === 'ue') position = 'ue';
      else if (lower === 'shita') position = 'shita';
      else if (lower === 'big') size = 'big';
      else if (lower === 'small') size = 'small';
      else if (/^#[0-9a-f]{6}$/i.test(lower)) color = lower;
      else if (NICO_COLOR_MAP[lower]) color = NICO_COLOR_MAP[lower];
    }
    return { color, position, size };
  }

  app.get('/api/nico/search', async (req, res) => {
    const q = ((req.query.q as string) || '').trim();
    const sort = ((req.query.sort as string) || 'v').trim();
    const order = ((req.query.order as string) || 'd').trim();
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);

    try {
      const result = await searchNiconicoSnapshot({ q, sort, order, page, limit: 20 });
      if (result.items.length > 0) {
        return res.json({ success: true, items: result.items, total: result.total, hasNext: result.hasNext });
      }
    } catch (err) {
      console.warn('/api/nico/search snapshot error:', err);
    }

    // Secondary live search via nvapi.nicovideo.jp/v2/search/video
    if (q) {
      try {
        const sortKeyMap: Record<string, string> = { v: 'viewCount', f: 'registeredAt', r: 'commentCount', m: 'mylistCount', l: 'likeCount' };
        const sortKey = sortKeyMap[sort] || 'viewCount';
        const nvResp = await fetch(
          `https://nvapi.nicovideo.jp/v2/search/video?keyword=${encodeURIComponent(q)}&sortKey=${sortKey}&sortOrder=${order === 'a' ? 'asc' : 'desc'}&pageSize=20&page=${page}`,
          { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6000) }
        );
        if (nvResp.ok) {
          const nvJson = await nvResp.json();
          const items = (nvJson?.data?.items || []).map(mapNvapiEssentialToVideo);
          if (items.length > 0) {
            return res.json({
              success: true,
              items,
              total: Number(nvJson?.data?.totalCount || items.length),
              hasNext: Boolean(nvJson?.data?.hasNext)
            });
          }
        }
      } catch (err) {
        console.warn('/api/nico/search nvapi fallback error:', err);
      }
    }

    const qLower = q.toLowerCase();
    const filtered = FALLBACK_VIDEOS.filter(v =>
      !qLower ||
      v.title.toLowerCase().includes(qLower) ||
      v.id.toLowerCase().includes(qLower) ||
      v.channel.toLowerCase().includes(qLower) ||
      v.description.toLowerCase().includes(qLower)
    );
    return res.json({ success: true, items: filtered, total: filtered.length, hasNext: false });
  });

  app.get('/api/nico/ranking', async (req, res) => {
    const genre = ((req.query.genre as string) || 'all').trim();
    const termRaw = ((req.query.term as string) || '24h').trim();
    const validTerms = ['hour', '24h', 'week', 'month', 'total'];
    const term = validTerms.includes(termRaw) ? termRaw : '24h';

    // Official nvapi genre ranking (returns real owner names, avatars, counts)
    const nvapiGenreMap: Record<string, string> = {
      all: 'all',
      game: 'game',
      anime: 'anime',
      music_sound: 'music_sound',
      entertainment: 'entertainment',
      dance: 'dance'
    };

    if (nvapiGenreMap[genre]) {
      try {
        const resp = await fetch(
          `https://nvapi.nicovideo.jp/v1/ranking/genre/${encodeURIComponent(nvapiGenreMap[genre])}?term=${encodeURIComponent(term)}`,
          { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6000) }
        );
        if (resp.ok) {
          const json = await resp.json();
          const items = (json?.data?.items || []).slice(0, 24).map(mapNvapiEssentialToVideo);
          if (items.length > 0) {
            return res.json({ success: true, items, total: items.length, source: 'nvapi', term });
          }
        }
      } catch (err) {
        console.warn('/api/nico/ranking nvapi error:', err);
      }
    }

    const termDaysMap: Record<string, number> = { hour: 1, '24h': 1, week: 7, month: 30, total: 0 };
    try {
      const result = await searchNiconicoSnapshot({
        q: '',
        sort: 'v',
        order: 'd',
        page: 1,
        limit: 24,
        genre,
        recentDays: termDaysMap[term] ?? 7
      });
      if (result.items.length > 0) {
        return res.json({ success: true, items: result.items, total: result.items.length, source: 'snapshot', term });
      }
      const wider = await searchNiconicoSnapshot({ q: '', sort: 'v', order: 'd', page: 1, limit: 24, genre });
      if (wider.items.length > 0) {
        return res.json({ success: true, items: wider.items, total: wider.items.length, source: 'snapshot', term });
      }
    } catch (err) {
      console.warn('/api/nico/ranking snapshot error:', err);
    }

    return res.json({ success: true, items: FALLBACK_VIDEOS, total: FALLBACK_VIDEOS.length });
  });

  app.get('/api/nico/comments/:id', async (req, res) => {
    const id = sanitizeId(req.params.id);

    // Primary: official watch/v3_guest -> nvcomment.nicovideo.jp/v1/threads (no login required)
    try {
      const v3 = await fetchNicoWatchV3Guest(id);
      const nvc = v3?.comment?.nvComment;
      if (nvc?.server && nvc?.threadKey && nvc?.params) {
        const cResp = await fetch(`${nvc.server}/v1/threads`, {
          method: 'POST',
          headers: {
            ...NICO_API_HEADERS,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            params: nvc.params,
            threadKey: nvc.threadKey,
            additionals: {}
          }),
          signal: AbortSignal.timeout(6000)
        });
        if (cResp.ok) {
          const cJson = await cResp.json();
          const threads: any[] = Array.isArray(cJson?.data?.threads) ? cJson.data.threads : [];
          const rawComments: any[] = [];
          for (const th of threads) {
            if (Array.isArray(th.comments)) {
              for (const c of th.comments) {
                if (typeof c.score === 'number' && c.score <= -10000) continue; // filter extreme NG spam
                if (!c.body) continue;
                rawComments.push(c);
              }
            }
          }
          if (rawComments.length > 0) {
            rawComments.sort((a, b) => Number(a.vposMs || 0) - Number(b.vposMs || 0));
            const seen = new Set<string>();
            const comments = [];
            for (const c of rawComments) {
              const cid = String(c.id || `${c.vposMs}-${c.body}`);
              if (seen.has(cid)) continue;
              seen.add(cid);
              const parsedCmd = parseNicoCommands(Array.isArray(c.commands) ? c.commands : []);
              comments.push({
                id: cid,
                text: String(c.body),
                timeMs: Number(c.vposMs || 0),
                commands: Array.isArray(c.commands) ? c.commands : [],
                color: parsedCmd.color,
                position: parsedCmd.position,
                size: parsedCmd.size,
                postedAt: c.postedAt || '',
                score: Number(c.score || 0),
                nicoruCount: Number(c.nicoruCount || 0)
              });
              if (comments.length >= 250) break;
            }
            return res.json({ success: true, source: 'nvcomment', count: comments.length, comments });
          }
        }
      }
    } catch (err) {
      console.warn('/api/nico/comments nvcomment error:', err);
    }

    const sampleComments = [
      'うぽつ！', '8888888888888888', '神曲きたああああああ', 'ここすき', '鳥肌立ったわ',
      '天才かよ', 'なつかしいww', '草', 'wwwwwwwwwwww', '最高すぎる',
      '音質よすぎ', '何回聴いても飽きない', '歌詞が刺さる', 'うぽつです！！', '弾幕薄いぞ何やってんの！'
    ];
    const comments = sampleComments.map((text, idx) => ({
      id: `fallback-comment-${idx}`,
      text,
      timeMs: idx * 2500,
      commands: [],
      color: '#ffffff',
      position: 'naka' as const,
      size: 'medium' as const
    }));
    return res.json({ success: true, source: 'fallback', count: comments.length, comments });
  });

  app.get('/api/nico/video/:id', async (req, res) => {
    const id = sanitizeId(req.params.id);

    // 1. Official watch/v3_guest (title, description, owner, tags, counts, series)
    try {
      const d = await fetchNicoWatchV3Guest(id);
      if (d?.video) {
        const v = d.video;
        const owner = d.owner;
        const ch = d.channel;
        const isChannel = Boolean(ch && !owner);
        const ownerId = owner?.id ? String(owner.id) : ch?.id ? String(ch.id) : '';
        const thumb = v.thumbnail?.ogp || v.thumbnail?.player || v.thumbnail?.largeUrl || v.thumbnail?.url ||
          `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, '')}/${id.replace(/\D/g, '')}`;
        const video = {
          id,
          nicoId: id,
          title: String(v.title || `動画 ${id}`),
          channel: String(owner?.nickname || ch?.name || 'ニコニコ動画'),
          userId: !isChannel && ownerId ? ownerId : undefined,
          channelId: isChannel && ownerId ? ownerId : undefined,
          channel_url: ownerId
            ? (isChannel ? `https://ch.nicovideo.jp/${ownerId}` : `https://www.nicovideo.jp/user/${ownerId}`)
            : '',
          channelAvatar: owner?.iconUrl || ch?.thumbnail?.url || 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
          thumbnail: thumb,
          duration: formatSecToDuration(Number(v.duration || 0)),
          views: Number(v.count?.view || 0),
          commentCount: Number(v.count?.comment || 0),
          mylistCount: Number(v.count?.mylist || 0),
          likeCount: Number(v.count?.like || 0),
          url: `https://www.nicovideo.jp/watch/${id}`,
          platform: 'niconico' as const,
          category: String(d.genre?.label || '総合'),
          description: stripHtmlTags(v.description || ''),
          uploadedAt: v.registeredAt ? String(v.registeredAt).slice(0, 10).replace(/-/g, '/') : '2026/01/01',
          tags: Array.isArray(d.tag?.items) ? d.tag.items.map((t: any) => ({ name: String(t.name), isLocked: Boolean(t.isLocked) })) : [],
          series: d.series ? { id: Number(d.series.id), title: String(d.series.title) } : null,
          subscribers: 0
        };
        return res.json({ success: true, source: 'v3_guest', video });
      }
    } catch (err) {
      console.warn('/api/nico/video v3_guest error:', err);
    }

    // 2. Legacy getthumbinfo XML API
    try {
      const xmlResp = await fetch(`https://ext.nicovideo.jp/api/getthumbinfo/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (xmlResp.ok) {
        const xml = await xmlResp.text();
        if (xml.includes('<nicovideo_thumb_response status="ok">')) {
          const title = extractXmlTag(xml, 'title');
          const description = extractXmlTag(xml, 'description');
          const thumbnail = extractXmlTag(xml, 'thumbnail_url');
          const lengthStr = extractXmlTag(xml, 'length');
          const viewCounter = parseInt(extractXmlTag(xml, 'view_counter') || '0', 10);
          const commentNum = parseInt(extractXmlTag(xml, 'comment_num') || '0', 10);
          const mylistCounter = parseInt(extractXmlTag(xml, 'mylist_counter') || '0', 10);
          const userId = extractXmlTag(xml, 'user_id');
          const userNickname = extractXmlTag(xml, 'user_nickname') || extractXmlTag(xml, 'ch_name') || 'ニコニコ動画';
          const userIcon = extractXmlTag(xml, 'user_icon_url') || 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg';
          const firstRetrieve = extractXmlTag(xml, 'first_retrieve').slice(0, 10).replace(/-/g, '/') || '2026/01/01';
          const tagMatches = Array.from(xml.matchAll(/<tag[^>]*>([\s\S]*?)<\/tag>/gi)).map((m) => ({
            name: decodeXmlEntities(m[1].trim()),
            isLocked: m[0].includes('lock="1"')
          }));
          return res.json({
            success: true,
            source: 'getthumbinfo',
            video: {
              id,
              nicoId: id,
              title: title || `動画 ${id}`,
              channel: userNickname,
              userId: userId || undefined,
              channel_url: userId ? `https://www.nicovideo.jp/user/${userId}` : '',
              channelAvatar: userIcon,
              thumbnail: thumbnail || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, '')}/${id.replace(/\D/g, '')}`,
              duration: lengthStr || '04:00',
              views: viewCounter,
              commentCount: commentNum,
              mylistCount: mylistCounter,
              likeCount: 0,
              url: `https://www.nicovideo.jp/watch/${id}`,
              platform: 'niconico',
              category: '総合',
              description,
              uploadedAt: firstRetrieve,
              tags: tagMatches,
              subscribers: 0
            }
          });
        }
      }
    } catch (err) {
      console.warn('/api/nico/video getthumbinfo error:', err);
    }

    // 3. Fallback to direct yt-dlp metadata extraction
    try {
      const ytDlpBin = await ensureYtDlp();
      const targetUrl = `https://www.nicovideo.jp/watch/${id}`;
      const rawJson = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const proc = spawn(ytDlpBin, ['-J', '--no-playlist', '--no-warnings', targetUrl]);
        const timeout = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('timeout')); }, 15000);
        proc.stdout.on('data', (d) => chunks.push(d));
        proc.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
          else reject(new Error(`yt-dlp code ${code}`));
        });
        proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
      const entry = JSON.parse(rawJson);
      const durSec = Number(entry.duration || 0);
      const video = {
        id,
        title: entry.title || `動画 ${id}`,
        channel: entry.uploader || 'ニコニコ動画',
        channel_url: entry.uploader_url || '',
        channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
        thumbnail: entry.thumbnail || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, '')}/${id.replace(/\D/g, '')}`,
        duration: durSec > 0 ? `${Math.floor(durSec / 60)}:${String(Math.floor(durSec % 60)).padStart(2, '0')}` : '04:00',
        views: Number(entry.view_count || 1000),
        url: targetUrl,
        platform: 'niconico',
        category: '総合',
        description: entry.description || '',
        uploadedAt: '2026/01/01',
        likeCount: Number(entry.like_count || 100),
        commentCount: Number(entry.comment_count || 50),
        subscribers: 0,
        nicoId: id
      };
      return res.json({ success: true, source: 'yt-dlp', video });
    } catch (e: any) {
      return res.status(404).json({ success: false, error: e.message || 'Not found' });
    }
  });

  // Related videos via nvapi recommendation
  app.get('/api/nico/related/:id', async (req, res) => {
    const id = sanitizeId(req.params.id);
    try {
      const resp = await fetch(
        `https://nvapi.nicovideo.jp/v1/recommend?recipeId=video_watch_recommendation&videoId=${encodeURIComponent(id)}&site=nicovideo&_frontendId=6`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) return res.json({ success: false, items: [] });
      const json = await resp.json();
      const items = (json?.data?.items || [])
        .filter((it: any) => it?.contentType === 'video' && it?.content?.id)
        .slice(0, 14)
        .map((it: any) => mapNvapiEssentialToVideo(it.content));
      return res.json({ success: true, items });
    } catch (err) {
      return res.json({ success: false, items: [] });
    }
  });

  // User profile, uploaded videos, mylists, and series via nvapi
  app.get('/api/nico/user/:userId', async (req, res) => {
    const userId = String(req.params.userId || '').replace(/\D/g, '');
    if (!userId) return res.status(400).json({ success: false, error: 'Invalid userId' });
    try {
      const [uRes, vRes, mRes, sRes] = await Promise.all([
        fetch(`https://nvapi.nicovideo.jp/v1/users/${userId}`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) }),
        fetch(`https://nvapi.nicovideo.jp/v3/users/${userId}/videos?sortKey=registeredAt&sortOrder=desc&pageSize=24&page=1`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) }),
        fetch(`https://nvapi.nicovideo.jp/v1/users/${userId}/mylists?sampleItemCount=3`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) }),
        fetch(`https://nvapi.nicovideo.jp/v1/users/${userId}/series?page=1&pageSize=12`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) })
      ]);

      const uJson = uRes.ok ? await uRes.json() : null;
      const vJson = vRes.ok ? await vRes.json() : null;
      const mJson = mRes.ok ? await mRes.json() : null;
      const sJson = sRes.ok ? await sRes.json() : null;

      const userRaw = uJson?.data?.user;
      if (!userRaw) return res.status(404).json({ success: false, error: 'User not found' });

      const user = {
        id: String(userRaw.id),
        nickname: String(userRaw.nickname || `ユーザー ${userId}`),
        description: stripHtmlTags(userRaw.strippedDescription || userRaw.description || ''),
        avatar: userRaw.icons?.large || userRaw.icons?.small || 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
        level: Number(userRaw.userLevel?.currentLevel || 1),
        followerCount: Number(userRaw.followerCount || 0),
        followeeCount: Number(userRaw.followeeCount || 0),
        isPremium: Boolean(userRaw.isPremium)
      };

      const videos = (vJson?.data?.items || []).map(mapNvapiEssentialToVideo);
      const mylists = (mJson?.data?.mylists || []).map((m: any) => ({
        id: String(m.id),
        name: String(m.name),
        description: String(m.description || ''),
        itemsCount: Number(m.itemsCount || 0)
      }));
      const series = (sJson?.data?.items || []).map((s: any) => ({
        id: String(s.id),
        title: String(s.title),
        itemsCount: Number(s.itemsCount || 0),
        thumbnailUrl: s.thumbnailUrl || ''
      }));

      return res.json({
        success: true,
        user,
        totalVideos: Number(vJson?.data?.totalCount || videos.length),
        videos,
        mylists,
        series
      });
    } catch (err: any) {
      return res.status(502).json({ success: false, error: err?.message || 'Failed to fetch user info' });
    }
  });

  // Public mylist items via nvapi
  app.get('/api/nico/mylist/:mylistId', async (req, res) => {
    const mylistId = String(req.params.mylistId || '').replace(/\D/g, '');
    if (!mylistId) return res.status(400).json({ success: false, error: 'Invalid mylistId' });
    try {
      const resp = await fetch(
        `https://nvapi.nicovideo.jp/v2/mylists/${mylistId}?pageSize=30&page=1`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) return res.status(resp.status).json({ success: false, error: 'Mylist fetch failed' });
      const json = await resp.json();
      const ml = json?.data?.mylist;
      const items = (ml?.items || []).map((entry: any) => mapNvapiEssentialToVideo(entry.video));
      return res.json({
        success: true,
        name: String(ml?.name || `マイリスト ${mylistId}`),
        description: String(ml?.description || ''),
        items
      });
    } catch (err: any) {
      return res.status(502).json({ success: false, error: err?.message || 'Failed to fetch mylist' });
    }
  });

  // Content tree (親作品・子作品) via commons.nicovideo.jp
  app.get('/api/nico/tree/:id', async (req, res) => {
    const id = sanitizeId(req.params.id);
    try {
      const resp = await fetch(
        `https://public-api.commons.nicovideo.jp/v1/tree/${encodeURIComponent(id)}/relatives`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) return res.json({ success: false, parents: [], children: [], parentsTotal: 0, childrenTotal: 0 });
      const json = await resp.json();
      const mapItem = (c: any) => {
        const gid = String(c.globalId || c.contentId || '');
        const kind = String(c.contentKind || 'video');
        let url = `https://commons.nicovideo.jp/works/${gid}`;
        if (kind === 'video') url = `https://www.nicovideo.jp/watch/${gid}`;
        else if (kind === 'illust') url = `https://seiga.nicovideo.jp/seiga/${gid}`;
        return { globalId: gid, contentKind: kind, url, created: c.created || '' };
      };
      const parents = (json?.data?.parents?.contents || []).slice(0, 10).map(mapItem);
      const children = (json?.data?.children?.contents || []).slice(0, 10).map(mapItem);
      return res.json({
        success: true,
        parentsTotal: Number(json?.data?.parents?.total || parents.length),
        childrenTotal: Number(json?.data?.children?.total || children.length),
        parents,
        children
      });
    } catch {
      return res.json({ success: false, parents: [], children: [], parentsTotal: 0, childrenTotal: 0 });
    }
  });

  // Live broadcasts via live.nicovideo.jp
  app.get('/api/nico/live', async (req, res) => {
    const sortOrder = String(req.query.sort || 'viewCount');
    try {
      const resp = await fetch(
        `https://live.nicovideo.jp/front/api/pages/recent/v1/programs?offset=0&limit=24&sortOrder=${encodeURIComponent(sortOrder)}`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6000) }
      );
      if (!resp.ok) return res.status(resp.status).json({ success: false, items: [] });
      const json = await resp.json();
      const items = (json?.data || []).map((p: any) => ({
        id: String(p.id),
        title: String(p.title || '生放送'),
        thumbnail: String(p.listingThumbnail || ''),
        url: String(p.watchPageUrl || `https://live.nicovideo.jp/watch/${p.id}`).split('?')[0],
        providerName: String(p.programProvider?.name || '放送主'),
        providerAvatar: String(p.programProvider?.icon || ''),
        watchCount: Number(p.statistics?.watchCount || 0),
        commentCount: Number(p.statistics?.commentCount || 0),
        liveCycle: String(p.liveCycle || 'ON_AIR')
      }));
      return res.json({ success: true, items, total: Number(json?.meta?.totalCount || items.length) });
    } catch (err: any) {
      return res.status(502).json({ success: false, items: [], error: err?.message });
    }
  });

  // Seiga illust info via seiga.nicovideo.jp/api/illust/info
  app.get('/api/nico/seiga/:id', async (req, res) => {
    const raw = String(req.params.id || '').trim();
    const numId = raw.replace(/\D/g, '');
    if (!numId) return res.status(400).json({ success: false, error: 'イラストID (例: im10000000) を指定してください' });
    try {
      const resp = await fetch(`https://seiga.nicovideo.jp/api/illust/info?id=im${numId}`, {
        headers: NICO_API_HEADERS,
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) return res.status(resp.status).json({ success: false, error: '静画情報の取得に失敗しました' });
      const xml = await resp.text();
      if (!xml.includes('<image>')) {
        return res.status(404).json({ success: false, error: '指定した静画が見つかりませんでした' });
      }
      return res.json({
        success: true,
        illust: {
          id: `im${numId}`,
          title: extractXmlTag(xml, 'title') || `im${numId}`,
          description: stripHtmlTags(extractXmlTag(xml, 'description')),
          userId: extractXmlTag(xml, 'user_id'),
          created: extractXmlTag(xml, 'created'),
          viewCount: parseInt(extractXmlTag(xml, 'view_count') || '0', 10),
          commentCount: parseInt(extractXmlTag(xml, 'comment_count') || '0', 10),
          clipCount: parseInt(extractXmlTag(xml, 'clip_count') || '0', 10),
          thumbnailUrl: `https://lohas.nicoseiga.jp/thumb/${numId}i`,
          url: `https://seiga.nicovideo.jp/seiga/im${numId}`
        }
      });
    } catch (err: any) {
      return res.status(502).json({ success: false, error: err?.message || '静画APIエラー' });
    }
  });

  // Nicopedia article summary via dic.nicovideo.jp
  app.get('/api/nico/dic/:word', async (req, res) => {
    const word = String(req.params.word || '').trim();
    if (!word) return res.status(400).json({ success: false, error: '単語を指定してください' });
    try {
      const targetUrl = `https://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
      const resp = await fetch(targetUrl, {
        headers: NICO_API_HEADERS,
        signal: AbortSignal.timeout(6000)
      });
      if (!resp.ok) {
        return res.status(404).json({ success: false, error: `「${word}」の大百科記事が見つかりませんでした`, url: targetUrl });
      }
      const html = await resp.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i) ||
        html.match(/<meta\s+content="([^"]*)"\s+property="og:description"/i);
      const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) ||
        html.match(/<meta\s+content="([^"]*)"\s+name="description"/i);
      const artStart = html.indexOf('id="article"');
      const paragraphs: string[] = [];
      if (artStart !== -1) {
        const artSlice = html.slice(artStart, artStart + 24000)
          .replace(/<div[^>]*class="[^"]*kyujin[^"]*"[\s\S]*?<\/ul>\s*<\/div>/gi, '');
        const pMatches = Array.from(artSlice.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
        for (const pm of pMatches) {
          const clean = stripHtmlTags(pm[1]);
          if (clean.length > 15 && !clean.includes('sponsored by')) paragraphs.push(clean);
          if (paragraphs.length >= 4) break;
        }
      }
      const summary = paragraphs.join('\n\n') || decodeXmlEntities(ogDescMatch?.[1] || descMatch?.[1] || '');
      return res.json({
        success: true,
        word,
        title: decodeXmlEntities((titleMatch?.[1] || word).replace(/\s*とは.*$/, '').trim()),
        summary: summary || '大百科ページで記事本文を確認できます。',
        url: targetUrl
      });
    } catch (err: any) {
      return res.status(502).json({ success: false, error: err?.message || '大百科の取得に失敗しました' });
    }
  });

  // Jikkyo past comment logs via jikkyo.tsukumijima.net
  app.get('/api/nico/jikkyo', async (req, res) => {
    const channel = String(req.query.channel || 'jk1').replace(/[^a-zA-Z0-9_]/g, '') || 'jk1';
    const nowSec = Math.floor(Date.now() / 1000);
    const endtime = parseInt(String(req.query.endtime || nowSec), 10) || nowSec;
    const starttime = parseInt(String(req.query.starttime || (endtime - 600)), 10) || (endtime - 600);
    try {
      const resp = await fetch(
        `https://jikkyo.tsukumijima.net/api/kakolog/${encodeURIComponent(channel)}?starttime=${starttime}&endtime=${endtime}&format=json`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!resp.ok) return res.status(resp.status).json({ success: false, packets: [], error: '実況ログ取得エラー' });
      const json = await resp.json();
      const rawPackets: any[] = Array.isArray(json?.packet) ? json.packet : [];
      const packets = rawPackets.slice(-80).reverse().map((p: any, idx: number) => ({
        id: `${p.chat?.no || idx}-${p.chat?.date || idx}`,
        text: String(p.chat?.content || ''),
        date: Number(p.chat?.date || 0),
        userId: String(p.chat?.user_id || '')
      })).filter((p) => p.text);
      return res.json({ success: true, channel, count: packets.length, packets });
    } catch (err: any) {
      return res.status(502).json({ success: false, packets: [], error: err?.message || '実況ログAPIエラー' });
    }
  });

  // Mount Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile('dist/index.html', { root: '.' });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Muratube proxy server listening on http://0.0.0.0:${PORT} -> ${NODE_SERVER}`);
  });
}

startServer();
