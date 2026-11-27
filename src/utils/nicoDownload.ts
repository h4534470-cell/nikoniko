// Zero-ffmpeg pure TypeScript Niconico HLS fMP4 downloader & muxer (Web Crypto AES-128-CBC + ISO-BMFF)

interface IsoBox {
  type: string;
  start: number;
  end: number;
  size: number;
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>>
    0
  );
}

function writeU32(buf: Uint8Array, off: number, val: number) {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}

function readBoxType(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
}

function listBoxes(buf: Uint8Array, start = 0, end = buf.length): IsoBox[] {
  const out: IsoBox[] = [];
  let off = start;
  while (off + 8 <= end) {
    const size = readU32(buf, off);
    const type = readBoxType(buf, off);
    if (size < 8 || off + size > end) break;
    out.push({ type, start: off, end: off + size, size });
    off += size;
  }
  return out;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function wrapBox(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.byteLength);
  writeU32(out, 0, out.byteLength);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(body, 8);
  return out;
}

function patchTrackIdInInit(buf: Uint8Array, newTrackId: number, nextTrackId: number): Uint8Array {
  const copy = new Uint8Array(buf);
  const top = listBoxes(copy);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) return copy;

  for (const child of listBoxes(copy, moov.start + 8, moov.end)) {
    if (child.type === 'mvhd') {
      const ver = copy[child.start + 8];
      const nextOff = ver === 1 ? child.start + 8 + 104 : child.start + 8 + 92;
      if (nextOff + 4 <= child.end) {
        writeU32(copy, nextOff, nextTrackId);
      }
    } else if (child.type === 'trak') {
      for (const tc of listBoxes(copy, child.start + 8, child.end)) {
        if (tc.type === 'tkhd') {
          const ver = copy[tc.start + 8];
          const idOff = ver === 1 ? tc.start + 8 + 20 : tc.start + 8 + 12;
          if (idOff + 4 <= tc.end) {
            writeU32(copy, idOff, newTrackId);
          }
        }
      }
    } else if (child.type === 'mvex') {
      for (const mc of listBoxes(copy, child.start + 8, child.end)) {
        if (mc.type === 'trex' && mc.start + 16 <= mc.end) {
          writeU32(copy, mc.start + 12, newTrackId);
        }
      }
    }
  }
  return copy;
}

function patchFragment(buf: Uint8Array, newTrackId: number, seqNum: number): Uint8Array {
  const copy = new Uint8Array(buf);
  for (const b of listBoxes(copy)) {
    if (b.type === 'moof') {
      for (const mc of listBoxes(copy, b.start + 8, b.end)) {
        if (mc.type === 'mfhd' && mc.start + 16 <= mc.end) {
          writeU32(copy, mc.start + 12, seqNum);
        } else if (mc.type === 'traf') {
          for (const tc of listBoxes(copy, mc.start + 8, mc.end)) {
            if (tc.type === 'tfhd' && tc.start + 16 <= tc.end) {
              writeU32(copy, tc.start + 12, newTrackId);
            }
          }
        }
      }
    }
  }
  return copy;
}

