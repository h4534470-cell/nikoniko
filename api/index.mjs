// api-app.ts
import express from "express";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
var NODE_SERVER = process.env.NODE_SERVER || "https://muratube.hospitaldelninodif.gob.mx";
var IS_VERCEL = Boolean(process.env.VERCEL);
var YT_DLP_BIN = path.resolve(IS_VERCEL ? "/tmp/bin/yt-dlp" : "bin/yt-dlp");
var VIDEOS_CACHE_DIR = path.resolve(IS_VERCEL ? "/tmp/videos" : "public/videos");
var ytDlpBootstrapPromise = null;
var cachedHasFfmpeg = null;
function hasFfmpeg() {
  if (cachedHasFfmpeg !== null) return cachedHasFfmpeg;
  try {
    const res = spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 2500 });
    cachedHasFfmpeg = res.status === 0;
  } catch {
    cachedHasFfmpeg = false;
  }
  return cachedHasFfmpeg;
}
async function ensureYtDlp() {
  if (fs.existsSync(YT_DLP_BIN)) {
    try {
      fs.chmodSync(YT_DLP_BIN, 493);
      return YT_DLP_BIN;
    } catch {
    }
  }
  if (ytDlpBootstrapPromise) return ytDlpBootstrapPromise;
  ytDlpBootstrapPromise = (async () => {
    const binDir = path.dirname(YT_DLP_BIN);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }
    const tmpBin = `${YT_DLP_BIN}.downloading`;
    const resp = await fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux", {
      redirect: "follow",
      signal: AbortSignal.timeout(6e4)
    });
    if (!resp.ok) {
      throw new Error(`Failed to download yt-dlp: HTTP ${resp.status}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(tmpBin, buf);
    fs.chmodSync(tmpBin, 493);
    fs.renameSync(tmpBin, YT_DLP_BIN);
    return YT_DLP_BIN;
  })().finally(() => {
    ytDlpBootstrapPromise = null;
  });
  return ytDlpBootstrapPromise;
}
function sanitizeId(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "video";
}
function normalizeTargetUrl(input, platformHint) {
  const trimmed = String(input || "").trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid URL protocol");
    }
    return parsed.toString();
  }
  if (/^(sm|so|nm)\d+$/i.test(trimmed)) {
    return `https://www.nicovideo.jp/watch/${trimmed}`;
  }
  if (/^lv\d+$/i.test(trimmed)) {
    return `https://live.nicovideo.jp/watch/${trimmed}`;
  }
  return `https://www.nicovideo.jp/watch/${encodeURIComponent(trimmed)}`;
}
function buildDownloadArgs(targetUrl, format, quality, outTemplate) {
  const qNum = Math.min(2160, Math.max(144, parseInt(String(quality), 10) || 1080));
  const fmt = (format || "mp4").toLowerCase();
  const ffmpegAvailable = hasFfmpeg();
  if (!ffmpegAvailable) {
    if (fmt === "mp3") {
      return [
        "--no-playlist",
        "--newline",
        "-f",
        "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best",
        targetUrl,
        "-o",
        outTemplate
      ];
    }
    if (fmt === "webm") {
      return [
        "--no-playlist",
        "--newline",
        "-f",
        `best[height<=${qNum}][ext=webm]/best[height<=${qNum}]/best`,
        targetUrl,
        "-o",
        outTemplate
      ];
    }
    return [
      "--no-playlist",
      "--newline",
      "-f",
      `best[height<=${qNum}][ext=mp4]/best[height<=${qNum}]/best`,
      targetUrl,
      "-o",
      outTemplate
    ];
  }
  if (fmt === "mp3") {
    return [
      "--no-playlist",
      "--newline",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      targetUrl,
      "-o",
      outTemplate
    ];
  }
  if (fmt === "webm") {
    return [
      "--no-playlist",
      "--newline",
      "-f",
      `bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
      "--recode-video",
      "webm",
      targetUrl,
      "-o",
      outTemplate
    ];
  }
  if (fmt === "mkv") {
    return [
      "--no-playlist",
      "--newline",
      "-f",
      `bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
      "--merge-output-format",
      "mkv",
      targetUrl,
      "-o",
      outTemplate
    ];
  }
  if (fmt === "avi") {
    return [
      "--no-playlist",
      "--newline",
      "-f",
      `bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
      "--recode-video",
      "avi",
      targetUrl,
      "-o",
      outTemplate
    ];
  }
  return [
    "--no-playlist",
    "--newline",
    "-f",
    `bestvideo[height<=${qNum}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=${qNum}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${qNum}]+bestaudio/best[height<=${qNum}]/best`,
    "--merge-output-format",
    "mp4",
    "--postprocessor-args",
    "Merger+ffmpeg:-movflags +faststart",
    targetUrl,
    "-o",
    outTemplate
  ];
}
function createApiApp() {
  const app2 = express();
  app2.use(express.json());
  app2.use("/videos", express.static(VIDEOS_CACHE_DIR));
  app2.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type,Range,range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range,Content-Length,Accept-Ranges");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  app2.get("/api/health", (_req, res) => {
    return res.json({
      ok: true,
      status: "ok",
      search: "ready",
      ytDlp: fs.existsSync(YT_DLP_BIN),
      ffmpeg: hasFfmpeg(),
      vercel: IS_VERCEL
    });
  });
  function formatSecToDuration(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor(total % 3600 / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  async function searchNiconicoSnapshot(opts) {
    const q = (opts.q || "").trim();
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(50, Math.max(1, opts.limit || 20));
    const offset = (page - 1) * limit;
    const sign = opts.order === "a" ? "+" : "-";
    const sortMap = {
      v: `${sign}viewCounter`,
      f: `${sign}startTime`,
      r: `${sign}commentCounter`,
      m: `${sign}mylistCounter`,
      l: `${sign}likeCounter`
    };
    const sortExpr = sortMap[opts.sort || "v"] || "-viewCounter";
    const params = new URLSearchParams();
    params.set("q", q);
    if (q) {
      params.set("targets", "title,description,tags");
    }
    params.set(
      "fields",
      "contentId,title,userId,channelId,viewCounter,lengthSeconds,thumbnailUrl,startTime,commentCounter,mylistCounter,likeCounter,genre,tags"
    );
    params.set("_sort", sortExpr);
    params.set("_offset", String(offset));
    params.set("_limit", String(limit));
    params.set("_context", "mura-nico-player");
    if (opts.genre && opts.genre !== "all" && opts.genre !== "classics") {
      const genreMap = {
        game: "\u30B2\u30FC\u30E0",
        anime: "\u30A2\u30CB\u30E1",
        music_sound: "\u97F3\u697D\u30FB\u30B5\u30A6\u30F3\u30C9",
        entertainment: "\u30A8\u30F3\u30BF\u30FC\u30C6\u30A4\u30E1\u30F3\u30C8",
        dance: "\u30C0\u30F3\u30B9"
      };
      if (opts.genre === "vocaloid") {
        if (!q) {
          params.set("q", "VOCALOID");
          params.set("targets", "tagsExact");
        }
      } else if (genreMap[opts.genre]) {
        params.set("filters[genre][0]", genreMap[opts.genre]);
      }
    }
    if (opts.recentDays && opts.recentDays > 0) {
      const since = new Date(Date.now() - opts.recentDays * 24 * 60 * 60 * 1e3);
      params.set("filters[startTime][gte]", since.toISOString().slice(0, 19) + "+00:00");
    }
    const url = `https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "mura-nico-player/1.0 (https://nicovideo.jp)",
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(7e3)
    });
    if (!resp.ok) {
      throw new Error(`Niconico Snapshot API HTTP ${resp.status}`);
    }
    const json = await resp.json();
    const totalCount = Number(json?.meta?.totalCount || 0);
    const rows = Array.isArray(json?.data) ? json.data : [];
    const items = rows.map((row) => {
      const id = String(row.contentId || "");
      const uploadedAt = row.startTime ? String(row.startTime).slice(0, 10).replace(/-/g, "/") : "2026/01/01";
      return {
        id,
        title: String(row.title || `\u52D5\u753B ${id}`),
        channel: row.channelId ? `\u516C\u5F0F\u30C1\u30E3\u30F3\u30CD\u30EB (${row.channelId})` : row.userId ? `\u30E6\u30FC\u30B6\u30FC ${row.userId}` : "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B",
        channel_url: row.channelId ? `https://ch.nicovideo.jp/ch${row.channelId}` : row.userId ? `https://www.nicovideo.jp/user/${row.userId}` : "",
        channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
        thumbnail: row.thumbnailUrl || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, "")}/${id.replace(/\D/g, "")}`,
        duration: formatSecToDuration(row.lengthSeconds),
        views: Number(row.viewCounter || 0),
        url: `https://www.nicovideo.jp/watch/${id}`,
        platform: "niconico",
        category: row.genre || "\u7DCF\u5408",
        description: row.tags ? `\u30BF\u30B0: ${row.tags}` : "",
        uploadedAt,
        likeCount: Number(row.likeCounter || 0),
        commentCount: Number(row.commentCounter || 0),
        subscribers: 5e4,
        nicoId: id
      };
    });
    return {
      items,
      total: totalCount || items.length,
      hasNext: offset + items.length < totalCount
    };
  }
  function parseJapaneseCountText(text) {
    const clean = String(text || "").replace(/,/g, "").trim();
    const m = clean.match(/([\d.]+)\s*(億|万|K|M)?/i);
    if (!m) return 0;
    const num = parseFloat(m[1]);
    const unit = (m[2] || "").toUpperCase();
    if (unit === "\u5104") return Math.round(num * 1e8);
    if (unit === "\u4E07") return Math.round(num * 1e4);
    if (unit === "M") return Math.round(num * 1e6);
    if (unit === "K") return Math.round(num * 1e3);
    return Math.round(num);
  }
  const handleMuratubeAction = async (action, req, res) => {
    if (action === "search") {
      const q = String(req.query.q || "").trim();
      const sort = String(req.query.sort || "v");
      const order = String(req.query.order || "d");
      const rawPage = parseInt(String(req.query.page || "1"), 10);
      const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
      try {
        const result = await searchNiconicoSnapshot({ q, sort, order, page, limit: 20 });
        return res.json({
          ok: true,
          success: true,
          platform: "niconico",
          query: q,
          total: result.total,
          hasNext: result.hasNext,
          videos: result.items,
          items: result.items
        });
      } catch (err) {
        return res.status(502).json({ ok: false, success: false, error: err?.message || "Search failed", videos: [], items: [] });
      }
    }
    if (action === "recommend") {
      try {
        const result = await searchNiconicoSnapshot({ q: "", sort: "v", order: "d", page: 1, limit: 24, recentDays: 7 });
        return res.json({ ok: true, success: true, videos: result.items, items: result.items, total: result.items.length });
      } catch (err) {
        return res.status(502).json({ ok: false, success: false, error: err?.message || "Recommend failed", videos: [], items: [] });
      }
    }
    let targetUrl = "";
    let method = req.method || "GET";
    if (action === "health") {
      return res.json({ ok: true, status: "ok", search: "ready", ytDlp: fs.existsSync(YT_DLP_BIN), ffmpeg: hasFfmpeg() });
    } else if (action === "shorts") {
      targetUrl = `${NODE_SERVER}/api/shorts?platform=niconico`;
    } else if (action === "extract") {
      const query = req.query.id ? `id=${encodeURIComponent(req.query.id || "")}` : `url=${encodeURIComponent(req.query.url || "")}`;
      targetUrl = `${NODE_SERVER}/api/extract?${query}&ip=${encodeURIComponent(req.query.ip || "")}&platform=niconico`;
    } else if (action === "visit") {
      targetUrl = `${NODE_SERVER}/api/visit`;
    } else if (action === "announcements") {
      targetUrl = `${NODE_SERVER}/api/announcements`;
    } else if (action === "channel") {
      targetUrl = `${NODE_SERVER}/api/channel?url=${encodeURIComponent(req.query.url || "")}&offset=${encodeURIComponent(req.query.offset || "0")}&limit=${encodeURIComponent(req.query.limit || "30")}`;
    } else if (action === "channel-info") {
      targetUrl = `${NODE_SERVER}/api/channel-info?url=${encodeURIComponent(req.query.url || "")}&offset=${encodeURIComponent(req.query.offset || "0")}&limit=${encodeURIComponent(req.query.limit || "30")}`;
    } else if (action === "comments") {
      targetUrl = `${NODE_SERVER}/api/comments?url=${encodeURIComponent(req.query.url || "")}&offset=${encodeURIComponent(req.query.offset || "0")}&limit=${encodeURIComponent(req.query.limit || "10")}&pageToken=${encodeURIComponent(req.query.pageToken || "")}`;
    } else if (action === "comment-replies") {
      targetUrl = `${NODE_SERVER}/api/comment-replies?url=${encodeURIComponent(req.query.url || "")}&parentId=${encodeURIComponent(req.query.parentId || "")}`;
    } else if (action === "channel-avatar") {
      targetUrl = `${NODE_SERVER}/api/channel-avatar?url=${encodeURIComponent(req.query.url || "")}`;
    } else if (action === "channel-banner") {
      targetUrl = `${NODE_SERVER}/api/channel-banner?url=${encodeURIComponent(req.query.url || "")}`;
    } else if (action === "nico-base64") {
      targetUrl = `${NODE_SERVER}/api/nico-base64?url=${encodeURIComponent(req.query.url || "")}`;
    } else if (action === "thumb-base64") {
      targetUrl = `${NODE_SERVER}/api/thumb-base64?url=${encodeURIComponent(req.query.url || "")}`;
    } else if (action === "media-link") {
      targetUrl = `${NODE_SERVER}/api/media-link?url=${encodeURIComponent(req.query.url || "")}`;
    } else if (action === "nico-comments") {
      targetUrl = `${NODE_SERVER}/api/nico-comments?id=${encodeURIComponent(req.query.id || "")}`;
    } else if (action === "reviews") {
      targetUrl = `${NODE_SERVER}/api/reviews?deviceId=${encodeURIComponent(req.query.deviceId || "")}`;
    } else if (action === "review-save") {
      targetUrl = `${NODE_SERVER}/api/review-save?rating=${encodeURIComponent(req.query.rating || "")}&comment=${encodeURIComponent(req.query.comment || "")}&deviceId=${encodeURIComponent(req.query.deviceId || "")}`;
    } else if (action === "job-start") {
      let query = `url=${encodeURIComponent(req.query.url || "")}&type=${encodeURIComponent(req.query.type || "")}`;
      if (req.query.height) query += `&height=${encodeURIComponent(req.query.height)}`;
      if (req.query.v_id) query += `&v_id=${encodeURIComponent(req.query.v_id)}`;
      if (req.query.a_id) query += `&a_id=${encodeURIComponent(req.query.a_id)}`;
      if (req.query.withComments) query += `&withComments=${encodeURIComponent(req.query.withComments)}`;
      targetUrl = `${NODE_SERVER}/api/job-start?${query}`;
    } else if (action === "job-progress") {
      targetUrl = `${NODE_SERVER}/api/job-progress?id=${encodeURIComponent(req.query.id || "")}`;
    } else if (action === "job-cancel") {
      targetUrl = `${NODE_SERVER}/api/job-cancel?id=${encodeURIComponent(req.query.id || "")}`;
      method = "POST";
    } else if (action === "job-file") {
      targetUrl = `${NODE_SERVER}/api/job-file?id=${encodeURIComponent(req.query.id || "")}&type=${encodeURIComponent(req.query.type || "")}&download=${encodeURIComponent(req.query.download || "")}`;
    } else if (action === "proxy") {
      targetUrl = `${NODE_SERVER}/api/proxy?url=${encodeURIComponent(req.query.url || "")}&platform=${encodeURIComponent(req.query.platform || "")}&relayBase=${encodeURIComponent(req.query.relayBase || "")}`;
    }
    if (!targetUrl) {
      return res.status(400).json({ error: "Invalid action: " + action });
    }
    const client = targetUrl.startsWith("https:") ? https : http;
    const reqHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    };
    if (req.headers.range) {
      reqHeaders["Range"] = req.headers.range;
    }
    const options = {
      method,
      headers: reqHeaders
    };
    const proxyReq = client.request(targetUrl, options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      console.error("Muratube Proxy Error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Muratube Server Error", detail: err.message });
      }
    });
    proxyReq.end();
  };
  app2.use("/", (req, res, next) => {
    if (req.query.action && typeof req.query.action === "string") {
      return handleMuratubeAction(req.query.action, req, res);
    }
    next();
  });
  app2.all("/api/:action", (req, res, next) => {
    const action = req.params.action;
    if (action === "video" || action === "nico" || action === "dl" || action === "download" || action === "freemake") {
      return next();
    }
    return handleMuratubeAction(action, req, res);
  });
  app2.get("/api/video/status/:id", (req, res) => {
    return res.json({
      ready: true,
      percent: 100,
      stage: "ready"
    });
  });
  const nicoHlsSessionCache = /* @__PURE__ */ new Map();
  const nicoHlsInFlight = /* @__PURE__ */ new Map();
  async function getLiveNicoStream(id, quality = "720", forceRefresh = false) {
    const qKey = String(quality || "720").replace(/\D/g, "") || "720";
    const cacheKey = `${id}:${qKey}`;
    if (!forceRefresh) {
      const cached = nicoHlsSessionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 1e3 * 60 * 12) {
        return cached;
      }
      const pending = nicoHlsInFlight.get(cacheKey);
      if (pending) return pending;
    }
    const work = (async () => {
      try {
        const htmlRes = await fetch(`https://www.nicovideo.jp/watch/${id}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(8e3)
        });
        const htmlCookies = htmlRes.headers.getSetCookie ? htmlRes.headers.getSetCookie() : [htmlRes.headers.get("set-cookie")];
        const cookieHeader = htmlCookies.filter((c) => typeof c === "string").map((c) => c.split(";")[0]).join("; ");
        const html = await htmlRes.text();
        const m = html.match(/name="server-response"[^>]*content="([^"]+)"/) || html.match(/content="([^"]+)"[^>]*name="server-response"/);
        if (!m) return null;
        const raw = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        const parsed = JSON.parse(raw);
        const w = parsed.data?.response?.["$watchV4"];
        const media = w?.data?.media;
        const accessRightKey = media?.accessRightKey;
        const trackId = w?.data?.client?.watchTrackId;
        if (!accessRightKey || !trackId || !media?.contents?.videos?.length) return null;
        const availableVideos = media.contents.videos.filter((v) => v.isAvailable);
        const targetHeight = parseInt(qKey, 10) || 720;
        const extractHeight = (vidId) => {
          const hm = String(vidId || "").match(/(\d+)p/);
          return hm ? parseInt(hm[1], 10) : 360;
        };
        const sortedVideos = [...availableVideos.length ? availableVideos : media.contents.videos].sort(
          (a, b) => extractHeight(b.id) - extractHeight(a.id)
        );
        const vChoice = sortedVideos.find((v) => extractHeight(v.id) <= targetHeight) || sortedVideos[sortedVideos.length - 1] || media.contents.videos[0];
        const aChoice = media.contents.audios.find((a) => a.isAvailable) || media.contents.audios[0];
        const postRes = await fetch(`https://nvapi.nicovideo.jp/v1/watch/${id}/access-rights/hls?actionTrackId=${trackId}`, {
          method: "POST",
          headers: {
            "Accept": "application/json;charset=utf-8",
            "Content-Type": "application/json",
            "X-Access-Right-Key": accessRightKey,
            "X-Request-With": "https://www.nicovideo.jp",
            "X-Frontend-Id": "6",
            "X-Frontend-Version": "0",
            "Cookie": cookieHeader,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Origin": "https://www.nicovideo.jp",
            "Referer": `https://www.nicovideo.jp/watch/${id}`
          },
          body: JSON.stringify({ outputs: [[vChoice.id, aChoice.id]] }),
          signal: AbortSignal.timeout(7e3)
        });
        if (!postRes.ok) return null;
        const postCookies = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [postRes.headers.get("set-cookie")];
        const allCookies = [...htmlCookies, ...postCookies].filter((c) => typeof c === "string").map((c) => c.split(";")[0]).join("; ");
        const json = await postRes.json();
        const m3u8Url = json.data?.contentUrl;
        if (!m3u8Url) return null;
        const headers = `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r
Referer: https://www.nicovideo.jp/\r
Cookie: ${allCookies}\r
`;
        const session = { m3u8Url, headers, cookieHeader: allCookies, timestamp: Date.now() };
        nicoHlsSessionCache.set(cacheKey, session);
        return session;
      } catch (err) {
        console.error("getLiveNicoStream error:", err);
        return null;
      } finally {
        nicoHlsInFlight.delete(cacheKey);
      }
    })();
    nicoHlsInFlight.set(cacheKey, work);
    return work;
  }
  app2.get("/api/nico/hls/:id/master.m3u8", async (req, res) => {
    const id = req.params.id;
    const quality = String(req.query.quality || req.query.q || "720");
    const audioOnly = req.query.audioOnly === "1" || req.query.audioOnly === "true";
    let session = await getLiveNicoStream(id, quality);
    if (!session) {
      return res.status(502).json({ error: "\u52D5\u753B\u30B9\u30C8\u30EA\u30FC\u30E0\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" });
    }
    try {
      let resp = await fetch(session.m3u8Url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Referer": "https://www.nicovideo.jp/",
          "Cookie": session.cookieHeader
        },
        signal: AbortSignal.timeout(8e3)
      });
      if (resp.status === 403 || resp.status === 410) {
        session = await getLiveNicoStream(id, quality, true);
        if (!session) return res.status(502).send("Stream refresh failed");
        resp = await fetch(session.m3u8Url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.nicovideo.jp/",
            "Cookie": session.cookieHeader
          },
          signal: AbortSignal.timeout(8e3)
        });
      }
      if (!resp.ok) return res.status(resp.status).send("Upstream playlist error");
      let text = await resp.text();
      if (audioOnly) {
        const audioMatch = text.match(/#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO[^\r\n]*URI="([^"]+)"/i);
        if (audioMatch?.[1]) {
          const audioSubUrl = new URL(audioMatch[1], session.m3u8Url).toString();
          const audioResp = await fetch(audioSubUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              "Referer": "https://www.nicovideo.jp/",
              "Cookie": session.cookieHeader
            },
            signal: AbortSignal.timeout(8e3)
          });
          if (audioResp.ok) {
            let audioText = await audioResp.text();
            audioText = audioText.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
              const abs = new URL(uri, audioSubUrl).toString();
              return `${p1}/api/nico/hls/segment?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(abs)}${p3}`;
            });
            audioText = audioText.split(/\r?\n/).map((line) => {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith("#")) {
                const abs = new URL(trimmed, audioSubUrl).toString();
                return `/api/nico/hls/segment?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(abs)}`;
              }
              return line;
            }).join("\n");
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-cache");
            return res.send(audioText);
          }
        }
      }
      text = text.replace(/(URI=")([^"]+)(")/g, (_match, p1, uri, p3) => {
        const abs = new URL(uri, session.m3u8Url).toString();
        return `${p1}/api/nico/hls/proxy?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(abs)}${p3}`;
      });
      text = text.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const abs = new URL(trimmed, session.m3u8Url).toString();
          return `/api/nico/hls/proxy?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(abs)}`;
        }
        return line;
      }).join("\n");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(text);
    } catch (err) {
      console.error("HLS master error:", err);
      return res.status(500).send(err.message);
    }
  });
  app2.get("/api/nico/hls/proxy", async (req, res) => {
    const id = req.query.id;
    const url = req.query.url;
    const quality = String(req.query.q || "720");
    if (!url || !id) return res.status(400).send("Missing params");
    const session = await getLiveNicoStream(id, quality);
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Referer": "https://www.nicovideo.jp/",
          "Cookie": session ? session.cookieHeader : ""
        },
        signal: AbortSignal.timeout(8e3)
      });
      if (!resp.ok) return res.status(resp.status).send("Upstream media playlist error");
      let text = await resp.text();
      text = text.replace(/(URI=")([^"]+)(")/g, (_match, p1, uri, p3) => {
        const abs = new URL(uri, url).toString();
        return `${p1}/api/nico/hls/segment?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(abs)}${p3}`;
      });
      text = text.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const abs = new URL(trimmed, url).toString();
          return `/api/nico/hls/segment?id=${encodeURIComponent(id)}&q=${encodeURIComponent(quality)}&url=${encodeURIComponent(abs)}`;
        }
        return line;
      }).join("\n");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(text);
    } catch (err) {
      console.error("HLS proxy error:", err);
      return res.status(500).send(err.message);
    }
  });
  app2.get("/api/nico/hls/segment", async (req, res) => {
    const id = req.query.id;
    const url = req.query.url;
    const quality = String(req.query.q || "720");
    if (!url || !id) return res.status(400).send("Missing params");
    const session = await getLiveNicoStream(id, quality);
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Referer": "https://www.nicovideo.jp/",
      "Origin": "https://www.nicovideo.jp"
    };
    if (session) {
      headers["Cookie"] = session.cookieHeader;
    }
    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }
    try {
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(12e3) });
      const buf = Buffer.from(await resp.arrayBuffer());
      res.status(resp.status);
      res.setHeader("Content-Type", resp.headers.get("content-type") || "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Length", buf.length);
      const cr = resp.headers.get("content-range");
      if (cr) res.setHeader("Content-Range", cr);
      return res.end(buf);
    } catch (err) {
      console.error("Segment proxy error:", err);
      if (!res.headersSent) res.status(500).end();
    }
  });
  const freemakeStreamCache = /* @__PURE__ */ new Map();
  function extractNicoIdFromUrl(input) {
    const m = String(input || "").match(/\b((?:sm|so|nm)\d+)\b/i);
    return m ? m[1].toLowerCase() : null;
  }
  async function resolveFreemakeStream(targetUrl, quality = "720", audioOnly = false) {
    const qNum = Math.min(2160, Math.max(144, parseInt(String(quality), 10) || 720));
    const cacheKey = `${targetUrl}::${audioOnly ? "audio" : qNum}`;
    const cached = freemakeStreamCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 1e3 * 60 * 15) {
      return cached;
    }
    const ytDlpBin = await ensureYtDlp();
    const rawJson = await new Promise((resolve, reject) => {
      const chunks = [];
      const errChunks = [];
      const proc = spawn(ytDlpBin, ["-J", "--no-playlist", "--no-warnings", targetUrl]);
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("\u30B9\u30C8\u30EA\u30FC\u30E0\u60C5\u5831\u306E\u53D6\u5F97\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002"));
      }, 25e3);
      proc.stdout.on("data", (d) => chunks.push(d));
      proc.stderr.on("data", (d) => errChunks.push(d));
      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
        else reject(new Error(Buffer.concat(errChunks).toString("utf8").slice(0, 350) || `yt-dlp exited ${code}`));
      });
      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    const info = JSON.parse(rawJson);
    const entry = Array.isArray(info.entries) && info.entries.length > 0 ? info.entries[0] : info;
    const formats = Array.isArray(entry.formats) ? entry.formats : [];
    const durSec = Number(entry.duration || 0);
    const mins = Math.floor(durSec / 60);
    const secs = Math.floor(durSec % 60);
    const qualities = Array.from(
      new Set(
        formats.filter((f) => f.height && f.vcodec && f.vcodec !== "none").map((f) => String(f.height))
      )
    ).sort((a, b) => Number(b) - Number(a));
    const httpHeaders = {};
    const sampleHeaders = entry.http_headers || formats[0]?.http_headers || {};
    if (sampleHeaders["User-Agent"]) httpHeaders["User-Agent"] = sampleHeaders["User-Agent"];
    if (sampleHeaders["Referer"]) httpHeaders["Referer"] = sampleHeaders["Referer"];
    if (audioOnly) {
      const audioProgCandidates = formats.filter(
        (f) => f.url && f.vcodec === "none" && f.acodec && f.acodec !== "none" && !String(f.protocol || "").includes("m3u8")
      ).sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0));
      const aProg = audioProgCandidates.find((f) => f.ext === "m4a" || f.ext === "aac" || f.ext === "mp3") || audioProgCandidates[0];
      if (aProg) {
        const result2 = {
          mode: "proxy",
          isAudioOnly: true,
          title: String(entry.title || "\u97F3\u58F0\u30B9\u30C8\u30EA\u30FC\u30E0"),
          thumbnail: String(entry.thumbnail || ""),
          durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
          uploader: String(entry.uploader || entry.channel || entry.extractor_key || "Web"),
          webpageUrl: String(entry.webpage_url || targetUrl),
          directUrl: aProg.url,
          httpHeaders: aProg.http_headers || httpHeaders,
          qualities: qualities.length ? qualities : ["720", "480", "360"],
          timestamp: Date.now()
        };
        freemakeStreamCache.set(cacheKey, result2);
        return result2;
      }
      const audioHls = formats.filter((f) => f.url && String(f.protocol || "").includes("m3u8") && f.vcodec === "none" && f.acodec && f.acodec !== "none").sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0))[0];
      if (audioHls) {
        const result2 = {
          mode: "hls",
          isAudioOnly: true,
          title: String(entry.title || "\u97F3\u58F0\u30B9\u30C8\u30EA\u30FC\u30E0"),
          thumbnail: String(entry.thumbnail || ""),
          durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
          uploader: String(entry.uploader || entry.channel || entry.extractor_key || "Web"),
          webpageUrl: String(entry.webpage_url || targetUrl),
          hlsUrl: audioHls.url,
          httpHeaders: audioHls.http_headers || httpHeaders,
          qualities: qualities.length ? qualities : ["720", "480", "360"],
          timestamp: Date.now()
        };
        freemakeStreamCache.set(cacheKey, result2);
        return result2;
      }
      const fallbackAudio = formats.filter((f) => f.url && f.vcodec === "none" && f.acodec && f.acodec !== "none")[0] || formats.filter((f) => f.url && f.acodec && f.acodec !== "none").sort((a, b) => Number(a.height || 9999) - Number(b.height || 9999))[0];
      if (fallbackAudio) {
        const result2 = {
          mode: "remux",
          isAudioOnly: true,
          title: String(entry.title || "\u97F3\u58F0\u30B9\u30C8\u30EA\u30FC\u30E0"),
          thumbnail: String(entry.thumbnail || ""),
          durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
          uploader: String(entry.uploader || entry.channel || entry.extractor_key || "Web"),
          webpageUrl: String(entry.webpage_url || targetUrl),
          audioUrl: fallbackAudio.url,
          httpHeaders: fallbackAudio.http_headers || httpHeaders,
          qualities: qualities.length ? qualities : ["720", "480", "360"],
          timestamp: Date.now()
        };
        freemakeStreamCache.set(cacheKey, result2);
        return result2;
      }
    }
    const progressiveCandidates = formats.filter(
      (f) => f.url && f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none" && !String(f.protocol || "").includes("m3u8")
    ).sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
    const progressive = progressiveCandidates.find((f) => Number(f.height || 0) <= qNum && f.ext === "mp4") || progressiveCandidates.find((f) => Number(f.height || 0) <= qNum) || progressiveCandidates[progressiveCandidates.length - 1];
    if (progressive) {
      const result2 = {
        mode: "proxy",
        title: String(entry.title || "\u30B9\u30C8\u30EA\u30FC\u30E0\u52D5\u753B"),
        thumbnail: String(entry.thumbnail || ""),
        durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
        uploader: String(entry.uploader || entry.channel || entry.extractor_key || "Web"),
        webpageUrl: String(entry.webpage_url || targetUrl),
        directUrl: progressive.url,
        httpHeaders: progressive.http_headers || httpHeaders,
        qualities: qualities.length ? qualities : ["720", "480", "360"],
        timestamp: Date.now()
      };
      freemakeStreamCache.set(cacheKey, result2);
      return result2;
    }
    const hlsCandidates = formats.filter(
      (f) => f.url && String(f.protocol || "").includes("m3u8") && f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none"
    ).sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
    const hlsFmt = hlsCandidates.find((f) => Number(f.height || 0) <= qNum) || hlsCandidates[hlsCandidates.length - 1];
    if (hlsFmt) {
      const result2 = {
        mode: "hls",
        title: String(entry.title || "\u30B9\u30C8\u30EA\u30FC\u30E0\u52D5\u753B"),
        thumbnail: String(entry.thumbnail || ""),
        durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
        uploader: String(entry.uploader || entry.channel || entry.extractor_key || "Web"),
        webpageUrl: String(entry.webpage_url || targetUrl),
        hlsUrl: hlsFmt.url,
        httpHeaders: hlsFmt.http_headers || httpHeaders,
        qualities: qualities.length ? qualities : ["720", "480", "360"],
        timestamp: Date.now()
      };
      freemakeStreamCache.set(cacheKey, result2);
      return result2;
    }
    const vCandidates = formats.filter((f) => f.url && f.vcodec && f.vcodec !== "none").sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
    const vPick = vCandidates.find((f) => Number(f.height || 0) <= qNum && String(f.vcodec).startsWith("avc1")) || vCandidates.find((f) => Number(f.height || 0) <= qNum) || vCandidates[vCandidates.length - 1];
    const aPick = formats.filter((f) => f.url && f.vcodec === "none" && f.acodec && f.acodec !== "none").sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0))[0];
    if (!vPick) {
      throw new Error("\u518D\u751F\u53EF\u80FD\u306A\u30B9\u30C8\u30EA\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    }
    const result = {
      mode: "remux",
      title: String(entry.title || "\u30B9\u30C8\u30EA\u30FC\u30E0\u52D5\u753B"),
      thumbnail: String(entry.thumbnail || ""),
      durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
      uploader: String(entry.uploader || entry.channel || entry.extractor_key || "Web"),
      webpageUrl: String(entry.webpage_url || targetUrl),
      videoUrl: vPick.url,
      audioUrl: aPick?.url,
      httpHeaders: vPick.http_headers || httpHeaders,
      qualities: qualities.length ? qualities : ["720", "480", "360"],
      timestamp: Date.now()
    };
    freemakeStreamCache.set(cacheKey, result);
    return result;
  }
  app2.get("/api/freemake/stream-info", async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    const quality = String(req.query.quality || "720").replace(/\D/g, "") || "720";
    const audioOnly = req.query.audioOnly === "1" || req.query.audioOnly === "true";
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: "URL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    let targetUrl = "";
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: "\u6709\u52B9\u306AURL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    const liveIdMatch = targetUrl.match(/\b(lv\d+)\b/i);
    if (liveIdMatch) {
      const lvId = liveIdMatch[1].toLowerCase();
      const liveQuality = audioOnly ? "audio_only" : "high";
      try {
        const liveSess = await getOrCreateNicoLiveSession(lvId, false, liveQuality);
        if (liveSess?.streamUri) {
          return res.json({
            ok: true,
            mode: "hls",
            platform: "niconico-live",
            isLive: true,
            isAudioOnly: audioOnly,
            streamUrl: `/api/nico/live/hls/${encodeURIComponent(lvId)}/master.m3u8${audioOnly ? "?quality=audio_only" : ""}`,
            qualities: ["720", "480", "360"]
          });
        }
      } catch (err) {
        console.warn("Live stream-info fallback:", err);
      }
    }
    const nicoId = extractNicoIdFromUrl(targetUrl);
    if (nicoId) {
      const session = await getLiveNicoStream(nicoId, quality);
      if (session) {
        return res.json({
          ok: true,
          mode: "hls",
          platform: "niconico",
          isAudioOnly: audioOnly,
          streamUrl: `/api/nico/hls/${encodeURIComponent(nicoId)}/master.m3u8?quality=${encodeURIComponent(quality)}${audioOnly ? "&audioOnly=1" : ""}`,
          qualities: ["720", "480", "360"]
        });
      }
    }
    try {
      const resolved = await resolveFreemakeStream(targetUrl, quality, audioOnly);
      const aoQuery = audioOnly ? "&audioOnly=1" : "";
      const streamUrl = resolved.mode === "hls" ? `/api/freemake/hls/master.m3u8?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}${aoQuery}` : `/api/freemake/stream?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}${aoQuery}`;
      return res.json({
        ok: true,
        mode: resolved.mode,
        isAudioOnly: audioOnly,
        title: resolved.title,
        thumbnail: resolved.thumbnail,
        durationString: resolved.durationString,
        uploader: resolved.uploader,
        streamUrl,
        qualities: resolved.qualities
      });
    } catch (err) {
      const msg = String(err?.message || "");
      return res.status(502).json({
        ok: false,
        error: msg || "\u30B9\u30C8\u30EA\u30FC\u30E0\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002"
      });
    }
  });
  app2.get("/api/freemake/hls/master.m3u8", async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    const quality = String(req.query.quality || "720");
    const audioOnly = req.query.audioOnly === "1" || req.query.audioOnly === "true";
    if (!rawUrl) return res.status(400).send("Missing url");
    try {
      const targetUrl = normalizeTargetUrl(rawUrl);
      const resolved = await resolveFreemakeStream(targetUrl, quality, audioOnly);
      if (!resolved.hlsUrl) return res.status(404).send("No HLS stream");
      const resp = await fetch(resolved.hlsUrl, { headers: resolved.httpHeaders || {} });
      if (!resp.ok) return res.status(resp.status).send("Upstream HLS error");
      let text = await resp.text();
      const base = resolved.hlsUrl;
      const aoQuery = audioOnly ? "&audioOnly=1" : "";
      text = text.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
        const abs = new URL(uri, base).toString();
        return `${p1}/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}${aoQuery}&target=${encodeURIComponent(abs)}${p3}`;
      });
      text = text.split("\n").map((line) => {
        const t = line.trim();
        if (t && !t.startsWith("#")) {
          const abs = new URL(t, base).toString();
          return `/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}${aoQuery}&target=${encodeURIComponent(abs)}`;
        }
        return line;
      }).join("\n");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(text);
    } catch (err) {
      return res.status(502).send(err?.message || "HLS error");
    }
  });
  app2.get("/api/freemake/hls/proxy", async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    const target = String(req.query.target || "").trim();
    const quality = String(req.query.quality || "720");
    const audioOnly = req.query.audioOnly === "1" || req.query.audioOnly === "true";
    if (!rawUrl || !target) return res.status(400).send("Missing params");
    try {
      const targetUrl = normalizeTargetUrl(rawUrl);
      const resolved = await resolveFreemakeStream(targetUrl, quality, audioOnly);
      const headers = { ...resolved.httpHeaders || {} };
      if (req.headers.range) headers["Range"] = String(req.headers.range);
      const resp = await fetch(target, { headers });
      const ct = resp.headers.get("content-type") || "";
      const aoQuery = audioOnly ? "&audioOnly=1" : "";
      if (ct.includes("mpegurl") || target.includes(".m3u8")) {
        let text = await resp.text();
        text = text.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
          const abs = new URL(uri, target).toString();
          return `${p1}/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}${aoQuery}&target=${encodeURIComponent(abs)}${p3}`;
        });
        text = text.split("\n").map((line) => {
          const t = line.trim();
          if (t && !t.startsWith("#")) {
            const abs = new URL(t, target).toString();
            return `/api/freemake/hls/proxy?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(quality)}${aoQuery}&target=${encodeURIComponent(abs)}`;
          }
          return line;
        }).join("\n");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
        return res.send(text);
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      res.status(resp.status);
      res.setHeader("Content-Type", ct || "video/mp2t");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", buf.length);
      const cr = resp.headers.get("content-range");
      if (cr) res.setHeader("Content-Range", cr);
      return res.end(buf);
    } catch (err) {
      if (!res.headersSent) return res.status(502).send(err?.message || "Proxy error");
    }
  });
  app2.get("/api/freemake/stream", async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    const quality = String(req.query.quality || "720").replace(/\D/g, "") || "720";
    const audioOnly = req.query.audioOnly === "1" || req.query.audioOnly === "true";
    if (!rawUrl) return res.status(400).send("Missing url");
    let targetUrl = "";
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).send("Invalid url");
    }
    try {
      const resolved = await resolveFreemakeStream(targetUrl, quality, audioOnly);
      if (resolved.mode === "proxy" && resolved.directUrl) {
        const headers = { ...resolved.httpHeaders || {} };
        if (req.headers.range) {
          headers["Range"] = String(req.headers.range);
        }
        const upstream = await fetch(resolved.directUrl, { headers });
        res.status(upstream.status);
        res.setHeader("Content-Type", upstream.headers.get("content-type") || (audioOnly ? "audio/mp4" : "video/mp4"));
        res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
        const cl = upstream.headers.get("content-length");
        if (cl) res.setHeader("Content-Length", cl);
        const cr = upstream.headers.get("content-range");
        if (cr) res.setHeader("Content-Range", cr);
        if (!upstream.body) return res.end();
        const reader = upstream.body.getReader();
        req.on("close", () => {
          reader.cancel().catch(() => {
          });
        });
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        return res.end();
      }
      if (resolved.isAudioOnly && resolved.audioUrl && !resolved.videoUrl) {
        if (!hasFfmpeg()) {
          const headers = { ...resolved.httpHeaders || {} };
          if (req.headers.range) headers["Range"] = String(req.headers.range);
          const upstream = await fetch(resolved.audioUrl, { headers });
          res.status(upstream.status);
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mp4");
          res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
          const cl = upstream.headers.get("content-length");
          if (cl) res.setHeader("Content-Length", cl);
          const cr = upstream.headers.get("content-range");
          if (cr) res.setHeader("Content-Range", cr);
          if (!upstream.body) return res.end();
          const reader = upstream.body.getReader();
          req.on("close", () => {
            reader.cancel().catch(() => {
            });
          });
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          return res.end();
        }
        const ffArgs = [];
        const headerStr = Object.entries(resolved.httpHeaders || {}).map(([k, v]) => `${k}: ${v}`).join("\r\n");
        if (headerStr) {
          ffArgs.push("-headers", `${headerStr}\r
`);
        }
        ffArgs.push("-i", resolved.audioUrl, "-vn", "-c:a", "aac", "-b:a", "128k", "-f", "adts", "pipe:1");
        res.setHeader("Content-Type", "audio/aac");
        res.setHeader("Cache-Control", "no-cache");
        const ff = spawn("ffmpeg", ffArgs);
        ff.stdout.pipe(res);
        req.on("close", () => {
          try {
            ff.kill("SIGKILL");
          } catch {
          }
        });
        ff.on("error", () => {
          if (!res.headersSent) res.status(500).end();
        });
        return;
      }
      if (resolved.videoUrl) {
        if (!hasFfmpeg()) {
          const headers = { ...resolved.httpHeaders || {} };
          if (req.headers.range) headers["Range"] = String(req.headers.range);
          const upstream = await fetch(resolved.videoUrl, { headers });
          res.status(upstream.status);
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
          res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
          const cl = upstream.headers.get("content-length");
          if (cl) res.setHeader("Content-Length", cl);
          const cr = upstream.headers.get("content-range");
          if (cr) res.setHeader("Content-Range", cr);
          if (!upstream.body) return res.end();
          const reader = upstream.body.getReader();
          req.on("close", () => {
            reader.cancel().catch(() => {
            });
          });
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          return res.end();
        }
        const ffArgs = [];
        const headerStr = Object.entries(resolved.httpHeaders || {}).map(([k, v]) => `${k}: ${v}`).join("\r\n");
        if (headerStr) {
          ffArgs.push("-headers", `${headerStr}\r
`);
        }
        ffArgs.push("-i", resolved.videoUrl);
        if (resolved.audioUrl) {
          if (headerStr) ffArgs.push("-headers", `${headerStr}\r
`);
          ffArgs.push("-i", resolved.audioUrl);
        }
        ffArgs.push(
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-movflags",
          "frag_keyframe+empty_moov+default_base_moof",
          "-f",
          "mp4",
          "pipe:1"
        );
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cache-Control", "no-cache");
        const ff = spawn("ffmpeg", ffArgs);
        ff.stdout.pipe(res);
        req.on("close", () => {
          try {
            ff.kill("SIGKILL");
          } catch {
          }
        });
        ff.on("error", () => {
          if (!res.headersSent) res.status(500).end();
        });
        return;
      }
      return res.status(404).send("No playable stream found");
    } catch (err) {
      if (!res.headersSent) {
        return res.status(502).json({ ok: false, error: err?.message || "Freemake stream failed" });
      }
    }
  });
  const activeDownloads = /* @__PURE__ */ new Map();
  function listIsoBoxes(buf, start = 0, end = buf.length) {
    const out = [];
    let off = start;
    while (off + 8 <= end) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString("ascii", off + 4, off + 8);
      if (size < 8 || off + size > end) break;
      out.push({ type, start: off, end: off + size, size });
      off += size;
    }
    return out;
  }
  function patchIsoInitTrackId(buf, newTrackId, nextTrackId) {
    const copy = Buffer.from(buf);
    const moov = listIsoBoxes(copy).find((b) => b.type === "moov");
    if (!moov) return copy;
    for (const child of listIsoBoxes(copy, moov.start + 8, moov.end)) {
      if (child.type === "mvhd") {
        const ver = copy[child.start + 8];
        const nextOff = ver === 1 ? child.start + 8 + 104 : child.start + 8 + 92;
        if (nextOff + 4 <= child.end) copy.writeUInt32BE(nextTrackId, nextOff);
      } else if (child.type === "trak") {
        for (const tc of listIsoBoxes(copy, child.start + 8, child.end)) {
          if (tc.type === "tkhd") {
            const ver = copy[tc.start + 8];
            const idOff = ver === 1 ? tc.start + 8 + 20 : tc.start + 8 + 12;
            if (idOff + 4 <= tc.end) copy.writeUInt32BE(newTrackId, idOff);
          }
        }
      } else if (child.type === "mvex") {
        for (const mc of listIsoBoxes(copy, child.start + 8, child.end)) {
          if (mc.type === "trex" && mc.start + 16 <= mc.end) {
            copy.writeUInt32BE(newTrackId, mc.start + 12);
          }
        }
      }
    }
    return copy;
  }
  function patchIsoFragment(buf, newTrackId, seqNum) {
    const copy = Buffer.from(buf);
    for (const b of listIsoBoxes(copy)) {
      if (b.type === "moof") {
        for (const mc of listIsoBoxes(copy, b.start + 8, b.end)) {
          if (mc.type === "mfhd" && mc.start + 16 <= mc.end) {
            copy.writeUInt32BE(seqNum, mc.start + 12);
          } else if (mc.type === "traf") {
            for (const tc of listIsoBoxes(copy, mc.start + 8, mc.end)) {
              if (tc.type === "tfhd" && tc.start + 16 <= tc.end) {
                copy.writeUInt32BE(newTrackId, tc.start + 12);
              }
            }
          }
        }
      }
    }
    return copy;
  }
  function mergeIsoFmp4Inits(videoInit, audioInit) {
    const vPatched = patchIsoInitTrackId(videoInit, 1, 3);
    const aPatched = patchIsoInitTrackId(audioInit, 2, 3);
    const vTop = listIsoBoxes(vPatched);
    const aTop = listIsoBoxes(aPatched);
    const vFtyp = vTop.find((b) => b.type === "ftyp");
    const vMoov = vTop.find((b) => b.type === "moov");
    const aMoov = aTop.find((b) => b.type === "moov");
    if (!vFtyp || !vMoov || !aMoov) return vPatched;
    const vChildren = listIsoBoxes(vPatched, vMoov.start + 8, vMoov.end);
    const aChildren = listIsoBoxes(aPatched, aMoov.start + 8, aMoov.end);
    const vMvhd = vChildren.find((b) => b.type === "mvhd");
    const vTraks = vChildren.filter((b) => b.type === "trak");
    const aTraks = aChildren.filter((b) => b.type === "trak");
    const vMvex = vChildren.find((b) => b.type === "mvex");
    const aMvex = aChildren.find((b) => b.type === "mvex");
    const mvexParts = [];
    if (vMvex) {
      for (const c of listIsoBoxes(vPatched, vMvex.start + 8, vMvex.end)) {
        mvexParts.push(vPatched.subarray(c.start, c.end));
      }
    }
    if (aMvex) {
      for (const c of listIsoBoxes(aPatched, aMvex.start + 8, aMvex.end)) {
        if (c.type === "trex") mvexParts.push(aPatched.subarray(c.start, c.end));
      }
    }
    const moovParts = [];
    if (vMvhd) moovParts.push(vPatched.subarray(vMvhd.start, vMvhd.end));
    for (const t of vTraks) moovParts.push(vPatched.subarray(t.start, t.end));
    for (const t of aTraks) moovParts.push(aPatched.subarray(t.start, t.end));
    if (mvexParts.length > 0) {
      const mvexBody = Buffer.concat(mvexParts);
      const mvexHdr = Buffer.alloc(8);
      mvexHdr.writeUInt32BE(8 + mvexBody.length, 0);
      mvexHdr.write("mvex", 4);
      moovParts.push(Buffer.concat([mvexHdr, mvexBody]));
    }
    const moovBody = Buffer.concat(moovParts);
    const moovHdr = Buffer.alloc(8);
    moovHdr.writeUInt32BE(8 + moovBody.length, 0);
    moovHdr.write("moov", 4);
    return Buffer.concat([vPatched.subarray(vFtyp.start, vFtyp.end), moovHdr, moovBody]);
  }
  async function downloadNiconicoWithoutFfmpeg(opts) {
    const { nicoId, quality, audioOnly, outPath, onProgress, isCancelled } = opts;
    const session = await getLiveNicoStream(nicoId, quality);
    if (!session) throw new Error("\u30CB\u30B3\u30CB\u30B3\u52D5\u753B\u30B9\u30C8\u30EA\u30FC\u30E0\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
    const reqHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Referer": "https://www.nicovideo.jp/",
      "Origin": "https://www.nicovideo.jp",
      "Cookie": session.cookieHeader
    };
    const masterRes = await fetch(session.m3u8Url, { headers: reqHeaders, signal: AbortSignal.timeout(8e3) });
    if (!masterRes.ok) throw new Error(`Master playlist HTTP ${masterRes.status}`);
    const masterText = await masterRes.text();
    let totalBytes = 0;
    const keyCache = /* @__PURE__ */ new Map();
    const fetchBytes = async (url) => {
      const r = await fetch(url, { headers: reqHeaders, signal: AbortSignal.timeout(12e3) });
      if (!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
      const b = Buffer.from(await r.arrayBuffer());
      totalBytes += b.length;
      return b;
    };
    const fetchTrack = async (playlistUrl, startPct, spanPct, label) => {
      const plRes = await fetch(playlistUrl, { headers: reqHeaders, signal: AbortSignal.timeout(8e3) });
      if (!plRes.ok) throw new Error(`Playlist HTTP ${plRes.status}`);
      const plText = await plRes.text();
      let initUrl = "";
      let mediaSeq = 0;
      let keyUrl = "";
      let ivHex = "";
      let aes = false;
      const segs = [];
      for (const raw of plText.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
          mediaSeq = parseInt(line.split(":")[1] || "0", 10) || 0;
        } else if (line.startsWith("#EXT-X-MAP:")) {
          const m = line.match(/URI="([^"]+)"/);
          if (m?.[1]) initUrl = new URL(m[1], playlistUrl).toString();
        } else if (line.startsWith("#EXT-X-KEY:")) {
          const method = (line.match(/METHOD=([^,\s]+)/i)?.[1] || "").toUpperCase();
          if (method === "AES-128") {
            aes = true;
            const u = line.match(/URI="([^"]+)"/)?.[1];
            keyUrl = u ? new URL(u, playlistUrl).toString() : "";
            ivHex = line.match(/IV=0x([0-9a-fA-F]+)/i)?.[1] || "";
          } else {
            aes = false;
          }
        } else if (!line.startsWith("#")) {
          const seq = mediaSeq + segs.length;
          let iv;
          if (aes) {
            if (ivHex) {
              iv = Buffer.from(ivHex.padStart(32, "0"), "hex");
            } else {
              iv = Buffer.alloc(16);
              iv.writeUInt32BE(seq >>> 0, 12);
            }
          }
          segs.push({
            url: new URL(line, playlistUrl).toString(),
            keyUrl: aes ? keyUrl : void 0,
            iv
          });
        }
      }
      const initBuf = initUrl ? await fetchBytes(initUrl) : void 0;
      const outSegs = new Array(segs.length);
      let nextIdx = 0;
      let doneCount = 0;
      const workers = Math.min(4, Math.max(1, segs.length));
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (true) {
            if (isCancelled?.()) throw new Error("Cancelled");
            const idx = nextIdx++;
            if (idx >= segs.length) break;
            const seg = segs[idx];
            const enc = await fetchBytes(seg.url);
            if (seg.keyUrl && seg.iv) {
              let keyBuf = keyCache.get(seg.keyUrl);
              if (!keyBuf) {
                keyBuf = await fetchBytes(seg.keyUrl);
                keyCache.set(seg.keyUrl, keyBuf);
              }
              const dec = crypto.createDecipheriv("aes-128-cbc", keyBuf, seg.iv);
              outSegs[idx] = Buffer.concat([dec.update(enc), dec.final()]);
            } else {
              outSegs[idx] = enc;
            }
            doneCount++;
            const pct = Math.min(96, Math.round(startPct + doneCount / Math.max(1, segs.length) * spanPct));
            onProgress?.(pct, `${label} (${doneCount}/${segs.length})`, totalBytes);
          }
        })
      );
      return { initBuf, segs: outSegs };
    };
    const audioMatch = masterText.match(/#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO[^\r\n]*URI="([^"]+)"/i);
    const videoLine = masterText.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
    if (audioOnly && audioMatch?.[1]) {
      const audioUrl = new URL(audioMatch[1], session.m3u8Url).toString();
      const audioTrack = await fetchTrack(audioUrl, 10, 82, "\u97F3\u58F0\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u30FB\u5FA9\u53F7\u4E2D");
      const parts = [];
      if (audioTrack.initBuf) parts.push(audioTrack.initBuf);
      for (let i = 0; i < audioTrack.segs.length; i++) {
        parts.push(audioTrack.initBuf ? patchIsoFragment(audioTrack.segs[i], 1, i + 1) : audioTrack.segs[i]);
      }
      const ext2 = audioTrack.initBuf ? "m4a" : "aac";
      const finalPath2 = `${outPath}.${ext2}`;
      fs.writeFileSync(finalPath2, Buffer.concat(parts));
      return { filePath: finalPath2, ext: ext2 };
    }
    const vPlUrl = videoLine ? new URL(videoLine, session.m3u8Url).toString() : session.m3u8Url;
    const hasAudio = Boolean(audioMatch?.[1]) && !audioOnly;
    const vTrack = await fetchTrack(vPlUrl, 10, hasAudio ? 56 : 82, "\u6620\u50CF\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u30FB\u5FA9\u53F7\u4E2D");
    const aTrack = hasAudio && audioMatch?.[1] ? await fetchTrack(new URL(audioMatch[1], session.m3u8Url).toString(), 66, 26, "\u97F3\u58F0\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u30FB\u5FA9\u53F7\u4E2D") : null;
    const chunks = [];
    if (vTrack.initBuf && aTrack?.initBuf) {
      chunks.push(mergeIsoFmp4Inits(vTrack.initBuf, aTrack.initBuf));
      let seq = 1;
      const maxLen = Math.max(vTrack.segs.length, aTrack.segs.length);
      for (let i = 0; i < maxLen; i++) {
        if (vTrack.segs[i]) chunks.push(patchIsoFragment(vTrack.segs[i], 1, seq++));
        if (aTrack.segs[i]) chunks.push(patchIsoFragment(aTrack.segs[i], 2, seq++));
      }
    } else {
      if (vTrack.initBuf) chunks.push(vTrack.initBuf);
      for (let i = 0; i < vTrack.segs.length; i++) {
        chunks.push(vTrack.initBuf ? patchIsoFragment(vTrack.segs[i], 1, i + 1) : vTrack.segs[i]);
      }
    }
    const ext = vTrack.initBuf ? "mp4" : "ts";
    const finalPath = `${outPath}.${ext}`;
    fs.writeFileSync(finalPath, Buffer.concat(chunks));
    return { filePath: finalPath, ext };
  }
  async function fetchOrGetVideo(id, customUrl) {
    const safeId = sanitizeId(id);
    const videosDir = VIDEOS_CACHE_DIR;
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }
    const targetFile = path.join(videosDir, `${safeId}.mp4`);
    if (fs.existsSync(targetFile)) {
      return targetFile;
    }
    if (activeDownloads.has(safeId)) {
      const ok2 = await activeDownloads.get(safeId);
      return ok2 && fs.existsSync(targetFile) ? targetFile : null;
    }
    const task = (async () => {
      try {
        const targetUrl = customUrl ? normalizeTargetUrl(customUrl) : normalizeTargetUrl(id);
        const nicoId = extractNicoIdFromUrl(targetUrl);
        if (nicoId) {
          const outBase = path.join(videosDir, `${safeId}.temp`);
          const res = await downloadNiconicoWithoutFfmpeg({
            nicoId,
            quality: "480",
            audioOnly: false,
            outPath: outBase
          });
          fs.renameSync(res.filePath, targetFile);
          return true;
        }
        const ytDlpBin = await ensureYtDlp();
        const tempOut = path.join(videosDir, `${safeId}.temp.mp4`);
        const dlArgs = hasFfmpeg() ? [
          "-f",
          "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
          "--merge-output-format",
          "mp4",
          "--postprocessor-args",
          "Merger+ffmpeg:-movflags +faststart",
          "--no-playlist",
          targetUrl,
          "-o",
          tempOut
        ] : [
          "-f",
          "best[height<=480][ext=mp4]/best[height<=480]/best",
          "--no-playlist",
          targetUrl,
          "-o",
          tempOut
        ];
        await new Promise((resolve, reject) => {
          const proc = spawn(ytDlpBin, dlArgs);
          proc.on("close", (code) => {
            if (code === 0 && fs.existsSync(tempOut)) {
              fs.renameSync(tempOut, targetFile);
              resolve();
            } else {
              reject(new Error(`yt-dlp exited with code ${code}`));
            }
          });
          proc.on("error", reject);
        });
        return true;
      } catch (err) {
        console.error("fetchOrGetVideo error:", err);
        return false;
      } finally {
        activeDownloads.delete(safeId);
      }
    })();
    activeDownloads.set(safeId, task);
    const ok = await task;
    return ok && fs.existsSync(targetFile) ? targetFile : null;
  }
  app2.get("/api/video/stream/:id", async (req, res) => {
    const safeId = sanitizeId(req.params.id);
    const customUrl = typeof req.query.url === "string" ? req.query.url : void 0;
    const targetFile = path.join(VIDEOS_CACHE_DIR, `${safeId}.mp4`);
    if (fs.existsSync(targetFile)) {
      return res.sendFile(targetFile, { acceptRanges: true });
    }
    const downloaded = await fetchOrGetVideo(req.params.id, customUrl);
    if (downloaded && fs.existsSync(downloaded)) {
      return res.sendFile(downloaded, { acceptRanges: true });
    }
    return res.status(502).json({ error: "\u52D5\u753B\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" });
  });
  const downloadJobs = /* @__PURE__ */ new Map();
  const dlCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 1e3 * 60 * 60;
    for (const [jobId, job] of downloadJobs.entries()) {
      if (job.createdAt < cutoff) {
        if (job.filePath && fs.existsSync(job.filePath)) {
          try {
            fs.unlinkSync(job.filePath);
          } catch {
          }
        }
        downloadJobs.delete(jobId);
      }
    }
  }, 1e3 * 60 * 10);
  dlCleanupTimer.unref?.();
  app2.post("/api/dl/inspect", async (req, res) => {
    const rawUrl = String(req.body?.url || "").trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: "\u52D5\u753BURL\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    let targetUrl = "";
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: "\u6709\u52B9\u306AURL\uFF08http:// \u307E\u305F\u306F https://\u3001\u307E\u305F\u306F sm\u756A\u53F7\uFF09\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    const nicoId = extractNicoIdFromUrl(targetUrl);
    if (nicoId) {
      try {
        const htmlRes = await fetch(`https://www.nicovideo.jp/watch/${encodeURIComponent(nicoId)}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(7e3)
        });
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const m = html.match(/name="server-response"[^>]*content="([^"]+)"/) || html.match(/content="([^"]+)"[^>]*name="server-response"/);
          if (m) {
            const parsed = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
            const wData = parsed.data?.response?.["$watchV4"]?.data;
            const vInfo = wData?.video;
            const mediaVideos = Array.isArray(wData?.media?.contents?.videos) ? wData.media.contents.videos : [];
            const durSec = Number(vInfo?.duration || 0);
            const mins = Math.floor(durSec / 60);
            const secs = Math.floor(durSec % 60);
            const heights = Array.from(
              new Set(
                mediaVideos.filter((v) => v?.isAvailable !== false).map((v) => parseInt(String(v.id || "").match(/(\d+)p/)?.[1] || "0", 10)).filter((h) => h > 0)
              )
            ).sort((a, b) => b - a);
            const hLabel = (h) => h >= 1080 ? `Full HD (${h}p)` : h >= 720 ? `HD (${h}p)` : h >= 480 ? `\u6A19\u6E96 (${h}p)` : `\u8EFD\u91CF (${h}p)`;
            return res.json({
              ok: true,
              info: {
                id: nicoId,
                rawId: nicoId,
                title: String(vInfo?.title || nicoId),
                uploader: String(wData?.owner?.nickname || wData?.channel?.name || "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B"),
                extractor: "Niconico",
                thumbnail: String(vInfo?.thumbnail?.ogp || vInfo?.thumbnail?.largeUrl || vInfo?.thumbnail?.url || ""),
                duration: durSec,
                durationString: durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--",
                webpageUrl: `https://www.nicovideo.jp/watch/${nicoId}`,
                qualities: (heights.length > 0 ? heights : [720, 480, 360]).map((h) => ({
                  value: String(h),
                  label: hLabel(h),
                  sizeMb: null
                })),
                audioSizeMb: null
              }
            });
          }
        }
      } catch {
      }
    }
    try {
      const ytDlpBin = await ensureYtDlp();
      const rawJson = await new Promise((resolve, reject) => {
        const chunks = [];
        const errChunks = [];
        const proc = spawn(ytDlpBin, [
          "-J",
          "--no-playlist",
          "--no-warnings",
          targetUrl
        ]);
        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error("\u52D5\u753B\u60C5\u5831\u306E\u89E3\u6790\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002"));
        }, 35e3);
        proc.stdout.on("data", (d) => chunks.push(d));
        proc.stderr.on("data", (d) => errChunks.push(d));
        proc.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve(Buffer.concat(chunks).toString("utf8"));
          } else {
            const errStr = Buffer.concat(errChunks).toString("utf8");
            reject(new Error(errStr.slice(0, 300) || `yt-dlp exited with code ${code}`));
          }
        });
        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      const info = JSON.parse(rawJson);
      const entry = Array.isArray(info.entries) && info.entries.length > 0 ? info.entries[0] : info;
      const formats = Array.isArray(entry.formats) ? entry.formats : [];
      const durSec = Number(entry.duration || 0);
      const estimateBytes = (f) => {
        if (!f) return 0;
        if (f.filesize) return Number(f.filesize);
        if (f.filesize_approx) return Number(f.filesize_approx);
        const kbps = Number(f.tbr || f.vbr || f.abr || 0);
        if (kbps > 0 && durSec > 0) {
          return Math.round(kbps * 1e3 * durSec / 8);
        }
        return 0;
      };
      const bestAudio = formats.filter((f) => f.vcodec === "none" && f.acodec && f.acodec !== "none").sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
      const audioBytes = estimateBytes(bestAudio);
      const heightMap = /* @__PURE__ */ new Map();
      for (const f of formats) {
        if (f.height && f.vcodec && f.vcodec !== "none") {
          const h = Number(f.height);
          const sz = estimateBytes(f);
          const prev = heightMap.get(h) || 0;
          if (sz > prev || !heightMap.has(h)) {
            heightMap.set(h, sz);
          }
        }
      }
      const sortedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);
      const heightLabel = (h) => {
        if (h >= 2160) return `4K Ultra HD (${h}p)`;
        if (h >= 1440) return `2K QHD (${h}p)`;
        if (h >= 1080) return `Full HD (${h}p)`;
        if (h >= 720) return `HD (${h}p)`;
        if (h >= 480) return `\u6A19\u6E96 (${h}p)`;
        return `\u8EFD\u91CF (${h}p)`;
      };
      const qualities = sortedHeights.length > 0 ? sortedHeights.map((h) => {
        const vBytes = heightMap.get(h) || 0;
        const totalBytes = vBytes > 0 ? vBytes + audioBytes : 0;
        return {
          value: String(h),
          label: heightLabel(h),
          sizeMb: totalBytes > 0 ? Number((totalBytes / (1024 * 1024)).toFixed(1)) : null
        };
      }) : [
        { value: "1080", label: "Full HD (1080p)", sizeMb: null },
        { value: "720", label: "HD (720p)", sizeMb: null },
        { value: "480", label: "\u6A19\u6E96 (480p)", sizeMb: null },
        { value: "360", label: "\u8EFD\u91CF (360p)", sizeMb: null }
      ];
      const mins = Math.floor(durSec / 60);
      const secs = Math.floor(durSec % 60);
      return res.json({
        ok: true,
        info: {
          id: sanitizeId(entry.id || entry.display_id || "video"),
          rawId: String(entry.id || entry.display_id || ""),
          title: String(entry.title || "\u7121\u984C\u306E\u52D5\u753B"),
          uploader: String(entry.uploader || entry.channel || entry.extractor_key || "\u52D5\u753B\u30B5\u30A4\u30C8"),
          extractor: String(entry.extractor_key || entry.extractor || "Web"),
          thumbnail: String(entry.thumbnail || ""),
          duration: durSec,
          durationString: entry.duration_string || (durSec > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : "--:--"),
          webpageUrl: String(entry.webpage_url || targetUrl),
          qualities,
          audioSizeMb: audioBytes > 0 ? Number((audioBytes / (1024 * 1024)).toFixed(1)) : null
        }
      });
    } catch (err) {
      console.error("/api/dl/inspect error:", err);
      return res.status(502).json({
        ok: false,
        error: err?.message || "\u52D5\u753B\u60C5\u5831\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002URL\u3092\u3054\u78BA\u8A8D\u306E\u3046\u3048\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002"
      });
    }
  });
  app2.post("/api/dl/start", async (req, res) => {
    const rawUrl = String(req.body?.url || "").trim();
    const format = String(req.body?.format || "mp4").toLowerCase();
    const quality = String(req.body?.quality || "720");
    const title = String(req.body?.title || "video").trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: "URL\u304C\u6307\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002" });
    }
    let targetUrl = "";
    try {
      targetUrl = normalizeTargetUrl(rawUrl, req.body?.platform);
    } catch {
      return res.status(400).json({ ok: false, error: "\u7121\u52B9\u306AURL\u3067\u3059\u3002" });
    }
    const allowedFormats = /* @__PURE__ */ new Set(["mp4", "mp3", "webm", "mkv", "avi", "iphone", "android"]);
    const safeFormat = allowedFormats.has(format) ? format : "mp4";
    const ext = safeFormat === "iphone" || safeFormat === "android" ? "mp4" : safeFormat;
    const jobId = crypto.randomBytes(8).toString("hex");
    const dlDir = path.resolve("/tmp/muratube_downloads");
    if (!fs.existsSync(dlDir)) {
      fs.mkdirSync(dlDir, { recursive: true });
    }
    const outTemplate = path.join(dlDir, `${jobId}.%(ext)s`);
    const safeTitle = title.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 80) || "video";
    const downloadFileName = safeFormat === "mp3" ? `${safeTitle}.mp3` : `${safeTitle}_${quality}p.${ext}`;
    const job = {
      id: jobId,
      url: targetUrl,
      title: safeTitle,
      format: safeFormat,
      quality,
      status: "preparing",
      percent: 0,
      totalSize: "",
      speed: "",
      eta: "",
      stage: "yt-dlp \u3092\u6E96\u5099\u4E2D...",
      fileName: downloadFileName,
      createdAt: Date.now()
    };
    downloadJobs.set(jobId, job);
    (async () => {
      try {
        const nicoId = extractNicoIdFromUrl(targetUrl);
        if (nicoId && (!hasFfmpeg() || safeFormat === "mp4" || safeFormat === "iphone" || safeFormat === "android")) {
          job.status = "downloading";
          job.stage = "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B\u30B9\u30C8\u30EA\u30FC\u30E0\u3092\u53D6\u5F97\u4E2D (ffmpeg\u4E0D\u8981)...";
          const outBase = path.join(dlDir, jobId);
          const result = await downloadNiconicoWithoutFfmpeg({
            nicoId,
            quality,
            audioOnly: safeFormat === "mp3",
            outPath: outBase,
            isCancelled: () => downloadJobs.get(jobId)?.status === "cancelled",
            onProgress: (pct, stage, bytes) => {
              job.percent = pct;
              job.stage = stage;
              job.totalSize = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            }
          });
          if (downloadJobs.get(jobId)?.status === "cancelled") {
            try {
              fs.unlinkSync(result.filePath);
            } catch {
            }
            return;
          }
          const stat = fs.statSync(result.filePath);
          job.filePath = result.filePath;
          job.fileSize = stat.size;
          job.fileName = safeFormat === "mp3" ? `${safeTitle}.${result.ext}` : `${safeTitle}_${quality}p.${result.ext}`;
          job.percent = 100;
          job.status = "done";
          job.stage = "\u5B8C\u4E86\uFF01\u7AEF\u672B\u3078\u4FDD\u5B58\u3067\u304D\u307E\u3059";
          return;
        }
        const ytDlpBin = await ensureYtDlp();
        const args = buildDownloadArgs(targetUrl, safeFormat, quality, outTemplate);
        job.stage = "\u52D5\u753B\u30B9\u30C8\u30EA\u30FC\u30E0\u3092\u53D6\u5F97\u4E2D...";
        job.status = "downloading";
        const child = spawn(ytDlpBin, args);
        job.process = child;
        const handleOutputLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          const dlMatch = trimmed.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([^\s]+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/);
          if (dlMatch) {
            const pct = Math.min(94, Math.max(job.percent, Math.round(parseFloat(dlMatch[1]))));
            job.status = "downloading";
            job.percent = pct;
            job.totalSize = dlMatch[2] || job.totalSize;
            job.speed = dlMatch[3] || job.speed;
            job.eta = dlMatch[4] || "";
            job.stage = "\u52D5\u753B\u30FB\u97F3\u58F0\u3092\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u4E2D...";
          } else if (trimmed.includes("[Merger]") || trimmed.includes("[ExtractAudio]") || trimmed.includes("[VideoConvertor]") || trimmed.includes("[ffmpeg]")) {
            job.status = "converting";
            job.percent = Math.max(job.percent, 95);
            job.stage = safeFormat === "mp3" ? "\u97F3\u58F0\u3092\u62BD\u51FA\u4E2D..." : `${ext.toUpperCase()}\u5F62\u5F0F\u3078\u5909\u63DB\u30FB\u7D50\u5408\u4E2D...`;
          }
        };
        let stdoutBuf = "";
        child.stdout.on("data", (chunk) => {
          stdoutBuf += chunk.toString("utf8");
          const lines = stdoutBuf.split(/\r?\n|\r/);
          stdoutBuf = lines.pop() || "";
          lines.forEach(handleOutputLine);
        });
        let stderrText = "";
        child.stderr.on("data", (chunk) => {
          const txt = chunk.toString("utf8");
          stderrText += txt;
          txt.split(/\r?\n|\r/).forEach(handleOutputLine);
        });
        child.on("close", (code) => {
          job.process = void 0;
          if (job.status === "cancelled") {
            const files2 = fs.readdirSync(dlDir).filter((f) => f.startsWith(`${jobId}.`));
            files2.forEach((f) => {
              try {
                fs.unlinkSync(path.join(dlDir, f));
              } catch {
              }
            });
            return;
          }
          const files = fs.readdirSync(dlDir).filter((f) => f.startsWith(`${jobId}.`) && !f.endsWith(".part") && !f.endsWith(".ytdl"));
          const preferred = files.find((f) => f.endsWith(`.${ext}`)) || files[0];
          if (code === 0 && preferred) {
            const fullPath = path.join(dlDir, preferred);
            const stat = fs.statSync(fullPath);
            const actualExt = path.extname(preferred).replace(/^\./, "") || ext;
            job.filePath = fullPath;
            job.fileSize = stat.size;
            job.fileName = safeFormat === "mp3" ? `${safeTitle}.${actualExt}` : `${safeTitle}_${quality}p.${actualExt}`;
            job.percent = 100;
            job.status = "done";
            job.stage = "\u5B8C\u4E86\uFF01\u7AEF\u672B\u3078\u4FDD\u5B58\u3067\u304D\u307E\u3059";
          } else {
            job.status = "error";
            job.error = stderrText.trim().slice(-240) || `\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u306B\u5931\u6557\u3057\u307E\u3057\u305F (code ${code})`;
            job.stage = "\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F";
          }
        });
        child.on("error", (err) => {
          job.process = void 0;
          job.status = "error";
          job.error = err.message;
          job.stage = "\u5B9F\u884C\u30A8\u30E9\u30FC";
        });
      } catch (err) {
        job.status = "error";
        job.error = err?.message || "\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F";
        job.stage = "\u30A8\u30E9\u30FC";
      }
    })();
    return res.json({ ok: true, jobId });
  });
  app2.get("/api/dl/direct", async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    const quality = String(req.query.quality || "720").replace(/\D/g, "") || "720";
    const format = String(req.query.format || "mp4").toLowerCase();
    const title = String(req.query.title || "video").trim();
    if (!rawUrl) return res.status(400).send("Missing url");
    let targetUrl = "";
    try {
      targetUrl = normalizeTargetUrl(rawUrl);
    } catch {
      return res.status(400).send("Invalid url");
    }
    const audioOnly = format === "mp3";
    const safeTitle = title.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 80) || "video";
    try {
      const resolved = await resolveFreemakeStream(targetUrl, quality, audioOnly);
      const upstreamUrl = resolved.directUrl || resolved.audioUrl || resolved.videoUrl;
      if (!upstreamUrl) {
        return res.status(404).send("\u76F4\u63A5\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u53EF\u80FD\u306A\u5358\u4E00\u30B9\u30C8\u30EA\u30FC\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F");
      }
      const upstream = await fetch(upstreamUrl, { headers: resolved.httpHeaders || {}, signal: AbortSignal.timeout(3e4) });
      if (!upstream.ok || !upstream.body) {
        return res.status(upstream.status || 502).send("Upstream error");
      }
      const ct = upstream.headers.get("content-type") || (audioOnly ? "audio/mp4" : "video/mp4");
      const ext = ct.includes("webm") ? "webm" : audioOnly ? ct.includes("mpeg") ? "mp3" : "m4a" : "mp4";
      const filename = audioOnly ? `${safeTitle}.${ext}` : `${safeTitle}_${quality}p.${ext}`;
      const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_") || "download";
      res.setHeader("Content-Type", ct);
      res.setHeader("Content-Disposition", `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      const cl = upstream.headers.get("content-length");
      if (cl) res.setHeader("Content-Length", cl);
      const reader = upstream.body.getReader();
      req.on("close", () => {
        reader.cancel().catch(() => {
        });
      });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    } catch (err) {
      if (!res.headersSent) return res.status(502).send(err?.message || "Direct download failed");
    }
  });
  app2.get("/api/dl/progress/:jobId", (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "\u30B8\u30E7\u30D6\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002" });
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
  app2.get("/api/dl/file/:jobId", (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job || job.status !== "done" || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(404).json({ ok: false, error: "\u30D5\u30A1\u30A4\u30EB\u304C\u307E\u3060\u6E96\u5099\u3067\u304D\u3066\u3044\u307E\u305B\u3093\u3002" });
    }
    const filename = job.fileName || path.basename(job.filePath);
    const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_") || "download";
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    return res.sendFile(job.filePath);
  });
  app2.post("/api/dl/cancel/:jobId", (req, res) => {
    const job = downloadJobs.get(req.params.jobId);
    if (!job) {
      return res.json({ ok: true });
    }
    job.status = "cancelled";
    if (job.process) {
      try {
        job.process.kill("SIGTERM");
      } catch {
      }
    }
    return res.json({ ok: true });
  });
  const deleteDownloadJobHandler = (req, res) => {
    const jobId = sanitizeId(req.params.jobId);
    const job = downloadJobs.get(jobId);
    if (job) {
      job.status = "cancelled";
      if (job.process) {
        try {
          job.process.kill("SIGTERM");
        } catch {
        }
      }
      if (job.filePath && fs.existsSync(job.filePath)) {
        try {
          fs.unlinkSync(job.filePath);
        } catch {
        }
      }
      downloadJobs.delete(jobId);
    }
    const dlDir = path.resolve("/tmp/muratube_downloads");
    if (fs.existsSync(dlDir)) {
      try {
        const files = fs.readdirSync(dlDir).filter((f) => f.startsWith(`${jobId}.`));
        files.forEach((f) => {
          try {
            fs.unlinkSync(path.join(dlDir, f));
          } catch {
          }
        });
      } catch {
      }
    }
    return res.json({ ok: true, deleted: true, jobId });
  };
  app2.delete("/api/dl/job/:jobId", deleteDownloadJobHandler);
  app2.post("/api/dl/delete/:jobId", deleteDownloadJobHandler);
  app2.get("/api/download/:id", async (req, res) => {
    const safeId = sanitizeId(req.params.id);
    const quality = req.query.quality || "720";
    const rawType = String(req.query.type || "mp4").toLowerCase();
    const allowedFormats = /* @__PURE__ */ new Set(["mp4", "mp3", "webm", "mkv", "avi", "iphone", "android"]);
    const type = allowedFormats.has(rawType) ? rawType : "mp4";
    const ext = type === "iphone" || type === "android" ? "mp4" : type;
    const customUrl = typeof req.query.url === "string" ? req.query.url : "";
    let targetUrl = "";
    try {
      targetUrl = customUrl ? normalizeTargetUrl(customUrl, req.query.platform) : normalizeTargetUrl(req.params.id, req.query.platform);
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }
    const dlDir = path.resolve("/tmp/muratube_downloads");
    if (!fs.existsSync(dlDir)) {
      fs.mkdirSync(dlDir, { recursive: true });
    }
    const outTemplate = path.join(dlDir, `${safeId}_${quality}_${type}.%(ext)s`);
    const expectedFile = path.join(dlDir, `${safeId}_${quality}_${type}.${ext}`);
    if (fs.existsSync(expectedFile)) {
      return res.download(expectedFile, `[mura\u306B\u3053]_${safeId}.${ext}`);
    }
    try {
      const nicoId = extractNicoIdFromUrl(targetUrl);
      if (nicoId) {
        const outBase = path.join(dlDir, `${safeId}_${quality}_${type}`);
        const dlRes = await downloadNiconicoWithoutFfmpeg({
          nicoId,
          quality,
          audioOnly: type === "mp3",
          outPath: outBase
        });
        return res.download(dlRes.filePath, `[mura\u306B\u3053]_${safeId}_${quality}p.${dlRes.ext}`);
      }
      const ytDlpBin = await ensureYtDlp();
      const args = buildDownloadArgs(targetUrl, type, quality, outTemplate);
      const child = spawn(ytDlpBin, args);
      child.on("close", (code) => {
        if (code === 0 && fs.existsSync(expectedFile)) {
          return res.download(expectedFile, `[mura\u306B\u3053]_${safeId}_${quality}p.${ext}`);
        }
        const files = fs.readdirSync(dlDir);
        const found = files.find((f) => f.startsWith(`${safeId}_${quality}_${type}`) && !f.endsWith(".part"));
        if (found) {
          return res.download(path.join(dlDir, found), `[mura\u306B\u3053]_${found}`);
        }
        if (!res.headersSent) {
          return res.status(500).json({ error: `yt-dlp download failed (code ${code})` });
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
  const FALLBACK_VIDEOS = [
    {
      id: "sm40320938",
      title: "\u3010\u6700\u9AD8\u753B\u8CEA/\u6700\u9AD8\u97F3\u8CEA\u3011Official\u9AED\u7537dism - \u30DF\u30C3\u30AF\u30B9\u30CA\u30C3\u30C4 MV",
      channel: "Official\u9AED\u7537dism",
      channel_url: "https://www.nicovideo.jp/watch/sm40320938",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/40320938/40320938.84330666",
      duration: "03:49",
      views: 4829100,
      url: "https://www.nicovideo.jp/watch/sm40320938",
      platform: "niconico",
      category: "\u97F3\u697D",
      description: "TV\u30A2\u30CB\u30E1\u300ESPY\xD7FAMILY\u300F\u30AA\u30FC\u30D7\u30CB\u30F3\u30B0\u4E3B\u984C\u6B4C Official\u9AED\u7537dism - \u30DF\u30C3\u30AF\u30B9\u30CA\u30C3\u30C4 MV",
      uploadedAt: "2022/04/15",
      likeCount: 129400,
      commentCount: 8420,
      subscribers: 45e4,
      nicoId: "sm40320938"
    },
    {
      id: "sm9",
      title: "\u65B0\u30FB\u8C6A\u8840\u5BFA\u4E00\u65CF -\u7169\u60A9\u89E3\u653E - \u30EC\u30C3\u30C4\u30B4\u30FC\uFF01\u9670\u967D\u5E2B",
      channel: "\u4E2D\u306E",
      channel_url: "https://www.nicovideo.jp/user/4",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/9/9",
      duration: "05:20",
      views: 23104343,
      url: "https://www.nicovideo.jp/watch/sm9",
      platform: "niconico",
      category: "\u97F3\u697D",
      description: "\u30EC\u30C3\u30C4\u30B4\u30FC\uFF01\u9670\u967D\u5E2B\uFF08\u30D5\u30EB\u30B3\u30FC\u30E9\u30B9\u30D0\u30FC\u30B8\u30E7\u30F3\uFF09",
      uploadedAt: "2007/03/06",
      likeCount: 183219,
      commentCount: 512e4,
      subscribers: 197823,
      nicoId: "sm9"
    },
    {
      id: "sm1097445",
      title: "\u3010\u521D\u97F3\u30DF\u30AF\u3011\u307F\u304F\u307F\u304F\u306B\u3057\u3066\u3042\u3052\u308B\u266A\u3010\u3057\u3066\u3084\u3093\u3088\u3011",
      channel: "ika",
      channel_url: "https://www.nicovideo.jp/user/70391",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/1097445/1097445",
      duration: "01:39",
      views: 17322896,
      url: "https://www.nicovideo.jp/watch/sm1097445",
      platform: "niconico",
      category: "\u97F3\u697D",
      description: "\u304A\u307E\u3048\u3089\u3001\u307F\u3063\u304F\u307F\u304F\u306B\u3057\u3066\u3084\u3093\u3088\u3002",
      uploadedAt: "2007/09/20",
      likeCount: 231390,
      commentCount: 342e4,
      subscribers: 101379,
      nicoId: "sm1097445"
    },
    {
      id: "sm1715919",
      title: "\u521D\u97F3\u30DF\u30AF\u3000\u304C\u3000\u30AA\u30EA\u30B8\u30CA\u30EB\u66F2\u3092\u6B4C\u3063\u3066\u304F\u308C\u305F\u3088\u300C\u30E1\u30EB\u30C8\u300D",
      channel: "ryo",
      channel_url: "https://www.nicovideo.jp/user/317063",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/1715919/1715919",
      duration: "04:16",
      views: 17191729,
      url: "https://www.nicovideo.jp/watch/sm1715919",
      platform: "niconico",
      category: "\u97F3\u697D",
      description: "\u604B\u3068\u6226\u4E89\u306B\u304A\u3044\u3066\u306F\u3042\u3089\u3086\u308B\u6226\u8853\u304C\u8A31\u3055\u308C\u308B",
      uploadedAt: "2007/12/07",
      likeCount: 311258,
      commentCount: 284e4,
      subscribers: 109990,
      nicoId: "sm1715919"
    },
    {
      id: "sm15630734",
      title: "\u300E\u521D\u97F3\u30DF\u30AF\u300F\u5343\u672C\u685C\u300E\u30AA\u30EA\u30B8\u30CA\u30EB\u66F2PV\u300F",
      channel: "\u9ED2\u3046\u3055",
      channel_url: "https://www.nicovideo.jp/user/449061",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/15630734/15630734.34480305",
      duration: "04:04",
      views: 18769865,
      url: "https://www.nicovideo.jp/watch/sm15630734",
      platform: "niconico",
      category: "\u97F3\u697D",
      description: "\u5343\u672C\u685C \u591C\u30CB\u7D1B\u30EC \u541B\u30CE\u58F0\u30E2\u5C4A\u30AB\u30CA\u30A4\u30E8",
      uploadedAt: "2011/09/17",
      likeCount: 333674,
      commentCount: 219e4,
      subscribers: 450574,
      nicoId: "sm15630734"
    },
    {
      id: "sm8628149",
      title: "\u3010\u6771\u65B9\u3011Bad Apple!!\u3000\uFF30\uFF36\u3010\u5F71\u7D75\u3011",
      channel: "\u3042\u306B\u3089",
      channel_url: "https://www.nicovideo.jp/user/10731211",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/8628149/8628149",
      duration: "03:39",
      views: 31445518,
      url: "https://www.nicovideo.jp/watch/sm8628149",
      platform: "niconico",
      category: "\u6771\u65B9",
      description: "Bad Apple!! feat. nomico \u5F71\u7D75PV",
      uploadedAt: "2009/10/27",
      likeCount: 674218,
      commentCount: 395e4,
      subscribers: 347089,
      nicoId: "sm8628149"
    },
    {
      id: "sm2057168",
      title: "M.C.\u30C9\u30CA\u30EB\u30C9\u306F\u30C0\u30F3\u30B9\u306B\u5922\u4E2D\u306A\u306E\u304B\uFF1F\u6700\u7D42\u9B3C\u755C\u9053\u5316\u5E2B\u30C9\u30CA\u30EB\u30C9\u30FB\uFF2D",
      channel: "\u307F\u304F\u308B",
      channel_url: "https://www.nicovideo.jp/user/921777",
      channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: "https://nicovideo.cdn.nimg.jp/thumbnails/2057168/2057168",
      duration: "03:19",
      views: 1542e4,
      url: "https://www.nicovideo.jp/watch/sm2057168",
      platform: "niconico",
      category: "MAD",
      description: "\u3089\u3093\u3089\u3093\u308B\u30FC\uFF01",
      uploadedAt: "2008/01/16",
      likeCount: 198e3,
      commentCount: 18e5,
      subscribers: 89e3,
      nicoId: "sm2057168"
    }
  ];
  const NICO_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-Frontend-Id": "6",
    "X-Frontend-Version": "0",
    "Referer": "https://www.nicovideo.jp/",
    "Origin": "https://www.nicovideo.jp"
  };
  const watchV3Cache = /* @__PURE__ */ new Map();
  async function fetchNicoWatchV3Guest(id) {
    const cleanId = sanitizeId(id);
    const cached = watchV3Cache.get(cleanId);
    if (cached && Date.now() - cached.timestamp < 1e3 * 60 * 5) {
      return cached.data;
    }
    const trackId = `${crypto.randomBytes(5).toString("hex")}_${Date.now()}`;
    try {
      const resp = await fetch(
        `https://www.nicovideo.jp/api/watch/v3_guest/${encodeURIComponent(cleanId)}?actionTrackId=${encodeURIComponent(trackId)}`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6e3) }
      );
      if (!resp.ok) return null;
      const json = await resp.json();
      if (json?.meta?.status === 200 && json?.data) {
        watchV3Cache.set(cleanId, { data: json.data, timestamp: Date.now() });
        return json.data;
      }
    } catch (err) {
      console.warn("watch/v3_guest error:", err);
    }
    return null;
  }
  function decodeXmlEntities(str) {
    return String(str || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  function stripHtmlTags(str) {
    return decodeXmlEntities(String(str || "")).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
  }
  function extractXmlTag(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? decodeXmlEntities(m[1].trim()) : "";
  }
  function mapNvapiEssentialToVideo(raw) {
    const ess = raw?.essential || raw?.content || raw || {};
    const id = String(ess.id || "");
    const owner = ess.owner || {};
    const ownerId = owner.id ? String(owner.id) : "";
    const isChannel = owner.ownerType === "channel" || ess.isChannelVideo;
    const thumbObj = ess.thumbnail || {};
    const thumb = thumbObj.nHdUrl || thumbObj.largeUrl || thumbObj.middleUrl || thumbObj.url || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, "")}/${id.replace(/\D/g, "")}`;
    const registeredAt = ess.registeredAt ? String(ess.registeredAt).slice(0, 10).replace(/-/g, "/") : "2026/01/01";
    return {
      id,
      nicoId: id,
      title: String(ess.title || `\u52D5\u753B ${id}`),
      channel: String(owner.name || "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B"),
      userId: !isChannel ? ownerId : void 0,
      channelId: isChannel ? ownerId : void 0,
      channel_url: ownerId ? isChannel ? `https://ch.nicovideo.jp/${ownerId.startsWith("ch") ? ownerId : `ch${ownerId}`}` : `https://www.nicovideo.jp/user/${ownerId}` : "",
      channelAvatar: owner.iconUrl || "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
      thumbnail: thumb,
      duration: formatSecToDuration(Number(ess.duration || 0)),
      views: Number(ess.count?.view || 0),
      commentCount: Number(ess.count?.comment || 0),
      mylistCount: Number(ess.count?.mylist || 0),
      likeCount: Number(ess.count?.like || 0),
      url: `https://www.nicovideo.jp/watch/${id}`,
      platform: "niconico",
      category: "\u7DCF\u5408",
      description: String(ess.shortDescription || ""),
      uploadedAt: registeredAt,
      subscribers: 0
    };
  }
  const NICO_COLOR_MAP = {
    white: "#ffffff",
    red: "#ff3333",
    pink: "#ff8080",
    orange: "#ffc000",
    yellow: "#ffff00",
    green: "#00ff00",
    cyan: "#00ffff",
    blue: "#3399ff",
    purple: "#cc66ff",
    black: "#333333",
    white2: "#cccc99",
    niconicowhite: "#cccc99",
    red2: "#cc0033",
    truered: "#cc0033",
    pink2: "#ff33cc",
    orange2: "#ff6600",
    passionorange: "#ff6600",
    yellow2: "#999900",
    madyellow: "#999900",
    green2: "#00cc66",
    elementalgreen: "#00cc66",
    cyan2: "#00cccc",
    blue2: "#3399ff",
    marineblue: "#3399ff",
    purple2: "#6633cc",
    nobleviolet: "#6633cc",
    black2: "#666666"
  };
  function parseNicoCommands(commands = []) {
    let color = "#ffffff";
    let position = "naka";
    let size = "medium";
    for (const cmd of commands) {
      const lower = String(cmd || "").toLowerCase();
      if (lower === "ue") position = "ue";
      else if (lower === "shita") position = "shita";
      else if (lower === "big") size = "big";
      else if (lower === "small") size = "small";
      else if (/^#[0-9a-f]{6}$/i.test(lower)) color = lower;
      else if (NICO_COLOR_MAP[lower]) color = NICO_COLOR_MAP[lower];
    }
    return { color, position, size };
  }
  app2.get("/api/nico/search", async (req, res) => {
    const q = (req.query.q || "").trim();
    const sort = (req.query.sort || "v").trim();
    const order = (req.query.order || "d").trim();
    const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    try {
      const result = await searchNiconicoSnapshot({ q, sort, order, page, limit: 20 });
      if (result.items.length > 0) {
        return res.json({ success: true, items: result.items, total: result.total, hasNext: result.hasNext });
      }
    } catch (err) {
      console.warn("/api/nico/search snapshot error:", err);
    }
    if (q) {
      try {
        const sortKeyMap = { v: "viewCount", f: "registeredAt", r: "commentCount", m: "mylistCount", l: "likeCount" };
        const sortKey = sortKeyMap[sort] || "viewCount";
        const nvResp = await fetch(
          `https://nvapi.nicovideo.jp/v2/search/video?keyword=${encodeURIComponent(q)}&sortKey=${sortKey}&sortOrder=${order === "a" ? "asc" : "desc"}&pageSize=20&page=${page}`,
          { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6e3) }
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
        console.warn("/api/nico/search nvapi fallback error:", err);
      }
    }
    const qLower = q.toLowerCase();
    const filtered = FALLBACK_VIDEOS.filter(
      (v) => !qLower || v.title.toLowerCase().includes(qLower) || v.id.toLowerCase().includes(qLower) || v.channel.toLowerCase().includes(qLower) || v.description.toLowerCase().includes(qLower)
    );
    return res.json({ success: true, items: filtered, total: filtered.length, hasNext: false });
  });
  app2.get("/api/nico/ranking", async (req, res) => {
    const genre = (req.query.genre || "all").trim();
    const termRaw = (req.query.term || "24h").trim();
    const validTerms = ["hour", "24h", "week", "month", "total"];
    const term = validTerms.includes(termRaw) ? termRaw : "24h";
    const nvapiGenreMap = {
      all: "all",
      game: "game",
      anime: "anime",
      music_sound: "music_sound",
      entertainment: "entertainment",
      dance: "dance"
    };
    if (nvapiGenreMap[genre]) {
      try {
        const resp = await fetch(
          `https://nvapi.nicovideo.jp/v1/ranking/genre/${encodeURIComponent(nvapiGenreMap[genre])}?term=${encodeURIComponent(term)}`,
          { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6e3) }
        );
        if (resp.ok) {
          const json = await resp.json();
          const items = (json?.data?.items || []).slice(0, 24).map(mapNvapiEssentialToVideo);
          if (items.length > 0) {
            return res.json({ success: true, items, total: items.length, source: "nvapi", term });
          }
        }
      } catch (err) {
        console.warn("/api/nico/ranking nvapi error:", err);
      }
    }
    const termDaysMap = { hour: 1, "24h": 1, week: 7, month: 30, total: 0 };
    try {
      const result = await searchNiconicoSnapshot({
        q: "",
        sort: "v",
        order: "d",
        page: 1,
        limit: 24,
        genre,
        recentDays: termDaysMap[term] ?? 7
      });
      if (result.items.length > 0) {
        return res.json({ success: true, items: result.items, total: result.items.length, source: "snapshot", term });
      }
      const wider = await searchNiconicoSnapshot({ q: "", sort: "v", order: "d", page: 1, limit: 24, genre });
      if (wider.items.length > 0) {
        return res.json({ success: true, items: wider.items, total: wider.items.length, source: "snapshot", term });
      }
    } catch (err) {
      console.warn("/api/nico/ranking snapshot error:", err);
    }
    return res.json({ success: true, items: FALLBACK_VIDEOS, total: FALLBACK_VIDEOS.length });
  });
  app2.get("/api/nico/comments/:id", async (req, res) => {
    const id = sanitizeId(req.params.id);
    try {
      const v3 = await fetchNicoWatchV3Guest(id);
      const nvc = v3?.comment?.nvComment;
      if (nvc?.server && nvc?.threadKey && nvc?.params) {
        const cResp = await fetch(`${nvc.server}/v1/threads`, {
          method: "POST",
          headers: {
            ...NICO_API_HEADERS,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            params: nvc.params,
            threadKey: nvc.threadKey,
            additionals: {}
          }),
          signal: AbortSignal.timeout(6e3)
        });
        if (cResp.ok) {
          const cJson = await cResp.json();
          const threads = Array.isArray(cJson?.data?.threads) ? cJson.data.threads : [];
          const rawComments = [];
          for (const th of threads) {
            if (Array.isArray(th.comments)) {
              for (const c of th.comments) {
                if (typeof c.score === "number" && c.score <= -1e4) continue;
                if (!c.body) continue;
                rawComments.push(c);
              }
            }
          }
          if (rawComments.length > 0) {
            rawComments.sort((a, b) => Number(a.vposMs || 0) - Number(b.vposMs || 0));
            const seen = /* @__PURE__ */ new Set();
            const comments2 = [];
            for (const c of rawComments) {
              const cid = String(c.id || `${c.vposMs}-${c.body}`);
              if (seen.has(cid)) continue;
              seen.add(cid);
              const parsedCmd = parseNicoCommands(Array.isArray(c.commands) ? c.commands : []);
              comments2.push({
                id: cid,
                text: String(c.body),
                timeMs: Number(c.vposMs || 0),
                commands: Array.isArray(c.commands) ? c.commands : [],
                color: parsedCmd.color,
                position: parsedCmd.position,
                size: parsedCmd.size,
                postedAt: c.postedAt || "",
                score: Number(c.score || 0),
                nicoruCount: Number(c.nicoruCount || 0)
              });
              if (comments2.length >= 250) break;
            }
            return res.json({ success: true, source: "nvcomment", count: comments2.length, comments: comments2 });
          }
        }
      }
    } catch (err) {
      console.warn("/api/nico/comments nvcomment error:", err);
    }
    const sampleComments = [
      "\u3046\u307D\u3064\uFF01",
      "8888888888888888",
      "\u795E\u66F2\u304D\u305F\u3042\u3042\u3042\u3042\u3042\u3042",
      "\u3053\u3053\u3059\u304D",
      "\u9CE5\u808C\u7ACB\u3063\u305F\u308F",
      "\u5929\u624D\u304B\u3088",
      "\u306A\u3064\u304B\u3057\u3044ww",
      "\u8349",
      "wwwwwwwwwwww",
      "\u6700\u9AD8\u3059\u304E\u308B",
      "\u97F3\u8CEA\u3088\u3059\u304E",
      "\u4F55\u56DE\u8074\u3044\u3066\u3082\u98FD\u304D\u306A\u3044",
      "\u6B4C\u8A5E\u304C\u523A\u3055\u308B",
      "\u3046\u307D\u3064\u3067\u3059\uFF01\uFF01",
      "\u5F3E\u5E55\u8584\u3044\u305E\u4F55\u3084\u3063\u3066\u3093\u306E\uFF01"
    ];
    const comments = sampleComments.map((text, idx) => ({
      id: `fallback-comment-${idx}`,
      text,
      timeMs: idx * 2500,
      commands: [],
      color: "#ffffff",
      position: "naka",
      size: "medium"
    }));
    return res.json({ success: true, source: "fallback", count: comments.length, comments });
  });
  app2.get("/api/nico/video/:id", async (req, res) => {
    const id = sanitizeId(req.params.id);
    try {
      const d = await fetchNicoWatchV3Guest(id);
      if (d?.video) {
        const v = d.video;
        const owner = d.owner;
        const ch = d.channel;
        const isChannel = Boolean(ch && !owner);
        const ownerId = owner?.id ? String(owner.id) : ch?.id ? String(ch.id) : "";
        const thumb = v.thumbnail?.ogp || v.thumbnail?.player || v.thumbnail?.largeUrl || v.thumbnail?.url || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, "")}/${id.replace(/\D/g, "")}`;
        const video = {
          id,
          nicoId: id,
          title: String(v.title || `\u52D5\u753B ${id}`),
          channel: String(owner?.nickname || ch?.name || "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B"),
          userId: !isChannel && ownerId ? ownerId : void 0,
          channelId: isChannel && ownerId ? ownerId : void 0,
          channel_url: ownerId ? isChannel ? `https://ch.nicovideo.jp/${ownerId}` : `https://www.nicovideo.jp/user/${ownerId}` : "",
          channelAvatar: owner?.iconUrl || ch?.thumbnail?.url || "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
          thumbnail: thumb,
          duration: formatSecToDuration(Number(v.duration || 0)),
          views: Number(v.count?.view || 0),
          commentCount: Number(v.count?.comment || 0),
          mylistCount: Number(v.count?.mylist || 0),
          likeCount: Number(v.count?.like || 0),
          url: `https://www.nicovideo.jp/watch/${id}`,
          platform: "niconico",
          category: String(d.genre?.label || "\u7DCF\u5408"),
          description: stripHtmlTags(v.description || ""),
          uploadedAt: v.registeredAt ? String(v.registeredAt).slice(0, 10).replace(/-/g, "/") : "2026/01/01",
          tags: Array.isArray(d.tag?.items) ? d.tag.items.map((t) => ({ name: String(t.name), isLocked: Boolean(t.isLocked) })) : [],
          series: d.series ? { id: Number(d.series.id), title: String(d.series.title) } : null,
          subscribers: 0
        };
        return res.json({ success: true, source: "v3_guest", video });
      }
    } catch (err) {
      console.warn("/api/nico/video v3_guest error:", err);
    }
    try {
      const xmlResp = await fetch(`https://ext.nicovideo.jp/api/getthumbinfo/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(5e3)
      });
      if (xmlResp.ok) {
        const xml = await xmlResp.text();
        if (xml.includes('<nicovideo_thumb_response status="ok">')) {
          const title = extractXmlTag(xml, "title");
          const description = extractXmlTag(xml, "description");
          const thumbnail = extractXmlTag(xml, "thumbnail_url");
          const lengthStr = extractXmlTag(xml, "length");
          const viewCounter = parseInt(extractXmlTag(xml, "view_counter") || "0", 10);
          const commentNum = parseInt(extractXmlTag(xml, "comment_num") || "0", 10);
          const mylistCounter = parseInt(extractXmlTag(xml, "mylist_counter") || "0", 10);
          const userId = extractXmlTag(xml, "user_id");
          const userNickname = extractXmlTag(xml, "user_nickname") || extractXmlTag(xml, "ch_name") || "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B";
          const userIcon = extractXmlTag(xml, "user_icon_url") || "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg";
          const firstRetrieve = extractXmlTag(xml, "first_retrieve").slice(0, 10).replace(/-/g, "/") || "2026/01/01";
          const tagMatches = Array.from(xml.matchAll(/<tag[^>]*>([\s\S]*?)<\/tag>/gi)).map((m) => ({
            name: decodeXmlEntities(m[1].trim()),
            isLocked: m[0].includes('lock="1"')
          }));
          return res.json({
            success: true,
            source: "getthumbinfo",
            video: {
              id,
              nicoId: id,
              title: title || `\u52D5\u753B ${id}`,
              channel: userNickname,
              userId: userId || void 0,
              channel_url: userId ? `https://www.nicovideo.jp/user/${userId}` : "",
              channelAvatar: userIcon,
              thumbnail: thumbnail || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, "")}/${id.replace(/\D/g, "")}`,
              duration: lengthStr || "04:00",
              views: viewCounter,
              commentCount: commentNum,
              mylistCount: mylistCounter,
              likeCount: 0,
              url: `https://www.nicovideo.jp/watch/${id}`,
              platform: "niconico",
              category: "\u7DCF\u5408",
              description,
              uploadedAt: firstRetrieve,
              tags: tagMatches,
              subscribers: 0
            }
          });
        }
      }
    } catch (err) {
      console.warn("/api/nico/video getthumbinfo error:", err);
    }
    try {
      const ytDlpBin = await ensureYtDlp();
      const targetUrl = `https://www.nicovideo.jp/watch/${id}`;
      const rawJson = await new Promise((resolve, reject) => {
        const chunks = [];
        const proc = spawn(ytDlpBin, ["-J", "--no-playlist", "--no-warnings", targetUrl]);
        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error("timeout"));
        }, 15e3);
        proc.stdout.on("data", (d) => chunks.push(d));
        proc.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
          else reject(new Error(`yt-dlp code ${code}`));
        });
        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      const entry = JSON.parse(rawJson);
      const durSec = Number(entry.duration || 0);
      const video = {
        id,
        title: entry.title || `\u52D5\u753B ${id}`,
        channel: entry.uploader || "\u30CB\u30B3\u30CB\u30B3\u52D5\u753B",
        channel_url: entry.uploader_url || "",
        channelAvatar: "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
        thumbnail: entry.thumbnail || `https://nicovideo.cdn.nimg.jp/thumbnails/${id.replace(/\D/g, "")}/${id.replace(/\D/g, "")}`,
        duration: durSec > 0 ? `${Math.floor(durSec / 60)}:${String(Math.floor(durSec % 60)).padStart(2, "0")}` : "04:00",
        views: Number(entry.view_count || 1e3),
        url: targetUrl,
        platform: "niconico",
        category: "\u7DCF\u5408",
        description: entry.description || "",
        uploadedAt: "2026/01/01",
        likeCount: Number(entry.like_count || 100),
        commentCount: Number(entry.comment_count || 50),
        subscribers: 0,
        nicoId: id
      };
      return res.json({ success: true, source: "yt-dlp", video });
    } catch (e) {
      return res.status(404).json({ success: false, error: e.message || "Not found" });
    }
  });
  app2.get("/api/nico/related/:id", async (req, res) => {
    const id = sanitizeId(req.params.id);
    try {
      const resp = await fetch(
        `https://nvapi.nicovideo.jp/v1/recommend?recipeId=video_watch_recommendation&videoId=${encodeURIComponent(id)}&site=nicovideo&_frontendId=6`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) }
      );
      if (!resp.ok) return res.json({ success: false, items: [] });
      const json = await resp.json();
      const items = (json?.data?.items || []).filter((it) => it?.contentType === "video" && it?.content?.id).slice(0, 14).map((it) => mapNvapiEssentialToVideo(it.content));
      return res.json({ success: true, items });
    } catch (err) {
      return res.json({ success: false, items: [] });
    }
  });
  app2.get("/api/nico/user/:userId", async (req, res) => {
    const userId = String(req.params.userId || "").replace(/\D/g, "");
    if (!userId) return res.status(400).json({ success: false, error: "Invalid userId" });
    try {
      const [uRes, vRes, mRes, sRes] = await Promise.all([
        fetch(`https://nvapi.nicovideo.jp/v1/users/${userId}`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) }),
        fetch(`https://nvapi.nicovideo.jp/v3/users/${userId}/videos?sortKey=registeredAt&sortOrder=desc&pageSize=24&page=1`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) }),
        fetch(`https://nvapi.nicovideo.jp/v1/users/${userId}/mylists?sampleItemCount=3`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) }),
        fetch(`https://nvapi.nicovideo.jp/v1/users/${userId}/series?page=1&pageSize=12`, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) })
      ]);
      const uJson = uRes.ok ? await uRes.json() : null;
      const vJson = vRes.ok ? await vRes.json() : null;
      const mJson = mRes.ok ? await mRes.json() : null;
      const sJson = sRes.ok ? await sRes.json() : null;
      const userRaw = uJson?.data?.user;
      if (!userRaw) return res.status(404).json({ success: false, error: "User not found" });
      const user = {
        id: String(userRaw.id),
        nickname: String(userRaw.nickname || `\u30E6\u30FC\u30B6\u30FC ${userId}`),
        description: stripHtmlTags(userRaw.strippedDescription || userRaw.description || ""),
        avatar: userRaw.icons?.large || userRaw.icons?.small || "https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg",
        level: Number(userRaw.userLevel?.currentLevel || 1),
        followerCount: Number(userRaw.followerCount || 0),
        followeeCount: Number(userRaw.followeeCount || 0),
        isPremium: Boolean(userRaw.isPremium)
      };
      const videos = (vJson?.data?.items || []).map(mapNvapiEssentialToVideo);
      const mylists = (mJson?.data?.mylists || []).map((m) => ({
        id: String(m.id),
        name: String(m.name),
        description: String(m.description || ""),
        itemsCount: Number(m.itemsCount || 0)
      }));
      const series = (sJson?.data?.items || []).map((s) => ({
        id: String(s.id),
        title: String(s.title),
        itemsCount: Number(s.itemsCount || 0),
        thumbnailUrl: s.thumbnailUrl || ""
      }));
      return res.json({
        success: true,
        user,
        totalVideos: Number(vJson?.data?.totalCount || videos.length),
        videos,
        mylists,
        series
      });
    } catch (err) {
      return res.status(502).json({ success: false, error: err?.message || "Failed to fetch user info" });
    }
  });
  app2.get("/api/nico/mylist/:mylistId", async (req, res) => {
    const mylistId = String(req.params.mylistId || "").replace(/\D/g, "");
    if (!mylistId) return res.status(400).json({ success: false, error: "Invalid mylistId" });
    try {
      const resp = await fetch(
        `https://nvapi.nicovideo.jp/v2/mylists/${mylistId}?pageSize=30&page=1`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) }
      );
      if (!resp.ok) return res.status(resp.status).json({ success: false, error: "Mylist fetch failed" });
      const json = await resp.json();
      const ml = json?.data?.mylist;
      const items = (ml?.items || []).map((entry) => mapNvapiEssentialToVideo(entry.video));
      return res.json({
        success: true,
        name: String(ml?.name || `\u30DE\u30A4\u30EA\u30B9\u30C8 ${mylistId}`),
        description: String(ml?.description || ""),
        items
      });
    } catch (err) {
      return res.status(502).json({ success: false, error: err?.message || "Failed to fetch mylist" });
    }
  });
  app2.get("/api/nico/tree/:id", async (req, res) => {
    const id = sanitizeId(req.params.id);
    try {
      const resp = await fetch(
        `https://public-api.commons.nicovideo.jp/v1/tree/${encodeURIComponent(id)}/relatives`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(5e3) }
      );
      if (!resp.ok) return res.json({ success: false, parents: [], children: [], parentsTotal: 0, childrenTotal: 0 });
      const json = await resp.json();
      const mapItem = (c) => {
        const gid = String(c.globalId || c.contentId || "");
        const kind = String(c.contentKind || "video");
        let url = `https://commons.nicovideo.jp/works/${gid}`;
        if (kind === "video") url = `https://www.nicovideo.jp/watch/${gid}`;
        else if (kind === "illust") url = `https://seiga.nicovideo.jp/seiga/${gid}`;
        return { globalId: gid, contentKind: kind, url, created: c.created || "" };
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
  const nicoLiveSessions = /* @__PURE__ */ new Map();
  const nicoLivePending = /* @__PURE__ */ new Map();
  function closeLiveSessionByKey(key) {
    const old = nicoLiveSessions.get(key);
    if (old) {
      if (old.keepTimer) clearInterval(old.keepTimer);
      try {
        old.ws?.close();
      } catch {
      }
      nicoLiveSessions.delete(key);
    }
  }
  function buildLiveCookieHeader(cookies, targetUrlStr) {
    let pathname = "/";
    try {
      pathname = new URL(targetUrlStr).pathname;
    } catch {
    }
    const pairs = [];
    for (const c of cookies) {
      if (!c.path || pathname.startsWith(c.path)) {
        pairs.push(`${c.name}=${c.value}`);
      }
    }
    return pairs.join("; ");
  }
  async function getOrCreateNicoLiveSession(lvId, forceRefresh = false, qualityMode = "high") {
    const cleanId = sanitizeId(lvId).toLowerCase();
    if (!/^lv\d+$/.test(cleanId)) return null;
    const sessionKey = `${cleanId}:${qualityMode}`;
    const oppositeKey = `${cleanId}:${qualityMode === "audio_only" ? "high" : "audio_only"}`;
    closeLiveSessionByKey(oppositeKey);
    if (!forceRefresh) {
      const existing = nicoLiveSessions.get(sessionKey);
      if (existing && existing.streamUri && Date.now() - existing.lastActive < 1e3 * 60 * 3 && existing.ws?.readyState === WebSocket.OPEN) {
        existing.lastActive = Date.now();
        return existing;
      }
      const pending = nicoLivePending.get(sessionKey);
      if (pending) return pending;
    } else {
      closeLiveSessionByKey(sessionKey);
    }
    const work = (async () => {
      try {
        const pageRes = await fetch(`https://live.nicovideo.jp/watch/${encodeURIComponent(cleanId)}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(8e3)
        });
        if (!pageRes.ok) return null;
        const html = await pageRes.text();
        const m = html.match(/id="embedded-data"[^>]*data-props="([^"]+)"/) || html.match(/data-props="([^"]+)"[^>]*id="embedded-data"/);
        if (!m) return null;
        const props = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
        const prog = props.program || {};
        const wsUrl = props.site?.relive?.webSocketUrl;
        const title = String(prog.title || `\u30CB\u30B3\u30CB\u30B3\u751F\u653E\u9001 ${cleanId}`);
        const status = String(prog.status || "ON_AIR");
        const providerName = String(props.programBroadcaster?.name || props.socialGroup?.name || "\u653E\u9001\u4E3B");
        const providerAvatar = String(props.programBroadcaster?.iconUrl || props.socialGroup?.thumbnailUrl || "");
        const providerId = String(props.programBroadcaster?.id || "");
        const watchCount = Number(prog.statistics?.watchCount || 0);
        const commentCount = Number(prog.statistics?.commentCount || 0);
        const thumbnail = String(prog.thumbnail?.large || prog.thumbnail?.small || "");
        if (!wsUrl || status === "ENDED") {
          return {
            lvId: cleanId,
            qualityMode,
            streamUri: "",
            cookies: [],
            ws: null,
            keepTimer: null,
            lastActive: Date.now(),
            title,
            status,
            providerName,
            providerAvatar,
            providerId,
            watchCount,
            commentCount,
            thumbnail
          };
        }
        const session = await new Promise((resolve) => {
          const ws = new WebSocket(wsUrl);
          let resolved = false;
          let keepTimer = null;
          let pendingViewUri = "";
          let liveSessRef = null;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try {
                ws.close();
              } catch {
              }
              resolve(null);
            }
          }, 8e3);
          ws.addEventListener("open", () => {
            ws.send(JSON.stringify({
              type: "startWatching",
              data: {
                stream: { quality: qualityMode, protocol: "hls", latency: "low", chasePlay: false },
                room: { protocol: "webSocket", commentable: false },
                reconnect: false
              }
            }));
          });
          ws.addEventListener("message", (ev) => {
            try {
              const msg = JSON.parse(String(ev.data));
              if (msg.type === "ping") {
                ws.send(JSON.stringify({ type: "pong" }));
              } else if (msg.type === "seat") {
                const intervalMs = Math.max(15e3, Number(msg.data?.keepIntervalSec || 30) * 1e3);
                if (!keepTimer) {
                  keepTimer = setInterval(() => {
                    const cur = nicoLiveSessions.get(sessionKey);
                    if (!cur || Date.now() - cur.lastActive > 9e4 || ws.readyState !== WebSocket.OPEN) {
                      if (keepTimer) clearInterval(keepTimer);
                      try {
                        ws.close();
                      } catch {
                      }
                      nicoLiveSessions.delete(sessionKey);
                      return;
                    }
                    try {
                      ws.send(JSON.stringify({ type: "keepSeat" }));
                    } catch {
                    }
                  }, intervalMs);
                  keepTimer.unref?.();
                }
              } else if (msg.type === "messageServer" && msg.data?.viewUri) {
                pendingViewUri = String(msg.data.viewUri);
                if (liveSessRef) {
                  liveSessRef.messageServerViewUri = pendingViewUri;
                }
              } else if (msg.type === "stream" && msg.data?.uri) {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  const sess = {
                    lvId: cleanId,
                    qualityMode,
                    streamUri: String(msg.data.uri),
                    messageServerViewUri: pendingViewUri || void 0,
                    cookies: Array.isArray(msg.data.cookies) ? msg.data.cookies : [],
                    ws,
                    keepTimer,
                    lastActive: Date.now(),
                    title,
                    status,
                    providerName,
                    providerAvatar,
                    providerId,
                    watchCount,
                    commentCount,
                    thumbnail
                  };
                  liveSessRef = sess;
                  nicoLiveSessions.set(sessionKey, sess);
                  resolve(sess);
                }
              } else if (msg.type === "error" || msg.type === "disconnect") {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  if (keepTimer) clearInterval(keepTimer);
                  resolve(null);
                }
              }
            } catch {
            }
          });
          ws.addEventListener("error", () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (keepTimer) clearInterval(keepTimer);
              resolve(null);
            }
          });
          ws.addEventListener("close", () => {
            if (keepTimer) clearInterval(keepTimer);
            const cur = nicoLiveSessions.get(sessionKey);
            if (cur?.ws === ws) nicoLiveSessions.delete(sessionKey);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(null);
            }
          });
        });
        return session;
      } catch (err) {
        console.warn("getOrCreateNicoLiveSession error:", err);
        return null;
      } finally {
        nicoLivePending.delete(sessionKey);
      }
    })();
    nicoLivePending.set(sessionKey, work);
    return work;
  }
  app2.post("/api/nico/live/stop/:id", (req, res) => {
    const cleanId = sanitizeId(req.params.id).toLowerCase();
    closeLiveSessionByKey(`${cleanId}:high`);
    closeLiveSessionByKey(`${cleanId}:audio_only`);
    return res.json({ success: true });
  });
  function readProtoVarint(buf, offset) {
    let res = 0n;
    let shift = 0n;
    let pos = offset;
    while (pos < buf.length) {
      const b = buf[pos++];
      res |= BigInt(b & 127) << shift;
      if ((b & 128) === 0) break;
      shift += 7n;
      if (shift > 63n) break;
    }
    return { val: Number(res), next: pos };
  }
  function parseProtoWire(buf) {
    const out = [];
    let pos = 0;
    while (pos < buf.length) {
      const tag = readProtoVarint(buf, pos);
      pos = tag.next;
      const fn = Math.floor(tag.val / 8);
      const wt = tag.val % 8;
      if (fn <= 0) break;
      if (wt === 0) {
        const v = readProtoVarint(buf, pos);
        pos = v.next;
        out.push({ fn, wt, val: v.val });
      } else if (wt === 2) {
        const len = readProtoVarint(buf, pos);
        pos = len.next;
        const end = Math.min(buf.length, pos + Math.max(0, len.val));
        out.push({ fn, wt, val: buf.subarray(pos, end) });
        pos = end;
      } else if (wt === 1) {
        pos = Math.min(buf.length, pos + 8);
      } else if (wt === 5) {
        pos = Math.min(buf.length, pos + 4);
      } else {
        break;
      }
    }
    return out;
  }
  function decodeProtoStreamChunks(buf) {
    const chunks = [];
    let pos = 0;
    while (pos < buf.length) {
      const len = readProtoVarint(buf, pos);
      pos = len.next;
      if (len.val <= 0 || pos + len.val > buf.length) break;
      chunks.push(buf.subarray(pos, pos + len.val));
      pos += len.val;
    }
    return chunks;
  }
  const NICO_LIVE_COLOR_MAP = {
    0: "#ffffff",
    1: "#ff0000",
    2: "#ff8080",
    3: "#ffc000",
    4: "#ffff00",
    5: "#00ff00",
    6: "#00ffff",
    7: "#0000ff",
    8: "#c000ff",
    9: "#000000",
    10: "#cccc99",
    11: "#cc0033",
    12: "#ff33cc",
    13: "#ff6600",
    14: "#999900",
    15: "#00cc66",
    16: "#00cccc",
    17: "#3399ff",
    18: "#6633cc",
    19: "#666666"
  };
  function decodeNicoLiveChatMessages(buf) {
    const td = new TextDecoder("utf-8", { fatal: false });
    const comments = [];
    const chunks = decodeProtoStreamChunks(buf);
    for (let idx = 0; idx < chunks.length; idx++) {
      const topFields = parseProtoWire(chunks[idx]);
      let msgId = "";
      let atMs = Date.now();
      let msgBytes = null;
      for (const f of topFields) {
        if (f.fn === 1 && f.wt === 2 && f.val instanceof Uint8Array) {
          const metaFields = parseProtoWire(f.val);
          for (const mf of metaFields) {
            if (mf.fn === 1 && mf.wt === 2 && mf.val instanceof Uint8Array) {
              msgId = td.decode(mf.val);
            } else if (mf.fn === 2 && mf.wt === 2 && mf.val instanceof Uint8Array) {
              let sec = 0;
              let nanos = 0;
              for (const tf of parseProtoWire(mf.val)) {
                if (tf.fn === 1 && tf.wt === 0 && typeof tf.val === "number") sec = tf.val;
                else if (tf.fn === 2 && tf.wt === 0 && typeof tf.val === "number") nanos = tf.val;
              }
              if (sec > 0) atMs = sec * 1e3 + Math.floor(nanos / 1e6);
            }
          }
        } else if (f.fn === 2 && f.wt === 2 && f.val instanceof Uint8Array) {
          msgBytes = f.val;
        }
      }
      if (!msgBytes) continue;
      for (const nf of parseProtoWire(msgBytes)) {
        if (nf.fn === 1 && nf.wt === 2 && nf.val instanceof Uint8Array) {
          let content = "";
          let name = "";
          let hashedUserId = "";
          let no;
          let color = "#ffffff";
          let position = "naka";
          let size = "medium";
          for (const cf of parseProtoWire(nf.val)) {
            if (cf.fn === 1 && cf.wt === 2 && cf.val instanceof Uint8Array) {
              content = td.decode(cf.val);
            } else if (cf.fn === 2 && cf.wt === 2 && cf.val instanceof Uint8Array) {
              name = td.decode(cf.val);
            } else if (cf.fn === 6 && cf.wt === 2 && cf.val instanceof Uint8Array) {
              hashedUserId = td.decode(cf.val);
            } else if (cf.fn === 8 && cf.wt === 0 && typeof cf.val === "number") {
              no = cf.val;
            } else if (cf.fn === 7 && cf.wt === 2 && cf.val instanceof Uint8Array) {
              for (const modf of parseProtoWire(cf.val)) {
                if (modf.fn === 1 && modf.wt === 0 && typeof modf.val === "number") {
                  position = modf.val === 2 ? "ue" : modf.val === 1 ? "shita" : "naka";
                } else if (modf.fn === 2 && modf.wt === 0 && typeof modf.val === "number") {
                  size = modf.val === 2 ? "big" : modf.val === 1 ? "small" : "medium";
                } else if (modf.fn === 3 && modf.wt === 0 && typeof modf.val === "number") {
                  color = NICO_LIVE_COLOR_MAP[modf.val] || "#ffffff";
                } else if (modf.fn === 4 && modf.wt === 2 && modf.val instanceof Uint8Array) {
                  let r = 255;
                  let g = 255;
                  let b = 255;
                  for (const rgbf of parseProtoWire(modf.val)) {
                    if (rgbf.fn === 1 && typeof rgbf.val === "number") r = rgbf.val & 255;
                    else if (rgbf.fn === 2 && typeof rgbf.val === "number") g = rgbf.val & 255;
                    else if (rgbf.fn === 3 && typeof rgbf.val === "number") b = rgbf.val & 255;
                  }
                  color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                }
              }
            }
          }
          if (content.trim()) {
            comments.push({
              id: msgId || `${atMs}-${no ?? idx}`,
              no,
              text: content,
              name: name || void 0,
              userId: hashedUserId || void 0,
              color,
              position,
              size,
              atMs
            });
          }
        } else if (nf.fn === 23 && nf.wt === 2 && nf.val instanceof Uint8Array) {
          let sysText = "";
          for (const sf of parseProtoWire(nf.val)) {
            if ((sf.fn === 2 || sf.fn === 1 || sf.fn === 3) && sf.wt === 2 && sf.val instanceof Uint8Array) {
              const decoded = td.decode(sf.val).trim();
              if (decoded) {
                sysText = decoded;
                if (sf.fn === 2) break;
              }
            }
          }
          if (sysText) {
            comments.push({
              id: msgId || `sys-${atMs}-${idx}`,
              text: sysText,
              color: "#93c5fd",
              atMs,
              isSystem: true
            });
          }
        }
      }
    }
    return comments;
  }
  const liveSegmentCache = /* @__PURE__ */ new Map();
  app2.get("/api/nico/live/comments/:id", async (req, res) => {
    const cleanId = sanitizeId(req.params.id).toLowerCase();
    if (!/^lv\d+$/.test(cleanId)) {
      return res.status(400).json({ success: false, error: "\u6709\u52B9\u306A\u751F\u653E\u9001ID (lv...) \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044", comments: [] });
    }
    const sinceRaw = Number(req.query.since || 0);
    const hasSince = Number.isFinite(sinceRaw) && sinceRaw > 0;
    const nowSec = Math.floor(Date.now() / 1e3);
    let sess = nicoLiveSessions.get(`${cleanId}:high`) || nicoLiveSessions.get(`${cleanId}:audio_only`) || null;
    if (!sess) {
      const pending = nicoLivePending.get(`${cleanId}:high`) || nicoLivePending.get(`${cleanId}:audio_only`) || null;
      if (pending) {
        sess = await pending;
      }
    }
    if (!sess) {
      sess = await getOrCreateNicoLiveSession(cleanId, false, "high");
    }
    if (!sess) {
      return res.json({ success: false, comments: [], serverTime: nowSec });
    }
    sess.lastActive = Date.now();
    if (!sess.messageServerViewUri) {
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (sess.messageServerViewUri) break;
      }
    }
    if (!sess.messageServerViewUri) {
      return res.json({ success: true, comments: [], serverTime: nowSec });
    }
    try {
      const atParam = hasSince ? Math.min(nowSec - 22, Math.max(nowSec - 45, Math.floor(sinceRaw) - 20)) : nowSec - 45;
      const viewSep = sess.messageServerViewUri.includes("?") ? "&" : "?";
      const viewResp = await fetch(`${sess.messageServerViewUri}${viewSep}at=${atParam}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": "https://live.nicovideo.jp/"
        },
        signal: AbortSignal.timeout(4500)
      });
      if (!viewResp.ok) {
        return res.json({ success: true, comments: [], serverTime: nowSec });
      }
      const viewBuf = new Uint8Array(await viewResp.arrayBuffer());
      const entries = decodeProtoStreamChunks(viewBuf);
      const segments = [];
      let snapshotUri = "";
      const td = new TextDecoder("utf-8", { fatal: false });
      for (const entry of entries) {
        for (const f of parseProtoWire(entry)) {
          if ((f.fn === 1 || f.fn === 3) && f.wt === 2 && f.val instanceof Uint8Array) {
            let uri = "";
            let until = nowSec;
            for (const sf of parseProtoWire(f.val)) {
              if (sf.fn === 2 && sf.wt === 0 && typeof sf.val === "number") until = sf.val;
              else if (sf.fn === 3 && sf.wt === 2 && sf.val instanceof Uint8Array) uri = td.decode(sf.val);
            }
            if (uri) segments.push({ uri, until });
          } else if (f.fn === 2 && f.wt === 2 && f.val instanceof Uint8Array) {
            for (const bf of parseProtoWire(f.val)) {
              if (bf.fn === 3 && bf.wt === 2 && bf.val instanceof Uint8Array) {
                for (const ssf of parseProtoWire(bf.val)) {
                  if (ssf.fn === 1 && ssf.wt === 2 && ssf.val instanceof Uint8Array) {
                    snapshotUri = td.decode(ssf.val);
                  }
                }
              }
            }
          }
        }
      }
      const targets = hasSince ? segments.slice(-2) : segments.slice(-4);
      if (!hasSince && targets.length === 0 && snapshotUri) {
        targets.push({ uri: snapshotUri, until: nowSec });
      }
      const segResults = await Promise.all(
        targets.map(async (seg) => {
          const cached = liveSegmentCache.get(seg.uri);
          if (cached) return cached;
          try {
            const sr = await fetch(seg.uri, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://live.nicovideo.jp/"
              },
              signal: AbortSignal.timeout(4e3)
            });
            if (!sr.ok) return [];
            const decoded = decodeNicoLiveChatMessages(new Uint8Array(await sr.arrayBuffer()));
            if (seg.until > 0 && seg.until < nowSec - 3) {
              if (liveSegmentCache.size > 200) {
                const firstKey = liveSegmentCache.keys().next().value;
                if (firstKey) liveSegmentCache.delete(firstKey);
              }
              liveSegmentCache.set(seg.uri, decoded);
            }
            return decoded;
          } catch {
            return [];
          }
        })
      );
      const deduped = /* @__PURE__ */ new Map();
      for (const list of segResults) {
        for (const c of list) {
          if (!deduped.has(c.id)) deduped.set(c.id, c);
        }
      }
      const sorted = Array.from(deduped.values()).sort((a, b) => a.atMs - b.atMs).slice(-120);
      return res.json({
        success: true,
        comments: sorted,
        serverTime: Math.floor(Date.now() / 1e3)
      });
    } catch {
      return res.json({ success: true, comments: [], serverTime: nowSec });
    }
  });
  app2.get("/api/nico/live/info/:id", async (req, res) => {
    const cleanId = sanitizeId(req.params.id).toLowerCase();
    if (!/^lv\d+$/.test(cleanId)) {
      return res.status(400).json({ success: false, error: "\u6709\u52B9\u306A\u751F\u653E\u9001ID (lv...) \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044" });
    }
    try {
      const pageRes = await fetch(`https://live.nicovideo.jp/watch/${encodeURIComponent(cleanId)}`, {
        headers: NICO_API_HEADERS,
        signal: AbortSignal.timeout(6e3)
      });
      if (!pageRes.ok) return res.status(pageRes.status).json({ success: false, error: "\u751F\u653E\u9001\u756A\u7D44\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      const html = await pageRes.text();
      const m = html.match(/id="embedded-data"[^>]*data-props="([^"]+)"/) || html.match(/data-props="([^"]+)"[^>]*id="embedded-data"/);
      if (!m) return res.status(404).json({ success: false, error: "\u756A\u7D44\u30C7\u30FC\u30BF\u3092\u89E3\u6790\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" });
      const props = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      const prog = props.program || {};
      return res.json({
        success: true,
        program: {
          id: cleanId,
          title: String(prog.title || cleanId),
          description: stripHtmlTags(prog.description || ""),
          status: String(prog.status || "ON_AIR"),
          providerName: String(props.programBroadcaster?.name || props.socialGroup?.name || "\u653E\u9001\u4E3B"),
          providerAvatar: String(props.programBroadcaster?.iconUrl || props.socialGroup?.thumbnailUrl || ""),
          providerId: String(props.programBroadcaster?.id || ""),
          thumbnail: String(prog.thumbnail?.large || prog.thumbnail?.small || ""),
          watchCount: Number(prog.statistics?.watchCount || 0),
          commentCount: Number(prog.statistics?.commentCount || 0),
          embedUrl: `https://live.nicovideo.jp/embed/${cleanId}`,
          url: `https://live.nicovideo.jp/watch/${cleanId}`
        }
      });
    } catch (err) {
      return res.status(502).json({ success: false, error: err?.message || "\u751F\u653E\u9001\u60C5\u5831\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F" });
    }
  });
  app2.get("/api/nico/live/hls/:id/master.m3u8", async (req, res) => {
    const cleanId = sanitizeId(req.params.id).toLowerCase();
    const qualityMode = req.query.quality === "audio_only" ? "audio_only" : "high";
    let sess = await getOrCreateNicoLiveSession(cleanId, false, qualityMode);
    if (!sess || !sess.streamUri) {
      return res.status(502).json({ error: "\u751F\u653E\u9001\u30B9\u30C8\u30EA\u30FC\u30E0\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F" });
    }
    sess.lastActive = Date.now();
    try {
      let cookieHeader = buildLiveCookieHeader(sess.cookies, sess.streamUri);
      let resp = await fetch(sess.streamUri, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Referer": "https://live.nicovideo.jp/",
          "Cookie": cookieHeader
        },
        signal: AbortSignal.timeout(8e3)
      });
      if (resp.status === 403 || resp.status === 410) {
        sess = await getOrCreateNicoLiveSession(cleanId, true, qualityMode);
        if (!sess || !sess.streamUri) return res.status(502).send("Live stream expired");
        cookieHeader = buildLiveCookieHeader(sess.cookies, sess.streamUri);
        resp = await fetch(sess.streamUri, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://live.nicovideo.jp/",
            "Cookie": cookieHeader
          },
          signal: AbortSignal.timeout(8e3)
        });
      }
      if (!resp.ok) return res.status(resp.status).send("Upstream live playlist error");
      let text = await resp.text();
      const base = sess.streamUri;
      text = text.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
        const abs = new URL(uri, base).toString();
        return `${p1}/api/nico/live/hls/proxy?id=${encodeURIComponent(cleanId)}&quality=${qualityMode}&url=${encodeURIComponent(abs)}${p3}`;
      });
      text = text.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const abs = new URL(trimmed, base).toString();
          return `/api/nico/live/hls/proxy?id=${encodeURIComponent(cleanId)}&quality=${qualityMode}&url=${encodeURIComponent(abs)}`;
        }
        return line;
      }).join("\n");
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(text);
    } catch (err) {
      return res.status(500).send(err?.message || "Live HLS error");
    }
  });
  app2.get("/api/nico/live/hls/proxy", async (req, res) => {
    const cleanId = sanitizeId(String(req.query.id || "")).toLowerCase();
    const targetUrl = String(req.query.url || "").trim();
    const qualityMode = req.query.quality === "audio_only" ? "audio_only" : "high";
    if (!cleanId || !targetUrl) return res.status(400).send("Missing params");
    const sess = await getOrCreateNicoLiveSession(cleanId, false, qualityMode);
    if (!sess) return res.status(502).send("No live session");
    sess.lastActive = Date.now();
    try {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://live.nicovideo.jp/",
        "Cookie": buildLiveCookieHeader(sess.cookies, targetUrl)
      };
      if (req.headers.range) {
        headers["Range"] = String(req.headers.range);
      }
      const resp = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(1e4) });
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("mpegurl") || targetUrl.includes(".m3u8")) {
        if (!resp.ok) return res.status(resp.status).send("Upstream live subplaylist error");
        let text = await resp.text();
        text = text.replace(/(URI=")([^"]+)(")/g, (_m, p1, uri, p3) => {
          const abs = new URL(uri, targetUrl).toString();
          return `${p1}/api/nico/live/hls/proxy?id=${encodeURIComponent(cleanId)}&quality=${qualityMode}&url=${encodeURIComponent(abs)}${p3}`;
        });
        text = text.split(/\r?\n/).map((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const abs = new URL(trimmed, targetUrl).toString();
            return `/api/nico/live/hls/proxy?id=${encodeURIComponent(cleanId)}&quality=${qualityMode}&url=${encodeURIComponent(abs)}`;
          }
          return line;
        }).join("\n");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
        return res.send(text);
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      res.status(resp.status);
      res.setHeader("Content-Type", ct || "video/mp2t");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Length", buf.length);
      const cr = resp.headers.get("content-range");
      if (cr) res.setHeader("Content-Range", cr);
      return res.end(buf);
    } catch (err) {
      if (!res.headersSent) return res.status(502).send(err?.message || "Live proxy error");
    }
  });
  const handleNicoLiveSearch = async (req, res) => {
    const q = String(req.query.q || "").trim();
    const sortRaw = String(req.query.sort || "viewCountDesc");
    const tabRaw = String(req.query.tab || "all").toLowerCase();
    const offset = Math.max(0, parseInt(String(req.query.offset || "0"), 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || (q ? "40" : "100")), 10) || 40));
    try {
      const lvMatch = q.match(/\b(lv\d+)\b/i);
      if (lvMatch && /^lv\d+$/i.test(q.replace(/^https?:\/\/[^/]+\/watch\//i, "").split(/[?#]/)[0].trim())) {
        const cleanId = lvMatch[1].toLowerCase();
        try {
          const r = await fetch(`https://live.nicovideo.jp/watch/${encodeURIComponent(cleanId)}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
            },
            signal: AbortSignal.timeout(6e3)
          });
          if (r.ok) {
            const html = await r.text();
            const m = html.match(/id="embedded-data"[^>]*data-props="([^"]+)"/) || html.match(/data-props="([^"]+)"[^>]*id="embedded-data"/);
            if (m) {
              const props = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
              const prog = props.program || {};
              const status = String(prog.status || "");
              const items2 = status === "ON_AIR" ? [{
                id: cleanId,
                title: String(prog.title || `\u30CB\u30B3\u30CB\u30B3\u751F\u653E\u9001 (${cleanId})`),
                thumbnail: String(prog.thumbnail?.largeUrl || prog.thumbnail?.smallUrl || ""),
                url: `https://live.nicovideo.jp/watch/${cleanId}`,
                providerName: String(prog.supplier?.name || props.user?.nickname || "\u653E\u9001\u4E3B"),
                providerAvatar: String(prog.supplier?.icons?.uri50x50 || ""),
                providerId: String(prog.supplier?.programProviderId || ""),
                providerType: String(prog.providerType || ""),
                watchCount: Number(prog.statistics?.watchCount || 0),
                commentCount: Number(prog.statistics?.commentCount || 0),
                liveCycle: "ON_AIR",
                beginTime: Number(prog.beginTime || 0)
              }] : [];
              return res.json({ success: true, items: items2, total: items2.length, keyword: q, status });
            }
          }
        } catch {
        }
      }
      if (q) {
        const searchSort = sortRaw === "commentCountDesc" || sortRaw === "commentCount" ? "commentCountDesc" : sortRaw === "recentDesc" || sortRaw === "recent" ? "recentDesc" : "viewCountDesc";
        const url = `https://live.nicovideo.jp/front/api/pages/search/v1/programs?keyword=${encodeURIComponent(q)}&status=onair&sortOrder=${encodeURIComponent(searchSort)}&offset=${offset}&limit=${limit}`;
        const resp2 = await fetch(url, { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6e3) });
        if (!resp2.ok) return res.status(resp2.status).json({ success: false, items: [] });
        const json2 = await resp2.json();
        const rawPrograms = Array.isArray(json2?.data?.programs) ? json2.data.programs : [];
        const items2 = rawPrograms.filter((p) => !p?.status || String(p.status).toUpperCase() === "ON_AIR").map((p) => {
          const pid = String(p.nicoliveProgramId || p.id || "").toLowerCase();
          return {
            id: pid,
            title: String(p.title || "\u751F\u653E\u9001"),
            thumbnail: String(p.listingThumbnail || ""),
            url: String(p.watchPageUrl || `https://live.nicovideo.jp/watch/${pid}`).split("?")[0],
            providerName: String(p.programProvider?.name || p.supplier?.name || p.socialGroup?.name || "\u653E\u9001\u4E3B"),
            providerAvatar: String(p.programProvider?.icon || p.socialGroup?.thumbnailUrl || ""),
            providerId: String(p.programProvider?.id || p.socialGroup?.id || ""),
            providerType: String(p.providerType || ""),
            watchCount: Number(p.statistics?.watchCount || 0),
            commentCount: Number(p.statistics?.commentCount || 0),
            liveCycle: "ON_AIR",
            beginTime: Number(p.beginTime || 0)
          };
        }).filter((p) => Boolean(p.id));
        return res.json({
          success: true,
          items: items2,
          total: Number(json2?.data?.totalCount ?? items2.length),
          keyword: q
        });
      }
      const recentSort = sortRaw === "commentCountDesc" || sortRaw === "commentCount" ? "commentCount" : sortRaw === "recentDesc" || sortRaw === "recent" ? "recent" : "viewCount";
      const validTabs = /* @__PURE__ */ new Set(["common", "game", "try", "official", "face"]);
      const tabParam = validTabs.has(tabRaw) ? `&tab=${encodeURIComponent(tabRaw)}` : "";
      const resp = await fetch(
        `https://live.nicovideo.jp/front/api/pages/recent/v1/programs?offset=${offset}&limit=${limit}&sortOrder=${encodeURIComponent(recentSort)}${tabParam}`,
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6e3) }
      );
      if (!resp.ok) return res.status(resp.status).json({ success: false, items: [] });
      const json = await resp.json();
      const items = (json?.data || []).filter((p) => !p?.liveCycle || String(p.liveCycle).toUpperCase() === "ON_AIR").map((p) => ({
        id: String(p.id).toLowerCase(),
        title: String(p.title || "\u751F\u653E\u9001"),
        thumbnail: String(p.listingThumbnail || ""),
        url: String(p.watchPageUrl || `https://live.nicovideo.jp/watch/${p.id}`).split("?")[0],
        providerName: String(p.programProvider?.name || "\u653E\u9001\u4E3B"),
        providerAvatar: String(p.programProvider?.icon || ""),
        providerId: String(p.programProvider?.id || ""),
        providerType: String(p.providerType || ""),
        watchCount: Number(p.statistics?.watchCount || 0),
        commentCount: Number(p.statistics?.commentCount || 0),
        liveCycle: String(p.liveCycle || "ON_AIR"),
        beginTime: Number(p.beginTime || 0)
      }));
      return res.json({
        success: true,
        items,
        total: Number(json?.meta?.totalCount || items.length),
        keyword: ""
      });
    } catch (err) {
      return res.status(502).json({ success: false, items: [], error: err?.message || "Live search failed" });
    }
  };
  app2.get("/api/nico/live", handleNicoLiveSearch);
  app2.get("/api/nico/live/search", handleNicoLiveSearch);
  const userLiveCheckCache = /* @__PURE__ */ new Map();
  app2.post("/api/nico/live/check-favorites", async (req, res) => {
    const rawSubs = Array.isArray(req.body?.subscriptions) ? req.body.subscriptions : [];
    if (rawSubs.length === 0) {
      return res.json({ success: true, liveAlerts: [] });
    }
    const subs = rawSubs.slice(0, 30).map((s) => {
      const url = String(s?.url || "");
      const name = String(s?.name || "").trim();
      const avatar = String(s?.avatar || "");
      const userIdMatch = String(s?.userId || "").match(/^\d+$/)?.[0] || url.match(/\/user\/(\d+)/)?.[1] || "";
      return { url, name, avatar, userId: userIdMatch };
    });
    const normalizeName = (str) => str.trim().toLowerCase().replace(/\s+/g, "");
    const matchedMap = /* @__PURE__ */ new Map();
    try {
      const recentRes = await fetch(
        "https://live.nicovideo.jp/front/api/pages/recent/v1/programs?offset=0&limit=100&sortOrder=viewCount",
        { headers: NICO_API_HEADERS, signal: AbortSignal.timeout(6e3) }
      );
      if (recentRes.ok) {
        const json = await recentRes.json();
        const activeList = Array.isArray(json?.data) ? json.data : [];
        const byProviderId = /* @__PURE__ */ new Map();
        const byProviderName = /* @__PURE__ */ new Map();
        for (const p of activeList) {
          if (p.liveCycle && p.liveCycle !== "ON_AIR") continue;
          const pid = String(p.programProvider?.id || "").trim();
          const pname = normalizeName(String(p.programProvider?.name || ""));
          if (pid) byProviderId.set(pid, p);
          if (pname) byProviderName.set(pname, p);
        }
        for (const sub of subs) {
          const hit = sub.userId && byProviderId.get(sub.userId) || sub.name && byProviderName.get(normalizeName(sub.name));
          if (hit) {
            const progId = String(hit.id).toLowerCase();
            if (!matchedMap.has(progId)) {
              matchedMap.set(progId, {
                id: progId,
                title: String(hit.title || "\u751F\u653E\u9001"),
                thumbnail: String(hit.listingThumbnail || ""),
                url: String(hit.watchPageUrl || `https://live.nicovideo.jp/watch/${progId}`).split("?")[0],
                providerName: String(hit.programProvider?.name || sub.name || "\u653E\u9001\u4E3B"),
                providerAvatar: String(hit.programProvider?.icon || sub.avatar || ""),
                providerId: String(hit.programProvider?.id || sub.userId || ""),
                watchCount: Number(hit.statistics?.watchCount || 0),
                commentCount: Number(hit.statistics?.commentCount || 0),
                liveCycle: String(hit.liveCycle || "ON_AIR"),
                matchedSubUrl: sub.url,
                matchedSubName: sub.name
              });
            }
          }
        }
      }
    } catch {
    }
    const matchedSubUrls = new Set(Array.from(matchedMap.values()).map((v) => v.matchedSubUrl));
    const remainingUserSubs = subs.filter((s) => s.userId && !matchedSubUrls.has(s.url)).slice(0, 10);
    await Promise.all(
      remainingUserSubs.map(async (sub) => {
        const uid = sub.userId;
        const cached = userLiveCheckCache.get(uid);
        if (cached && Date.now() - cached.checkedAt < 6e4) {
          if (cached.live && !matchedMap.has(cached.live.id)) {
            matchedMap.set(cached.live.id, {
              ...cached.live,
              matchedSubUrl: sub.url,
              matchedSubName: sub.name
            });
          }
          return;
        }
        try {
          const r = await fetch(`https://live.nicovideo.jp/watch/user/${encodeURIComponent(uid)}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
            },
            signal: AbortSignal.timeout(5e3)
          });
          if (!r.ok) {
            userLiveCheckCache.set(uid, { checkedAt: Date.now(), live: null });
            return;
          }
          const html = await r.text();
          const m = html.match(/id="embedded-data"[^>]*data-props="([^"]+)"/) || html.match(/data-props="([^"]+)"[^>]*id="embedded-data"/);
          if (!m) {
            userLiveCheckCache.set(uid, { checkedAt: Date.now(), live: null });
            return;
          }
          const props = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
          const prog = props.program || {};
          const progId = String(prog.nicoliveProgramId || "").toLowerCase();
          const status = String(prog.status || "");
          if (progId && status === "ON_AIR") {
            const liveObj = {
              id: progId,
              title: String(prog.title || `${sub.name} \u306E\u751F\u653E\u9001`),
              thumbnail: String(prog.thumbnail?.large || prog.thumbnail?.small || ""),
              url: `https://live.nicovideo.jp/watch/${progId}`,
              providerName: String(props.programBroadcaster?.name || sub.name || "\u653E\u9001\u4E3B"),
              providerAvatar: String(props.programBroadcaster?.iconUrl || sub.avatar || ""),
              providerId: uid,
              watchCount: Number(prog.statistics?.watchCount || 0),
              commentCount: Number(prog.statistics?.commentCount || 0),
              liveCycle: "ON_AIR"
            };
            userLiveCheckCache.set(uid, { checkedAt: Date.now(), live: liveObj });
            if (!matchedMap.has(progId)) {
              matchedMap.set(progId, {
                ...liveObj,
                matchedSubUrl: sub.url,
                matchedSubName: sub.name
              });
            }
          } else {
            userLiveCheckCache.set(uid, { checkedAt: Date.now(), live: null });
          }
        } catch {
        }
      })
    );
    return res.json({ success: true, liveAlerts: Array.from(matchedMap.values()) });
  });
  app2.get("/api/nico/seiga/:id", async (req, res) => {
    const raw = String(req.params.id || "").trim();
    const numId = raw.replace(/\D/g, "");
    if (!numId) return res.status(400).json({ success: false, error: "\u30A4\u30E9\u30B9\u30C8ID (\u4F8B: im10000000) \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044" });
    try {
      const resp = await fetch(`https://seiga.nicovideo.jp/api/illust/info?id=im${numId}`, {
        headers: NICO_API_HEADERS,
        signal: AbortSignal.timeout(5e3)
      });
      if (!resp.ok) return res.status(resp.status).json({ success: false, error: "\u9759\u753B\u60C5\u5831\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F" });
      const xml = await resp.text();
      if (!xml.includes("<image>")) {
        return res.status(404).json({ success: false, error: "\u6307\u5B9A\u3057\u305F\u9759\u753B\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F" });
      }
      return res.json({
        success: true,
        illust: {
          id: `im${numId}`,
          title: extractXmlTag(xml, "title") || `im${numId}`,
          description: stripHtmlTags(extractXmlTag(xml, "description")),
          userId: extractXmlTag(xml, "user_id"),
          created: extractXmlTag(xml, "created"),
          viewCount: parseInt(extractXmlTag(xml, "view_count") || "0", 10),
          commentCount: parseInt(extractXmlTag(xml, "comment_count") || "0", 10),
          clipCount: parseInt(extractXmlTag(xml, "clip_count") || "0", 10),
          thumbnailUrl: `https://lohas.nicoseiga.jp/thumb/${numId}i`,
          url: `https://seiga.nicovideo.jp/seiga/im${numId}`
        }
      });
    } catch (err) {
      return res.status(502).json({ success: false, error: err?.message || "\u9759\u753BAPI\u30A8\u30E9\u30FC" });
    }
  });
  app2.get("/api/nico/dic/:word", async (req, res) => {
    const word = String(req.params.word || "").trim();
    if (!word) return res.status(400).json({ success: false, error: "\u5358\u8A9E\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044" });
    try {
      const targetUrl = `https://dic.nicovideo.jp/a/${encodeURIComponent(word)}`;
      const resp = await fetch(targetUrl, {
        headers: NICO_API_HEADERS,
        signal: AbortSignal.timeout(6e3)
      });
      if (!resp.ok) {
        return res.status(404).json({ success: false, error: `\u300C${word}\u300D\u306E\u5927\u767E\u79D1\u8A18\u4E8B\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F`, url: targetUrl });
      }
      const html = await resp.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i) || html.match(/<meta\s+content="([^"]*)"\s+property="og:description"/i);
      const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || html.match(/<meta\s+content="([^"]*)"\s+name="description"/i);
      const artStart = html.indexOf('id="article"');
      const paragraphs = [];
      if (artStart !== -1) {
        const artSlice = html.slice(artStart, artStart + 24e3).replace(/<div[^>]*class="[^"]*kyujin[^"]*"[\s\S]*?<\/ul>\s*<\/div>/gi, "");
        const pMatches = Array.from(artSlice.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
        for (const pm of pMatches) {
          const clean = stripHtmlTags(pm[1]);
          if (clean.length > 15 && !clean.includes("sponsored by")) paragraphs.push(clean);
          if (paragraphs.length >= 4) break;
        }
      }
      const summary = paragraphs.join("\n\n") || decodeXmlEntities(ogDescMatch?.[1] || descMatch?.[1] || "");
      return res.json({
        success: true,
        word,
        title: decodeXmlEntities((titleMatch?.[1] || word).replace(/\s*とは.*$/, "").trim()),
        summary: summary || "\u5927\u767E\u79D1\u30DA\u30FC\u30B8\u3067\u8A18\u4E8B\u672C\u6587\u3092\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002",
        url: targetUrl
      });
    } catch (err) {
      return res.status(502).json({ success: false, error: err?.message || "\u5927\u767E\u79D1\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F" });
    }
  });
  app2.get("/api/nico/jikkyo", async (req, res) => {
    const channel = String(req.query.channel || "jk1").replace(/[^a-zA-Z0-9_]/g, "") || "jk1";
    const nowSec = Math.floor(Date.now() / 1e3);
    const endtime = parseInt(String(req.query.endtime || nowSec), 10) || nowSec;
    const starttime = parseInt(String(req.query.starttime || endtime - 600), 10) || endtime - 600;
    try {
      const resp = await fetch(
        `https://jikkyo.tsukumijima.net/api/kakolog/${encodeURIComponent(channel)}?starttime=${starttime}&endtime=${endtime}&format=json`,
        { signal: AbortSignal.timeout(6e3) }
      );
      if (!resp.ok) return res.status(resp.status).json({ success: false, packets: [], error: "\u5B9F\u6CC1\u30ED\u30B0\u53D6\u5F97\u30A8\u30E9\u30FC" });
      const json = await resp.json();
      const rawPackets = Array.isArray(json?.packet) ? json.packet : [];
      const packets = rawPackets.slice(-80).reverse().map((p, idx) => ({
        id: `${p.chat?.no || idx}-${p.chat?.date || idx}`,
        text: String(p.chat?.content || ""),
        date: Number(p.chat?.date || 0),
        userId: String(p.chat?.user_id || "")
      })).filter((p) => p.text);
      return res.json({ success: true, channel, count: packets.length, packets });
    } catch (err) {
      return res.status(502).json({ success: false, packets: [], error: err?.message || "\u5B9F\u6CC1\u30ED\u30B0API\u30A8\u30E9\u30FC" });
    }
  });
  return app2;
}

// api/_entry.ts
var app = createApiApp();
var entry_default = app;
export {
  entry_default as default
};
