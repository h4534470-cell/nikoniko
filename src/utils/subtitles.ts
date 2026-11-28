import { NicoComment } from '../types';

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface AutoSubtitleBuildResult {
  cues: SubtitleCue[];
  modeLabel: string;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function parseTimestampMs(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return Math.round((m * 60 + s) * 1000);
  }
  return 0;
}

function formatVttTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3600000);
  const m = Math.floor((safe % 3600000) / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  const rem = safe % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rem).padStart(3, '0')}`;
}

function cleanVttLineText(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?>/g, '')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseAssSubtitles(normalized: string): SubtitleCue[] {
  const lines = normalized.split('\n');
  let formatCols: string[] = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  const cues: SubtitleCue[] = [];
  let idx = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Format:/i.test(trimmed)) {
      formatCols = trimmed.replace(/^Format:/i, '').split(',').map((s) => s.trim());
      continue;
    }
    if (/^Dialogue:/i.test(trimmed)) {
      const payload = trimmed.replace(/^Dialogue:\s*/i, '');
      const textIdx = Math.max(formatCols.findIndex((c) => c.toLowerCase() === 'text'), 9);
      const parts = payload.split(',');
      if (parts.length <= textIdx) continue;
      const startIdx = Math.max(formatCols.findIndex((c) => c.toLowerCase() === 'start'), 1);
      const endIdx = Math.max(formatCols.findIndex((c) => c.toLowerCase() === 'end'), 2);
      const startMs = parseTimestampMs(parts[startIdx] || '0:00:00.00');
      const endMs = Math.max(startMs + 600, parseTimestampMs(parts[endIdx] || '0:00:01.00'));
      const rawText = parts.slice(textIdx).join(',');
      const cleaned = decodeHtmlEntities(
        rawText
          .replace(/\{[^}]*\}/g, '')
          .replace(/\\N|\\n/g, '\n')
          .replace(/\\h/g, ' ')
      ).trim();
      if (!cleaned) continue;
      cues.push({ id: `ass-sub-${idx++}`, startMs, endMs, text: cleaned });
    }
  }
  return normalizeParsedCues(cues);
}

function normalizeParsedCues(rawCues: SubtitleCue[]): SubtitleCue[] {
  const sorted = [...rawCues].sort((a, b) => a.startMs - b.startMs);
  const out: SubtitleCue[] = [];

  for (const cue of sorted) {
    // 10ms未満の空に近いYouTubeローリング重複フレームを除去
    if (cue.endMs - cue.startMs < 120) continue;

    let cueLines = cue.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const prev = out[out.length - 1];
    if (prev) {
      const prevLines = prev.text.split('\n').map((l) => l.trim()).filter(Boolean);
      // YouTube自動字幕のロールアップ重複行（前行と同じ行）を除去してスッキリさせる
      if (
        cue.startMs <= prev.endMs + 250 &&
        cueLines.length > 1 &&
        prevLines.length > 0 &&
        cueLines[0] === prevLines[prevLines.length - 1]
      ) {
        cueLines = cueLines.slice(1);
      }
      const nextText = cueLines.join('\n').trim();
      if (!nextText) continue;
      if (nextText === prev.text && cue.startMs <= prev.endMs + 200) {
        prev.endMs = Math.max(prev.endMs, cue.endMs);
        continue;
      }
      // 同一トラック上の過度な重なりをクランプ
      if (prev.endMs > cue.startMs && cue.startMs - prev.startMs >= 500) {
        prev.endMs = Math.max(prev.startMs + 400, cue.startMs - 20);
      }
      out.push({ ...cue, text: nextText });
    } else {
      const nextText = cueLines.join('\n').trim();
      if (nextText) out.push({ ...cue, text: nextText });
    }
  }

  return out;
}

export function parseSubtitleFileText(raw: string): SubtitleCue[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (/\[Events\]/i.test(normalized) && /^Dialogue:/im.test(normalized)) {
    return parseAssSubtitles(normalized);
  }

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  let idx = 0;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE') || lines[0].startsWith('STYLE') || lines[0].startsWith('REGION')) continue;

    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const timeParts = lines[timeLineIdx].split('-->');
    if (timeParts.length < 2) continue;

    const startMs = parseTimestampMs(timeParts[0]);
    const endRaw = timeParts[1].trim().split(/\s+/)[0];
    const endMs = Math.max(startMs + 600, parseTimestampMs(endRaw));
    const cleanedLines = lines
      .slice(timeLineIdx + 1)
      .map(cleanVttLineText)
      .filter(Boolean);
    const text = Array.from(new Set(cleanedLines)).join('\n').trim();
    if (!text) continue;

    cues.push({
      id: `ext-sub-${idx++}`,
      startMs,
      endMs,
      text
    });
  }

  return normalizeParsedCues(cues);
}

const NOISE_EXACT_RE = /^(?:うぽつ|うぽ|おつ|おつかれ|お疲れ|お疲れ様|おつかれさま|初見|しょけん|ただいま|おかえり|ここすき|ここ好き|かわいい|かわよ|草|くさ|大草原|神|神回|神曲|神動画|広告|ニコニ広告|広告ありがとう|きた|ｷﾀ|待機|1コメ|いちこめ|イチコメ|2コメ|3コメ|わかる|それな|なるほど|やばい|すごい|すげー|マジか|まじか|草生える|ワロタ|わろた|笑|ｗ|w|888|パチパチ|GJ|gj|gg|nice|lol|誰？|だれ？|なにこれ|何これ|おお|おー|ああ|あー|うわ|えっ|は？|ん？|草不可避|お前らか|定期|いつも通り|通常運転|安心した|安定|原点|伝説|懐かしい|なつかしい|すき|好き)[!！?？wｗ。、〜~]*$/i;

function isNoiseSubtitleComment(c: NicoComment): boolean {
  if (c.fork === 'easy') return true;
  if (typeof c.score === 'number' && c.score <= -500) return true;

  const txt = (c.text || '').trim();
  if (txt.length < 2 || txt.length > 90) return true;
  if (/https?:\/\/|nicovideo\.jp|(?:sm|so|nm|lv)\d+/i.test(txt)) return true;
  if (/^[wｗ草8８!！?？。、・.…\-_=＋+＊*〜~＠@＃#()（）\[\]【】\s\d:：]+$/i.test(txt)) return true;
  if (/^([wｗ8８あ-んア-ン])\1{2,}$/i.test(txt)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(txt)) return true;
  if (/^[(（].*[)）]$/.test(txt) && txt.length <= 10) return true;
  if (NOISE_EXACT_RE.test(txt)) return true;
  return false;
}

function scoreSubtitleCandidate(c: NicoComment): number {
  const txt = (c.text || '').trim();
  let score = 0;

  // 投稿者コメント（投コメ）は最高優先度
  if (c.fork === 'owner') score += 120;

  // 固定字幕・歌詞職人コマンド（shita / ue）
  const isFixedPos =
    c.position === 'shita' ||
    c.position === 'ue' ||
    c.commands?.includes('shita') ||
    c.commands?.includes('ue');
  if (isFixedPos) score += 55;

  // 歌詞・セリフ・翻訳・解説記号
  if (/[♪♫♬「」『』]/.test(txt)) score += 35;
  if (/^(?:【|\[|訳[:：]|字幕[:：]|歌詞[:：])/.test(txt)) score += 35;

  // ニコる数・本文の文字質（自然な文・漢字かな混じり）
  if ((c.nicoruCount || 0) >= 3) score += 20;
  if (/[\u4e00-\u9faf]/.test(txt) && /[\u3041-\u3096]/.test(txt) && txt.length >= 6) score += 15;
  if (/[。、！？]/.test(txt) && txt.length >= 8) score += 12;

  // 短すぎる感嘆・草語尾は減点
  if (txt.length <= 4 && !isFixedPos && c.fork !== 'owner') score -= 25;
  if (/[wｗ]{2,}$/i.test(txt)) score -= 35;

  return score;
}

function wrapSubtitleText(text: string, maxCharsPerLine: number = 26): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.includes('\n') || clean.length <= maxCharsPerLine) return clean;

  const breakChars = ['。', '、', '！', '？', '!', '?', '　', ' ', '」', '』', '）', '】'];
  const mid = Math.floor(clean.length / 2);
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = Math.max(8, mid - 8); i <= Math.min(clean.length - 5, mid + 8); i++) {
    if (breakChars.includes(clean[i])) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }

  if (bestIdx > 0 && bestIdx < clean.length - 2) {
    return `${clean.slice(0, bestIdx).trim()}\n${clean.slice(bestIdx).trim()}`;
  }
  return clean;
}

export function buildAutoSubtitlesFromComments(comments: NicoComment[]): AutoSubtitleBuildResult {
  if (!Array.isArray(comments) || comments.length === 0) {
    return { cues: [], modeLabel: '自動字幕なし' };
  }

  const scored = comments
    .filter((c) => !isNoiseSubtitleComment(c))
    .map((c) => ({ comment: c, quality: scoreSubtitleCandidate(c) }))
    .filter((item) => item.quality >= 10)
    .sort((a, b) => a.comment.timeMs - b.comment.timeMs);

  if (scored.length === 0) {
    return { cues: [], modeLabel: 'コメント厳選字幕' };
  }

  const highConfidenceItems = scored.filter(
    ({ comment, quality }) =>
      comment.fork === 'owner' ||
      comment.position === 'shita' ||
      comment.position === 'ue' ||
      comment.commands?.includes('shita') ||
      comment.commands?.includes('ue') ||
      quality >= 75
  );

  const hasDedicatedCaptions = highConfidenceItems.length >= 4;
  const pool = hasDedicatedCaptions ? highConfidenceItems : scored;
  const modeLabel = hasDedicatedCaptions
    ? (highConfidenceItems.some((i) => i.comment.fork === 'owner') ? '投稿者・公式コメント字幕' : '歌詞・固定コメント字幕')
    : 'コメント厳選字幕';

  const rawCues: Array<{ id: string; startMs: number; endMs: number; text: string; priority: number }> = [];
  let lastAcceptedText = '';
  let lastAcceptedStart = -99999;

  for (let i = 0; i < pool.length; i++) {
    const { comment, quality } = pool[i];
    const cleanText = comment.text.trim();
    const startMs = Math.max(0, comment.timeMs);

    // 1.5秒以内の同一文・重複テキストをマージスキップ
    if (cleanText === lastAcceptedText && startMs - lastAcceptedStart < 2500) {
      continue;
    }

    const readingDurationMs = Math.min(5400, Math.max(1900, 900 + cleanText.length * 145));
    rawCues.push({
      id: `auto-sub-${comment.id}-${i}`,
      startMs,
      endMs: startMs + readingDurationMs,
      text: wrapSubtitleText(cleanText),
      priority: quality
    });
    lastAcceptedText = cleanText;
    lastAcceptedStart = startMs;
  }

  // 密集箇所で低優先度を間引きつつ、次の字幕手前で綺麗に終了させる
  const finalCues: SubtitleCue[] = [];
  let lastPriority = -Infinity;
  for (let i = 0; i < rawCues.length; i++) {
    const cur = rawCues[i];
    const prev = finalCues[finalCues.length - 1];
    if (prev && cur.startMs - prev.startMs < 550) {
      if (cur.priority > lastPriority + 15) {
        finalCues[finalCues.length - 1] = {
          id: cur.id,
          startMs: cur.startMs,
          endMs: cur.endMs,
          text: cur.text
        };
        lastPriority = cur.priority;
      }
      continue;
    }
    if (prev && prev.endMs > cur.startMs - 50) {
      prev.endMs = Math.max(prev.startMs + 900, cur.startMs - 50);
    }
    finalCues.push({
      id: cur.id,
      startMs: cur.startMs,
      endMs: cur.endMs,
      text: cur.text
    });
    lastPriority = cur.priority;
  }

  return { cues: finalCues, modeLabel };
}

export function findActiveSubtitleText(
  cues: SubtitleCue[],
  currentTimeMs: number,
  offsetMs: number = 0
): string {
  if (!cues || cues.length === 0) return '';
  const targetMs = currentTimeMs + offsetMs;

  // 二分探索で最初に targetMs 付近になり得る開始位置を特定
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startMs <= targetMs) lo = mid + 1;
    else hi = mid - 1;
  }

  const matchedTexts: string[] = [];
  const startScan = Math.max(0, hi - 4);
  const endScan = Math.min(cues.length - 1, hi + 1);
  for (let i = startScan; i <= endScan; i++) {
    const c = cues[i];
    if (targetMs >= c.startMs && targetMs <= c.endMs) {
      if (!matchedTexts.includes(c.text)) {
        matchedTexts.push(c.text);
        if (matchedTexts.length >= 2) break;
      }
    }
  }

  return matchedTexts.join('\n');
}

export function createVttBlobUrl(cues: SubtitleCue[], offsetMs: number = 0): string {
  const lines = ['WEBVTT', ''];
  cues.forEach((cue, i) => {
    const s = Math.max(0, cue.startMs - offsetMs);
    const e = Math.max(s + 500, cue.endMs - offsetMs);
    lines.push(String(i + 1));
    lines.push(`${formatVttTime(s)} --> ${formatVttTime(e)}`);
    lines.push(cue.text);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/vtt;charset=utf-8' });
  return URL.createObjectURL(blob);
}

export interface FullscreenDanmakuCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  lane: number;
  linePercent: number;
}

const DANMAKU_LANE_PERCENTS = [10, 22, 34, 46, 58];

export function buildFullscreenDanmakuCues(
  comments: NicoComment[],
  options?: { videoDurationMs?: number; maxCues?: number }
): FullscreenDanmakuCue[] {
  if (!Array.isArray(comments) || comments.length === 0) return [];
  const maxCues = Math.max(40, options?.maxCues ?? 400);

  const cleaned = comments
    .map((c) => {
      const normalized = String(c.text || '').replace(/\s+/g, ' ').trim();
      const clipped = normalized.length > 30 ? `${normalized.slice(0, 29)}…` : normalized;
      return { ...c, cleanText: clipped };
    })
    .filter((c) => c.cleanText.length > 0);

  if (cleaned.length === 0) return [];

  const hasSpreadTimestamps = cleaned.some((c) => Number(c.timeMs || 0) > 500);
  const prepared = cleaned
    .map((c, idx) => ({
      ...c,
      effectiveTimeMs: hasSpreadTimestamps
        ? Math.max(0, Number(c.timeMs || 0))
        : idx * 1400
    }))
    .sort((a, b) => a.effectiveTimeMs - b.effectiveTimeMs)
    .slice(0, maxCues);

  const laneBusyUntil = new Array(DANMAKU_LANE_PERCENTS.length).fill(0);
  const cues: FullscreenDanmakuCue[] = [];
  let recentKey = '';
  let recentTime = -99999;

  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    if (item.cleanText === recentKey && item.effectiveTimeMs - recentTime < 1200) {
      continue;
    }
    recentKey = item.cleanText;
    recentTime = item.effectiveTimeMs;

    const startMs = item.effectiveTimeMs;
    let chosenLane = -1;
    for (let l = 0; l < laneBusyUntil.length; l++) {
      if (laneBusyUntil[l] <= startMs) {
        chosenLane = l;
        break;
      }
    }
    if (chosenLane === -1) {
      // 全レーン使用中なら過密重複を避けてスキップ（次のタイミングに回す）
      continue;
    }

    const durationMs = 2600;
    const rawEndMs = startMs + durationMs;
    const boundedEndMs =
      options?.videoDurationMs && options.videoDurationMs > 0
        ? Math.min(options.videoDurationMs, rawEndMs)
        : rawEndMs;

    if (boundedEndMs <= startMs + 400) continue;

    laneBusyUntil[chosenLane] = boundedEndMs + 200;

    cues.push({
      id: `fs-danmaku-${i}`,
      startMs,
      endMs: boundedEndMs,
      text: item.cleanText,
      lane: chosenLane,
      linePercent: DANMAKU_LANE_PERCENTS[chosenLane]
    });
  }

  return cues;
}