export function mergeFmp4Inits(videoInit: Uint8Array, audioInit: Uint8Array): Uint8Array {
  const vPatched = patchTrackIdInInit(videoInit, 1, 3);
  const aPatched = patchTrackIdInInit(audioInit, 2, 3);

  const vTop = listBoxes(vPatched);
  const aTop = listBoxes(aPatched);
  const vFtyp = vTop.find((b) => b.type === 'ftyp');
  const vMoov = vTop.find((b) => b.type === 'moov');
  const aMoov = aTop.find((b) => b.type === 'moov');

  if (!vFtyp || !vMoov || !aMoov) {
    return vPatched;
  }

  const vChildren = listBoxes(vPatched, vMoov.start + 8, vMoov.end);
  const aChildren = listBoxes(aPatched, aMoov.start + 8, aMoov.end);

  const vMvhd = vChildren.find((b) => b.type === 'mvhd');
  const vTraks = vChildren.filter((b) => b.type === 'trak');
  const aTraks = aChildren.filter((b) => b.type === 'trak');
  const vMvex = vChildren.find((b) => b.type === 'mvex');
  const aMvex = aChildren.find((b) => b.type === 'mvex');

  const mvexParts: Uint8Array[] = [];
  if (vMvex) {
    for (const c of listBoxes(vPatched, vMvex.start + 8, vMvex.end)) {
      mvexParts.push(vPatched.subarray(c.start, c.end));
    }
  }
  if (aMvex) {
    for (const c of listBoxes(aPatched, aMvex.start + 8, aMvex.end)) {
      if (c.type === 'trex') {
        mvexParts.push(aPatched.subarray(c.start, c.end));
      }
    }
  }

  const moovParts: Uint8Array[] = [];
  if (vMvhd) moovParts.push(vPatched.subarray(vMvhd.start, vMvhd.end));
  for (const t of vTraks) moovParts.push(vPatched.subarray(t.start, t.end));
  for (const t of aTraks) moovParts.push(aPatched.subarray(t.start, t.end));
  if (mvexParts.length > 0) {
    moovParts.push(wrapBox('mvex', concatUint8Arrays(mvexParts)));
  }

  const mergedMoov = wrapBox('moov', concatUint8Arrays(moovParts));
  return concatUint8Arrays([vPatched.subarray(vFtyp.start, vFtyp.end), mergedMoov]);
}

interface ParsedHlsSegment {
  url: string;
  keyUrl?: string;
  iv?: Uint8Array;
}

interface ParsedMediaPlaylist {
  initUrl?: string;
  segments: ParsedHlsSegment[];
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '').padStart(32, '0');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function seqToIv(seq: number): Uint8Array {
  const out = new Uint8Array(16);
  writeU32(out, 12, seq >>> 0);
  return out;
}

function parseMediaPlaylist(m3u8Text: string): ParsedMediaPlaylist {
  const lines = m3u8Text.split(/\r?\n/);
  let initUrl: string | undefined;
  let mediaSequence = 0;
  let currentKeyUrl: string | undefined;
  let currentIv: Uint8Array | undefined;
  let useAes128 = false;
  const segments: ParsedHlsSegment[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.split(':')[1] || '0', 10) || 0;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const m = line.match(/URI="([^"]+)"/);
      if (m?.[1]) initUrl = m[1];
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const methodM = line.match(/METHOD=([^,\s]+)/i);
      const method = (methodM?.[1] || '').toUpperCase();
      if (method === 'NONE') {
        useAes128 = false;
        currentKeyUrl = undefined;
        currentIv = undefined;
      } else if (method === 'AES-128') {
        useAes128 = true;
        const uriM = line.match(/URI="([^"]+)"/);
        const ivM = line.match(/IV=0x([0-9a-fA-F]+)/i);
        currentKeyUrl = uriM?.[1];
        currentIv = ivM?.[1] ? hexToBytes(ivM[1]) : undefined;
      }
    } else if (!line.startsWith('#')) {
      const seqNum = mediaSequence + segments.length;
      segments.push({
        url: line,
        keyUrl: useAes128 ? currentKeyUrl : undefined,
        iv: useAes128 ? currentIv || seqToIv(seqNum) : undefined
      });
    }
  }

  return { initUrl, segments };
}

export interface NicoDownloadProgress {
  percent: number;
  stage: string;
  downloadedBytes: number;
  speedText: string;
}

