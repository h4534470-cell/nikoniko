import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiRoute';
import { AppSettings } from '../types';

const thumbBase64Cache = new Map<string, string>();
const thumbBase64Pending = new Map<string, Promise<string>>();

export async function resolveThumbnailDataUrl(
  url: string,
  method: AppSettings['thumbMethod'] = 'server',
  routeMethod: AppSettings['apiRouteMethod'] = 'auto'
): Promise<string> {
  const raw = String(url || '').trim();
  if (!raw || method !== 'server' || !/^https?:\/\//i.test(raw)) {
    return raw;
  }
  const hit = thumbBase64Cache.get(raw);
  if (hit) return hit;

  const existing = thumbBase64Pending.get(raw);
  if (existing) return existing;

  const work = (async () => {
    try {
      const resp = await apiFetch(
        `/api/thumb-base64?url=${encodeURIComponent(raw)}`,
        undefined,
        routeMethod
      );
      if (resp.ok) {
        const json = await resp.json();
        if (json?.dataUrl && typeof json.dataUrl === 'string') {
          if (thumbBase64Cache.size > 300) thumbBase64Cache.clear();
          thumbBase64Cache.set(raw, json.dataUrl);
          return json.dataUrl;
        }
      }
    } catch {}
    return raw;
  })().finally(() => {
    thumbBase64Pending.delete(raw);
  });

  thumbBase64Pending.set(raw, work);
  return work;
}

interface ThumbImgProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
  thumbMethod?: AppSettings['thumbMethod'];
  apiRouteMethod?: AppSettings['apiRouteMethod'];
}

export const ThumbImg: React.FC<ThumbImgProps> = ({
  src,
  thumbMethod = 'server',
  apiRouteMethod = 'auto',
  alt = '',
  ...rest
}) => {
  const cleanSrc = String(src || '');
  const [resolvedSrc, setResolvedSrc] = useState<string>(() => {
    if (thumbMethod === 'server' && cleanSrc) {
      return thumbBase64Cache.get(cleanSrc) || cleanSrc;
    }
    return cleanSrc;
  });

  useEffect(() => {
    let active = true;
    if (!cleanSrc) {
      setResolvedSrc('');
      return;
    }
    if (thumbMethod !== 'server' || !/^https?:\/\//i.test(cleanSrc)) {
      setResolvedSrc(cleanSrc);
      return;
    }
    const cached = thumbBase64Cache.get(cleanSrc);
    if (cached) {
      setResolvedSrc(cached);
      return;
    }
    resolveThumbnailDataUrl(cleanSrc, thumbMethod, apiRouteMethod).then((out) => {
      if (active && out) setResolvedSrc(out);
    });
    return () => {
      active = false;
    };
  }, [cleanSrc, thumbMethod, apiRouteMethod]);

  return (
    <img
      src={resolvedSrc || cleanSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      {...rest}
    />
  );
};
