import { Video, Playlist, ChannelSubscription, Review, AppSettings, VideoComment, NicoComment } from '../types';
import { INITIAL_REVIEWS, INITIAL_COMMENTS } from '../data/mockVideos';

const memoryFallback = new Map<string, string>();

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      // In iOS Safari iframe or private mode, localStorage throws SecurityError
    }
    return memoryFallback.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Fallback
    }
    memoryFallback.set(key, value);
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
    } catch {}
    memoryFallback.delete(key);
  }
};

const KEYS = {
  TERMS: 'zeroTermsAccepted_v1',
  HISTORY: 'zero_playHistory',
  SUBSCRIPTIONS: 'zero_savedSubscriptions',
  PLAYLISTS: 'zero_savedPlaylists',
  REVIEWS: 'zero_reviews',
  DEVICE_ID: 'zero_reviewDeviceId',
  SETTINGS: 'zero_settings',
  VISIT_COUNT: 'zero_visitCount',
  COMMENTS_STORE: 'zero_comments_by_video',
  DANMAKU_STORE: 'zero_danmaku_by_video',
  LIKED_COMMENTS: 'zero_liked_comments',
  LIKED_VIDEOS: 'zero_liked_videos'
};

export function getDeviceId(): string {
  try {
    let id = safeStorage.getItem(KEYS.DEVICE_ID);
    if (!id) {
      id = 'dev-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
      safeStorage.setItem(KEYS.DEVICE_ID, id);
    }
    return id;
  } catch {
    return 'dev-guest';
  }
}

export function getVisitCount(): number {
  try {
    let current = parseInt(safeStorage.getItem(KEYS.VISIT_COUNT) || '12845', 10);
    current += 1;
    safeStorage.setItem(KEYS.VISIT_COUNT, current.toString());
    return current;
  } catch {
    return 12845;
  }
}

export function getPlayHistory(): Video[] {
  try {
    const raw = safeStorage.getItem(KEYS.HISTORY);
    const list: Video[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v) => (v.platform as string) !== 'youtube' && !(v as any).youtubeId) : [];
  } catch {
    return [];
  }
}

export function addToPlayHistory(video: Video): Video[] {
  try {
    const history = getPlayHistory().filter(v => v.id !== video.id);
    const updated = [video, ...history].slice(0, 50);
    safeStorage.setItem(KEYS.HISTORY, JSON.stringify(updated));
    return updated;
  } catch {
    return [video];
  }
}

export function clearPlayHistory(): void {
  try {
    safeStorage.setItem(KEYS.HISTORY, JSON.stringify([]));
  } catch {}
}