export interface NicoDownloadResult {
  blobUrl: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

export async function downloadNiconicoInBrowser(opts: {
  nicoId: string;
  title: string;
  quality: string;
  audioOnly: boolean;
  signal?: AbortSignal;
  onProgress?: (p: NicoDownloadProgress) => void;
}): Promise<NicoDownloadResult> {
  const { nicoId, title, quality, audioOnly, signal, onProgress } = opts;
  const safeTitle = title.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || nicoId;
  const startedAt = Date.now();
  let downloadedBytes = 0;

  const report = (percent: number, stage: string) => {
    const elapsedSec = Math.max(0.2, (Date.now() - startedAt) / 1000);
    const speedMbps = downloadedBytes / (1024 * 1024) / elapsedSec;
    onProgress?.({
      percent,
      stage,
      downloadedBytes,
      speedText: speedMbps >= 0.05 ? `${speedMbps.toFixed(1)} MB/s` : ''
    });
  };

  report(5, 'ニコニコ動画ストリームを解析中...');

  const masterRes = await fetch(
    `/api/nico/hls/${encodeURIComponent(nicoId)}/master.m3u8?quality=${encodeURIComponent(quality)}${audioOnly ? '&audioOnly=1' : ''}`,
    { signal }
  );
  if (!masterRes.ok) {
    throw new Error(`ストリーム情報の取得に失敗しました (${masterRes.status})`);
  }
  const masterText = await masterRes.text();

  const fetchWithRetry = async (url: string, label: string, maxAttempts = 3): Promise<Response> => {
    let lastStatus = 0;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const res = await fetch(url, { signal });
        if (res.ok) return res;
        lastStatus = res.status;
        if (attempt < maxAttempts && (res.status === 403 || res.status === 408 || res.status === 429 || res.status >= 500)) {
          await new Promise((r) => setTimeout(r, attempt * 350));
          continue;
        }
        throw new Error(`${label} (${res.status})`);
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        lastErr = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 350));
          continue;
        }
      }
    }
    throw lastErr || new Error(`${label} (${lastStatus || 'network'})`);
  };

  const keyCache = new Map<string, CryptoKey>();
  const getCryptoKey = async (keyUrl: string): Promise<CryptoKey> => {
    const existing = keyCache.get(keyUrl);
    if (existing) return existing;
    const kr = await fetchWithRetry(keyUrl, '復号鍵の取得に失敗しました');
    const raw = await kr.arrayBuffer();
    const ck = await window.crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
    keyCache.set(keyUrl, ck);
    return ck;
  };

  const fetchTrack = async (
    playlistText: string,
    progressStart: number,
    progressSpan: number,
    stageLabel: string
  ): Promise<{ init?: Uint8Array; segments: Uint8Array[] }> => {
    const parsed = parseMediaPlaylist(playlistText);
    let initBuf: Uint8Array | undefined;
    if (parsed.initUrl) {
      const ir = await fetchWithRetry(parsed.initUrl, '初期化セグメントの取得に失敗しました');
      initBuf = new Uint8Array(await ir.arrayBuffer());
      downloadedBytes += initBuf.byteLength;
    }

    const total = parsed.segments.length;
    const out: Uint8Array[] = new Array(total);
    let nextIdx = 0;
    let finished = 0;
    const concurrency = Math.min(4, Math.max(1, total));

    const worker = async () => {
      while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const idx = nextIdx++;
        if (idx >= total) break;
        const seg = parsed.segments[idx];
        const sr = await fetchWithRetry(seg.url, 'セグメント取得に失敗しました');
        const rawBuf = await sr.arrayBuffer();
        downloadedBytes += rawBuf.byteLength;
        if (seg.keyUrl && seg.iv) {
          const ck = await getCryptoKey(seg.keyUrl);
          const ivCopy = new Uint8Array(seg.iv);
          const decBuf = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivCopy }, ck, rawBuf);
          out[idx] = new Uint8Array(decBuf);
        } else {
          out[idx] = new Uint8Array(rawBuf);
        }
        finished++;
        const pct = Math.min(96, Math.round(progressStart + (finished / Math.max(1, total)) * progressSpan));
        report(pct, `${stageLabel} (${finished}/${total})`);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { init: initBuf, segments: out };
  };

  if (audioOnly) {
    const audioTrack = await fetchTrack(masterText, 10, 82, '音声データを取得・復号中');
    report(95, 'M4A音声ファイルを構築中...');
    const parts: Uint8Array[] = [];
    if (audioTrack.init) parts.push(audioTrack.init);
    for (let i = 0; i < audioTrack.segments.length; i++) {
      parts.push(audioTrack.init ? patchFragment(audioTrack.segments[i], 1, i + 1) : audioTrack.segments[i]);
    }
    const finalBytes = concatUint8Arrays(parts);
    const blob = new Blob([finalBytes as unknown as BlobPart], { type: 'audio/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    report(100, '完了！');
    return {
      blobUrl,
      fileName: `${safeTitle}.m4a`,
      sizeBytes: finalBytes.byteLength,
      mimeType: 'audio/mp4'
    };
  }

  // Video + optional separate Audio playlist in master.m3u8
  const audioMatch = masterText.match(/#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO[^\r\n]*URI="([^"]+)"/i);
  const videoPlaylistUrl = masterText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));

  if (!videoPlaylistUrl) {
    // Master text was already a single media playlist
    const singleTrack = await fetchTrack(masterText, 10, 82, '動画データを取得・復号中');
    report(95, 'MP4ファイルを構築中...');
    const parts: Uint8Array[] = [];
    if (singleTrack.init) parts.push(singleTrack.init);
    for (let i = 0; i < singleTrack.segments.length; i++) {
      parts.push(singleTrack.init ? patchFragment(singleTrack.segments[i], 1, i + 1) : singleTrack.segments[i]);
    }
    const finalBytes = concatUint8Arrays(parts);
    const isFmp4 = Boolean(singleTrack.init);
    const mimeType = isFmp4 ? 'video/mp4' : 'video/mp2t';
    const ext = isFmp4 ? 'mp4' : 'ts';
    const blob = new Blob([finalBytes as unknown as BlobPart], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    report(100, '完了！');
    return {
      blobUrl,
      fileName: `${safeTitle}_${quality}p.${ext}`,
      sizeBytes: finalBytes.byteLength,
      mimeType
    };
  }

  const videoPlaylistText = await (await fetch(videoPlaylistUrl, { signal })).text();
  const hasSeparateAudio = Boolean(audioMatch?.[1]);
  const videoTrack = await fetchTrack(
    videoPlaylistText,
    10,
    hasSeparateAudio ? 56 : 82,
    '映像データを取得・復号中'
  );

  let audioTrack: { init?: Uint8Array; segments: Uint8Array[] } | null = null;
  if (audioMatch?.[1]) {
    const audioPlaylistText = await (await fetch(audioMatch[1], { signal })).text();
    audioTrack = await fetchTrack(audioPlaylistText, 66, 26, '音声データを取得・復号中');
  }

  report(95, 'MP4ファイルを結合・構築中 (ffmpeg不要)...');

  const chunks: Uint8Array[] = [];
  if (videoTrack.init && audioTrack?.init) {
    chunks.push(mergeFmp4Inits(videoTrack.init, audioTrack.init));
    let seq = 1;
    const maxSegs = Math.max(videoTrack.segments.length, audioTrack.segments.length);
    for (let i = 0; i < maxSegs; i++) {
      if (videoTrack.segments[i]) {
        chunks.push(patchFragment(videoTrack.segments[i], 1, seq++));
      }
      if (audioTrack.segments[i]) {
        chunks.push(patchFragment(audioTrack.segments[i], 2, seq++));
      }
    }
  } else {
    if (videoTrack.init) chunks.push(videoTrack.init);
    for (let i = 0; i < videoTrack.segments.length; i++) {
      chunks.push(videoTrack.init ? patchFragment(videoTrack.segments[i], 1, i + 1) : videoTrack.segments[i]);
    }
  }

  const finalBytes = concatUint8Arrays(chunks);
  const blob = new Blob([finalBytes as unknown as BlobPart], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);
  report(100, '完了！');

  return {
    blobUrl,
    fileName: `${safeTitle}_${quality}p.mp4`,
    sizeBytes: finalBytes.byteLength,
    mimeType: 'video/mp4'
  };
}
