export type Platform = 'niconico';

export type ViewType = 'home' | 'search' | 'player' | 'channel' | 'history' | 'subscriptions' | 'playlists' | 'library' | 'downloader' | 'nico-hub' | 'reviews' | 'settings';

export interface VideoTag {
  name: string;
  isLocked?: boolean;
}

export interface Video {
  id: string;
  title: string;
  channel: string;
  channel_url?: string;
  channelAvatar?: string;
  userId?: string;
  channelId?: string;
  thumbnail: string;
  duration: string;
  views: number;
  url: string;
  platform: Platform;
  category?: string;
  description?: string;
  uploadedAt?: string;
  likeCount?: number;
  mylistCount?: number;
  subscribers?: number;
  videoUrl?: string; // HTML5 video source
  nicoId?: string; // Niconico video ID
  commentCount?: number;
  tags?: VideoTag[];
  series?: { id: number; title: string } | null;
  initialDanmaku?: string[];
  isLive?: boolean;
}

export interface CommentReply {
  id: string;
  author: string;
  author_thumbnail?: string;
  text: string;
  time: string;
  likeCount: number;
}

export interface VideoComment {
  id: string;
  author: string;
  author_thumbnail?: string;
  text: string;
  time: string;
  likeCount: number;
  replyCount?: number;
  replies?: CommentReply[];
}

export interface NicoComment {
  id: string;
  text: string;
  timeMs: number;
  commands?: string[];
  color?: string;
  position?: 'ue' | 'shita' | 'naka';
  size?: 'big' | 'small' | 'medium';
  postedAt?: string;
  score?: number;
  nicoruCount?: number;
}

export interface Review {
  id: string;
  deviceId: string;
  rating: number;
  comment: string;
  displayName: string;
  iconInitial: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Playlist {
  id: string;
  name: string;
  videos: Video[];
  createdAt: string;
}

export interface ChannelSubscription {
  url: string;
  name: string;
  avatar?: string;
  userId?: string;
  subscriberCount?: number;
  videoCount?: number;
  description?: string;
}

export interface LiveProgram {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
  providerName: string;
  providerAvatar: string;
  providerId?: string;
  watchCount: number;
  commentCount: number;
  liveCycle?: string;
  matchedSubUrl?: string;
  matchedSubName?: string;
}

export interface LiveChatComment {
  id: string;
  no?: number;
  text: string;
  name?: string;
  userId?: string;
  color?: string;
  position?: 'ue' | 'shita' | 'naka';
  size?: 'big' | 'small' | 'medium';
  atMs: number;
  isSystem?: boolean;
}

export interface AppSettings {
  apiRouteMethod: 'auto' | 'direct' | 'render' | 'render2' | 'render3' | 'worker' | 'vercel' | 'gas';
  thumbMethod: 'direct' | 'server';
  nicoPlayMethod: 'proxy' | 'direct';
  autoPlay?: boolean;
  subtitleEnabled?: boolean;
  searchConvertEnabled?: boolean;
  vercelApiUrl?: string;
  danmakuSpeed: number; // in seconds, default 8
  danmakuFontSize: number; // default 24
}