export function getSubscriptions(): ChannelSubscription[] {
  try {
    const raw = safeStorage.getItem(KEYS.SUBSCRIPTIONS);
    if (!raw) {
      const defaultSubs: ChannelSubscription[] = [
        {
          url: 'https://www.nicovideo.jp/user/10892011',
          name: 'Relaxing Nature Piano',
          avatar: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=120&auto=format&fit=crop&q=80',
          subscriberCount: 285000,
          videoCount: 142,
          description: '日常を癒やす心地よい音楽と美しい自然風景をお届けします。'
        },
        {
          url: 'https://www.nicovideo.jp/user/10293847',
          name: '星影P（Hoshikage）',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
          subscriberCount: 120000,
          videoCount: 38,
          description: 'ボカロ楽曲の作詞・作曲をしています。'
        }
      ];
      safeStorage.setItem(KEYS.SUBSCRIPTIONS, JSON.stringify(defaultSubs));
      return defaultSubs;
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function toggleSubscription(channel: ChannelSubscription): boolean {
  try {
    const current = getSubscriptions();
    const exists = current.some(c => c.url === channel.url);
    let updated: ChannelSubscription[];
    if (exists) {
      updated = current.filter(c => c.url !== channel.url);
    } else {
      updated = [channel, ...current];
    }
    safeStorage.setItem(KEYS.SUBSCRIPTIONS, JSON.stringify(updated));
    return !exists;
  } catch {
    return false;
  }
}

export function isChannelSubscribed(url?: string): boolean {
  if (!url) return false;
  return getSubscriptions().some(c => c.url === url);
}

export function getPlaylists(): Playlist[] {
  try {
    const raw = safeStorage.getItem(KEYS.PLAYLISTS);
    if (!raw) {
      const defaultPlaylists: Playlist[] = [
        {
          id: 'pl-fav',
          name: 'お気に入りマイリスト',
          videos: [],
          createdAt: new Date().toISOString()
        },
        {
          id: 'pl-study',
          name: '作業用・勉強用BGM',
          videos: [],
          createdAt: new Date().toISOString()
        }
      ];
      safeStorage.setItem(KEYS.PLAYLISTS, JSON.stringify(defaultPlaylists));
      return defaultPlaylists;
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function createPlaylist(name: string): Playlist[] {
  try {
    const playlists = getPlaylists();
    const newPl: Playlist = {
      id: 'pl-' + Date.now(),
      name: name.trim().slice(0, 40),
      videos: [],
      createdAt: new Date().toISOString()
    };
    const updated = [newPl, ...playlists];
    safeStorage.setItem(KEYS.PLAYLISTS, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function addVideoToPlaylist(playlistId: string, video: Video): boolean {
  try {
    const playlists = getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return false;
    if (!pl.videos.some(v => v.id === video.id)) {
      pl.videos.push(video);
      safeStorage.setItem(KEYS.PLAYLISTS, JSON.stringify(playlists));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function removeVideoFromPlaylist(playlistId: string, videoId: string): Playlist[] {
  try {
    const playlists = getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.videos = pl.videos.filter(v => v.id !== videoId);
      safeStorage.setItem(KEYS.PLAYLISTS, JSON.stringify(playlists));
    }
    return playlists;
  } catch {
    return [];
  }
}

export function deletePlaylist(playlistId: string): Playlist[] {
  try {
    const playlists = getPlaylists().filter(p => p.id !== playlistId);
    safeStorage.setItem(KEYS.PLAYLISTS, JSON.stringify(playlists));
    return playlists;
  } catch {
    return [];
  }
}

export function getReviews(): Review[] {
  try {
    const raw = safeStorage.getItem(KEYS.REVIEWS);
    if (!raw) {
      safeStorage.setItem(KEYS.REVIEWS, JSON.stringify(INITIAL_REVIEWS));
      return INITIAL_REVIEWS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_REVIEWS;
  }
}

export function saveReview(rating: number, comment: string): { reviews: Review[]; myReview: Review; updated: boolean } {
  const deviceId = getDeviceId();
  const reviews = getReviews();
  const existingIndex = reviews.findIndex(r => r.deviceId === deviceId);

  let myReview: Review;
  let updated = false;

  if (existingIndex >= 0) {
    updated = true;
    myReview = {
      ...reviews[existingIndex],
      rating,
      comment: comment.trim().slice(0, 20),
      updatedAt: new Date().toISOString()
    };
    reviews[existingIndex] = myReview;
  } else {
    myReview = {
      id: 'rev-' + Date.now(),
      deviceId,
      rating,
      comment: comment.trim().slice(0, 20),
      displayName: `ユーザー (${deviceId.slice(-4)})`,
      iconInitial: 'ユ',
      createdAt: new Date().toISOString()
    };
    reviews.unshift(myReview);
  }

  try {
    safeStorage.setItem(KEYS.REVIEWS, JSON.stringify(reviews));
  } catch {}

  return { reviews, myReview, updated };
}

export function getMyReview(): Review | undefined {
  const deviceId = getDeviceId();
  return getReviews().find(r => r.deviceId === deviceId);
}

export function getSettings(): AppSettings {
  const defaults: AppSettings = {
    apiRouteMethod: 'auto',
    thumbMethod: 'server',
    nicoPlayMethod: 'proxy',
    autoPlay: true,
    subtitleEnabled: true,
    searchConvertEnabled: true,
    vercelApiUrl: '',
    danmakuSpeed: 8,
    danmakuFontSize: 24
  };
  try {
    const raw = safeStorage.getItem(KEYS.SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        thumbMethod: parsed.thumbMethod === 'direct' ? 'direct' : 'server',
        autoPlay: parsed.autoPlay !== false,
        subtitleEnabled: parsed.subtitleEnabled !== false,
        searchConvertEnabled: parsed.searchConvertEnabled !== false,
        vercelApiUrl: typeof parsed.vercelApiUrl === 'string' ? parsed.vercelApiUrl : ''
      };
    }
  } catch {}
  return defaults;
}

export function saveSettings(settings: AppSettings): void {
  try {
    safeStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch {}
}

export function getVideoComments(videoId: string): VideoComment[] {
  try {
    const raw = safeStorage.getItem(`${KEYS.COMMENTS_STORE}_${videoId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return INITIAL_COMMENTS;
}

export function addVideoComment(videoId: string, text: string): VideoComment[] {
  const comments = getVideoComments(videoId);
  const newComment: VideoComment = {
    id: 'c-user-' + Date.now(),
    author: 'あなた',
    text: text.trim(),
    time: 'たった今',
    likeCount: 0,
    replyCount: 0
  };
  const updated = [newComment, ...comments];
  try {
    safeStorage.setItem(`${KEYS.COMMENTS_STORE}_${videoId}`, JSON.stringify(updated));
  } catch {}
  return updated;
}

export function getVideoDanmaku(videoId: string): NicoComment[] {
  try {
    const raw = safeStorage.getItem(`${KEYS.DANMAKU_STORE}_${videoId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function addDanmakuComment(videoId: string, text: string, timeMs: number, color = '#ffffff'): NicoComment[] {
  const list = getVideoDanmaku(videoId);
  const newDanmaku: NicoComment = {
    id: 'nd-user-' + Date.now(),
    text: text.trim(),
    timeMs,
    color
  };
  const updated = [...list, newDanmaku];
  try {
    safeStorage.setItem(`${KEYS.DANMAKU_STORE}_${videoId}`, JSON.stringify(updated));
  } catch {}
  return updated;
}

export function isCommentLiked(commentId: string): boolean {
  try {
    const raw = safeStorage.getItem(KEYS.LIKED_COMMENTS);
    const set = raw ? JSON.parse(raw) : {};
    return Boolean(set[commentId]);
  } catch {
    return false;
  }
}

export function toggleCommentLike(commentId: string): boolean {
  try {
    const raw = safeStorage.getItem(KEYS.LIKED_COMMENTS);
    const set = raw ? JSON.parse(raw) : {};
    const newState = !set[commentId];
    if (newState) set[commentId] = true;
    else delete set[commentId];
    safeStorage.setItem(KEYS.LIKED_COMMENTS, JSON.stringify(set));
    return newState;
  } catch {
    return false;
  }
}

export function isVideoLiked(videoId: string): boolean {
  try {
    const raw = safeStorage.getItem(KEYS.LIKED_VIDEOS);
    const set = raw ? JSON.parse(raw) : {};
    return Boolean(set[videoId]);
  } catch {
    return false;
  }
}

export function toggleVideoLike(videoId: string): boolean {
  try {
    const raw = safeStorage.getItem(KEYS.LIKED_VIDEOS);
    const set = raw ? JSON.parse(raw) : {};
    const newState = !set[videoId];
    if (newState) set[videoId] = true;
    else delete set[videoId];
    safeStorage.setItem(KEYS.LIKED_VIDEOS, JSON.stringify(set));
    return newState;
  } catch {
    return false;
  }
}

const CUSTOM_VIDEOS_KEY = 'zero_custom_nico_videos';

export function getSavedCustomVideos(): Video[] {
  try {
    const raw = safeStorage.getItem(CUSTOM_VIDEOS_KEY);
    const list: Video[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v) => (v.platform as string) !== 'youtube' && !(v as any).youtubeId) : [];
  } catch {
    return [];
  }
}

export function saveCustomVideo(video: Video): Video[] {
  try {
    const list = getSavedCustomVideos().filter(v => v.nicoId !== video.nicoId && v.id !== video.id);
    const updated = [video, ...list].slice(0, 100);
    safeStorage.setItem(CUSTOM_VIDEOS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [video];
  }
}

