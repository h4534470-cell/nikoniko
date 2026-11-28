import { NicoComment } from '../types';

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
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

export function parseSubtitleFileText(raw: string): SubtitleCue[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  let idx = 0;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE')) continue;

    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const timeParts = lines[timeLineIdx].split('-->');
    if (timeParts.length < 2) continue;

    const startMs = parseTimestampMs(timeParts[0]);
    const endRaw = timeParts[1].trim().split(/\s+/)[0];
    const endMs = Math.max(startMs + 800, parseTimestampMs(endRaw));
    const text = lines
      .slice(timeLineIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;

    cues.push({
      id: `ext-sub-${idx++}`,
      startMs,
      endMs,
      text
    });
  }

  return cues.sort((a, b) => a.startMs - b.startMs);
}

function isReadableSubtitleComment(c: NicoComment): boolean {
  const txt = (c.text || '').trim();
  if (txt.length < 2 || txt.length > 68) return false;
  // 単発の草・拍手弾幕・記号連打を除外して字幕らしく整形
  if (/^[wｗ草8８!！?？。、・.…\-_=＋+＊*〜~]+$/i.test(txt)) return false;
  if (/^([wｗ8８])\1+$/i.test(txt)) return false;
  return true;
}

export function buildAutoSubtitlesFromComments(comments: NicoComment[]): SubtitleCue[] {
  if (!Array.isArray(comments) || comments.length === 0) return [];

  // 下固定(shita)・上固定(ue)を優先しつつ、通常コメントも時間間隔を空けて見やすく配置
  const sorted = [...comments]
    .filter(isReadableSubtitleComment)
    .sort((a, b) => a.timeMs - b.timeMs);

  const cues: SubtitleCue[] = [];
  let lastEndMs = -1000;
  let lastText = '';

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const isCaptionPos =
      c.position === 'shita' ||
      c.commands?.includes('shita') ||
      c.commands?.includes('ue');
    const cleanText = c.text.trim();
    if (cleanText === lastText) continue;

    const startMs = Math.max(0, c.timeMs);
    if (!isCaptionPos && startMs < lastEndMs + 400) {
      continue;
    }

    const durationMs = Math.min(4800, Math.max(2200, cleanText.length * 160));
    const endMs = startMs + durationMs;

    cues.push({
      id: `auto-sub-${c.id}-${i}`,
      startMs,
      endMs,
      text: cleanText
    });
    lastEndMs = endMs;
    lastText = cleanText;
  }

  return cues;
}

export function createVttBlobUrl(cues: SubtitleCue[]): string {
  const lines = ['WEBVTT', ''];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}`);
    lines.push(cue.text);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/vtt;charset=utf-8' });
  return URL.createObjectURL(blob);
}
