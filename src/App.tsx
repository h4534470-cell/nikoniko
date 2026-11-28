import React, { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import { Video, ViewType, Review, ChannelSubscription, Playlist, NicoComment, LiveProgram, LiveChatComment, AppSettings } from './types';
import { INITIAL_VIDEOS, INITIAL_REVIEWS } from './data/mockVideos';
import { downloadNiconicoInBrowser } from './utils/nicoDownload';
import { buildApiUrl, apiFetch, getAutoNodeDisplayInfo, rerollAutoNode, getLiveViewerId, getConfiguredVercelUrl, RENDER_SERVER_URLS, QUOTA_EXCEEDED_EVENT, QUOTA_EXCEEDED_MESSAGE, LIVE_CAPACITY_FULL_MESSAGE } from './utils/apiRoute';
import { ThumbImg, resolveThumbnailDataUrl } from './components/ThumbImg';
import { convertSearchQuery, toSearchHiragana, getLocalSearchSuggestions, getLocalKanjiCandidates, SearchConversionResult } from './utils/searchQuery';
import { SubtitleCue, parseSubtitleFileText, buildAutoSubtitlesFromComments, buildFullscreenDanmakuCues, findActiveSubtitleText, createVttBlobUrl } from './utils/subtitles';
import {
  safeStorage,
  getPlayHistory,
  addToPlayHistory,
  clearPlayHistory,
  getSubscriptions,
  toggleSubscription,
  getPlaylists,
  createPlaylist,
  addVideoToPlaylist,
  deletePlaylist,
  getReviews,
  saveReview,
  getMyReview,
  getSettings,
  saveSettings,
  getVideoDanmaku,
  addDanmakuComment,
  getSavedCustomVideos,
  saveCustomVideo
} from './utils/storage';

interface ActiveDanmakuItem {
  id: string;
  text: string;
  topPercent: number;
  color: string;
  key: string;
}

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [guestName, setGuestName] = useState<string>(() => safeStorage.getItem('zeroGuestName') || '');
  const [guestNameDraft, setGuestNameDraft] = useState<string>(() => safeStorage.getItem('zeroGuestName') || '');

  // Video and Playback
  const [videos, setVideos] = useState<Video[]>(() => {
    const saved = getSavedCustomVideos();
    const existingIds = new Set(INITIAL_VIDEOS.map(v => v.nicoId || v.id));
    const custom = saved.filter(v => !existingIds.has(v.nicoId || v.id));
    return [...custom, ...INITIAL_VIDEOS];
  });
  const [currentVideo, setCurrentVideo] = useState<Video | null>(INITIAL_VIDEOS[0]);
  const [playHistory, setPlayHistory] = useState<Video[]>([]);
  const [channelData, setChannelData] = useState<{ url: string; name: string; avatar?: string; userId?: string } | null>(null);
  const [channelActiveTab, setChannelActiveTab] = useState<string>('home');
  const [channelProfile, setChannelProfile] = useState<{
    user?: { id: string; nickname: string; description: string; avatar: string; level: number; followerCount: number; followeeCount: number; isPremium: boolean };
    totalVideos?: number;
    videos: Video[];
    mylists: Array<{ id: string; name: string; description: string; itemsCount: number }>;
    series: Array<{ id: string; title: string; itemsCount: number; thumbnailUrl: string }>;
    selectedMylistName?: string;
    selectedMylistVideos?: Video[];
    loading: boolean;
    error?: string;
  } | null>(null);
  const [isSearchingOnline, setIsSearchingOnline] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('すべて');

  // Home live ranking state
  const [homeGenre, setHomeGenre] = useState<string>('all');
  const [homeTerm, setHomeTerm] = useState<string>('24h');
  const [rankingVideos, setRankingVideos] = useState<Video[]>([]);
  const [isLoadingRanking, setIsLoadingRanking] = useState<boolean>(false);

  // Player rich Niconico API state (related, content tree, nicopedia preview)
  const [liveRelatedVideos, setLiveRelatedVideos] = useState<Video[]>([]);
  const [videoTree, setVideoTree] = useState<{
    parentsTotal: number;
    childrenTotal: number;
    parents: Array<{ globalId: string; contentKind: string; url: string }>;
    children: Array<{ globalId: string; contentKind: string; url: string }>;
  } | null>(null);
  const [dicModal, setDicModal] = useState<{
    word: string;
    title?: string;
    summary?: string;
    url?: string;
    loading: boolean;
    error?: string;
  } | null>(null);

  // Niconico Hub (Live / Seiga / Nicopedia / Jikkyo) state
  const [nicoHubTab, setNicoHubTab] = useState<'live' | 'seiga' | 'dic' | 'jikkyo'>('live');
  const [livePrograms, setLivePrograms] = useState<Array<{
    id: string;
    title: string;
    thumbnail: string;
    url: string;
    providerName: string;
    providerAvatar: string;
    watchCount: number;
    commentCount: number;
    beginTime?: number;
  }>>([]);
  const [isLoadingLive, setIsLoadingLive] = useState<boolean>(false);
  const [liveSearchQuery, setLiveSearchQuery] = useState<string>('');
  const [liveSearchSort, setLiveSearchSort] = useState<'viewCountDesc' | 'commentCountDesc' | 'recentDesc'>('viewCountDesc');
  const [liveCategoryTab, setLiveCategoryTab] = useState<'all' | 'common' | 'game' | 'try' | 'face' | 'official'>('all');
  const [liveTotalCount, setLiveTotalCount] = useState<number>(0);
  const [liveSearchError, setLiveSearchError] = useState<string | null>(null);
  const [favoriteLiveAlerts, setFavoriteLiveAlerts] = useState<LiveProgram[]>([]);
  const [liveAlertsDismissed, setLiveAlertsDismissed] = useState<boolean>(false);
  const [seigaInput, setSeigaInput] = useState<string>('im10000000');
  const [seigaResult, setSeigaResult] = useState<any>(null);
  const [seigaLoading, setSeigaLoading] = useState<boolean>(false);
  const [seigaError, setSeigaError] = useState<string | null>(null);
  const [dicInput, setDicInput] = useState<string>('レッツゴー！陰陽師');
  const [dicResult, setDicResult] = useState<any>(null);
  const [dicLoading, setDicLoading] = useState<boolean>(false);
  const [dicError, setDicError] = useState<string | null>(null);
  const [jikkyoChannel, setJikkyoChannel] = useState<string>('jk1');
  const [jikkyoLogs, setJikkyoLogs] = useState<Array<{ id: string; text: string; date: number; userId: string }>>([]);
  const [jikkyoLoading, setJikkyoLoading] = useState<boolean>(false);
  const [jikkyoError, setJikkyoError] = useState<string | null>(null);

  // Search pagination & sort state
  const [searchPage, setSearchPage] = useState<number>(0);
  const [searchApiPage, setSearchApiPage] = useState<number>(1);
  const [searchTotalCount, setSearchTotalCount] = useState<number>(0);
  const [searchHasNext, setSearchHasNext] = useState<boolean>(false);
  const [searchSort, setSearchSort] = useState<string>('v');

  // Player mode ('freemake' real-time yt-dlp/HLS stream, 'embed' official iframe, 'custom' cached MP4)
  const [playerMode, setPlayerMode] = useState<'freemake' | 'embed' | 'custom'>('freemake');
  const [radioMode, setRadioMode] = useState<boolean>(() => safeStorage.getItem('zeroRadioMode') === 'on');
  const [freemakeQuality, setFreemakeQuality] = useState<string>('720');
  const [freemakeStreamType, setFreemakeStreamType] = useState<'hls' | 'proxy' | 'remux' | null>(null);
  const [freemakeResolvedUrl, setFreemakeResolvedUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState<boolean>(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [playerNotification, setPlayerNotification] = useState<string | null>(null);

  // Real-time video progress & percentage state (できてるパーセンテージ)
  const [videoLoadingPercent, setVideoLoadingPercent] = useState<number>(0);
  const [videoLoadingStage, setVideoLoadingStage] = useState<string>('準備中');
  const [videoSpeed, setVideoSpeed] = useState<string>('');
  const [loadingElapsedSec, setLoadingElapsedSec] = useState<number>(0);
  const [videoPlayPercent, setVideoPlayPercent] = useState<number>(0);
  const [videoBufferPercent, setVideoBufferPercent] = useState<number>(0);

  // Live Search Conversion state
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
  const [remoteConvertCandidates, setRemoteConvertCandidates] = useState<Array<{ text: string; kind: 'ime' | 'nico' }>>([]);
  const [isFetchingConvert, setIsFetchingConvert] = useState<boolean>(false);
  const [activeConvertIdx, setActiveConvertIdx] = useState<number>(-1);
  const convertCacheRef = useRef<Map<string, { primary: string; candidates: Array<{ text: string; kind: 'ime' | 'nico' }> }>>(new Map());
  const [showSiteIntro] = useState<boolean>(false);

  const formatLoadingDuration = (seconds: number) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return minutes ? `${minutes}分${String(rest).padStart(2, '0')}秒` : `${rest}秒`;
  };



  useEffect(() => {
    if (!isVideoLoading) {
      setLoadingElapsedSec(0);
      return;
    }
    const t = setInterval(() => {
      setLoadingElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [isVideoLoading]);

  const estimatedRemainingSec = useMemo(() => {
    if (videoLoadingPercent <= 0) return 8;
    if (videoLoadingPercent >= 100) return 0;
    const totalEst = (loadingElapsedSec * 100) / Math.max(1, videoLoadingPercent);
    const rem = Math.max(0, Math.round(totalEst - loadingElapsedSec));
    return Math.min(rem, 20);
  }, [videoLoadingPercent, loadingElapsedSec]);

  // HTML5 Player loading state management: auto-complete or fallback to embed if delayed
  useEffect(() => {
    if (!isVideoLoading || !currentVideo || playerMode !== 'custom') return;

    let isMounted = true;
    const timer = setTimeout(() => {
      if (isMounted) {
        setIsVideoLoading(false);
        // If HTML5 player hasn't started playing within 3.5s, offer seamless embed player
        if (playerMode === 'custom' && (!videoRef.current || videoRef.current.readyState < 2)) {
          setPlayerNotification('公式プレイヤーで即時視聴に切り替えることができます');
        }
      }
    }, 3500);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isVideoLoading, currentVideo, playerMode]);

  // Automatically dismiss the loading overlay once 100% is reached so it never gets stuck
  useEffect(() => {
    if (videoLoadingPercent >= 100 && isVideoLoading) {
      const timer = setTimeout(() => {
        setIsVideoLoading(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [videoLoadingPercent, isVideoLoading]);

  const showPlayerNotification = (msg: string) => {
    setPlayerNotification(msg);
    setTimeout(() => {
      setPlayerNotification((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const getStreamUrl = (v: Video) => {
    if (v.videoUrl) return v.videoUrl;
    const vid = v.nicoId || v.id;
    return `/api/video/stream/${encodeURIComponent(vid)}`;
  };

  const getEmbedUrl = (v: Video) => {
    const vid = v.nicoId || v.id;
    if (v.isLive || /^lv\d+$/i.test(vid)) {
      return `https://live.nicovideo.jp/embed/${encodeURIComponent(vid)}`;
    }
    return `https://embed.nicovideo.jp/watch/${encodeURIComponent(vid)}`;
  };

  const switchPlayerMode = (mode: 'freemake' | 'embed' | 'custom') => {
    setPlayerMode(mode);
    setVideoError(null);
    safeStorage.setItem('playerModePreference', mode);

    if (mode === 'embed') {
      loadedStreamKeyRef.current = '';
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      }
      setIsVideoLoading(false);
      setVideoLoadingPercent(100);
      return;
    }

    if (mode === 'freemake') {
      loadedStreamKeyRef.current = '';
      setIsVideoLoading(true);
      setVideoLoadingPercent(25);
      setVideoLoadingStage(radioMode ? 'ラジオ用音声ストリームを解析中...' : 'Freemake ストリームを解析中...');
      return;
    }

    loadedStreamKeyRef.current = '';
    setIsVideoLoading(false);
    setVideoLoadingPercent(100);

    const activeEl = getActiveMediaEl();
    if (mode === 'custom' && currentVideo && activeEl) {
      const streamUrl = getStreamUrl(currentVideo);
      if (!activeEl.src.endsWith(streamUrl)) {
        activeEl.src = streamUrl;
        activeEl.load();
      }
      if (autoPlayRef.current) {
        setTimeout(() => {
          const el = getActiveMediaEl();
          if (el) {
            el.play().catch(() => {
              el.muted = true;
              el.play().catch(() => {});
            });
          }
        }, 50);
      }
    }
  };

  const toggleRadioMode = () => {
    const next = !radioMode;
    loadedStreamKeyRef.current = '';
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    setRadioMode(next);
    safeStorage.setItem('zeroRadioMode', next ? 'on' : 'off');
    if (next && playerMode === 'embed') {
      setPlayerMode('freemake');
      safeStorage.setItem('playerModePreference', 'freemake');
    }
    showPlayerNotification(
      next
        ? 'ラジオモード（音声のみ・省データ）に切り替えました'
        : '通常プレイヤー（映像＋音声）に戻しました'
    );
  };

  // Player controls
  const [playerLoop, setPlayerLoop] = useState<boolean>(() => safeStorage.getItem('playerLoopEnabled') === 'on');
  const [nicoCommentsOn, setNicoCommentsOn] = useState<boolean>(() => safeStorage.getItem('nicoCommentDisplay') !== 'off');
  const [showPlayerSettings, setShowPlayerSettings] = useState<boolean>(false);
  const [descExpanded, setDescExpanded] = useState<boolean>(false);
  const [activeDanmaku, setActiveDanmaku] = useState<ActiveDanmakuItem[]>([]);
  const [danmakuPool, setDanmakuPool] = useState<NicoComment[]>([]);
  const [vodCommentsLoading, setVodCommentsLoading] = useState<boolean>(false);
  const [vodCommentInput, setVodCommentInput] = useState<string>('');
  const [vodCommentColor, setVodCommentColor] = useState<string>('#ffffff');
  const [vodCommentSort, setVodCommentSort] = useState<'time' | 'newest'>('time');
  const [vodCommentFilter, setVodCommentFilter] = useState<string>('');
  const [liveComments, setLiveComments] = useState<LiveChatComment[]>([]);
  const [liveCommentsLoading, setLiveCommentsLoading] = useState<boolean>(false);
  const seenLiveCommentIdsRef = useRef<Set<string>>(new Set());
  const liveCommentsCursorRef = useRef<number>(0);
  const liveChatListRef = useRef<HTMLDivElement | null>(null);
  const nicoCommentsOnRef = useRef<boolean>(nicoCommentsOn);
  const radioModeRef = useRef<boolean>(radioMode);
  useEffect(() => { nicoCommentsOnRef.current = nicoCommentsOn; }, [nicoCommentsOn]);
  useEffect(() => { radioModeRef.current = radioMode; }, [radioMode]);
  const [floatingPlayerVisible, setFloatingPlayerVisible] = useState<boolean>(false);

  // Library & Playlists
  const [subscriptions, setSubscriptions] = useState<ChannelSubscription[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistIndex, setSelectedPlaylistIndex] = useState<number | null>(null);
  const [isPlaylistDialogOpen, setIsPlaylistDialogOpen] = useState<boolean>(false);

  // Reviews
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [reviewStatus, setReviewStatus] = useState<string>('');
  const [myReview, setMyReview] = useState<Review | undefined>(undefined);

  // Settings & Distributed Route State
  const [settings, setSettings] = useState(() => getSettings());
  const autoPlayRef = useRef<boolean>(settings.autoPlay !== false);
  const userPausedRef = useRef<boolean>(false);
  const [isAutoMutedFallback, setIsAutoMutedFallback] = useState<boolean>(false);
  const [nextAutoPlayState, setNextAutoPlayState] = useState<{ nextVideo: Video; secondsLeft: number } | null>(null);
  useEffect(() => {
    autoPlayRef.current = settings.autoPlay !== false;
  }, [settings.autoPlay]);

  const attemptAutoPlay = async (el: HTMLMediaElement | null, preferUnmuted: boolean = true): Promise<boolean> => {
    if (!el) return false;
    if (!autoPlayRef.current || userPausedRef.current) {
      if (!autoPlayRef.current && !el.paused) {
        el.pause();
      }
      setIsVideoPlaying(false);
      return false;
    }
    el.autoplay = true;
    try {
      if (preferUnmuted) {
        el.muted = false;
      }
      await el.play();
      setIsVideoPlaying(true);
      setIsVideoLoading(false);
      setVideoLoadingPercent(100);
      setIsAutoMutedFallback(el.muted);
      return true;
    } catch {
      if (!radioMode) {
        try {
          el.muted = true;
          el.defaultMuted = true;
          await el.play();
          setIsVideoPlaying(true);
          setIsVideoLoading(false);
          setVideoLoadingPercent(100);
          setIsAutoMutedFallback(true);
          return true;
        } catch {
          setIsVideoPlaying(false);
          return false;
        }
      }
      setIsVideoPlaying(false);
      return false;
    }
  };
  const [customSubtitles, setCustomSubtitles] = useState<SubtitleCue[] | null>(null);
  const [fetchedSubtitles, setFetchedSubtitles] = useState<SubtitleCue[] | null>(null);
  const [fetchedSubtitleLabel, setFetchedSubtitleLabel] = useState<string>('');
  const [subtitleOffsetMs, setSubtitleOffsetMs] = useState<number>(0);
  const [activeSubtitleText, setActiveSubtitleText] = useState<string>('');
  const [searchConversion, setSearchConversion] = useState<SearchConversionResult | null>(null);
  const [vercelUrlDraft, setVercelUrlDraft] = useState<string>(() => getSettings().vercelApiUrl || '');
  const subtitleFileInputRef = useRef<HTMLInputElement>(null);
  const [autoNodeInfo, setAutoNodeInfo] = useState(() => getAutoNodeDisplayInfo());
  const [quotaBanner, setQuotaBanner] = useState<string | null>(null);
  const apiUrl = (path: string) => buildApiUrl(path, settings.apiRouteMethod);
  const apiCall = (path: string, init?: RequestInit) => apiFetch(path, init, settings.apiRouteMethod);
  const [apiRouteStatus, setApiRouteStatus] = useState<string>(() => {
    const initial = getSettings().apiRouteMethod;
    if (initial === 'worker') return 'Cloudflare Worker (niconico-2.na8526130.workers.dev) を使用中';
    if (initial === 'render') return 'Render #1 (nikoniko-4.onrender.com) を使用中';
    if (initial === 'render2') return 'Render #2 (nikoniko-dass.onrender.com) を使用中';
    if (initial === 'render3') return 'Render #3 (nikoniko-ju6x.onrender.com) を使用中';
    if (initial === 'vercel') return `Vercel API (${getConfiguredVercelUrl() || '同一オリジン'}) を使用中`;
    if (initial === 'direct') return 'メインサーバー直通を使用中';
    return `自動選択（分散）: ${getAutoNodeDisplayInfo().label}`;
  });
  const [apiBenchmarks, setApiBenchmarks] = useState<Record<string, { loading: boolean; ms: number | null; ok: boolean | null }>>({});
  const [isMeasuringApis, setIsMeasuringApis] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<string>(() => safeStorage.getItem('zeroThemeMode') || 'light');

  const subtitleEnabled = settings.subtitleEnabled !== false;
  const autoPlayEnabled = settings.autoPlay !== false;
  const searchConvertEnabled = settings.searchConvertEnabled !== false;

  const fetchSearchConvertWithFallback = async (
    q: string,
    hira: string,
    signal?: AbortSignal
  ): Promise<{ primary: string; candidates: Array<{ text: string; kind: 'ime' | 'nico' }> }> => {
    const path = `/api/search/convert?q=${encodeURIComponent(q)}&hira=${encodeURIComponent(hira)}`;
    const parsePayload = (data: any) => {
      const cands: Array<{ text: string; kind: 'ime' | 'nico' }> = Array.isArray(data?.candidates)
        ? data.candidates
            .filter((c: any) => c && typeof c.text === 'string' && c.text.trim())
            .map((c: any) => ({
              text: c.text.trim(),
              kind: c.kind === 'ime' ? 'ime' : 'nico'
            }))
        : [];
      return { primary: String(data?.primary || '').trim(), candidates: cands };
    };

    // 同一オリジンAPIは最新の /api/search/convert を常に持つため auto/direct では最優先
    const trySameOrigin = async () => {
      const res = await fetch(path, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parsePayload(await res.json());
    };
    const tryRoutedApi = async () => {
      const res = await apiCall(path, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parsePayload(await res.json());
    };

    if (settings.apiRouteMethod === 'auto' || settings.apiRouteMethod === 'direct') {
      try {
        const localRes = await trySameOrigin();
        if (localRes.candidates.length > 0) return localRes;
      } catch {}
      try {
        return await tryRoutedApi();
      } catch {
        return { primary: '', candidates: [] };
      }
    }

    try {
      const routedRes = await tryRoutedApi();
      if (routedRes.candidates.some((c) => c.kind === 'ime')) return routedRes;
    } catch {}
    try {
      return await trySameOrigin();
    } catch {
      return { primary: '', candidates: [] };
    }
  };

  useEffect(() => {
    const q = searchQuery.trim();
    setActiveConvertIdx(-1);
    if (!q || !searchConvertEnabled || /^https?:\/\//i.test(q) || /^(sm|so|nm|lv)\d+$/i.test(q)) {
      setRemoteConvertCandidates([]);
      setIsFetchingConvert(false);
      return;
    }

    const localConv = convertSearchQuery(q, true);
    const hira = localConv.hiraText || toSearchHiragana(q);
    const cacheKey = `${q}::${hira}`;
    const cached = convertCacheRef.current.get(cacheKey);
    if (cached) {
      setRemoteConvertCandidates(cached.candidates);
      setIsFetchingConvert(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsFetchingConvert(true);

    const timer = window.setTimeout(async () => {
      try {
        const entry = await fetchSearchConvertWithFallback(q, hira, controller.signal);
        if (cancelled) return;
        if (entry.candidates.length > 0) {
          if (convertCacheRef.current.size > 150) convertCacheRef.current.clear();
          convertCacheRef.current.set(cacheKey, entry);
        }
        setRemoteConvertCandidates(entry.candidates);
      } catch {
        if (!cancelled) {
          setRemoteConvertCandidates([]);
        }
      } finally {
        if (!cancelled) setIsFetchingConvert(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, searchConvertEnabled, settings.apiRouteMethod]);

  const searchDropdownCandidates = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw || !searchConvertEnabled) return [];
    const localConv = convertSearchQuery(raw, true);
    const localKanji = getLocalKanjiCandidates(raw, 10);
    const localSuggests = getLocalSearchSuggestions(raw, 12);
    const list: Array<{ text: string; kind: 'dict' | 'ime' | 'nico' | 'kana'; badge: string }> = [];
    const seen = new Set<string>();
    const push = (text: string, kind: 'dict' | 'ime' | 'nico' | 'kana', badge: string) => {
      const clean = String(text || '').trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      list.push({ text: clean, kind, badge });
    };

    if (localConv.wasConverted && localConv.reason === 'キーワード変換') {
      push(localConv.converted, 'dict', '最適変換');
    }

    for (const rc of remoteConvertCandidates) {
      if (rc.kind === 'ime') push(rc.text, 'ime', '漢字変換');
    }

    for (const lk of localKanji) {
      push(lk, 'ime', '漢字変換');
    }

    for (const ls of localSuggests) {
      push(ls, 'dict', '関連語');
    }

    for (const rc of remoteConvertCandidates) {
      if (rc.kind !== 'ime') push(rc.text, 'nico', 'ニコニコ候補');
    }

    if (localConv.wasConverted) {
      push(localConv.converted, 'kana', localConv.reason === '動画/生放送IDを抽出' ? 'ID抽出' : 'かな変換');
    }

    for (const alt of localConv.alternatives) {
      push(alt, 'kana', '表記候補');
    }

    return list.slice(0, 20);
  }, [searchQuery, searchConvertEnabled, remoteConvertCandidates]);

  const activeSubtitleInfo = useMemo<{ cues: SubtitleCue[]; sourceLabel: string }>(() => {
    if (customSubtitles && customSubtitles.length > 0) {
      return { cues: customSubtitles, sourceLabel: '読込字幕ファイル' };
    }
    if (fetchedSubtitles && fetchedSubtitles.length > 0) {
      return { cues: fetchedSubtitles, sourceLabel: fetchedSubtitleLabel || '公式/自動字幕' };
    }
    if (!currentVideo || currentVideo.isLive) {
      return { cues: [], sourceLabel: '' };
    }
    const built = buildAutoSubtitlesFromComments(danmakuPool);
    return { cues: built.cues, sourceLabel: built.modeLabel };
  }, [customSubtitles, fetchedSubtitles, fetchedSubtitleLabel, currentVideo?.id, currentVideo?.isLive, danmakuPool]);

  const activeSubtitleCues = activeSubtitleInfo.cues;
  const activeSubtitleSourceLabel = activeSubtitleInfo.sourceLabel;

  const [subtitleVttUrl, setSubtitleVttUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!subtitleEnabled || activeSubtitleCues.length === 0) {
      setSubtitleVttUrl(null);
      return;
    }
    const url = createVttBlobUrl(activeSubtitleCues, subtitleOffsetMs);
    setSubtitleVttUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    };
  }, [subtitleEnabled, activeSubtitleCues, subtitleOffsetMs]);

  const [fullscreenMode, setFullscreenMode] = useState<'none' | 'container' | 'native-video'>('none');
  const fullscreenModeRef = useRef<'none' | 'container' | 'native-video'>('none');
  useEffect(() => {
    fullscreenModeRef.current = fullscreenMode;
  }, [fullscreenMode]);

  const fullscreenCommentTrackRef = useRef<TextTrack | null>(null);
  const injectedLiveFullscreenIdsRef = useRef<Set<string>>(new Set());

  const ensureFullscreenTrack = (vid: HTMLVideoElement): TextTrack | null => {
    try {
      const existingTracks = Array.from(vid.textTracks || []);
      let track = fullscreenCommentTrackRef.current;
      if (!track || !existingTracks.includes(track)) {
        track = vid.addTextTrack('captions', '弾幕コメント', 'ja');
        track.mode = 'disabled';
        fullscreenCommentTrackRef.current = track;
      }
      return track;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const syncFullscreenState = () => {
      const fsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;
      const vid = videoRef.current as any;
      const container = videoContainerRef.current as any;

      if (
        vid &&
        (fsEl === vid ||
          Boolean(vid.webkitDisplayingFullscreen) ||
          vid.webkitPresentationMode === 'fullscreen')
      ) {
        setFullscreenMode('native-video');
      } else if (fsEl && container && (fsEl === container || fsEl.contains(container))) {
        setFullscreenMode('container');
      } else {
        setFullscreenMode('none');
      }
    };

    const vid = videoRef.current;
    // iOS/iPadOS AVPlayer が webkitbeginfullscreen 時に即座に認識できるよう空のまま事前登録（非全画面時は0キュー・disabled）
    if (vid && !radioMode && playerMode !== 'embed') {
      ensureFullscreenTrack(vid);
    }

    syncFullscreenState();
    const docEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'msfullscreenchange'];
    docEvents.forEach((ev) => document.addEventListener(ev, syncFullscreenState));

    const vidEvents = ['webkitbeginfullscreen', 'webkitendfullscreen', 'webkitpresentationmodechanged'];
    if (vid) {
      vidEvents.forEach((ev) => vid.addEventListener(ev, syncFullscreenState));
    }

    return () => {
      docEvents.forEach((ev) => document.removeEventListener(ev, syncFullscreenState));
      if (vid) {
        vidEvents.forEach((ev) => vid.removeEventListener(ev, syncFullscreenState));
      }
    };
  }, [currentView, playerMode, radioMode, currentVideo?.id]);

  // 画面フルスクリーン時のみ <video> の TextTrack へ弾幕コメントを挿入し、通常再生に戻ったら即時削除する
  useEffect(() => {
    const clearTrackCues = (track: TextTrack | null) => {
      if (!track) return;
      try {
        if (track.cues) {
          for (let i = track.cues.length - 1; i >= 0; i--) {
            track.removeCue(track.cues[i]);
          }
        }
        track.mode = 'disabled';
      } catch {}
    };

    const vid = videoRef.current;
    const shouldInsertFullscreenTrack =
      fullscreenMode === 'native-video' &&
      !radioMode &&
      playerMode !== 'embed' &&
      Boolean(currentVideo) &&
      Boolean(vid) &&
      (nicoCommentsOn || (subtitleEnabled && activeSubtitleCues.length > 0));

    if (!shouldInsertFullscreenTrack || !vid) {
      clearTrackCues(fullscreenCommentTrackRef.current);
      injectedLiveFullscreenIdsRef.current.clear();
      return;
    }

    if (typeof window === 'undefined' || typeof window.VTTCue !== 'function') {
      return;
    }

    const track = ensureFullscreenTrack(vid);
    if (!track) return;

    const existingTracks = Array.from(vid.textTracks || []);
    for (const t of existingTracks) {
      if (t !== track) {
        try {
          t.mode = 'disabled';
        } catch {}
      }
    }

    const isAppleNativeAv =
      Boolean((vid as any).webkitDisplayingFullscreen) ||
      (vid as any).webkitPresentationMode === 'fullscreen' ||
      (/iPhone|iPad|iPod/i.test(navigator.userAgent) && document.fullscreenElement !== vid);

    const danmakuCueRefs: TextTrackCue[] = [];

    const configureDanmakuCueBox = (cue: VTTCue, lanePercent: number) => {
      try {
        cue.snapToLines = false;
        cue.line = lanePercent;
        if (isAppleNativeAv) {
          // iOS/iPadOS AVPlayer で幅が狭まり縦1文字ずつ折り返されるバグを防ぐため幅94%中央配置にする
          cue.size = 94;
          cue.align = 'center';
          cue.position = 50;
        } else {
          // デスクトップは幅45%を保ったまま右半面から左端へ流す
          cue.size = 45;
          cue.align = 'start';
          cue.position = 55;
        }
      } catch {}
    };

    if (currentVideo?.isLive) {
      if (!nicoCommentsOn) {
        clearTrackCues(track);
        injectedLiveFullscreenIdsRef.current.clear();
        return;
      }

      const nowSec = Number.isFinite(vid.currentTime) ? Math.max(0, vid.currentTime) : 0;
      try {
        if (track.cues) {
          for (let i = track.cues.length - 1; i >= 0; i--) {
            const c = track.cues[i];
            if (c.endTime < nowSec - 8) {
              track.removeCue(c);
            }
          }
        }
      } catch {}

      const liveLanes = [10, 22, 34, 46, 58];
      const nonSystem = liveComments.filter((c) => c?.id && !c.isSystem && c.text?.trim());
      const isInitialBurst = injectedLiveFullscreenIdsRef.current.size === 0;
      const candidates = isInitialBurst ? nonSystem.slice(-5) : nonSystem.slice(-8);

      candidates.forEach((c, idx) => {
        if (injectedLiveFullscreenIdsRef.current.has(c.id)) return;
        injectedLiveFullscreenIdsRef.current.add(c.id);
        const startSec = nowSec + (isInitialBurst ? idx * 0.45 : idx * 0.25);
        const endSec = startSec + 2.8;
        const lanePct = liveLanes[idx % liveLanes.length];
        const normalized = c.text.replace(/\s+/g, ' ').trim();
        const clipped = normalized.length > 30 ? `${normalized.slice(0, 29)}…` : normalized;
        try {
          const cue = new window.VTTCue(startSec, endSec, clipped);
          configureDanmakuCueBox(cue, lanePct);
          track.addCue(cue);
        } catch {}
      });

      if (track.cues) {
        for (let i = 0; i < track.cues.length; i++) {
          danmakuCueRefs.push(track.cues[i]);
        }
      }
    } else {
      // VOD: ネイティブ全画面中のみレーン別弾幕コメントキュー（＋字幕ON時は下部字幕キュー）を挿入
      clearTrackCues(track);
      injectedLiveFullscreenIdsRef.current.clear();

      if (nicoCommentsOn && danmakuPool.length > 0) {
        const danmakuCues = buildFullscreenDanmakuCues(danmakuPool, {
          videoDurationMs:
            Number.isFinite(vid.duration) && vid.duration > 0
              ? Math.round(vid.duration * 1000)
              : undefined
        });
        for (const c of danmakuCues) {
          const s = Math.max(0, c.startMs / 1000);
          const e = Math.max(s + 1.0, c.endMs / 1000);
          try {
            const cue = new window.VTTCue(s, e, c.text);
            configureDanmakuCueBox(cue, c.linePercent);
            track.addCue(cue);
            danmakuCueRefs.push(cue);
          } catch {}
        }
      }

      if (subtitleEnabled && activeSubtitleCues.length > 0) {
        for (const sub of activeSubtitleCues) {
          const s = Math.max(0, (sub.startMs - subtitleOffsetMs) / 1000);
          const e = Math.max(s + 0.5, (sub.endMs - subtitleOffsetMs) / 1000);
          try {
            const cue = new window.VTTCue(s, e, sub.text);
            try {
              cue.snapToLines = false;
              cue.line = 88;
              cue.size = 94;
              cue.align = 'center';
              cue.position = 50;
            } catch {}
            track.addCue(cue);
          } catch {}
        }
      }
    }

    try {
      track.mode = 'hidden';
      requestAnimationFrame(() => {
        if (fullscreenCommentTrackRef.current === track && fullscreenModeRef.current === 'native-video') {
          try {
            track.mode = 'showing';
          } catch {}
        }
      });
      track.mode = 'showing';
    } catch {}

    // デスクトップ等の native <video> フルスクリーンでは VTTCue.position を右→左へ滑らかに移動させて弾幕感を再現
    if (isAppleNativeAv || danmakuCueRefs.length === 0) {
      return;
    }

    const animTimer = window.setInterval(() => {
      if (fullscreenModeRef.current !== 'native-video') return;
      const cur = vid.currentTime;
      for (const rawCue of danmakuCueRefs) {
        const cue = rawCue as VTTCue;
        if (cur >= cue.startTime && cur <= cue.endTime) {
          const dur = Math.max(0.5, cue.endTime - cue.startTime);
          const progress = Math.min(1, Math.max(0, (cur - cue.startTime) / dur));
          const nextPos = Math.round((55 - progress * 53) * 10) / 10;
          try {
            cue.position = nextPos;
          } catch {}
        }
      }
    }, 85);

    return () => {
      window.clearInterval(animTimer);
    };
  }, [
    fullscreenMode,
    radioMode,
    playerMode,
    currentVideo?.id,
    currentVideo?.isLive,
    nicoCommentsOn,
    danmakuPool,
    liveComments,
    subtitleEnabled,
    activeSubtitleCues,
    subtitleOffsetMs
  ]);

  useEffect(() => {
    const onQuota = (ev: Event) => {
      const msg = (ev as CustomEvent)?.detail?.message || QUOTA_EXCEEDED_MESSAGE;
      setQuotaBanner(String(msg));
    };
    window.addEventListener(QUOTA_EXCEEDED_EVENT, onQuota);
    return () => window.removeEventListener(QUOTA_EXCEEDED_EVENT, onQuota);
  }, []);

  // Download modal & Freemake-style URL Downloader state
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState<boolean>(false);
  const [downloadQuality, setDownloadQuality] = useState<string>('1080');
  const [downloadFormat, setDownloadFormat] = useState<string>('mp4');
  const [downloadWithComments, setDownloadWithComments] = useState<boolean>(true);
  const [isDownloadingOverlay, setIsDownloadingOverlay] = useState<boolean>(false);
  const [dlProgress, setDlProgress] = useState<number>(0);
  const [dlProgressSize, setDlProgressSize] = useState<string>('準備中...');
  const [dlStageText, setDlStageText] = useState<string>('ダウンロード準備中...');
  const [dlSpeedText, setDlSpeedText] = useState<string>('');
  const [dlEtaText, setDlEtaText] = useState<string>('');
  const [dlActiveJobId, setDlActiveJobId] = useState<string | null>(null);
  const [dlReadyFileUrl, setDlReadyFileUrl] = useState<string | null>(null);
  const [dlReadyFileName, setDlReadyFileName] = useState<string>('');
  const [dlJobError, setDlJobError] = useState<string | null>(null);

  // Freemake-style URL Downloader view state
  const [dlUrlInput, setDlUrlInput] = useState<string>('');
  const [dlInspecting, setDlInspecting] = useState<boolean>(false);
  const [dlInspectError, setDlInspectError] = useState<string | null>(null);
  const [dlInspectedInfo, setDlInspectedInfo] = useState<{
    id: string;
    rawId: string;
    title: string;
    uploader: string;
    extractor: string;
    thumbnail: string;
    duration: number;
    durationString: string;
    webpageUrl: string;
    qualities: Array<{ value: string; label: string; sizeMb: number | null }>;
    audioSizeMb: number | null;
  } | null>(null);
  const [dlRecentJobs, setDlRecentJobs] = useState<Array<{
    jobId: string;
    title: string;
    format: string;
    quality: string;
    fileUrl: string;
    fileName: string;
    sizeMb: string;
  }>>(() => {
    try {
      const saved = safeStorage.getItem('dlRecentJobs');
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      const persistable = dlRecentJobs.filter((j) => !j.fileUrl.startsWith('blob:'));
      safeStorage.setItem('dlRecentJobs', JSON.stringify(persistable));
    } catch {}
  }, [dlRecentJobs]);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const floatingVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const danmakuTimerRef = useRef<Set<string>>(new Set());
  const dlIntervalRef = useRef<number | null>(null);
  const dlAbortRef = useRef<AbortController | null>(null);
  const videoRetryCountRef = useRef<number>(0);
  const hlsRef = useRef<Hls | null>(null);
  const loadedStreamKeyRef = useRef<string>('');
  const prevAlertIdsRef = useRef<string>('');

  const getActiveMediaEl = (): HTMLMediaElement | null => {
    if (radioMode && playerMode !== 'embed') {
      return audioRef.current;
    }
    return videoRef.current;
  };

  // Sync Media Session metadata, artwork, position state & lock-screen/background controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentVideo) return;
    let active = true;
    const applyMetadata = (artSrc: string) => {
      if (!active) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentVideo.title || 'ZERO-ニコ動',
          artist: currentVideo.channel || 'ニコニコ動画',
          album: currentVideo.isLive
            ? 'ニコニコ生放送'
            : radioMode
              ? 'ZERO-ニコ動 ラジオモード'
              : (currentVideo.category || 'ZERO-ニコ動'),
          artwork: artSrc
            ? [
                { src: artSrc, sizes: '320x180', type: 'image/jpeg' },
                { src: artSrc, sizes: '640x360', type: 'image/jpeg' }
              ]
            : []
        });
      } catch {}
    };

    if (currentVideo.thumbnail) {
      applyMetadata(currentVideo.thumbnail);
      if (settings.thumbMethod === 'server') {
        void resolveThumbnailDataUrl(currentVideo.thumbnail, 'server', settings.apiRouteMethod).then((dataUrl) => {
          if (dataUrl && dataUrl !== currentVideo.thumbnail) {
            applyMetadata(dataUrl);
          }
        });
      }
    } else {
      applyMetadata('');
    }

    try {
      navigator.mediaSession.playbackState = isVideoPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => {
        const el = getActiveMediaEl();
        el?.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        const el = getActiveMediaEl();
        el?.pause();
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const el = getActiveMediaEl();
        if (el && !currentVideo.isLive) {
          el.currentTime = Math.max(0, el.currentTime - (details.seekOffset || 10));
        }
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const el = getActiveMediaEl();
        if (el && !currentVideo.isLive) {
          el.currentTime = Math.min(el.duration || el.currentTime + 10, el.currentTime + (details.seekOffset || 10));
        }
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        const el = getActiveMediaEl();
        if (el && !currentVideo.isLive && typeof details.seekTime === 'number') {
          if (details.fastSeek && 'fastSeek' in el && typeof (el as HTMLVideoElement).fastSeek === 'function') {
            (el as HTMLVideoElement).fastSeek(details.seekTime);
          } else {
            el.currentTime = Math.max(0, details.seekTime);
          }
        }
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (playHistory.length > 1) {
          const prev = playHistory.find((v) => v.id !== currentVideo.id);
          if (prev) playVideo(prev);
        }
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        const list = liveRelatedVideos.length > 0 ? liveRelatedVideos : videos;
        const idx = list.findIndex((v) => v.id === currentVideo.id);
        const next = idx >= 0 && idx + 1 < list.length ? list[idx + 1] : list.find((v) => v.id !== currentVideo.id);
        if (next) playVideo(next);
      });
    } catch {}

    return () => {
      active = false;
    };
  }, [currentVideo?.id, currentVideo?.title, currentVideo?.channel, currentVideo?.thumbnail, currentVideo?.isLive, isVideoPlaying, radioMode, playerMode, settings.thumbMethod, settings.apiRouteMethod]);

  // Real-time stream attachment for Freemake (HLS / Range Proxy / ffmpeg) & Custom HTML5 player (supports Video & Radio Audio-Only)
  useEffect(() => {
    if ((playerMode !== 'custom' && playerMode !== 'freemake') || !currentVideo) {
      loadedStreamKeyRef.current = '';
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const desiredKey = `${currentVideo.id}::${playerMode}::${freemakeQuality}::${radioMode ? 'audio' : 'video'}`;

    if (currentView !== 'player') {
      // Keep radio audio or floating player alive when navigating to other views
      if (loadedStreamKeyRef.current === desiredKey && (radioMode || floatingPlayerVisible)) {
        return;
      }
      if (!radioMode) {
        loadedStreamKeyRef.current = '';
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      }
      return;
    }

    const mediaEl = radioMode ? audioRef.current : videoRef.current;
    const inactiveEl = radioMode ? videoRef.current : audioRef.current;
    if (inactiveEl) {
      inactiveEl.pause();
      inactiveEl.removeAttribute('src');
    }
    if (!mediaEl) return;

    // Avoid reloading an already-active stream when returning from another view
    if (loadedStreamKeyRef.current === desiredKey && (hlsRef.current || mediaEl.currentSrc || mediaEl.src)) {
      return;
    }

    loadedStreamKeyRef.current = desiredKey;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (playerMode === 'custom') {
      const directStreamUrl = getStreamUrl(currentVideo);
      if (!mediaEl.src.endsWith(directStreamUrl)) {
        mediaEl.src = directStreamUrl;
        mediaEl.load();
      }
      if (autoPlayRef.current && !userPausedRef.current) {
        void attemptAutoPlay(mediaEl);
      } else {
        mediaEl.pause();
        setIsVideoPlaying(false);
      }
      return;
    }

    // Freemake Real-Time Stream Mode (or Radio Audio-Only Mode)
    let cancelled = false;
    let stallTimer: number | null = null;
    const isNicoTarget = Boolean(
      currentVideo.isLive ||
      /^(sm|so|nm|lv)\d+$/i.test(currentVideo.nicoId || currentVideo.id) ||
      (currentVideo.url && currentVideo.url.includes('nicovideo.jp'))
    );
    const targetUrl =
      currentVideo.url ||
      (currentVideo.nicoId
        ? (currentVideo.isLive || /^lv\d+$/i.test(currentVideo.nicoId)
            ? `https://live.nicovideo.jp/watch/${currentVideo.nicoId}`
            : `https://www.nicovideo.jp/watch/${currentVideo.nicoId}`)
        : currentVideo.id);

    setIsVideoLoading(true);
    setVideoError(null);
    setVideoLoadingPercent(30);
    setVideoLoadingStage(
      radioMode
        ? 'ラジオ音声ストリームへ接続中...'
        : currentVideo.isLive
          ? '生放送ストリームへ接続中...'
          : `Freemake ストリーム接続中 (${freemakeQuality}p)...`
    );
    setFreemakeStreamType(null);
    setFreemakeResolvedUrl(null);

    const clearStallTimer = () => {
      if (stallTimer !== null) {
        window.clearTimeout(stallTimer);
        stallTimer = null;
      }
    };

    const startMetadataWatchdog = () => {
      clearStallTimer();
      const timeoutMs = currentVideo.isLive ? 15000 : 10000;
      stallTimer = window.setTimeout(() => {
        if (cancelled) return;
        const m = radioMode ? audioRef.current : videoRef.current;
        if (!m || m.readyState < 1) {
          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }
          setIsVideoLoading(false);
          if (isNicoTarget && !radioMode) {
            setPlayerMode('embed');
            showPlayerNotification('ストリーム読み込みに時間がかかったため、公式プレイヤーへ切り替えました');
          } else {
            setVideoError('ストリームの読み込みがタイムアウトしました。再度お試しください。');
          }
        }
      }, timeoutMs);
    };

    const trySafePlay = (el: HTMLMediaElement) => {
      if (!autoPlayRef.current) {
        if (cancelled) return;
        el.pause();
        setIsVideoPlaying(false);
        setIsVideoLoading(false);
        setVideoLoadingPercent(100);
        setVideoLoadingStage('自動再生OFF（再生ボタンを押して視聴）');
        return;
      }
      void attemptAutoPlay(el).then((started) => {
        if (cancelled) return;
        if (!started && el.readyState >= 2) {
          setIsVideoLoading(false);
          setIsVideoPlaying(false);
        }
      });
    };

    const viewerId = getLiveViewerId();
    const isLiveBroadcast = Boolean(currentVideo.isLive);

    (async () => {
      try {
        const liveParams = isLiveBroadcast
          ? `&liveQuality=low&vid=${encodeURIComponent(viewerId)}`
          : '';
        const resp = await apiCall(
          `/api/freemake/stream-info?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(freemakeQuality)}${radioMode ? '&audioOnly=1' : ''}${liveParams}`
        );
        const rawText = await resp.text();
        let data: any = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          data = null;
        }
        if (cancelled) return;

        if (resp.status === 429 || data?.code === 'QUOTA_EXCEEDED') {
          setQuotaBanner(QUOTA_EXCEEDED_MESSAGE);
          throw new Error(`QUOTA_EXCEEDED:${QUOTA_EXCEEDED_MESSAGE}`);
        }
        if (data?.code === 'LIVE_CAPACITY_FULL' || (resp.status === 503 && String(data?.error || '').includes('満員'))) {
          throw new Error(`LIVE_CAPACITY_FULL:${data?.error || LIVE_CAPACITY_FULL_MESSAGE}`);
        }
        if (!resp.ok || !data?.ok || !data?.streamUrl) {
          throw new Error(data?.error || `ストリーム取得に失敗しました (HTTP ${resp.status})`);
        }

        const rawStreamUrl = String(data.streamUrl);
        const withViewer =
          isLiveBroadcast && !rawStreamUrl.includes('vid=')
            ? `${rawStreamUrl}${rawStreamUrl.includes('?') ? '&' : '?'}vid=${encodeURIComponent(viewerId)}`
            : rawStreamUrl;
        const resolvedStreamUrl = withViewer.startsWith('/')
          ? apiUrl(withViewer)
          : withViewer;

        setFreemakeStreamType(data.mode || 'proxy');
        setFreemakeResolvedUrl(resolvedStreamUrl);
        setVideoLoadingPercent(85);
        setVideoLoadingStage('再生バッファを開始中...');
        startMetadataWatchdog();

        const isHls = data.mode === 'hls' || resolvedStreamUrl.includes('.m3u8');
        if (isHls) {
          if (Hls.isSupported()) {
            const hasNativeMSE = typeof window !== 'undefined' && 'MediaSource' in window;
            if (!hasNativeMSE && 'ManagedMediaSource' in window && 'disableRemotePlayback' in mediaEl) {
              (mediaEl as HTMLVideoElement).disableRemotePlayback = true;
            }
            const hls = new Hls({
              enableWorker: hasNativeMSE,
              lowLatencyMode: false,
              ...(isLiveBroadcast
                ? {
                    // マニフェスト更新頻度・バッファ・画質を抑えて1.5秒共有キャッシュと相性最適化
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 6,
                    backBufferLength: 10,
                    maxBufferLength: 16,
                    startLevel: 0,
                    capLevelToPlayerSize: true,
                    manifestLoadingMaxRetry: 3,
                    manifestLoadingRetryDelay: 1500,
                    levelLoadingMaxRetry: 3,
                    levelLoadingRetryDelay: 1500,
                    fragLoadingMaxRetry: 4,
                    fragLoadingRetryDelay: 1000
                  }
                : {
                    maxBufferLength: 25
                  })
            });
            hlsRef.current = hls;
            let networkRetries = 0;
            let mediaRetries = 0;
            hls.loadSource(resolvedStreamUrl);
            hls.attachMedia(mediaEl);
            hls.on(Hls.Events.MANIFEST_PARSED, (_ev, parsedData) => {
              if (cancelled) return;
              if (isLiveBroadcast && Array.isArray(parsedData?.levels) && parsedData.levels.length > 1) {
                // 生放送はデフォルト低画質レベルを上限に設定し通信量を削減
                hls.autoLevelCapping = 0;
                hls.currentLevel = 0;
              }
              networkRetries = 0;
              setVideoLoadingPercent(100);
              setIsVideoLoading(false);
              trySafePlay(mediaEl);
            });
            hls.on(Hls.Events.FRAG_BUFFERED, () => {
              networkRetries = 0;
              mediaRetries = 0;
            });
            hls.on(Hls.Events.ERROR, (_event, errData) => {
              if (!errData.fatal || cancelled) return;
              if (errData.response?.code === 429) {
                setQuotaBanner(QUOTA_EXCEEDED_MESSAGE);
              }
              if (errData.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
                networkRetries++;
                const code = errData.response?.code;
                if (isLiveBroadcast && (code === 403 || code === 410 || networkRetries >= 2)) {
                  const sep = resolvedStreamUrl.includes('?') ? '&' : '?';
                  hls.loadSource(`${resolvedStreamUrl}${sep}refresh=1&_t=${Date.now()}`);
                } else {
                  hls.startLoad();
                }
                return;
              }
              if (errData.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
                mediaRetries++;
                hls.recoverMediaError();
                return;
              }
              clearStallTimer();
              hls.destroy();
              hlsRef.current = null;
              setIsVideoLoading(false);
              if (isNicoTarget && !radioMode) {
                setPlayerMode('embed');
                showPlayerNotification('公式プレイヤーで再生します');
              } else {
                setVideoError('音声・HLSストリームの読み込みに失敗しました。');
              }
            });
          } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
            mediaEl.src = resolvedStreamUrl;
            mediaEl.load();
            trySafePlay(mediaEl);
          } else {
            mediaEl.src = resolvedStreamUrl;
            mediaEl.load();
            trySafePlay(mediaEl);
          }
        } else {
          mediaEl.src = resolvedStreamUrl;
          mediaEl.load();
          trySafePlay(mediaEl);
        }
      } catch (err: any) {
        if (cancelled) return;
        clearStallTimer();
        setIsVideoLoading(false);
        const msg = String(err?.message || '');
        if (msg.startsWith('LIVE_CAPACITY_FULL:')) {
          setVideoError(msg.replace('LIVE_CAPACITY_FULL:', '') || LIVE_CAPACITY_FULL_MESSAGE);
          return;
        }
        if (msg.startsWith('QUOTA_EXCEEDED:')) {
          setVideoError(QUOTA_EXCEEDED_MESSAGE);
          return;
        }
        if (isNicoTarget && currentVideo.isLive && !radioMode) {
          setPlayerMode('embed');
          showPlayerNotification('公式生放送プレイヤーへ切り替えました');
        } else {
          setVideoError(msg || 'ストリームの取得に失敗しました');
        }
      }
    })();

    let liveHeartbeatTimer: number | null = null;
    const liveHeartbeatId = (currentVideo.nicoId || currentVideo.id || '').toLowerCase();
    if (isLiveBroadcast && /^lv\d+$/.test(liveHeartbeatId)) {
      liveHeartbeatTimer = window.setInterval(() => {
        apiCall(`/api/nico/live/heartbeat/${encodeURIComponent(liveHeartbeatId)}?vid=${encodeURIComponent(viewerId)}`, {
          method: 'POST'
        }).catch(() => {});
      }, 25000);
    }

    return () => {
      cancelled = true;
      clearStallTimer();
      if (liveHeartbeatTimer !== null) {
        window.clearInterval(liveHeartbeatTimer);
      }
      if (isLiveBroadcast && /^lv\d+$/.test(liveHeartbeatId)) {
        fetch(apiUrl(`/api/nico/live/stop/${encodeURIComponent(liveHeartbeatId)}?vid=${encodeURIComponent(viewerId)}`), {
          method: 'POST',
          keepalive: true
        }).catch(() => {});
      }
    };
  }, [playerMode, currentVideo?.id, currentView, freemakeQuality, radioMode]);

  useEffect(() => {
    if (themeMode === 'dark') {
      document.body.classList.add('niconico-theme');
    } else {
      document.body.classList.remove('niconico-theme');
    }
    safeStorage.setItem('zeroThemeMode', themeMode);
  }, [themeMode]);

  const measureApiServers = async () => {
    setIsMeasuringApis(true);
    const currentAuto = getAutoNodeDisplayInfo();
    setAutoNodeInfo(currentAuto);
    const autoHealthUrl = currentAuto.baseUrl
      ? `${currentAuto.baseUrl}${currentAuto.baseUrl.includes('workers.dev') ? '/health' : '/api/health'}`
      : '/api/health';
    const vercelBase = getConfiguredVercelUrl();
    const isHostedVercel = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app');
    const targets: Array<{ id: AppSettings['apiRouteMethod']; url: string }> = [
      { id: 'auto', url: autoHealthUrl },
      { id: 'worker', url: 'https://niconico-2.na8526130.workers.dev/health' },
      { id: 'render', url: `${RENDER_SERVER_URLS[0]}/api/health` },
      { id: 'render2', url: `${RENDER_SERVER_URLS[1]}/api/health` },
      { id: 'render3', url: `${RENDER_SERVER_URLS[2]}/api/health` },
      ...(vercelBase || isHostedVercel
        ? [{ id: 'vercel' as const, url: `${vercelBase}/api/health` }]
        : []),
      { id: 'direct', url: '/api/health' }
    ];
    setApiBenchmarks({
      auto: { loading: true, ms: null, ok: null },
      worker: { loading: true, ms: null, ok: null },
      render: { loading: true, ms: null, ok: null },
      render2: { loading: true, ms: null, ok: null },
      render3: { loading: true, ms: null, ok: null },
      ...(vercelBase || isHostedVercel ? { vercel: { loading: true, ms: null, ok: null } } : {}),
      direct: { loading: true, ms: null, ok: null }
    });
    await Promise.all(
      targets.map(async (t) => {
        const started = performance.now();
        try {
          const r = await fetch(t.url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
          const ms = Math.max(1, Math.round(performance.now() - started));
          setApiBenchmarks((prev) => ({ ...prev, [t.id]: { loading: false, ms, ok: r.ok } }));
        } catch {
          const ms = Math.max(1, Math.round(performance.now() - started));
          setApiBenchmarks((prev) => ({ ...prev, [t.id]: { loading: false, ms, ok: false } }));
        }
      })
    );
    setIsMeasuringApis(false);
  };

  useEffect(() => {
    if (currentView === 'settings') {
      void measureApiServers();
    }
  }, [currentView]);

  useEffect(() => {
    setPlayHistory(getPlayHistory());
    setSubscriptions(getSubscriptions());
    setPlaylists(getPlaylists());
    const rList = getReviews();
    setReviews(rList.length > 0 ? rList : INITIAL_REVIEWS);
    const mine = getMyReview();
    if (mine) {
      setMyReview(mine);
      setSelectedRating(mine.rating);
      setReviewComment(mine.comment);
    }
  }, []);

  const fetchRanking = async (genre: string, termOverride?: string) => {
    const activeTerm = termOverride || homeTerm;
    setHomeGenre(genre);
    if (termOverride) setHomeTerm(termOverride);
    if (genre === 'classics') {
      setRankingVideos(INITIAL_VIDEOS);
      return;
    }
    setIsLoadingRanking(true);
    try {
      const res = await apiCall(`/api/nico/ranking?genre=${encodeURIComponent(genre)}&term=${encodeURIComponent(activeTerm)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.items) && data.items.length > 0) {
        setRankingVideos(data.items);
      } else {
        setRankingVideos(INITIAL_VIDEOS);
      }
    } catch {
      setRankingVideos(INITIAL_VIDEOS);
    } finally {
      setIsLoadingRanking(false);
    }
  };

  useEffect(() => {
    fetchRanking('all', '24h');
  }, []);

  const checkFavoriteLiveAlerts = async (subsList: ChannelSubscription[]) => {
    if (!subsList || subsList.length === 0) {
      setFavoriteLiveAlerts([]);
      return;
    }
    try {
      const res = await apiCall('/api/nico/live/check-favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: subsList })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.liveAlerts)) {
        const nextIds = data.liveAlerts.map((a: LiveProgram) => a.id).sort().join(',');
        if (nextIds && nextIds !== prevAlertIdsRef.current) {
          setLiveAlertsDismissed(false);
        }
        prevAlertIdsRef.current = nextIds;
        setFavoriteLiveAlerts(data.liveAlerts);
      }
    } catch {}
  };

  useEffect(() => {
    if (subscriptions.length === 0) {
      setFavoriteLiveAlerts([]);
      return;
    }
    void checkFavoriteLiveAlerts(subscriptions);
    const timer = window.setInterval(() => {
      void checkFavoriteLiveAlerts(subscriptions);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [subscriptions]);

  const formatLiveElapsed = (beginTime?: number): string => {
    if (!beginTime || beginTime <= 0) return '';
    const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - beginTime);
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}分経過`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}時間${remMins > 0 ? `${remMins}分` : ''}経過`;
  };

  const loadNicoLivePrograms = async (opts?: { q?: string; sort?: string; tab?: string }) => {
    const q = (opts?.q !== undefined ? opts.q : liveSearchQuery).trim();
    const sort = opts?.sort || liveSearchSort;
    const tab = opts?.tab || liveCategoryTab;
    setIsLoadingLive(true);
    setLiveSearchError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('sort', sort);
      if (!q && tab && tab !== 'all') params.set('tab', tab);
      const res = await apiCall(`/api/nico/live/search?${params.toString()}`);
      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `生放送検索に失敗しました (HTTP ${res.status})`);
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setLivePrograms(items);
      setLiveTotalCount(Number(data.total ?? items.length));
    } catch (err: any) {
      setLiveSearchError(err?.message || '放送中のLIVE一覧を取得できませんでした。');
    } finally {
      setIsLoadingLive(false);
    }
  };

  const openLiveSearch = (initialQuery?: string) => {
    const nextQ = initialQuery !== undefined ? initialQuery : liveSearchQuery;
    setNicoHubTab('live');
    if (initialQuery !== undefined) {
      setLiveSearchQuery(initialQuery);
    }
    switchView('nico-hub');
    void loadNicoLivePrograms({ q: nextQ, sort: liveSearchSort, tab: liveCategoryTab });
  };

  const playLiveProgram = async (p: {
    id: string;
    title?: string;
    thumbnail?: string;
    url?: string;
    providerName?: string;
    providerAvatar?: string;
    watchCount?: number;
    commentCount?: number;
  }) => {
    const cleanId = p.id.toLowerCase();
    const initialVideo: Video = {
      id: cleanId,
      nicoId: cleanId,
      isLive: true,
      title: p.title || `ニコニコ生放送 (${cleanId})`,
      channel: p.providerName || 'ニコニコ生放送',
      channelAvatar: p.providerAvatar || '',
      channel_url: `https://live.nicovideo.jp/watch/${cleanId}`,
      thumbnail: p.thumbnail || '',
      duration: 'LIVE',
      views: Number(p.watchCount || 0),
      commentCount: Number(p.commentCount || 0),
      url: p.url || `https://live.nicovideo.jp/watch/${cleanId}`,
      platform: 'niconico',
      category: '生放送',
      description: 'ニコニコ生放送のリアルタイム配信です。上の切り替えボタンで「公式生放送プレイヤー」と「ライブHLS再生」を切り替えられます。'
    };
    playVideo(initialVideo, 'freemake');
    try {
      const res = await apiCall(`/api/nico/live/info/${encodeURIComponent(cleanId)}`);
      const data = await res.json();
      if (data.success && data.program) {
        const prog = data.program;
        setCurrentVideo((prev) => {
          if (!prev || prev.id !== cleanId) return prev;
          return {
            ...prev,
            title: prog.title || prev.title,
            channel: prog.providerName || prev.channel,
            channelAvatar: prog.providerAvatar || prev.channelAvatar,
            thumbnail: prog.thumbnail || prev.thumbnail,
            views: Number(prog.watchCount ?? prev.views),
            commentCount: Number(prog.commentCount ?? prev.commentCount),
            description: prog.description || prev.description
          };
        });
      }
    } catch {}
  };

  const openNicopediaModal = async (word: string) => {
    setDicModal({ word, loading: true });
    try {
      const res = await apiCall(`/api/nico/dic/${encodeURIComponent(word)}`);
      const data = await res.json();
      if (data.success) {
        setDicModal({ word, title: data.title, summary: data.summary, url: data.url, loading: false });
      } else {
        setDicModal({ word, url: data.url, loading: false, error: data.error || '大百科記事が見つかりませんでした' });
      }
    } catch {
      setDicModal({ word, loading: false, error: '大百科の取得に失敗しました' });
    }
  };

  const openChannelProfile = async (info: { url: string; name: string; avatar?: string; userId?: string }) => {
    setChannelData(info);
    setChannelActiveTab('home');
    switchView('channel');

    const userMatch = info.userId || (info.url || '').match(/\/user\/(\d+)/)?.[1];
    if (!userMatch) {
      setChannelProfile(null);
      return;
    }

    setChannelProfile({ videos: [], mylists: [], series: [], loading: true });
    try {
      const res = await apiCall(`/api/nico/user/${encodeURIComponent(userMatch)}`);
      const data = await res.json();
      if (data.success && data.user) {
        setChannelProfile({
          user: data.user,
          totalVideos: data.totalVideos,
          videos: data.videos || [],
          mylists: data.mylists || [],
          series: data.series || [],
          loading: false
        });
      } else {
        setChannelProfile({ videos: [], mylists: [], series: [], loading: false, error: data.error });
      }
    } catch {
      setChannelProfile({ videos: [], mylists: [], series: [], loading: false, error: 'ユーザー情報を取得できませんでした' });
    }
  };

  const switchView = (view: ViewType) => {
    const activeEl = getActiveMediaEl();
    if (currentView === 'player' && view !== 'player' && currentVideo) {
      if (activeEl && !activeEl.paused) {
        setFloatingPlayerVisible(true);
      }
    } else if (view === 'player') {
      setFloatingPlayerVisible(false);
    }
    if (view === 'nico-hub' && livePrograms.length === 0) {
      void loadNicoLivePrograms();
    }
    setCurrentView(view);
    window.scrollTo(0, 0);
  };

  const playVideo = (v: Video, modeOverride?: 'freemake' | 'embed' | 'custom', qualityOverride?: string) => {
    videoRetryCountRef.current = 0;
    loadedStreamKeyRef.current = '';
    userPausedRef.current = false;
    setIsAutoMutedFallback(false);
    setNextAutoPlayState(null);
    const targetMode: 'freemake' | 'embed' | 'custom' = modeOverride || 'freemake';
    if (qualityOverride) {
      setFreemakeQuality(qualityOverride);
    }
    setPlayerMode(targetMode);
    safeStorage.setItem('playerModePreference', targetMode);

    setIsVideoLoading(targetMode === 'freemake');
    setIsVideoPlaying(false);
    setVideoError(null);
    setVideoLoadingPercent(targetMode === 'freemake' ? 25 : 100);
    setVideoLoadingStage(targetMode === 'freemake' ? 'Freemake ストリームを準備中...' : '動画準備完了！');
    setVideoPlayPercent(0);
    setVideoBufferPercent(0);

    setCurrentVideo(v);
    const updatedHist = addToPlayHistory(v);
    setPlayHistory(updatedHist);
    setChannelData({
      url: v.channel_url || '',
      name: v.channel,
      avatar: v.channelAvatar,
      userId: v.userId
    });
    setLiveRelatedVideos([]);
    setVideoTree(null);

    const targetNicoId = v.nicoId || v.id;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setLiveComments([]);
    seenLiveCommentIdsRef.current.clear();
    liveCommentsCursorRef.current = 0;

    // Start with user-posted local danmaku only until authentic nvcomment loads
    setVodCommentFilter('');
    setCustomSubtitles(null);
    setFetchedSubtitles(null);
    setFetchedSubtitleLabel('');
    setSubtitleOffsetMs(0);
    setActiveSubtitleText('');
    if (v.isLive) {
      setDanmakuPool([]);
      setVodCommentsLoading(false);
      setLiveCommentsLoading(true);
    } else {
      setLiveCommentsLoading(false);
      setDanmakuPool(getVideoDanmaku(v.id));
      setVodCommentsLoading(/^(sm|so|nm)\d+$/i.test(targetNicoId));
    }

    // 1. Fetch authentic watch/v3_guest metadata (tags, counts, real owner, description)
    if (/^(sm|so|nm)\d+$/i.test(targetNicoId)) {
      apiCall(`/api/nico/video/${encodeURIComponent(targetNicoId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.video) {
            setCurrentVideo((prev) => {
              if (!prev || (prev.nicoId || prev.id) !== targetNicoId) return prev;
              return { ...prev, ...data.video };
            });
            setChannelData({
              url: data.video.channel_url || '',
              name: data.video.channel,
              avatar: data.video.channelAvatar,
              userId: data.video.userId
            });
          }
        })
        .catch(() => {});

      // 2. Fetch authentic nvcomment danmaku comments
      apiCall(`/api/nico/comments/${encodeURIComponent(targetNicoId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.comments)) {
            const apiComments: NicoComment[] = data.comments.map((c: any, idx: number) => ({
              id: `nico-live-${c.id}-${idx}`,
              text: c.text,
              timeMs: c.timeMs,
              commands: c.commands,
              color: c.color || '#ffffff',
              position: c.position || 'naka',
              size: c.size || 'medium',
              postedAt: c.postedAt,
              score: c.score,
              nicoruCount: Number(c.nicoruCount || 0),
              fork: c.fork || 'main'
            }));
            setDanmakuPool([...apiComments, ...getVideoDanmaku(v.id)]);
          }
        })
        .catch(() => {})
        .finally(() => {
          setVodCommentsLoading(false);
        });

      // 3. Fetch real nvapi related recommendations
      apiCall(`/api/nico/related/${encodeURIComponent(targetNicoId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.items)) {
            setLiveRelatedVideos(data.items);
          }
        })
        .catch(() => {});

      // 4. Fetch content tree (親作品・子作品)
      apiCall(`/api/nico/tree/${encodeURIComponent(targetNicoId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setVideoTree({
              parentsTotal: data.parentsTotal || 0,
              childrenTotal: data.childrenTotal || 0,
              parents: data.parents || [],
              children: data.children || []
            });
          }
        })
        .catch(() => {});
    } else if (!v.isLive && v.url && /^https?:\/\//i.test(v.url)) {
      // 外部動画URL（YouTube等）の場合は公式字幕/自動字幕を自動取得
      const subUrl = `/api/subtitles?url=${encodeURIComponent(v.url)}`;
      fetch(subUrl)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP'))))
        .catch(() => apiCall(subUrl).then((r) => r.json()))
        .then((data) => {
          if (data?.ok && data?.vtt) {
            const cues = parseSubtitleFileText(String(data.vtt));
            if (cues.length > 0) {
              setFetchedSubtitles(cues);
              setFetchedSubtitleLabel(
                data.source === 'official'
                  ? `公式字幕 (${data.lang || 'ja'})`
                  : `自動字幕 (${data.lang || 'ja'})`
              );
            }
          }
        })
        .catch(() => {});
    }

    danmakuTimerRef.current.clear();
    setActiveDanmaku([]);
    setDescExpanded(false);
    setFloatingPlayerVisible(false);
    setShowPlayerSettings(false);
    switchView('player');
  };

  // Continuous Danmaku comment flow when watching VOD (normal & container fullscreen)
  useEffect(() => {
    if (
      currentView !== 'player' ||
      !nicoCommentsOn ||
      currentVideo?.isLive ||
      danmakuPool.length === 0
    ) {
      return;
    }

    let idx = 0;
    const count = Math.min(5, danmakuPool.length);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const item = danmakuPool[i % danmakuPool.length];
        const lane = (i * 2 + 1) % 8;
        const activeItem: ActiveDanmakuItem = {
          id: `${item.id}-${Date.now()}-${i}`,
          text: item.text,
          topPercent: 5 + lane * 11,
          color: item.color || '#ffffff',
          key: `flow-init-${item.id}-${Date.now()}-${i}`
        };
        setActiveDanmaku((prev) => [...prev, activeItem]);
        setTimeout(() => {
          setActiveDanmaku((prev) => prev.filter((d) => d.key !== activeItem.key));
        }, 7800);
      }, i * 350);
    }
    idx = count;

    const timer = setInterval(() => {
      if (!nicoCommentsOn || danmakuPool.length === 0) return;
      if (playerMode !== 'embed') {
        const el = getActiveMediaEl();
        if (el && el.paused) return;
      }

      const item = danmakuPool[idx % danmakuPool.length];
      idx++;
      const lane = Math.floor(Math.random() * 8);
      const activeItem: ActiveDanmakuItem = {
        id: `${item.id}-${Date.now()}`,
        text: item.text,
        topPercent: 5 + lane * 11,
        color: item.color || '#ffffff',
        key: `flow-stream-${item.id}-${Date.now()}-${Math.random()}`
      };
      setActiveDanmaku((prev) => [...prev, activeItem]);
      setTimeout(() => {
        setActiveDanmaku((prev) => prev.filter((d) => d.key !== activeItem.key));
      }, 7800);
    }, 1300);

    return () => clearInterval(timer);
  }, [playerMode, currentView, nicoCommentsOn, danmakuPool, currentVideo?.id, currentVideo?.isLive]);

  // Real-time Niconico Live comment polling & Danmaku spawning
  useEffect(() => {
    const liveId = (currentVideo?.nicoId || currentVideo?.id || '').toLowerCase();
    if (currentView !== 'player' || !currentVideo?.isLive || !/^lv\d+$/.test(liveId)) {
      return;
    }

    let cancelled = false;
    let firstFetch = true;

    const pollComments = async () => {
      try {
        const cursor = liveCommentsCursorRef.current;
        const res = await apiCall(`/api/nico/live/comments/${encodeURIComponent(liveId)}${cursor > 0 ? `?since=${cursor}` : ''}`);
        const data = await res.json();
        if (cancelled) return;

        if (data.serverTime) {
          liveCommentsCursorRef.current = Number(data.serverTime);
        }

        if (data.success && Array.isArray(data.comments)) {
          const fresh: LiveChatComment[] = [];
          for (const c of data.comments as LiveChatComment[]) {
            if (!c?.id || seenLiveCommentIdsRef.current.has(c.id)) continue;
            seenLiveCommentIdsRef.current.add(c.id);
            fresh.push(c);
          }

          if (seenLiveCommentIdsRef.current.size > 1200) {
            const trimmed = Array.from(seenLiveCommentIdsRef.current).slice(-600);
            seenLiveCommentIdsRef.current = new Set(trimmed);
          }

          if (fresh.length > 0) {
            setLiveComments((prev) => [...prev, ...fresh].slice(-150));

            if (nicoCommentsOnRef.current && !radioModeRef.current) {
              const danmakuBatch = fresh.filter((c) => !c.isSystem).slice(-6);
              danmakuBatch.forEach((c, idx) => {
                window.setTimeout(() => {
                  if (cancelled || !nicoCommentsOnRef.current || radioModeRef.current) return;
                  const lane = (idx + Math.floor(Math.random() * 8)) % 8;
                  const activeItem: ActiveDanmakuItem = {
                    id: c.id,
                    text: c.text,
                    topPercent: 5 + lane * 11,
                    color: c.color || '#ffffff',
                    key: `live-danmaku-${c.id}-${Date.now()}-${idx}`
                  };
                  setActiveDanmaku((prev) => [...prev, activeItem]);
                  window.setTimeout(() => {
                    setActiveDanmaku((prev) => prev.filter((d) => d.key !== activeItem.key));
                  }, 7800);
                }, firstFetch ? idx * 320 : idx * 240);
              });
            }
          }
        }
      } catch {
        // Ignore transient poll errors and retry on next interval
      } finally {
        if (firstFetch && !cancelled) {
          firstFetch = false;
          setLiveCommentsLoading(false);
        }
      }
    };

    void pollComments();
    const timer = window.setInterval(() => {
      void pollComments();
    }, 2200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentView, currentVideo?.id, currentVideo?.isLive]);

  // Auto-scroll live chat panel to latest comment when user is near bottom
  useEffect(() => {
    const el = liveChatListRef.current;
    if (!el || liveComments.length === 0) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 140 || liveComments.length <= 50) {
      el.scrollTop = el.scrollHeight;
    }
  }, [liveComments]);

  useEffect(() => {
    const el = getActiveMediaEl();
    if (playerMode === 'custom' && currentVideo && el) {
      if (!autoPlayRef.current) {
        el.pause();
        return;
      }
      if (!userPausedRef.current) {
        void attemptAutoPlay(el);
      }
    }
  }, [playerMode, currentVideo?.id]);

  const [onlineSearchResults, setOnlineSearchResults] = useState<Video[] | null>(null);
  const [onlineSearchError, setOnlineSearchError] = useState<string | null>(null);

  const handleSearch = async (
    overrideQuery?: string,
    page: number = 1,
    overrideSort?: string,
    skipConversion: boolean = false
  ) => {
    const targetQ = typeof overrideQuery === 'string' ? overrideQuery : searchQuery;
    const raw = targetQ.trim();
    const sortParam = overrideSort || searchSort;

    // If empty query, show all
    if (!raw) {
      if (typeof overrideQuery === 'string') setSearchQuery('');
      if (overrideSort) setSearchSort(overrideSort);
      setSearchApiPage(page);
      setSearchConversion(null);
      setOnlineSearchResults(null);
      setOnlineSearchError(null);
      setSearchTotalCount(videos.length);
      setSearchHasNext(false);
      setSearchPage(0);
      switchView('search');
      return;
    }

    const conv = convertSearchQuery(raw, searchConvertEnabled && !skipConversion);
    let effectiveQuery = conv.converted || raw;
    let finalConv: SearchConversionResult = conv;

    setIsSearchFocused(false);
    setActiveConvertIdx(-1);

    if (conv.needsRemoteIme && page === 1 && !skipConversion) {
      setIsSearchingOnline(true);
      const hiraForApi = conv.hiraText || toSearchHiragana(raw);
      const cacheKey = `${raw}::${hiraForApi}`;
      let remoteEntry = convertCacheRef.current.get(cacheKey);
      if (!remoteEntry) {
        try {
          const fetchedEntry = await fetchSearchConvertWithFallback(raw, hiraForApi, AbortSignal.timeout(900));
          if (fetchedEntry.candidates.length > 0 || fetchedEntry.primary) {
            remoteEntry = fetchedEntry;
            if (convertCacheRef.current.size > 150) convertCacheRef.current.clear();
            convertCacheRef.current.set(cacheKey, remoteEntry);
          }
        } catch {
          // fallback to local conversion
        }
      }
      if (remoteEntry) {
        const remoteTexts = remoteEntry.candidates.map((c) => c.text);
        if (remoteEntry.primary && remoteEntry.primary !== raw) {
          effectiveQuery = remoteEntry.primary;
          finalConv = {
            ...conv,
            converted: remoteEntry.primary,
            wasConverted: remoteEntry.primary !== raw,
            reason: 'IME漢字・予測変換',
            alternatives: Array.from(new Set([conv.converted, ...remoteTexts, ...conv.alternatives]))
              .filter((s) => s && s !== remoteEntry!.primary && s !== raw)
              .slice(0, 10)
          };
        } else if (remoteTexts.length > 0) {
          finalConv = {
            ...conv,
            alternatives: Array.from(new Set([...remoteTexts, ...conv.alternatives]))
              .filter((s) => s && s !== effectiveQuery && s !== raw)
              .slice(0, 10)
          };
        }
      }
    }

    setSearchConversion(finalConv);
    setSearchQuery(effectiveQuery);
    if (overrideSort) {
      setSearchSort(overrideSort);
    }
    setSearchApiPage(page);

    const q = effectiveQuery.toLowerCase();

    // Check if query contains a specific sm ID (e.g. sm9, sm1097445, so30413239)
    const matchSm = q.match(/(sm|so|nm)\d+/);
    if (matchSm && page === 1) {
      const smId = matchSm[0];
      const found = videos.find((v) => v.nicoId?.toLowerCase() === smId || v.url.toLowerCase().includes(smId));
      if (found) {
        playVideo(found);
        return;
      }

      // Try fetching video metadata via server endpoint
      try {
        setIsSearchingOnline(true);
        const res = await apiCall(`/api/nico/video/${smId}`);
        const data = await res.json();
        if (data.success && data.video) {
          const newVideo: Video = data.video;
          saveCustomVideo(newVideo);
          setVideos((prev) => [newVideo, ...prev.filter((v) => v.id !== newVideo.id && v.nicoId !== newVideo.nicoId)]);
          playVideo(newVideo);
          setIsSearchingOnline(false);
          return;
        }
      } catch (err) {
        console.warn('Server sm fetch failed:', err);
      } finally {
        setIsSearchingOnline(false);
      }
    }

    // Check if query contains a Niconico Live ID (e.g. lv351891443)
    const matchLv = q.match(/\blv\d+\b/i);
    if (matchLv && page === 1) {
      const lvId = matchLv[0].toLowerCase();
      await playLiveProgram({ id: lvId, url: `https://live.nicovideo.jp/watch/${lvId}` });
      return;
    }

    // If user pasted any external video URL, open Downloader & inspect
    if (/^https?:\/\//i.test(raw) && page === 1) {
      setDlUrlInput(raw);
      switchView('downloader');
      void inspectDownloaderUrl(raw);
      return;
    }

    // Live search via self-contained Search API (Niconico Snapshot v2)
    setIsSearchingOnline(true);
    setOnlineSearchError(null);
    try {
      const resp = await apiCall(`/api/nico/search?q=${encodeURIComponent(effectiveQuery)}&sort=${sortParam}&order=d&page=${page}`);
      const result = await resp.json();
      if (result.success && Array.isArray(result.items) && result.items.length > 0) {
        setOnlineSearchResults(result.items);
        setSearchTotalCount(result.total || result.items.length);
        setSearchHasNext(result.hasNext || false);
        result.items.forEach((item: Video) => saveCustomVideo(item));
        setVideos((prev) => {
          const newIds = new Set(result.items.map((it: Video) => it.id));
          return [...result.items, ...prev.filter((p) => !newIds.has(p.id))];
        });
      } else {
        setOnlineSearchResults([]);
        setSearchTotalCount(0);
        setSearchHasNext(false);
      }
    } catch (e: any) {
      console.warn('Live search failed, falling back to local dataset:', e);
      setOnlineSearchResults(null);
      setOnlineSearchError('オンライン検索中に問題が発生したため、内蔵データベースから検索しました。');
    } finally {
      setIsSearchingOnline(false);
      setSearchPage(0);
      switchView('search');
    }
  };

  const handleTimeUpdate = () => {
    const activeEl = getActiveMediaEl();
    if (activeEl && activeEl.duration > 0) {
      const cur = activeEl.currentTime;
      const dur = activeEl.duration;
      setVideoPlayPercent(Math.min(100, Math.round((cur / dur) * 100)));
      if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function' && Number.isFinite(dur)) {
        try {
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: activeEl.playbackRate || 1,
            position: Math.min(dur, Math.max(0, cur))
          });
        } catch {}
      }
    }

    if (!activeEl) return;

    // iOS/iPadOS Safari で webkitDisplayingFullscreen が変化している場合の同期フォールバック
    const isAppleFs = Boolean((activeEl as any).webkitDisplayingFullscreen) || (activeEl as any).webkitPresentationMode === 'fullscreen';
    if (isAppleFs && fullscreenModeRef.current !== 'native-video') {
      setFullscreenMode('native-video');
    } else if (!isAppleFs && fullscreenModeRef.current === 'native-video' && !document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      setFullscreenMode('none');
    }

    const timeMs = activeEl.currentTime * 1000;

    // 字幕オーバーレイを現在再生時間へ高精度二分探索で同期
    if (subtitleEnabled && !radioMode && activeSubtitleCues.length > 0) {
      const nextSub = findActiveSubtitleText(activeSubtitleCues, timeMs, subtitleOffsetMs);
      setActiveSubtitleText((prev) => (prev === nextSub ? prev : nextSub));
    } else if (activeSubtitleText) {
      setActiveSubtitleText('');
    }

    if (!nicoCommentsOn || radioMode) return;

    danmakuPool.forEach((item) => {
      if (!danmakuTimerRef.current.has(item.id) && Math.abs(item.timeMs - timeMs) < 1600) {
        danmakuTimerRef.current.add(item.id);
        const lane = Math.floor(Math.random() * 8);
        const activeItem: ActiveDanmakuItem = {
          id: item.id,
          text: item.text,
          topPercent: 4 + lane * 11.5,
          color: item.color || '#ffffff',
          key: `${item.id}-${Date.now()}`
        };
        setActiveDanmaku((prev) => [...prev, activeItem]);
        setTimeout(() => {
          setActiveDanmaku((prev) => prev.filter((d) => d.key !== activeItem.key));
        }, 7800);
      }
    });
  };

  const formatCommentTimeMs = (ms: number) => {
    const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const seekToCommentTime = (timeMs: number) => {
    const activeEl = getActiveMediaEl();
    if (!activeEl) {
      showPlayerNotification('公式プレイヤー以外の再生モードでは時間ジャンプに対応しています');
      return;
    }
    const targetSec = Math.max(0, (Number(timeMs) || 0) / 1000);
    try {
      activeEl.currentTime = targetSec;
      if (activeEl.paused) {
        activeEl.play().catch(() => {});
      }
      showPlayerNotification(`${formatCommentTimeMs(timeMs)} に移動しました`);
    } catch {}
  };

  const handleSubmitVodComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVideo || currentVideo.isLive) return;
    const text = vodCommentInput.trim();
    if (!text) return;

    const activeEl = getActiveMediaEl();
    const timeMs = activeEl && Number.isFinite(activeEl.currentTime)
      ? Math.max(0, Math.round(activeEl.currentTime * 1000))
      : 0;
    const nowIso = new Date().toISOString();
    const savedList = addDanmakuComment(currentVideo.id, text, timeMs, vodCommentColor);
    const latestSaved = savedList[savedList.length - 1];
    const newItem: NicoComment = {
      id: latestSaved?.id || `nd-user-${Date.now()}`,
      text,
      timeMs,
      color: vodCommentColor,
      postedAt: nowIso
    };

    setDanmakuPool((prev) => [newItem, ...prev]);
    setVodCommentInput('');

    if (nicoCommentsOn && !radioMode) {
      const lane = Math.floor(Math.random() * 8);
      const activeItem: ActiveDanmakuItem = {
        id: newItem.id,
        text: newItem.text,
        topPercent: 4 + lane * 11.5,
        color: newItem.color || '#ffffff',
        key: `post-${newItem.id}-${Date.now()}`
      };
      setActiveDanmaku((prev) => [...prev, activeItem]);
      setTimeout(() => {
        setActiveDanmaku((prev) => prev.filter((d) => d.key !== activeItem.key));
      }, 7800);
    }
    showPlayerNotification('コメントを投稿しました');
  };

  const visibleVodComments = useMemo(() => {
    const q = vodCommentFilter.trim().toLowerCase();
    const list = q
      ? danmakuPool.filter((c) => c.text.toLowerCase().includes(q))
      : [...danmakuPool];

    if (vodCommentSort === 'newest') {
      list.sort((a, b) => {
        const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
        const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
        if (tb !== ta) return tb - ta;
        return Number(b.timeMs || 0) - Number(a.timeMs || 0);
      });
    } else {
      list.sort((a, b) => Number(a.timeMs || 0) - Number(b.timeMs || 0));
    }
    return list;
  }, [danmakuPool, vodCommentFilter, vodCommentSort]);

  const toggleSubscriptionState = (channel: { url: string; name: string; avatar?: string; userId?: string }) => {
    if (!channel.url && !channel.name) return;
    const extractedId = channel.userId || (channel.url || '').match(/\/user\/(\d+)/)?.[1] || '';
    const url = channel.url || (extractedId ? `https://www.nicovideo.jp/user/${extractedId}` : `https://www.nicovideo.jp/user/${encodeURIComponent(channel.name)}`);
    toggleSubscription({
      url,
      name: channel.name,
      avatar: channel.avatar,
      userId: extractedId || undefined
    });
    setSubscriptions(getSubscriptions());
  };

  const isSubscribed = (url?: string, name?: string) => {
    if (url && subscriptions.some((s) => s.url === url)) return true;
    if (name && subscriptions.some((s) => s.name === name)) return true;
    return false;
  };

  const handleCreatePlaylist = () => {
    const name = window.prompt('新しい再生リスト名を入力してください');
    if (name && name.trim()) {
      const updated = createPlaylist(name.trim());
      setPlaylists(updated);
    }
  };

  const handleSaveReview = () => {
    if (!selectedRating) {
      setReviewStatus('星評価を選択してください。');
      return;
    }
    const { reviews: updatedReviews, myReview: updatedMy, updated } = saveReview(selectedRating, reviewComment);
    setReviews(updatedReviews);
    setMyReview(updatedMy);
    setReviewStatus(updated ? 'レビューを更新しました。' : 'レビューを投稿しました。ありがとうございます！');
  };

  const inspectDownloaderUrl = async (overrideUrl?: string) => {
    const target = (overrideUrl ?? dlUrlInput).trim();
    if (!target) {
      setDlInspectError('動画URLを入力または貼り付けしてください。');
      return;
    }
    setDlInspecting(true);
    setDlInspectError(null);
    setDlInspectedInfo(null);
    try {
      const res = await fetch('/api/dl/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target })
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.info) {
        throw new Error(data.error || '動画情報の取得に失敗しました。');
      }
      setDlInspectedInfo(data.info);
      if (Array.isArray(data.info.qualities) && data.info.qualities.length > 0) {
        const has720 = data.info.qualities.find((q: any) => q.value === '720');
        setDownloadQuality(has720 ? '720' : data.info.qualities[0].value);
      }
    } catch (err: any) {
      setDlInspectError(err?.message || 'URLの解析に失敗しました。');
    } finally {
      setDlInspecting(false);
    }
  };

  const triggerFileDownload = (fileUrl: string, fileName: string) => {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const startRealDownloadJob = async (
    targetUrl: string,
    format: string,
    quality: string,
    title: string,
    platformHint?: string
  ) => {
    if (dlIntervalRef.current) {
      clearInterval(dlIntervalRef.current);
      dlIntervalRef.current = null;
    }
    if (dlAbortRef.current) {
      dlAbortRef.current.abort();
      dlAbortRef.current = null;
    }

    setIsDownloadDialogOpen(false);
    setIsDownloadingOverlay(true);
    setDlProgress(3);
    setDlProgressSize('接続中...');
    setDlStageText('ダウンロードを準備しています...');
    setDlSpeedText('');
    setDlEtaText('');
    setDlReadyFileUrl(null);
    setDlReadyFileName('');
    setDlJobError(null);
    setDlActiveJobId(null);

    const nicoMatch = targetUrl.match(/\b((?:sm|so|nm)\d+)\b/i);
    const nicoId = nicoMatch ? nicoMatch[1].toLowerCase() : null;

    if (nicoId) {
      const controller = new AbortController();
      dlAbortRef.current = controller;
      const localJobId = `nico-${nicoId}-${Date.now()}`;
      setDlActiveJobId(localJobId);

      try {
        const audioOnly = format === 'mp3';
        const res = await downloadNiconicoInBrowser({
          nicoId,
          title,
          quality: quality || '720',
          audioOnly,
          signal: controller.signal,
          onProgress: (p) => {
            setDlProgress(p.percent);
            setDlStageText(p.stage);
            const mb = (p.downloadedBytes / (1024 * 1024)).toFixed(1);
            setDlProgressSize(p.speedText ? `${mb} MB (${p.speedText})` : `${mb} MB`);
            setDlSpeedText(p.speedText);
          }
        });

        dlAbortRef.current = null;
        const sizeMb = `${(res.sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
        setDlProgress(100);
        setDlProgressSize(`完了 (${sizeMb})`);
        setDlSpeedText('');
        setDlReadyFileUrl(res.blobUrl);
        setDlReadyFileName(res.fileName);
        setDlRecentJobs((prev) => [
          {
            jobId: localJobId,
            title,
            format: audioOnly ? 'M4A音声' : 'MP4',
            quality: audioOnly ? '音声' : `${quality}p`,
            fileUrl: res.blobUrl,
            fileName: res.fileName,
            sizeMb
          },
          ...prev.filter((j) => j.jobId !== localJobId)
        ].slice(0, 12));

        triggerFileDownload(res.blobUrl, res.fileName);
      } catch (err: any) {
        dlAbortRef.current = null;
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        setDlJobError(err?.message || 'ダウンロードに失敗しました。');
        setDlStageText('エラーが発生しました');
      }
      return;
    }

    try {
      const startRes = await fetch('/api/dl/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          format,
          quality,
          title,
          platform: platformHint
        })
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.ok || !startData.jobId) {
        throw new Error(startData.error || 'ダウンロードの開始に失敗しました。');
      }

      const jobId: string = startData.jobId;
      setDlActiveJobId(jobId);

      dlIntervalRef.current = window.setInterval(async () => {
        try {
          const pRes = await fetch(`/api/dl/progress/${jobId}`);
          if (pRes.status === 404) {
            if (dlIntervalRef.current) {
              clearInterval(dlIntervalRef.current);
              dlIntervalRef.current = null;
            }
            const safeTitle = title.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || 'video';
            const ext = format === 'mp3' ? 'm4a' : format === 'webm' ? 'webm' : 'mp4';
            const fileName = format === 'mp3' ? `${safeTitle}.${ext}` : `${safeTitle}_${quality}p.${ext}`;
            const directUrl = `/api/dl/direct?url=${encodeURIComponent(targetUrl)}&format=${encodeURIComponent(format)}&quality=${encodeURIComponent(quality)}&title=${encodeURIComponent(title)}`;
            setDlProgress(100);
            setDlStageText('直接ダウンロードを開始しています...');
            setDlProgressSize('直接保存');
            setDlReadyFileUrl(directUrl);
            setDlReadyFileName(fileName);
            setDlRecentJobs((prev) => [
              { jobId, title, format: format.toUpperCase(), quality: format === 'mp3' ? '音声' : `${quality}p`, fileUrl: directUrl, fileName, sizeMb: '' },
              ...prev.filter((j) => j.jobId !== jobId)
            ].slice(0, 12));
            triggerFileDownload(directUrl, fileName);
            return;
          }
          const pData = await pRes.json();
          if (!pRes.ok || !pData.ok) return;

          setDlProgress(pData.percent ?? 0);
          setDlStageText(pData.stage || '処理中...');
          if (pData.totalSize) {
            setDlProgressSize(pData.speed ? `${pData.totalSize} (${pData.speed})` : pData.totalSize);
          }
          setDlSpeedText(pData.speed || '');
          setDlEtaText(pData.eta || '');

          if (pData.status === 'done') {
            if (dlIntervalRef.current) {
              clearInterval(dlIntervalRef.current);
              dlIntervalRef.current = null;
            }
            const fileUrl = `/api/dl/file/${jobId}`;
            const fileName = pData.fileName || `video.${format === 'mp3' ? 'm4a' : format}`;
            const sizeMb = pData.fileSize ? `${(pData.fileSize / (1024 * 1024)).toFixed(1)} MB` : pData.totalSize || '';

            setDlProgress(100);
            setDlProgressSize(sizeMb ? `完了 (${sizeMb})` : '完了！');
            setDlReadyFileUrl(fileUrl);
            setDlReadyFileName(fileName);
            setDlRecentJobs((prev) => [
              { jobId, title, format: format.toUpperCase(), quality: format === 'mp3' ? '音声' : `${quality}p`, fileUrl, fileName, sizeMb },
              ...prev.filter((j) => j.jobId !== jobId)
            ].slice(0, 12));

            triggerFileDownload(fileUrl, fileName);
          } else if (pData.status === 'error') {
            if (dlIntervalRef.current) {
              clearInterval(dlIntervalRef.current);
              dlIntervalRef.current = null;
            }
            setDlJobError(pData.error || 'ダウンロードに失敗しました。');
            setDlStageText('エラーが発生しました');
          }
        } catch {}
      }, 650);
    } catch (err: any) {
      setDlJobError(err?.message || 'ダウンロードを開始できませんでした。');
      setDlStageText('エラーが発生しました');
    }
  };

  const handleStartDownload = () => {
    if (!currentVideo) {
      setIsDownloadDialogOpen(false);
      return;
    }
    const targetUrl = currentVideo.url || (currentVideo.nicoId ? `https://www.nicovideo.jp/watch/${currentVideo.nicoId}` : currentVideo.id);
    void startRealDownloadJob(targetUrl, downloadFormat, downloadQuality, currentVideo.title, currentVideo.platform);
  };

  const handleCancelDownload = async () => {
    if (dlIntervalRef.current) {
      clearInterval(dlIntervalRef.current);
      dlIntervalRef.current = null;
    }
    if (dlAbortRef.current) {
      dlAbortRef.current.abort();
      dlAbortRef.current = null;
    }
    if (dlActiveJobId && !dlActiveJobId.startsWith('nico-') && !dlReadyFileUrl) {
      fetch(`/api/dl/cancel/${dlActiveJobId}`, { method: 'POST' }).catch(() => {});
    }
    setIsDownloadingOverlay(false);
    setDlProgress(0);
    setDlActiveJobId(null);
    setDlReadyFileUrl(null);
    setDlJobError(null);
  };

  const handleDeleteRecentJob = async (jobId: string) => {
    const target = dlRecentJobs.find((item) => item.jobId === jobId);
    if (target?.fileUrl.startsWith('blob:')) {
      URL.revokeObjectURL(target.fileUrl);
    }
    setDlRecentJobs((prev) => prev.filter((item) => item.jobId !== jobId));
    if (!jobId.startsWith('nico-')) {
      try {
        await fetch(`/api/dl/job/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      } catch {}
    }
  };

  const handleClearAllRecentJobs = async () => {
    for (const j of dlRecentJobs) {
      if (j.fileUrl.startsWith('blob:')) {
        URL.revokeObjectURL(j.fileUrl);
      }
    }
    const targets = dlRecentJobs.map((j) => j.jobId).filter((id) => !id.startsWith('nico-'));
    setDlRecentJobs([]);
    await Promise.all(
      targets.map((jobId) =>
        fetch(`/api/dl/job/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {})
      )
    );
  };

  const handleRequestFullscreen = () => {
    const fsEl =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement;
    const vid = videoRef.current as any;

    if (fsEl) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      return;
    }

    if (vid?.webkitDisplayingFullscreen && typeof vid.webkitExitFullscreen === 'function') {
      try {
        vid.webkitExitFullscreen();
      } catch {}
      return;
    }

    const el = videoContainerRef.current as any;
    const canContainerFs = Boolean(document.fullscreenEnabled || (document as any).webkitFullscreenEnabled);
    if (el && canContainerFs) {
      if (el.requestFullscreen) {
        Promise.resolve(el.requestFullscreen()).catch(() => {
          if (vid && typeof vid.webkitEnterFullscreen === 'function') {
            try { vid.webkitEnterFullscreen(); } catch {}
          }
        });
        return;
      }
      if (el.webkitRequestFullscreen) {
        try {
          el.webkitRequestFullscreen();
          return;
        } catch {}
      }
    }

    if (vid && typeof vid.webkitEnterFullscreen === 'function') {
      try { vid.webkitEnterFullscreen(); } catch {}
    }
  };

  // Normalize search query for flexible matching
  const normalizeText = (str: string) => {
    return str
      .toLowerCase()
      .replace(/[\u30a1-\u30f6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60)) // katakana to hiragana
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Video search results (online search prioritized when searching, fallback to normalized local search)
  const searchResults = useMemo(() => {
    if (onlineSearchResults !== null && searchQuery.trim()) {
      return onlineSearchResults;
    }
    return videos.filter((v) => {
      if (!searchQuery.trim()) return true;
      const rawTokens = searchQuery.trim().split(/[\s,　]+/);
      const normTokens = rawTokens.map(normalizeText);

      const titleNorm = normalizeText(v.title);
      const channelNorm = normalizeText(v.channel);
      const descNorm = normalizeText(v.description || '');
      const nicoIdNorm = (v.nicoId || '').toLowerCase();
      const catNorm = normalizeText(v.category || '');

      // Every token must match at least one attribute (AND search)
      return normTokens.every((token) => {
        return (
          titleNorm.includes(token) ||
          channelNorm.includes(token) ||
          descNorm.includes(token) ||
          nicoIdNorm.includes(token.toLowerCase()) ||
          catNorm.includes(token)
        );
      });
    });
  }, [videos, searchQuery, onlineSearchResults]);
  const searchPageVideos = searchResults.slice(searchPage * 12, (searchPage + 1) * 12);
  const relatedVideos = liveRelatedVideos.length > 0
    ? liveRelatedVideos.filter((v) => v.id !== currentVideo?.id)
    : videos.filter((v) => v.id !== currentVideo?.id).slice(0, 10);

  const handleMediaEnded = () => {
    danmakuTimerRef.current.clear();
    setIsVideoPlaying(false);
    if (!autoPlayRef.current || playerLoop || !currentVideo || currentVideo.isLive) {
      return;
    }
    const pool = [
      ...relatedVideos,
      ...rankingVideos.filter((v) => v.id !== currentVideo.id),
      ...videos.filter((v) => v.id !== currentVideo.id)
    ];
    const nextVideo = pool.find((v) => v && v.id !== currentVideo.id && !v.isLive);
    if (nextVideo) {
      setNextAutoPlayState({ nextVideo, secondsLeft: radioMode ? 1 : 3 });
    }
  };

  useEffect(() => {
    if (!nextAutoPlayState) return;
    if (nextAutoPlayState.secondsLeft <= 0) {
      const target = nextAutoPlayState.nextVideo;
      setNextAutoPlayState(null);
      playVideo(target, playerMode === 'custom' ? 'custom' : 'freemake');
      return;
    }
    const t = window.setTimeout(() => {
      setNextAutoPlayState((prev) => (prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : null));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [nextAutoPlayState]);

  const avgReview = reviews.length ? (reviews.reduce((a, b) => a + b.rating, 0) / reviews.length).toFixed(1) : '4.9';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 0. Site Intro */}
      {showSiteIntro && (
        <div id="site-intro" role="status" aria-label="ZERO-ニコ動 を読み込み中">
          <span className="site-intro-line" aria-hidden="true" />
          <div className="site-intro-mark">
            <span className="site-intro-icon">
              <span className="material-icons" style={{ fontSize: '38px', color: '#fff' }}>play_arrow</span>
            </span>
            <span className="site-intro-name">ZERO-ニコ動</span>
          </div>
        </div>
      )}

      {/* 1. Download Overlay */}
      <div id="dl-block-overlay" style={{ display: isDownloadingOverlay ? 'flex' : 'none' }}>
        <span className={`material-icons ${dlReadyFileUrl || dlJobError ? '' : 'spin-icon'}`} style={{ fontSize: '48px', color: dlJobError ? '#ff5555' : dlReadyFileUrl ? '#22cc88' : '#00d4ff' }}>
          {dlJobError ? 'error_outline' : dlReadyFileUrl ? 'check_circle' : 'download'}
        </span>
        <h2 style={{ margin: '10px 0 0' }}>
          {dlJobError ? 'ダウンロードエラー' : dlReadyFileUrl ? '保存の準備が完了しました！' : dlStageText}
        </h2>
        <p style={{ color: '#bbb', fontSize: '14px', marginTop: '8px', maxWidth: '380px', textAlign: 'center', lineHeight: 1.5 }}>
          {dlJobError
            ? dlJobError
            : dlReadyFileUrl
              ? '自動で保存が始まらない場合は下の「ファイルを保存」ボタンを押してください。'
              : '動画・音声データを直接取得してファイルを構築しています。このままお待ちください。'}
        </p>
        <div className="progress-bar-container">
          <div id="dl-progress-bar" style={{ width: `${dlProgress}%`, background: dlJobError ? '#ff5555' : dlReadyFileUrl ? '#22cc88' : undefined }}></div>
        </div>
        <p id="dl-progress-text" style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '12px', marginBottom: '4px' }}>
          {dlProgress}%
        </p>
        <p id="dl-progress-size" style={{ fontSize: '14px', color: '#aaa', margin: 0, fontWeight: 'bold' }}>
          {dlProgressSize}
        </p>
        <p id="dl-remaining-time">
          {dlReadyFileUrl
            ? dlReadyFileName
            : dlEtaText
              ? `残り時間: ${dlEtaText}${dlSpeedText ? ` ・ ${dlSpeedText}` : ''}`
              : dlProgress >= 100
                ? '完了'
                : '処理中...'}
        </p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {dlReadyFileUrl && (
            <a
              href={dlReadyFileUrl}
              download={dlReadyFileName}
              style={{
                padding: '10px 20px',
                background: '#0088cc',
                color: '#fff',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 'bold',
                fontSize: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span className="material-icons" style={{ fontSize: '18px' }}>save_alt</span>
              ファイルを保存
            </a>
          )}
          <button className="cancel-btn" onClick={handleCancelDownload}>
            {dlReadyFileUrl || dlJobError ? '閉じる' : 'キャンセル'}
          </button>
        </div>
      </div>

      {/* 2. Download Quality & Format Modal (Freemake-style) */}
      <div
        id="download-quality-dialog"
        className={`modal-backdrop ${isDownloadDialogOpen ? 'show' : ''}`}
        role="dialog"
      >
        <div className="modal-card download-quality-card">
          <h2 id="download-quality-title">保存形式・画質を選択</h2>
          <p style={{ margin: '0 0 12px', color: '#888', fontSize: '13px' }}>
            MP4 / iPhone用 / MP3音声 / WebM / MKV / AVI から選んで端末へ保存できます。
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
            {[
              { id: 'mp4', label: 'MP4', sub: '高画質標準' },
              { id: 'iphone', label: 'iPhone用', sub: 'iOS最適化' },
              { id: 'mp3', label: 'MP3', sub: '音声のみ' },
              { id: 'webm', label: 'WebM', sub: 'Web形式' },
              { id: 'mkv', label: 'MKV', sub: '高音質格納' },
              { id: 'avi', label: 'AVI', sub: '汎用変換' }
            ].map((fmt) => (
              <button
                key={fmt.id}
                type="button"
                onClick={() => setDownloadFormat(fmt.id)}
                style={{
                  padding: '8px 6px',
                  borderRadius: '8px',
                  border: '1px solid ' + (downloadFormat === fmt.id ? 'var(--accent)' : 'var(--border-color)'),
                  background: downloadFormat === fmt.id ? 'var(--accent-soft)' : 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: '13px', color: downloadFormat === fmt.id ? 'var(--accent-strong)' : 'var(--text-main)' }}>{fmt.label}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{fmt.sub}</div>
              </button>
            ))}
          </div>

          {downloadFormat !== 'mp3' && (
            <select
              id="download-quality-choice"
              value={downloadQuality}
              onChange={(e) => setDownloadQuality(e.target.value)}
              aria-label="保存画質"
            >
              <option value="2160">4K Ultra HD (2160p)</option>
              <option value="1080">1080p (Full HD 最高画質)</option>
              <option value="720">720p (HD 高画質)</option>
              <option value="480">480p (標準)</option>
              <option value="360">360p (軽量・高速)</option>
            </select>
          )}

          <label id="download-comment-option" className="download-comment-option">
            <input
              id="download-with-comments"
              type="checkbox"
              checked={downloadWithComments}
              onChange={(e) => setDownloadWithComments(e.target.checked)}
            />
            <span>
              ニコニコの表示コメント情報を関連付ける<br />
              <small style={{ color: '#888' }}>権利を持つ、または許可を得た動画だけで利用してください。</small>
            </span>
          </label>
          <div className="download-quality-actions">
            <button
              className="download-quality-button secondary"
              type="button"
              onClick={() => setIsDownloadDialogOpen(false)}
            >
              キャンセル
            </button>
            <button
              className="download-quality-button"
              type="button"
              onClick={handleStartDownload}
            >
              保存を開始
            </button>
          </div>
        </div>
      </div>

      {/* 3. Playlist Selection Dialog */}
      <div
        id="playlist-dialog"
        className={`modal-backdrop ${isPlaylistDialogOpen ? 'show' : ''}`}
        role="dialog"
      >
        <div className="modal-card playlist-dialog-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 id="playlist-dialog-title" style={{ margin: 0 }}>保存先再生リスト</h2>
            <button
              style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '18px' }}
              onClick={() => setIsPlaylistDialogOpen(false)}
            >
              ✕
            </button>
          </div>
          <p style={{ color: '#888', fontSize: '13px', margin: '8px 0 16px' }}>追加したい再生リストを選択してください。</p>
          <div id="playlist-destinations" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {playlists.length === 0 ? (
              <p style={{ color: '#888', fontSize: '13px' }}>まだ再生リストがありません。</p>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    if (currentVideo) {
                      addVideoToPlaylist(pl.id, currentVideo);
                      setPlaylists(getPlaylists());
                      setIsPlaylistDialogOpen(false);
                      showPlayerNotification(`「${pl.name}」に追加しました`);
                    }
                  }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-surface)',
                      color: 'var(--text-main)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span>{pl.name}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{pl.videos.length}本</span>
                  </button>
              ))
            )}
          </div>
          <button
            className="playlist-new-button"
            type="button"
            onClick={() => {
              const name = window.prompt('新しい再生リスト名を入力してください');
              if (name && name.trim()) {
                const updated = createPlaylist(name.trim());
                if (currentVideo) {
                  addVideoToPlaylist(updated[0].id, currentVideo);
                }
                setPlaylists(getPlaylists());
                setIsPlaylistDialogOpen(false);
              }
            }}
          >
            <span className="material-icons">add</span> 新しい再生リストを作成して追加
          </button>
        </div>
      </div>

      {/* 5. Login / Account Modal */}
      <div
        id="login-dialog"
        className={`modal-backdrop ${isLoginModalOpen ? 'show' : ''}`}
        role="dialog"
        onClick={() => setIsLoginModalOpen(false)}
      >
        <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ margin: 0 }}>{guestName ? `アカウント設定 (${guestName})` : 'ZERO-ニコ動 ログイン'}</h2>
            <button
              type="button"
              onClick={() => setIsLoginModalOpen(false)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
            >
              ✕
            </button>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            すべての動画・コメント・検索・ランキングはログイン不要でご利用いただけます。表示名を設定するとレビューやマイメニューに表示されます。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = guestNameDraft.trim();
              setGuestName(trimmed);
              safeStorage.setItem('zeroGuestName', trimmed);
              setIsLoginModalOpen(false);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <label htmlFor="guest-name-input" style={{ fontSize: '13px', fontWeight: 700 }}>
              ニックネーム（ローカル保存）
            </label>
            <input
              id="guest-name-input"
              className="zero-input"
              type="text"
              value={guestNameDraft}
              onChange={(e) => setGuestNameDraft(e.target.value)}
              placeholder="例: ニコニコ視聴者"
              maxLength={24}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
              {guestName && (
                <button
                  type="button"
                  className="zero-secondary-btn"
                  onClick={() => {
                    setGuestName('');
                    setGuestNameDraft('');
                    safeStorage.setItem('zeroGuestName', '');
                    setIsLoginModalOpen(false);
                  }}
                >
                  ログアウト
                </button>
              )}
              <button type="submit" className="zero-primary-btn">
                保存して適用
              </button>
            </div>
          </form>

          <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '16px', paddingTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              className="zero-secondary-btn"
              onClick={() => {
                setIsLoginModalOpen(false);
                switchView('settings');
              }}
            >
              設定を開く
            </button>
            <button
              type="button"
              className="zero-secondary-btn"
              onClick={() => {
                setIsLoginModalOpen(false);
                switchView('reviews');
              }}
            >
              サイト評価
            </button>
          </div>
        </div>
      </div>

      {/* ZERO-ニコ動 Header */}
      <header className="zero-header">
        <div className="zero-header-left">
          <button
            type="button"
            className="zero-menu-btn"
            onClick={() => setSidebarHidden(!sidebarHidden)}
            aria-label="メニューを開く"
            title="メニュー"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <button
            type="button"
            className="zero-logo"
            onClick={() => switchView('home')}
            aria-label="ZERO-ニコ動 ホーム"
          >
            <svg width="32" height="26" viewBox="0 0 36 30" aria-hidden="true">
              <g transform="translate(8, 23)">
                <rect x="0" y="-21" width="6" height="20" rx="3" fill="#22c55e" transform="rotate(-18)" />
                <rect x="0" y="-21" width="6" height="20" rx="3" fill="#eab308" transform="rotate(14)" />
                <rect x="0" y="-21" width="6" height="20" rx="3" fill="#3b82f6" transform="rotate(46)" />
                <rect x="0" y="-21" width="6" height="20" rx="3" fill="#ef4444" transform="rotate(78)" />
                <circle cx="2" cy="-2" r="2.2" fill="#1e293b" />
              </g>
            </svg>
            <span id="main-logo-text" className="zero-logo-text">ZERO-ニコ動</span>
          </button>
        </div>

        <div className="zero-header-right">
          <form
            className="zero-search-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
          >
            <button
              type="submit"
              className="zero-search-icon-btn"
              title="検索"
              aria-label="検索"
              disabled={isSearchingOnline}
            >
              {isSearchingOnline ? (
                <span className="material-icons spin-icon" style={{ fontSize: '20px' }}>sync</span>
              ) : (
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="10.5" cy="10.5" r="7" fill="#ffffff" fillOpacity="0.9" />
                  <line x1="15.8" y1="15.8" x2="21" y2="21" />
                </svg>
              )}
            </button>

            <div className="zero-search-input-wrap">
              <input
                type="text"
                id="searchInput"
                placeholder="動画名・ローマ字/ひらがな変換・sm番号・URL"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchFocused(true);
                }}
                onFocus={() => {
                  setIsSearchFocused(true);
                }}
                onBlur={() => {
                  setTimeout(() => setIsSearchFocused(false), 220);
                }}
                onKeyDown={(e) => {
                  if (!isSearchFocused || searchDropdownCandidates.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveConvertIdx((prev) => (prev + 1) % searchDropdownCandidates.length);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveConvertIdx((prev) => (prev <= 0 ? searchDropdownCandidates.length - 1 : prev - 1));
                  } else if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    const idx = activeConvertIdx >= 0 ? activeConvertIdx : 0;
                    const chosen = searchDropdownCandidates[idx];
                    if (chosen) {
                      setSearchQuery(chosen.text);
                      setActiveConvertIdx(-1);
                    }
                  } else if (e.key === 'Enter' && activeConvertIdx >= 0) {
                    const chosen = searchDropdownCandidates[activeConvertIdx];
                    if (chosen) {
                      e.preventDefault();
                      void handleSearch(chosen.text, 1, undefined, true);
                    }
                  } else if (e.key === 'Escape') {
                    setIsSearchFocused(false);
                    setActiveConvertIdx(-1);
                  }
                }}
              />
              {searchConvertEnabled && searchDropdownCandidates.length > 0 && (
                <button
                  type="button"
                  className="zero-search-kanji-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const idx = activeConvertIdx >= 0 ? activeConvertIdx : 0;
                    const chosen = searchDropdownCandidates[idx];
                    if (chosen) {
                      setSearchQuery(chosen.text);
                      setIsSearchFocused(true);
                      setActiveConvertIdx(idx);
                    }
                  }}
                  title="漢字・最適表記へ変換して入力欄に反映"
                >
                  漢字変換
                </button>
              )}
              {searchQuery && (
                <button
                  type="button"
                  className="zero-search-clear"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchPage(0);
                    setRemoteConvertCandidates([]);
                    setActiveConvertIdx(-1);
                  }}
                  title="クリア"
                  aria-label="検索文字をクリア"
                >
                  <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
                </button>
              )}

              {/* Live Search Conversion Popover (no search history) */}
              {isSearchFocused && searchConvertEnabled && searchQuery.trim().length > 0 && (searchDropdownCandidates.length > 0 || isFetchingConvert) && (
                <div className="search-popover-stack" onMouseDown={(e) => e.preventDefault()}>
                  <div className="search-convert-dropdown" role="listbox" aria-label="検索変換候補">
                    <div className="search-convert-header">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span className="material-icons" style={{ fontSize: '14px', color: 'var(--accent-strong)' }}>auto_fix_high</span>
                        <span>変換・検索候補 ({searchDropdownCandidates.length}件)</span>
                        {isFetchingConvert && <span className="search-convert-loading">漢字変換中...</span>}
                      </span>
                      <span style={{ fontSize: '10.5px', opacity: 0.75 }}>↑↓選択 / Tab入力</span>
                    </div>
                    {searchDropdownCandidates.map((cand, idx) => (
                      <div
                        key={`${cand.kind}:${cand.text}`}
                        role="option"
                        aria-selected={idx === activeConvertIdx}
                        className={`search-convert-item ${idx === activeConvertIdx ? 'active' : ''}`}
                        onMouseEnter={() => setActiveConvertIdx(idx)}
                        onClick={() => void handleSearch(cand.text, 1, undefined, true)}
                      >
                        <span className={`search-convert-badge ${cand.kind}`}>{cand.badge}</span>
                        <span className="search-convert-text">{cand.text}</span>
                        <button
                          type="button"
                          className="search-convert-insert-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchQuery(cand.text);
                            setActiveConvertIdx(-1);
                          }}
                          title="検索欄に入力"
                        >
                          入力
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="search-convert-raw-btn"
                      onClick={() => void handleSearch(searchQuery.trim(), 1, undefined, true)}
                    >
                      「{searchQuery.trim()}」のまま検索
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>

          <button
            type="button"
            className="zero-login-btn"
            onClick={() => setIsLoginModalOpen(true)}
          >
            {guestName || 'ログイン'}
          </button>
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="container">
        {/* Desktop Sidebar */}
        <aside className={`sidebar ${sidebarHidden ? 'hidden' : ''}`} id="sidebar">
          <div
            className={`sidebar-item ${currentView === 'home' ? 'active' : ''}`}
            id="nav-home"
            onClick={() => switchView('home')}
          >
            <span className="material-icons">home</span>
            <span>ホーム</span>
          </div>
          <div
            className={`sidebar-item ${currentView === 'history' ? 'active' : ''}`}
            id="nav-history"
            onClick={() => switchView('history')}
          >
            <span className="material-icons">history</span>
            <span>履歴</span>
          </div>
          <div
            className={`sidebar-item ${currentView === 'subscriptions' || currentView === 'library' ? 'active' : ''}`}
            id="nav-subscriptions"
            onClick={() => switchView('subscriptions')}
          >
            <span className="material-icons">subscriptions</span>
            <span>登録チャンネル</span>
            {favoriteLiveAlerts.length > 0 && (
              <span className="sidebar-live-badge" title="登録チャンネルが生放送中">
                LIVE {favoriteLiveAlerts.length}
              </span>
            )}
          </div>
          <div
            className={`sidebar-item ${currentView === 'playlists' ? 'active' : ''}`}
            id="nav-playlists"
            onClick={() => switchView('playlists')}
          >
            <span className="material-icons">playlist_play</span>
            <span>再生リスト</span>
          </div>
          <div
            className={`sidebar-item ${currentView === 'downloader' ? 'active' : ''}`}
            id="nav-downloader"
            onClick={() => switchView('downloader')}
          >
            <span className="material-icons">stream</span>
            <span>Freemake 再生/保存</span>
          </div>
          <div
            className={`sidebar-item ${currentView === 'nico-hub' ? 'active' : ''}`}
            id="nav-nico-hub"
            onClick={() => switchView('nico-hub')}
          >
            <span className="material-icons">sensors</span>
            <span>生放送・静画・大百科</span>
            {favoriteLiveAlerts.length > 0 && (
              <span className="sidebar-live-badge">
                配信中
              </span>
            )}
          </div>
          <div
            className={`sidebar-item ${currentView === 'settings' ? 'active' : ''}`}
            id="nav-settings"
            onClick={() => switchView('settings')}
          >
            <span className="material-icons">settings</span>
            <span>設定</span>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          <div className="content-area">
            {quotaBanner && (
              <div className="quota-fallback-banner" role="alert">
                <span className="material-icons">warning_amber</span>
                <div className="quota-fallback-text">
                  <strong>{quotaBanner}</strong>
                  <span>別の中継サーバーへ切り替えると復帰できる場合があります。</span>
                </div>
                <div className="quota-fallback-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const next = rerollAutoNode(autoNodeInfo.baseUrl);
                      setAutoNodeInfo(next);
                      const updated = { ...settings, apiRouteMethod: 'auto' as const };
                      setSettings(updated);
                      saveSettings(updated);
                      setApiRouteStatus(`自動選択（分散）: ${next.label}`);
                      setQuotaBanner(null);
                    }}
                  >
                    別サーバーへ切替
                  </button>
                  <button type="button" className="close-quota-btn" onClick={() => setQuotaBanner(null)}>
                    閉じる
                  </button>
                </div>
              </div>
            )}
            {/* 1. Home View */}
            <div id="home-view" className={`view ${currentView === 'home' ? 'active' : ''}`}>
              {/* Genre & Term tabs for Home Ranking */}
              <div className="zero-filter-row">
                <div className="zero-tabs-strip">
                  {[
                    { id: 'all', label: '総合' },
                    { id: 'game', label: 'ゲーム' },
                    { id: 'anime', label: 'アニメ' },
                    { id: 'vocaloid', label: 'ボーカロイド' },
                    { id: 'music_sound', label: '音楽・サウンド' },
                    { id: 'entertainment', label: 'エンタメ' },
                    { id: 'dance', label: '踊ってみた' },
                    { id: 'classics', label: '殿堂入り名作' }
                  ].map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`zero-tab-btn ${homeGenre === g.id ? 'active' : ''}`}
                      onClick={() => fetchRanking(g.id)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {homeGenre !== 'classics' && (
                    <div className="zero-tabs-strip">
                      {[
                        { id: 'hour', label: '毎時' },
                        { id: '24h', label: '24時間' },
                        { id: 'week', label: '週間' },
                        { id: 'month', label: '月間' },
                        { id: 'total', label: '合計' }
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`zero-tab-btn ${homeTerm === t.id ? 'active' : ''}`}
                          onClick={() => fetchRanking(homeGenre, t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="zero-secondary-btn"
                    onClick={() => openLiveSearch()}
                    style={{ padding: '6px 12px', fontSize: '12.5px', gap: '5px' }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                    <span>LIVE専用検索</span>
                  </button>
                </div>
              </div>

              {favoriteLiveAlerts.length > 0 && !liveAlertsDismissed && (
                <section className="live-alert-banner" aria-label="お気に入り生放送通知">
                  <div className="live-alert-header">
                    <div className="live-alert-title">
                      <span className="live-stream-dot" aria-hidden="true" />
                      <span>登録チャンネルが生放送中！（{favoriteLiveAlerts.length}件）</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        className="zero-secondary-btn"
                        style={{ padding: '4px 10px', fontSize: '11.5px' }}
                        onClick={() => switchView('subscriptions')}
                      >
                        登録一覧を見る
                      </button>
                      <button
                        type="button"
                        onClick={() => setLiveAlertsDismissed(true)}
                        aria-label="通知を閉じる"
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                      >
                        <span className="material-icons" style={{ fontSize: '18px' }}>close</span>
                      </button>
                    </div>
                  </div>
                  <div className="live-alert-chips">
                    {favoriteLiveAlerts.map((alert) => (
                      <button
                        key={alert.id}
                        type="button"
                        className="live-alert-chip"
                        onClick={() => void playLiveProgram(alert)}
                      >
                        <ThumbImg
                          src={alert.providerAvatar || alert.thumbnail}
                          alt={alert.providerName}
                          className="live-alert-chip-avatar"
                          thumbMethod={settings.thumbMethod}
                          apiRouteMethod={settings.apiRouteMethod}
                        />
                        <div className="live-alert-chip-meta">
                          <span className="live-alert-chip-name">配信中 · {alert.providerName}</span>
                          <span className="live-alert-chip-title">{alert.title}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {isLoadingRanking ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  <span className="material-icons spin-icon" style={{ fontSize: '36px', color: 'var(--accent)', marginBottom: '8px' }}>sync</span>
                  <p style={{ margin: 0 }}>
                    ニコニコ動画から最新ランキングを取得中...
                  </p>
                </div>
              ) : (
                <div id="home-results" className="video-grid">
                  {(homeGenre === 'classics' ? videos : (rankingVideos.length > 0 ? rankingVideos : videos)).map((video, idx) => (
                    <div key={`${video.id}-${idx}`} className="video-card-grid" onClick={() => playVideo(video)}>
                      <div className="video-card-thumb-wrap">
                        <ThumbImg
                          src={video.thumbnail}
                          alt={video.title}
                          loading="lazy"
                          thumbMethod={settings.thumbMethod}
                          apiRouteMethod={settings.apiRouteMethod}
                        />
                        <span className={`video-rank-tag ${idx < 3 ? 'top3' : ''}`}>
                          #{idx + 1}
                        </span>
                        <span className="video-duration-tag">
                          {video.duration}
                        </span>
                      </div>
                      <div className="video-card-body">
                        <h3>{video.title}</h3>
                        <p>
                          {video.channel} · {video.views.toLocaleString()}回視聴
                          {video.commentCount ? ` · コメ ${video.commentCount.toLocaleString()}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Search View */}
            <div id="search-view" className={`view ${currentView === 'search' ? 'active' : ''}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '20px' }}>
                  検索結果: <span style={{ color: 'var(--accent-strong)' }}>{searchQuery || 'すべての動画'}</span>
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label htmlFor="search-sort-select" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>並び替え:</label>
                  <select
                    id="search-sort-select"
                    value={searchSort}
                    onChange={(e) => {
                      const newSort = e.target.value;
                      setSearchSort(newSort);
                      if (searchQuery.trim()) {
                        handleSearch(searchQuery, 1, newSort);
                      }
                    }}
                    className="zero-input"
                    style={{ padding: '5px 10px', fontSize: '12px' }}
                  >
                    <option value="v">再生数が多い順</option>
                    <option value="f">投稿が新しい順</option>
                    <option value="r">コメントが多い順</option>
                    <option value="m">マイリストが多い順</option>
                  </select>
                  <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    {searchTotalCount > 0 ? searchTotalCount.toLocaleString() : searchResults.length}件
                  </span>
                  <button
                    type="button"
                    className="zero-secondary-btn"
                    onClick={() => openLiveSearch(searchQuery)}
                    style={{ padding: '5px 10px', fontSize: '12px', gap: '5px' }}
                  >
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                    <span>{searchQuery.trim() ? `「${searchQuery.trim()}」の放送中LIVEを検索` : 'LIVE専用検索へ'}</span>
                  </button>
                </div>
              </div>

              {searchConversion && (searchConversion.wasConverted || searchConversion.alternatives.length > 0) && (
                <div className="search-conversion-banner">
                  <div className="search-conversion-main">
                    <span className="material-icons" style={{ fontSize: '18px', color: 'var(--accent-strong)' }}>auto_fix_high</span>
                    <div>
                      {searchConversion.wasConverted ? (
                        <span>
                          検索変換: 「<strong>{searchConversion.raw}</strong>」→「<strong>{searchConversion.converted}</strong>」
                          {searchConversion.reason ? `（${searchConversion.reason}）` : ''}
                        </span>
                      ) : (
                        <span>関連候補キーワード:</span>
                      )}
                    </div>
                  </div>
                  <div className="search-conversion-chips">
                    {searchConversion.alternatives.map((alt) => (
                      <button
                        key={alt}
                        type="button"
                        className="search-conversion-chip"
                        onClick={() => void handleSearch(alt, 1, undefined, true)}
                      >
                        {alt} で検索
                      </button>
                    ))}
                    {searchConversion.wasConverted && (
                      <button
                        type="button"
                        className="search-conversion-chip secondary"
                        onClick={() => void handleSearch(searchConversion.raw, 1, undefined, true)}
                      >
                        「{searchConversion.raw}」のまま検索
                      </button>
                    )}
                  </div>
                </div>
              )}

              {onlineSearchError && (
                <div style={{ padding: '8px 12px', background: 'rgba(217, 119, 6, 0.14)', border: '1px solid #d97706', borderRadius: '8px', fontSize: '12px', color: 'var(--text-main)', marginBottom: '12px' }}>
                  {onlineSearchError}
                </div>
              )}

              {/* Popular search keywords */}
              <div className="zero-tabs-strip" style={{ marginBottom: '18px', width: 'fit-content', maxWidth: '100%' }}>
                {['ボカロ', '初音ミク', '東方', '実況', 'アニメ', '歌ってみた', 'MAD', 'ゲーム', 'sm9', 'sm1097445'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`zero-tab-btn ${searchQuery === tag ? 'active' : ''}`}
                    onClick={() => handleSearch(tag, 1)}
                  >
                    {tag}
                  </button>
                ))}
                {searchQuery && (
                  <button
                    type="button"
                    className="zero-tab-btn"
                    onClick={() => handleSearch('')}
                  >
                    リセット
                  </button>
                )}
              </div>

              {isSearchingOnline ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  <span className="material-icons spin-icon" style={{ fontSize: '36px', color: 'var(--accent)', marginBottom: '8px' }}>sync</span>
                  <p style={{ margin: 0 }}>
                    ニコニコ動画から動画を検索・取得中...
                  </p>
                </div>
              ) : (
                <div id="search-results" className="video-grid">
                  {(onlineSearchResults !== null ? onlineSearchResults : searchPageVideos).length === 0 ? (
                    <div className="zero-surface-box" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '44px 20px' }}>
                      <span className="material-icons" style={{ fontSize: '44px', color: 'var(--text-muted)', marginBottom: '10px' }}>search_off</span>
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>動画が見つかりませんでした</h3>
                      <p style={{ margin: '0 0 16px 0', fontSize: '13.5px', color: 'var(--text-muted)' }}>
                        「ボカロ」「初音ミク」「東方」「ゲーム」「アニメ」などのキーワードや、sm番号（例: sm9, sm1097445）でお試しください。
                      </p>
                      <button
                        type="button"
                        className="zero-primary-btn"
                        onClick={() => handleSearch('')}
                      >
                        全動画一覧を見る
                      </button>
                    </div>
                  ) : (
                    (onlineSearchResults !== null ? onlineSearchResults : searchPageVideos).map((video: Video, idx: number) => (
                      <div key={`${video.id}-${idx}`} className="video-card-grid" onClick={() => playVideo(video)}>
                        <div className="video-card-thumb-wrap">
                          <ThumbImg
                            src={video.thumbnail}
                            alt={video.title}
                            loading="lazy"
                            thumbMethod={settings.thumbMethod}
                            apiRouteMethod={settings.apiRouteMethod}
                          />
                          <span className="video-duration-tag">
                            {video.duration}
                          </span>
                        </div>
                        <div className="video-card-body">
                          <h3>{video.title}</h3>
                          <p>
                            {video.channel} · {video.views.toLocaleString()}回視聴
                            {video.commentCount ? ` · コメ ${video.commentCount.toLocaleString()}` : ''}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Multi-page pagination */}
              {onlineSearchResults !== null ? (
                <div id="search-pagination" className="search-pagination">
                  <button
                    id="search-prev"
                    type="button"
                    disabled={searchApiPage <= 1 || isSearchingOnline}
                    onClick={() => {
                      handleSearch(searchQuery, searchApiPage - 1);
                      window.scrollTo(0, 0);
                    }}
                  >
                    前のページ
                  </button>
                  <span id="search-page-label" className="tabular-nums" style={{ fontWeight: 'bold' }}>
                    {searchApiPage} ページ目 {searchTotalCount > 0 ? `(全 ${searchTotalCount.toLocaleString()} 件中)` : ''}
                  </span>
                  <button
                    id="search-next"
                    type="button"
                    disabled={!searchHasNext || isSearchingOnline}
                    onClick={() => {
                      handleSearch(searchQuery, searchApiPage + 1);
                      window.scrollTo(0, 0);
                    }}
                  >
                    次のページ
                  </button>
                </div>
              ) : (
                searchResults.length > 12 && (
                  <div id="search-pagination" className="search-pagination">
                    <button
                      id="search-prev"
                      type="button"
                      disabled={searchPage === 0}
                      onClick={() => {
                        setSearchPage((p) => Math.max(0, p - 1));
                        window.scrollTo(0, 0);
                      }}
                    >
                      前のページ
                    </button>
                    <span id="search-page-label" className="tabular-nums">{searchPage + 1} / {Math.ceil(searchResults.length / 12)} ページ</span>
                    <button
                      id="search-next"
                      type="button"
                      disabled={(searchPage + 1) * 12 >= searchResults.length}
                      onClick={() => {
                        setSearchPage((p) => p + 1);
                        window.scrollTo(0, 0);
                      }}
                    >
                      次のページ
                    </button>
                  </div>
                )
              )}
            </div>

            {/* 3. History View */}
            <div id="history-view" className={`view ${currentView === 'history' ? 'active' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0 }}>再生履歴</h2>
                {playHistory.length > 0 && (
                  <button
                    className="zero-secondary-btn"
                    onClick={() => {
                      if (window.confirm('再生履歴をすべて消去しますか？')) {
                        clearPlayHistory();
                        setPlayHistory([]);
                      }
                    }}
                  >
                    履歴を削除
                  </button>
                )}
              </div>
              <div id="history-results" className="video-grid">
                {playHistory.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                    再生履歴はありません。動画を視聴すると自動でここに記録されます。
                  </div>
                ) : (
                  playHistory.map((video) => (
                    <div key={video.id} className="video-card-grid" onClick={() => playVideo(video)}>
                      <div className="video-card-thumb-wrap">
                        <ThumbImg
                          src={video.thumbnail}
                          alt={video.title}
                          loading="lazy"
                          thumbMethod={settings.thumbMethod}
                          apiRouteMethod={settings.apiRouteMethod}
                        />
                        <span className="video-duration-tag">{video.duration}</span>
                      </div>
                      <div className="video-card-body">
                        <h3>{video.title}</h3>
                        <p>{video.channel} · {video.views.toLocaleString()}回視聴</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 4. Subscriptions View */}
            <div id="subscriptions-view" className={`view ${currentView === 'subscriptions' || currentView === 'library' ? 'active' : ''}`}>
              <div className="library-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                  <h2 style={{ margin: 0 }}>登録チャンネル</h2>
                  {subscriptions.length > 0 && (
                    <button
                      type="button"
                      className="zero-secondary-btn"
                      onClick={() => void checkFavoriteLiveAlerts(subscriptions)}
                    >
                      <span className="material-icons" style={{ fontSize: '17px' }}>sensors</span>
                      生放送状況を再確認
                    </button>
                  )}
                </div>
                <div id="subscriptions-list" className="library-list subscription-list">
                  {subscriptions.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', padding: '24px 0', color: '#888' }}>
                      登録チャンネルはありません。動画再生画面の「登録」ボタンからお気に入りのチャンネルを登録できます。
                    </div>
                  ) : (
                    subscriptions.map((sub) => {
                      const subUid = sub.userId || sub.url.match(/\/user\/(\d+)/)?.[1] || '';
                      const liveMatch = favoriteLiveAlerts.find(
                        (a) =>
                          a.matchedSubUrl === sub.url ||
                          (subUid && a.providerId === subUid) ||
                          (sub.name && a.providerName.trim().toLowerCase() === sub.name.trim().toLowerCase())
                      );
                      return (
                        <article
                          key={sub.url}
                          className="library-card"
                          style={liveMatch ? { borderColor: '#dc2626', boxShadow: '0 0 0 1px rgba(220, 38, 38, 0.2)' } : undefined}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                            <div
                              className="channel-avatar"
                              style={{ backgroundImage: sub.avatar ? `url('${sub.avatar}')` : 'none', width: '42px', height: '42px' }}
                            >
                              {!sub.avatar && (sub.name[0] || 'チ')}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <h3 style={{ margin: 0, fontSize: '15px' }}>{sub.name}</h3>
                                {liveMatch && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 800, color: '#dc2626' }}>
                                    <span className="live-stream-dot" aria-hidden="true" />
                                    配信中！
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {liveMatch ? liveMatch.title : 'このサイト内で登録済み'}
                              </p>
                            </div>
                          </div>
                          <div className="library-card-actions">
                            {liveMatch && (
                              <button
                                type="button"
                                style={{ background: '#dc2626', color: '#ffffff', borderColor: '#dc2626' }}
                                onClick={() => void playLiveProgram(liveMatch)}
                              >
                                今すぐ視聴
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                void openChannelProfile({ url: sub.url, name: sub.name, avatar: sub.avatar, userId: subUid || undefined });
                              }}
                            >
                              チャンネルを開く
                            </button>
                            <button
                              className="library-remove"
                              type="button"
                              onClick={() => toggleSubscriptionState(sub)}
                            >
                              登録解除
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* 5. Playlists View */}
            <div id="playlists-view" className={`view ${currentView === 'playlists' ? 'active' : ''}`}>
              <div className="library-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0 }}>再生リスト</h2>
                  <button className="action-btn" type="button" onClick={handleCreatePlaylist}>
                    <span className="material-icons" style={{ fontSize: '18px' }}>add</span> 新規作成
                  </button>
                </div>
                <div id="playlists-list" className="library-list" style={{ marginTop: '16px' }}>
                  {playlists.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', padding: '24px 0', color: '#888' }}>
                      再生リストはありません。「新規作成」または動画再生画面の「リスト」ボタンから追加できます。
                    </div>
                  ) : (
                    playlists.map((pl, idx) => (
                      <article key={pl.id} className="library-card">
                        <h3>{pl.name}</h3>
                        <p>{pl.videos.length}本の動画</p>
                        <div className="library-card-actions">
                          <button
                            type="button"
                            onClick={() => setSelectedPlaylistIndex(selectedPlaylistIndex === idx ? null : idx)}
                          >
                            {selectedPlaylistIndex === idx ? '閉じる' : '開く'}
                          </button>
                          <button
                            className="library-remove"
                            type="button"
                            onClick={() => {
                              if (window.confirm(`「${pl.name}」を削除しますか？`)) {
                                deletePlaylist(pl.id);
                                setPlaylists(getPlaylists());
                              }
                            }}
                          >
                            削除
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>

                {selectedPlaylistIndex !== null && playlists[selectedPlaylistIndex] && (
                  <div id="playlist-videos" style={{ marginTop: '24px' }}>
                    <h3 style={{ margin: '0 0 16px' }}>{playlists[selectedPlaylistIndex].name}（{playlists[selectedPlaylistIndex].videos.length}本）</h3>
                    {playlists[selectedPlaylistIndex].videos.length === 0 ? (
                      <p style={{ color: '#888' }}>このリストにはまだ動画が登録されていません。</p>
                    ) : (
                      <div className="video-grid">
                        {playlists[selectedPlaylistIndex].videos.map((v) => (
                          <div key={v.id} className="video-card-grid" onClick={() => playVideo(v)}>
                            <div className="video-card-thumb-wrap">
                              <ThumbImg
                                src={v.thumbnail}
                                alt={v.title}
                                loading="lazy"
                                thumbMethod={settings.thumbMethod}
                                apiRouteMethod={settings.apiRouteMethod}
                              />
                              <span className="video-duration-tag">{v.duration}</span>
                            </div>
                            <div className="video-card-body">
                              <h3>{v.title}</h3>
                              <p>{v.channel}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 6. Channel / User Profile View (nvapi) */}
            <div id="channel-view" className={`view ${currentView === 'channel' ? 'active' : ''}`}>
              {channelData && (
                <div className="channel-page">
                  <div className="channel-page-header">
                    <div
                      className="channel-avatar"
                      style={{
                        width: '80px',
                        height: '80px',
                        backgroundImage: (channelProfile?.user?.avatar || channelData.avatar)
                          ? `url('${channelProfile?.user?.avatar || channelData.avatar}')`
                          : 'none',
                        fontSize: '28px'
                      }}
                      id="ch-avatar-main"
                    >
                      {!(channelProfile?.user?.avatar || channelData.avatar) && (channelData.name[0] || 'チ')}
                    </div>
                    <div>
                      <h2 id="channel-view-title" style={{ margin: 0, fontSize: '24px' }}>
                        {channelProfile?.user?.nickname || channelData.name}
                      </h2>
                      <p id="channel-view-meta" className="channel-page-meta">
                        {channelProfile?.user ? (
                          <>
                            Lv.{channelProfile.user.level} ・ フォロワー {channelProfile.user.followerCount.toLocaleString()}人 ・ フォロー {channelProfile.user.followeeCount.toLocaleString()}人 ・ 投稿動画 {(channelProfile.totalVideos ?? channelProfile.videos.length).toLocaleString()}本
                          </>
                        ) : (
                          <>投稿動画 {videos.filter((v) => v.channel === channelData.name).length || 1}本</>
                        )}
                      </p>
                    </div>
                    <button
                      id="channel-subscribe-button"
                      className={`subscribe-button ${isSubscribed(channelData.url, channelData.name) ? 'subscribed' : ''}`}
                      type="button"
                      onClick={() => toggleSubscriptionState(channelData)}
                    >
                      {isSubscribed(channelData.url, channelData.name) ? '登録済み' : '登録'}
                    </button>
                    <p id="channel-view-description" className="channel-page-description">
                      {channelProfile?.user?.description || 'ニコニコ動画の投稿者・チャンネルページです。'}
                    </p>
                  </div>

                  <div className="channel-tabs" role="tablist">
                    {[
                      { key: 'home', label: '投稿動画' },
                      { key: 'mylists', label: `マイリスト・シリーズ (${(channelProfile?.mylists?.length || 0) + (channelProfile?.series?.length || 0)})` },
                      { key: 'about', label: 'プロフィール' }
                    ].map((t) => (
                      <button
                        key={t.key}
                        className={`channel-tab ${channelActiveTab === t.key ? 'active' : ''}`}
                        type="button"
                        onClick={() => setChannelActiveTab(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="channel-tab-panel">
                    {channelProfile?.loading ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                        <span className="material-icons spin-icon" style={{ fontSize: '32px', color: '#0088cc' }}>sync</span>
                        <p>ユーザー情報を読み込み中...</p>
                      </div>
                    ) : channelActiveTab === 'about' ? (
                      <div className="zero-surface-box">
                        <h4 style={{ margin: '0 0 8px' }}>ユーザー / チャンネル情報</h4>
                        <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>
                          名前: {channelProfile?.user?.nickname || channelData.name}
                          {'\n'}URL: {channelData.url || 'ニコニコ動画'}
                          {channelProfile?.user ? `\nレベル: Lv.${channelProfile.user.level} (${channelProfile.user.isPremium ? 'プレミアム会員' : '一般会員'})` : ''}
                          {'\n'}自己紹介: {channelProfile?.user?.description || '自己紹介はありません。'}
                        </p>
                      </div>
                    ) : channelActiveTab === 'mylists' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {channelProfile?.series && channelProfile.series.length > 0 && (
                          <div>
                            <h4 style={{ margin: '0 0 10px' }}>公開シリーズ</h4>
                            <div className="library-list">
                              {channelProfile.series.map((s) => (
                                <article key={s.id} className="library-card">
                                  <h3>{s.title}</h3>
                                  <p>{s.itemsCount}本の動画</p>
                                  <a
                                    href={`https://www.nicovideo.jp/series/${s.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'var(--accent-strong)', fontSize: '12px', textDecoration: 'none' }}
                                  >
                                    シリーズをニコニコで見る ↗
                                  </a>
                                </article>
                              ))}
                            </div>
                          </div>
                        )}
                        {channelProfile?.mylists && channelProfile.mylists.length > 0 ? (
                          <div>
                            <h4 style={{ margin: '0 0 10px' }}>公開マイリスト</h4>
                            <div className="library-list">
                              {channelProfile.mylists.map((m) => (
                                <article key={m.id} className="library-card">
                                  <h3>{m.name}</h3>
                                  <p>{m.itemsCount}本</p>
                                  <div className="library-card-actions">
                                    <button
                                      type="button"
                                    onClick={async () => {
                                        try {
                                          const r = await apiCall(`/api/nico/mylist/${m.id}`);
                                          const d = await r.json();
                                          if (d.success) {
                                            setChannelProfile((prev) => prev ? { ...prev, selectedMylistName: d.name, selectedMylistVideos: d.items || [] } : prev);
                                          }
                                        } catch {}
                                      }}
                                    >
                                      リストを開く
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-muted)' }}>公開マイリストはありません。</p>
                        )}
                        {channelProfile?.selectedMylistVideos && (
                          <div style={{ marginTop: '10px' }}>
                            <h4 style={{ margin: '0 0 10px' }}>{channelProfile.selectedMylistName}（{channelProfile.selectedMylistVideos.length}本）</h4>
                            <div className="video-grid">
                              {channelProfile.selectedMylistVideos.map((v) => (
                                <div key={v.id} className="video-card-grid" onClick={() => playVideo(v)}>
                                  <div className="video-card-thumb-wrap">
                                    <ThumbImg
                                      src={v.thumbnail}
                                      alt={v.title}
                                      loading="lazy"
                                      thumbMethod={settings.thumbMethod}
                                      apiRouteMethod={settings.apiRouteMethod}
                                    />
                                    <span className="video-duration-tag">{v.duration}</span>
                                  </div>
                                  <div className="video-card-body">
                                    <h3>{v.title}</h3>
                                    <p>{v.views.toLocaleString()}回視聴</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div id="channel-results" className="video-grid">
                        {(channelProfile && channelProfile.videos.length > 0
                          ? channelProfile.videos
                          : videos.filter((v) => v.channel === channelData.name)
                        ).map((video) => (
                          <div key={video.id} className="video-card-grid" onClick={() => playVideo(video)}>
                            <div className="video-card-thumb-wrap">
                              <ThumbImg
                                src={video.thumbnail}
                                alt={video.title}
                                loading="lazy"
                                thumbMethod={settings.thumbMethod}
                                apiRouteMethod={settings.apiRouteMethod}
                              />
                              <span className="video-duration-tag">{video.duration}</span>
                            </div>
                            <div className="video-card-body">
                              <h3>{video.title}</h3>
                              <p>{video.channel} · {video.views.toLocaleString()}回視聴</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 6.2 Niconico Hub (Live / Seiga / Dic / Jikkyo) */}
            <div id="nico-hub-view" className={`view ${currentView === 'nico-hub' ? 'active' : ''}`}>
              <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <h2 style={{ margin: 0, fontSize: '21px' }}>ニコニコ生放送・静画・大百科・実況過去ログ</h2>
                  <div className="zero-tabs-strip">
                    {[
                      { id: 'live', label: '生放送 (配信中)' },
                      { id: 'seiga', label: '静画 (im番号)' },
                      { id: 'dic', label: '大百科' },
                      { id: 'jikkyo', label: '実況過去ログ' }
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`zero-tab-btn ${nicoHubTab === t.id ? 'active' : ''}`}
                        onClick={() => {
                          setNicoHubTab(t.id as any);
                          if (t.id === 'live' && livePrograms.length === 0) void loadNicoLivePrograms();
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {nicoHubTab === 'live' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Dedicated ON_AIR Live Search Bar */}
                    <div className="zero-surface-box" style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.2)' }} />
                          <strong style={{ fontSize: '15px' }}>LIVEやってるの専用検索（現在放送中のみ）</strong>
                        </div>
                        <span className="tabular-nums" style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                          {isLoadingLive
                            ? '検索中...'
                            : liveSearchQuery.trim()
                              ? `「${liveSearchQuery.trim()}」で放送中 ${liveTotalCount.toLocaleString()}件`
                              : `現在放送中 ${(liveTotalCount || livePrograms.length).toLocaleString()}件`}
                        </span>
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const trimmed = liveSearchQuery.trim();
                          const directLv = trimmed.match(/^(?:https?:\/\/live\.nicovideo\.jp\/watch\/)?(lv\d+)(?:[?#].*)?$/i);
                          if (directLv) {
                            const lvId = directLv[1].toLowerCase();
                            void playLiveProgram({ id: lvId, url: `https://live.nicovideo.jp/watch/${lvId}` });
                            return;
                          }
                          void loadNicoLivePrograms({ q: trimmed, sort: liveSearchSort, tab: liveCategoryTab });
                        }}
                        style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}
                      >
                        <div style={{ position: 'relative', flex: '1 1 240px', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="text"
                            className="zero-input"
                            value={liveSearchQuery}
                            onChange={(e) => setLiveSearchQuery(e.target.value)}
                            placeholder="今やってるLIVEをキーワード検索（例: 雑談 / ゲーム / 歌枠 / マイクラ / 実況 / lv番号）"
                            style={{ width: '100%', paddingRight: liveSearchQuery ? '34px' : undefined }}
                          />
                          {liveSearchQuery && (
                            <button
                              type="button"
                              aria-label="LIVE検索文字をクリア"
                              onClick={() => {
                                setLiveSearchQuery('');
                                void loadNicoLivePrograms({ q: '', sort: liveSearchSort, tab: liveCategoryTab });
                              }}
                              style={{
                                position: 'absolute',
                                right: '8px',
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                padding: '2px'
                              }}
                            >
                              <span className="material-icons" style={{ fontSize: '17px' }}>close</span>
                            </button>
                          )}
                        </div>
                        <button type="submit" className="zero-primary-btn" disabled={isLoadingLive}>
                          <span className="material-icons" style={{ fontSize: '17px' }}>search</span>
                          <span>LIVE検索</span>
                        </button>
                        <button
                          type="button"
                          className="zero-secondary-btn"
                          onClick={() => void loadNicoLivePrograms()}
                          disabled={isLoadingLive}
                        >
                          <span className={`material-icons ${isLoadingLive ? 'spin-icon' : ''}`} style={{ fontSize: '17px' }}>refresh</span>
                          <span>更新</span>
                        </button>
                      </form>

                      {/* Quick Live Keyword Chips */}
                      <div className="zero-tabs-strip" style={{ marginBottom: '10px' }}>
                        {[
                          { label: 'すべて (人気順)', q: '' },
                          { label: '雑談', q: '雑談' },
                          { label: 'ゲーム', q: 'ゲーム' },
                          { label: '歌枠', q: '歌' },
                          { label: 'お絵描き', q: '絵' },
                          { label: '外配信', q: '外配信' },
                          { label: 'ニコニコ実況', q: 'ニコニコ実況' },
                          { label: '競馬・麻雀', q: '麻雀' },
                          { label: '作業', q: '作業' }
                        ].map((chip) => {
                          const isActive = liveSearchQuery.trim() === chip.q;
                          return (
                            <button
                              key={chip.label}
                              type="button"
                              className={`zero-tab-btn ${isActive ? 'active' : ''}`}
                              onClick={() => {
                                setLiveSearchQuery(chip.q);
                                void loadNicoLivePrograms({ q: chip.q, sort: liveSearchSort, tab: liveCategoryTab });
                              }}
                            >
                              {chip.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Sort & Category Filter Row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        {!liveSearchQuery.trim() ? (
                          <div className="zero-tabs-strip">
                            {[
                              { id: 'all', label: '全ジャンル' },
                              { id: 'common', label: '一般' },
                              { id: 'game', label: 'ゲーム' },
                              { id: 'try', label: 'やってみた' },
                              { id: 'face', label: '顔出し' },
                              { id: 'official', label: '公式' }
                            ].map((cat) => (
                              <button
                                key={cat.id}
                                type="button"
                                className={`zero-tab-btn ${liveCategoryTab === cat.id ? 'active' : ''}`}
                                onClick={() => {
                                  const nextTab = cat.id as typeof liveCategoryTab;
                                  setLiveCategoryTab(nextTab);
                                  void loadNicoLivePrograms({ q: '', sort: liveSearchSort, tab: nextTab });
                                }}
                              >
                                {cat.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            現在放送中（ON_AIR）の番組のみを表示中
                          </span>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <label htmlFor="live-sort-select" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>並び替え:</label>
                          <select
                            id="live-sort-select"
                            value={liveSearchSort}
                            onChange={(e) => {
                              const nextSort = e.target.value as typeof liveSearchSort;
                              setLiveSearchSort(nextSort);
                              void loadNicoLivePrograms({ q: liveSearchQuery, sort: nextSort, tab: liveCategoryTab });
                            }}
                            className="zero-input"
                            style={{ padding: '5px 10px', fontSize: '12px' }}
                          >
                            <option value="viewCountDesc">来場者数が多い順</option>
                            <option value="commentCountDesc">コメントが多い順</option>
                            <option value="recentDesc">配信開始が新しい順</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {liveSearchError && (
                      <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(220, 38, 38, 0.1)', border: '1px solid #dc2626', color: '#dc2626', fontSize: '13px' }}>
                        {liveSearchError}
                      </div>
                    )}

                    {isLoadingLive ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <span className="material-icons spin-icon" style={{ fontSize: '32px', color: 'var(--accent)' }}>sync</span>
                        <p>{liveSearchQuery.trim() ? `「${liveSearchQuery.trim()}」の放送中LIVEを検索中...` : '放送中のLIVE一覧を取得中...'}</p>
                      </div>
                    ) : livePrograms.length === 0 ? (
                      <div className="zero-surface-box" style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <span className="material-icons" style={{ fontSize: '40px', color: 'var(--text-muted)', marginBottom: '8px' }}>live_tv</span>
                        <h3 style={{ margin: '0 0 6px', fontSize: '16px' }}>
                          {liveSearchQuery.trim()
                            ? `「${liveSearchQuery.trim()}」で現在放送中のLIVEは見つかりませんでした`
                            : '現在放送中のLIVEが見つかりませんでした'}
                        </h3>
                        <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)' }}>
                          別のキーワードを試すか、すべての放送中LIVE一覧を表示してください。
                        </p>
                        {liveSearchQuery.trim() && (
                          <button
                            type="button"
                            className="zero-primary-btn"
                            onClick={() => {
                              setLiveSearchQuery('');
                              void loadNicoLivePrograms({ q: '', sort: liveSearchSort, tab: liveCategoryTab });
                            }}
                          >
                            すべての放送中LIVEを表示
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="video-grid">
                        {livePrograms.map((p) => {
                          const elapsed = formatLiveElapsed(p.beginTime);
                          return (
                            <div
                              key={p.id}
                              className="video-card-grid"
                              onClick={() => void playLiveProgram(p)}
                            >
                              <div className="video-card-thumb-wrap">
                                <ThumbImg
                                  src={p.thumbnail}
                                  alt={p.title}
                                  loading="lazy"
                                  thumbMethod={settings.thumbMethod}
                                  apiRouteMethod={settings.apiRouteMethod}
                                />
                                <span className="video-rank-tag top3">
                                  LIVE
                                </span>
                                {elapsed && (
                                  <span className="video-duration-tag">
                                    {elapsed}
                                  </span>
                                )}
                              </div>
                              <div className="video-card-body">
                                <h3>{p.title}</h3>
                                <p>{p.providerName} · 来場 {p.watchCount.toLocaleString()} · コメ {p.commentCount.toLocaleString()}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {nicoHubTab === 'seiga' && (
                  <div className="zero-surface-box">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setSeigaLoading(true);
                        setSeigaError(null);
                        try {
                          const r = await apiCall(`/api/nico/seiga/${encodeURIComponent(seigaInput.trim())}`);
                          const d = await r.json();
                          if (!d.success) throw new Error(d.error || '取得失敗');
                          setSeigaResult(d.illust);
                        } catch (err: any) {
                          setSeigaError(err?.message || '取得に失敗しました');
                          setSeigaResult(null);
                        } finally {
                          setSeigaLoading(false);
                        }
                      }}
                      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}
                    >
                      <input
                        type="text"
                        className="zero-input"
                        value={seigaInput}
                        onChange={(e) => setSeigaInput(e.target.value)}
                        placeholder="静画IDを入力（例: im10000000）"
                        style={{ flex: '1 1 220px' }}
                      />
                      <button type="submit" disabled={seigaLoading} className="zero-primary-btn">
                        {seigaLoading ? '取得中...' : '静画情報を取得'}
                      </button>
                    </form>
                    {seigaError && <p style={{ color: '#dc2626', fontSize: '13px' }}>{seigaError}</p>}
                    {seigaResult && (
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <ThumbImg
                          src={seigaResult.thumbnailUrl}
                          alt={seigaResult.title}
                          thumbMethod={settings.thumbMethod}
                          apiRouteMethod={settings.apiRouteMethod}
                          style={{ maxWidth: '240px', borderRadius: '8px', background: '#000' }}
                        />
                        <div style={{ flex: '1 1 240px' }}>
                          <h3 style={{ margin: '0 0 6px' }}>{seigaResult.title}</h3>
                          <p className="tabular-nums" style={{ margin: '0 0 8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                            閲覧 {seigaResult.viewCount.toLocaleString()} · コメ {seigaResult.commentCount.toLocaleString()} · クリップ {seigaResult.clipCount.toLocaleString()}
                          </p>
                          <p style={{ margin: '0 0 12px', color: 'var(--text-main)', fontSize: '13px', whiteSpace: 'pre-wrap' }}>{seigaResult.description}</p>
                          <a href={seigaResult.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-strong)', fontSize: '13px', fontWeight: 600 }}>
                            ニコニコ静画で開く ↗
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {nicoHubTab === 'dic' && (
                  <div className="zero-surface-box">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setDicLoading(true);
                        setDicError(null);
                        try {
                          const r = await apiCall(`/api/nico/dic/${encodeURIComponent(dicInput.trim())}`);
                          const d = await r.json();
                          if (!d.success) throw new Error(d.error || '取得失敗');
                          setDicResult(d);
                        } catch (err: any) {
                          setDicError(err?.message || '取得に失敗しました');
                          setDicResult(null);
                        } finally {
                          setDicLoading(false);
                        }
                      }}
                      style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}
                    >
                      <input
                        type="text"
                        className="zero-input"
                        value={dicInput}
                        onChange={(e) => setDicInput(e.target.value)}
                        placeholder="大百科の単語を入力（例: 初音ミク, 陰陽師）"
                        style={{ flex: '1 1 220px' }}
                      />
                      <button type="submit" disabled={dicLoading} className="zero-primary-btn">
                        {dicLoading ? '検索中...' : '大百科を読む'}
                      </button>
                    </form>
                    {dicError && <p style={{ color: '#dc2626', fontSize: '13px' }}>{dicError}</p>}
                    {dicResult && (
                      <div>
                        <h3 style={{ margin: '0 0 8px' }}>{dicResult.title}</h3>
                        <p style={{ margin: '0 0 12px', color: 'var(--text-main)', fontSize: '14px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{dicResult.summary}</p>
                        <a href={dicResult.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-strong)', fontSize: '13px', fontWeight: 600 }}>
                          ニコニコ大百科で全文を読む ↗
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {nicoHubTab === 'jikkyo' && (
                  <div className="zero-surface-box">
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
                      <select
                        value={jikkyoChannel}
                        onChange={(e) => setJikkyoChannel(e.target.value)}
                        className="zero-input"
                      >
                        <option value="jk1">jk1 (NHK総合)</option>
                        <option value="jk2">jk2 (NHK Eテレ)</option>
                        <option value="jk4">jk4 (日本テレビ)</option>
                        <option value="jk5">jk5 (テレビ朝日)</option>
                        <option value="jk6">jk6 (TBS)</option>
                        <option value="jk7">jk7 (テレビ東京)</option>
                        <option value="jk8">jk8 (フジテレビ)</option>
                        <option value="jk9">jk9 (TOKYO MX)</option>
                      </select>
                      <button
                        type="button"
                        disabled={jikkyoLoading}
                        className="zero-primary-btn"
                        onClick={async () => {
                          setJikkyoLoading(true);
                          setJikkyoError(null);
                          try {
                            const end = Math.floor(Date.now() / 1000);
                            const start = end - 1800;
                            const r = await apiCall(`/api/nico/jikkyo?channel=${encodeURIComponent(jikkyoChannel)}&starttime=${start}&endtime=${end}`);
                            const d = await r.json();
                            if (!d.success) throw new Error(d.error || '取得失敗');
                            setJikkyoLogs(d.packets || []);
                          } catch (err: any) {
                            setJikkyoError(err?.message || 'ログ取得に失敗しました');
                          } finally {
                            setJikkyoLoading(false);
                          }
                        }}
                      >
                        {jikkyoLoading ? '取得中...' : '直近30分の実況ログを取得'}
                      </button>
                    </div>
                    {jikkyoError && <p style={{ color: '#dc2626', fontSize: '13px' }}>{jikkyoError}</p>}
                    <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {jikkyoLogs.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>「取得」ボタンを押すと過去ログを読み込みます。</p>
                      ) : (
                        jikkyoLogs.map((l) => (
                          <div key={l.id} style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-page)', border: '1px solid var(--border-color)', fontSize: '13px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                            <span>{l.text}</span>
                            <span className="tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                              {l.date ? new Date(l.date * 1000).toLocaleTimeString('ja-JP') : ''}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 6.5 Freemake-style URL Video Downloader View */}
            <div id="downloader-view" className={`view ${currentView === 'downloader' ? 'active' : ''}`}>
              <div style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div className="zero-surface-box" style={{ padding: '22px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span className="material-icons" style={{ fontSize: '28px', color: 'var(--accent)' }}>download_for_offline</span>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '20px' }}>ストリーム再生 ＆ URLダウンローダー</h2>
                      <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                        URLを貼り付けて即座にストリーム再生、または MP4 / iPhone用 / MP3 / WebM / MKV / AVI に変換保存できます
                      </p>
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void inspectDownloaderUrl();
                    }}
                    style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}
                  >
                    <input
                      type="text"
                      className="zero-input"
                      value={dlUrlInput}
                      onChange={(e) => setDlUrlInput(e.target.value)}
                      placeholder="動画URLを貼り付け（例: https://www.nicovideo.jp/watch/sm40320938）"
                      style={{ flex: '1 1 260px' }}
                    />
                    <button
                      type="button"
                      className="zero-secondary-btn"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text) {
                            setDlUrlInput(text.trim());
                            void inspectDownloaderUrl(text.trim());
                          }
                        } catch {
                          setDlInspectError('クリップボードの読み取りが許可されませんでした。入力欄に直接貼り付けてください。');
                        }
                      }}
                    >
                      <span className="material-icons" style={{ fontSize: '16px' }}>content_paste</span>
                      URLを貼付
                    </button>
                    <button
                      type="button"
                      className="zero-secondary-btn"
                      onClick={() => {
                        const raw = dlUrlInput.trim();
                        if (!raw) {
                          setDlInspectError('ストリーム再生したい動画URLを入力してください。');
                          return;
                        }
                        const nicoMatch = raw.match(/\b((?:sm|so|nm)\d+)\b/i);
                        const streamVideo: Video = {
                          id: nicoMatch ? nicoMatch[1] : `stream-${Date.now()}`,
                          nicoId: nicoMatch ? nicoMatch[1] : undefined,
                          title: dlInspectedInfo?.title || raw,
                          channel: dlInspectedInfo?.uploader || 'Freemake ストリーム',
                          channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
                          thumbnail: dlInspectedInfo?.thumbnail || '',
                          duration: dlInspectedInfo?.durationString || '--:--',
                          views: 0,
                          url: /^https?:\/\//i.test(raw) ? raw : nicoMatch ? `https://www.nicovideo.jp/watch/${nicoMatch[1]}` : raw,
                          platform: 'niconico'
                        };
                        playVideo(streamVideo, 'freemake', downloadQuality === '2160' ? '1080' : downloadQuality);
                      }}
                    >
                      <span className="material-icons" style={{ fontSize: '18px', color: 'var(--accent)' }}>stream</span>
                      ストリーム再生
                    </button>
                    <button
                      type="submit"
                      disabled={dlInspecting}
                      className="zero-primary-btn"
                    >
                      <span className={`material-icons ${dlInspecting ? 'spin-icon' : ''}`} style={{ fontSize: '18px' }}>
                        {dlInspecting ? 'sync' : 'search'}
                      </span>
                      {dlInspecting ? '解析中...' : 'URLを解析'}
                    </button>
                  </form>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>サンプル:</span>
                    {[
                      { label: 'ミックスナッツ (sm40320938)', url: 'https://www.nicovideo.jp/watch/sm40320938' },
                      { label: 'レッツゴー！陰陽師 (sm9)', url: 'https://www.nicovideo.jp/watch/sm9' },
                      { label: '千本桜 (sm15630734)', url: 'https://www.nicovideo.jp/watch/sm15630734' }
                    ].map((sample) => (
                      <button
                        key={sample.url}
                        type="button"
                        className="zero-secondary-btn"
                        style={{ padding: '4px 10px', fontSize: '11.5px' }}
                        onClick={() => {
                          setDlUrlInput(sample.url);
                          void inspectDownloaderUrl(sample.url);
                        }}
                      >
                        {sample.label}
                      </button>
                    ))}
                  </div>

                  {dlInspectError && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(220, 38, 38, 0.1)', border: '1px solid #dc2626', color: '#dc2626', fontSize: '13px' }}>
                      {dlInspectError}
                    </div>
                  )}
                </div>

                {/* Inspected Video Preview & Format/Quality Picker */}
                {dlInspectedInfo && (
                  <div className="zero-surface-box" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {dlInspectedInfo.thumbnail && (
                        <ThumbImg
                          src={dlInspectedInfo.thumbnail}
                          alt={dlInspectedInfo.title}
                          thumbMethod={settings.thumbMethod}
                          apiRouteMethod={settings.apiRouteMethod}
                          style={{ width: '200px', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '8px', background: '#000' }}
                        />
                      )}
                      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                          {dlInspectedInfo.extractor} · 再生時間 {dlInspectedInfo.durationString}
                        </div>
                        <h3 style={{ margin: '0 0 6px', fontSize: '17px', lineHeight: 1.4 }}>{dlInspectedInfo.title}</h3>
                        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>投稿者: {dlInspectedInfo.uploader}</p>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>1. 変換・保存形式を選択</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: '8px' }}>
                        {[
                          { id: 'mp4', label: 'MP4', desc: '標準・高画質' },
                          { id: 'iphone', label: 'iPhone / iPad', desc: 'iOS最適化MP4' },
                          { id: 'android', label: 'Android用', desc: 'スマホMP4' },
                          { id: 'mp3', label: 'MP3', desc: dlInspectedInfo.audioSizeMb ? `音声 約${dlInspectedInfo.audioSizeMb}MB` : '音声のみ抽出' },
                          { id: 'webm', label: 'WebM', desc: '高圧縮動画' },
                          { id: 'mkv', label: 'MKV', desc: '劣化なし結合' },
                          { id: 'avi', label: 'AVI', desc: 'PC汎用形式' }
                        ].map((fmt) => (
                          <button
                            key={fmt.id}
                            type="button"
                            onClick={() => setDownloadFormat(fmt.id)}
                            style={{
                              padding: '10px 8px',
                              borderRadius: '8px',
                              border: '2px solid ' + (downloadFormat === fmt.id ? 'var(--accent)' : 'var(--border-color)'),
                              background: downloadFormat === fmt.id ? 'var(--accent-soft)' : 'var(--bg-page)',
                              color: 'var(--text-main)',
                              cursor: 'pointer',
                              textAlign: 'left'
                            }}
                          >
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: downloadFormat === fmt.id ? 'var(--accent-strong)' : 'var(--text-main)' }}>{fmt.label}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{fmt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {downloadFormat !== 'mp3' && (
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>2. 画質・解像度を選択</div>
                        <select
                          value={downloadQuality}
                          onChange={(e) => setDownloadQuality(e.target.value)}
                          className="zero-input"
                          style={{ width: '100%' }}
                        >
                          {dlInspectedInfo.qualities.map((q) => (
                            <option key={q.value} value={q.value}>
                              {q.label}{q.sizeMb ? ` (約 ${q.sizeMb} MB)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="zero-primary-btn"
                        style={{ flex: '1 1 220px', justifyContent: 'center', padding: '12px 18px', fontSize: '14px' }}
                        onClick={() => void startRealDownloadJob(
                          dlInspectedInfo.webpageUrl,
                          downloadFormat,
                          downloadQuality,
                          dlInspectedInfo.title
                        )}
                      >
                        <span className="material-icons">download</span>
                        {downloadFormat === 'mp3' ? 'MP3音声をダウンロード' : `${downloadFormat.toUpperCase()} (${downloadQuality}p) をダウンロード`}
                      </button>

                      <button
                        type="button"
                        className="zero-secondary-btn"
                        style={{ padding: '12px 18px' }}
                        onClick={() => {
                          const isNico = /^(sm|so|nm)\d+$/i.test(dlInspectedInfo.rawId);
                          const externalVideo: Video = {
                            id: dlInspectedInfo.rawId || dlInspectedInfo.id,
                            nicoId: isNico ? dlInspectedInfo.rawId : undefined,
                            title: dlInspectedInfo.title,
                            channel: dlInspectedInfo.uploader,
                            channelAvatar: 'https://img.nicoprofile.nimg.jp/usericon/defaults/blank.jpg',
                            thumbnail: dlInspectedInfo.thumbnail,
                            duration: dlInspectedInfo.durationString,
                            views: 1000,
                            url: dlInspectedInfo.webpageUrl,
                            platform: 'niconico'
                          };
                          playVideo(externalVideo, 'freemake', downloadQuality === '2160' ? '1080' : downloadQuality);
                        }}
                      >
                        <span className="material-icons" style={{ color: 'var(--accent)' }}>stream</span>
                        Freemakeストリーム再生 ({downloadQuality}p)
                      </button>
                    </div>
                  </div>
                )}

                {/* Recent Session Downloads */}
                {dlRecentJobs.length > 0 && (
                  <div className="zero-surface-box">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '12px' }}>
                      <h3 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="material-icons" style={{ fontSize: '18px', color: '#16a34a' }}>task_alt</span>
                        ダウンロード完了リスト ({dlRecentJobs.length}件)
                      </h3>
                      <button
                        type="button"
                        className="zero-secondary-btn"
                        style={{ padding: '4px 10px', fontSize: '11.5px' }}
                        onClick={() => void handleClearAllRecentJobs()}
                      >
                        履歴をすべて削除
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {dlRecentJobs.map((item) => (
                        <div
                          key={item.jobId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            background: 'var(--bg-page)',
                            border: '1px solid var(--border-color)'
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {item.format} · {item.quality}{item.sizeMb ? ` · ${item.sizeMb}` : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <a
                              href={item.fileUrl}
                              download={item.fileName}
                              className="zero-primary-btn"
                              style={{ padding: '6px 12px', fontSize: '12px', textDecoration: 'none' }}
                            >
                              保存
                            </a>
                            <button
                              type="button"
                              onClick={() => void handleDeleteRecentJob(item.jobId)}
                              aria-label={`${item.title} を履歴から削除`}
                              title="このジョブを履歴から削除"
                              className="zero-secondary-btn"
                              style={{ padding: '6px 10px', fontSize: '12px', color: '#dc2626' }}
                            >
                              <span className="material-icons" style={{ fontSize: '15px' }}>delete_outline</span>
                              削除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 7. Settings View */}
            <div id="settings-view" className={`view ${currentView === 'settings' ? 'active' : ''}`}>
              <div className="settings-card">
                <h2 style={{ marginTop: 0 }}>設定</h2>
                <p className="settings-description" style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px' }}>
                  見た目と動画再生の方法を、ここからいつでも変更できます。
                </p>

                <section className="settings-section">
                  <h3 className="settings-section-title"><span className="material-icons">palette</span>表示テーマ</h3>
                  <p className="settings-section-note">使いやすい画面の色を選びます。選択は次回も保存されます。</p>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="themeMode">テーマ</label>
                    <select
                      id="themeMode"
                      value={themeMode}
                      onChange={(e) => setThemeMode(e.target.value)}
                    >
                      <option value="light">ZERO-ニコ動（ライト・標準）</option>
                      <option value="dark">ダークモード</option>
                    </select>
                  </div>
                </section>

                <section className="settings-section">
                  <h3 className="settings-section-title"><span className="material-icons">play_circle</span>動画再生・検索・字幕</h3>
                  <p className="settings-section-note">自動再生、動画内字幕の挿入、検索キーワード自動変換を切り替えます。</p>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="nicoPlayMethod">再生方式</label>
                    <select
                      id="nicoPlayMethod"
                      value={settings.nicoPlayMethod}
                      onChange={(e) => {
                        const updated = { ...settings, nicoPlayMethod: e.target.value as any };
                        setSettings(updated);
                        saveSettings(updated);
                      }}
                    >
                      <option value="proxy">ストリーミングリンク (標準・安定)</option>
                      <option value="direct">直接リンク再生</option>
                    </select>
                  </div>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="autoPlayMode">動画の自動再生</label>
                    <select
                      id="autoPlayMode"
                      value={autoPlayEnabled ? 'on' : 'off'}
                      onChange={(e) => {
                        const next = e.target.value === 'on';
                        const updated = { ...settings, autoPlay: next };
                        setSettings(updated);
                        saveSettings(updated);
                      }}
                    >
                      <option value="on">ON (デフォルト・自動で再生開始)</option>
                      <option value="off">OFF (読み込み後に手動で再生)</option>
                    </select>
                  </div>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="subtitleMode">動画内字幕の挿入</label>
                    <select
                      id="subtitleMode"
                      value={subtitleEnabled ? 'on' : 'off'}
                      onChange={(e) => {
                        const next = e.target.value === 'on';
                        const updated = { ...settings, subtitleEnabled: next };
                        setSettings(updated);
                        saveSettings(updated);
                      }}
                    >
                      <option value="on">ON (デフォルト・コメント/VTT/SRTを字幕表示)</option>
                      <option value="off">OFF (字幕を非表示)</option>
                    </select>
                  </div>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="searchConvertMode">検索キーワード変換</label>
                    <select
                      id="searchConvertMode"
                      value={searchConvertEnabled ? 'on' : 'off'}
                      onChange={(e) => {
                        const next = e.target.value === 'on';
                        const updated = { ...settings, searchConvertEnabled: next };
                        setSettings(updated);
                        saveSettings(updated);
                      }}
                    >
                      <option value="on">ON (デフォルト・ローマ字/全角半角/略称を自動変換)</option>
                      <option value="off">OFF (入力した文字のまま検索)</option>
                    </select>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="api-list-header">
                    <div>
                      <h3 className="settings-section-title" style={{ marginBottom: '2px' }}>
                        <span className="material-icons">cloud</span>API中継サーバー一覧
                      </h3>
                      <p className="settings-section-note" style={{ marginBottom: 0 }}>
                        実測の応答速度と用途を比較して接続先を選択できます（Render 3台＋Cloudflare Worker＋Vercel API対応）。
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="api-retest-btn"
                        onClick={() => {
                          const next = rerollAutoNode(autoNodeInfo.baseUrl);
                          setAutoNodeInfo(next);
                          if (settings.apiRouteMethod === 'auto') {
                            setApiRouteStatus(`自動選択（分散）: ${next.label}`);
                          }
                          void measureApiServers();
                        }}
                        disabled={isMeasuringApis}
                      >
                        <span className="material-icons" style={{ fontSize: '15px' }}>shuffle</span>
                        分散先を変更
                      </button>
                      <button
                        type="button"
                        className="api-retest-btn"
                        onClick={() => void measureApiServers()}
                        disabled={isMeasuringApis}
                      >
                        <span className={`material-icons${isMeasuringApis ? ' spin-icon' : ''}`} style={{ fontSize: '15px' }}>refresh</span>
                        {isMeasuringApis ? '測定中...' : '速度を再測定'}
                      </button>
                    </div>
                  </div>

                  <div className="api-route-list" role="radiogroup" aria-label="API中継サーバー一覧">
                    {[
                      {
                        id: 'auto' as const,
                        name: '自動選択（分散）',
                        badge: '推奨・標準',
                        recommended: true,
                        urlLabel: `現在割り当て中: ${autoNodeInfo.label}`,
                        desc: '初回アクセス時にWorker/Render/Vercelへ分散し、1つの無料枠枯渇と混雑を防ぎます。',
                        typical: '目安 0.1〜0.6秒'
                      },
                      {
                        id: 'worker' as const,
                        name: 'Cloudflare Worker（東京エッジ中継）',
                        badge: '推奨・1.5秒共有キャッシュ',
                        recommended: true,
                        urlLabel: 'https://niconico-2.na8526130.workers.dev',
                        desc: '東京エッジ経由＋生放送HLS 1.5秒共有キャッシュ＋3台Render自動フェイルオーバー。',
                        typical: '目安 0.05〜0.50秒'
                      },
                      {
                        id: 'render' as const,
                        name: 'Render #1（常駐APIサーバー）',
                        badge: '座席維持対応',
                        recommended: false,
                        urlLabel: RENDER_SERVER_URLS[0],
                        desc: '1台目の常駐Renderノード。生放送WebSocketや動画ストリーム取得を担当します。',
                        typical: '稼働時 0.36〜1.2秒'
                      },
                      {
                        id: 'render2' as const,
                        name: 'Render #2（分散APIサーバー）',
                        badge: '追加ノード',
                        recommended: false,
                        urlLabel: RENDER_SERVER_URLS[1],
                        desc: '2台目のRenderノード。アクセス集中時や1台目満員時の分散先として動作します。',
                        typical: '稼働時 0.36〜1.2秒'
                      },
                      {
                        id: 'render3' as const,
                        name: 'Render #3（分散APIサーバー）',
                        badge: '追加ノード',
                        recommended: false,
                        urlLabel: RENDER_SERVER_URLS[2],
                        desc: '3台目のRenderノード。3台並列で生放送・検索・Base64サムネの負荷を分散します。',
                        typical: '稼働時 0.36〜1.2秒'
                      },
                      {
                        id: 'vercel' as const,
                        name: 'Vercel サーバーAPI',
                        badge: 'Serverless',
                        recommended: false,
                        urlLabel: getConfiguredVercelUrl() || '同一オリジン (/api/*) または下のURL欄で指定',
                        desc: 'VercelのServerless Functions (/api/*) をサーバーAPIとして使用します。外部Vercel URLの指定も可能です。',
                        typical: '目安 0.15〜0.80秒'
                      },
                      {
                        id: 'direct' as const,
                        name: 'メインサーバー直通',
                        badge: 'シンプル',
                        recommended: false,
                        urlLabel: '現在のサイト (/api/*)',
                        desc: '中継を挟まず現在のホストサーバーへ直接アクセスします。',
                        typical: '目安 0.1〜0.5秒'
                      }
                    ].map((srv) => {
                      const bench = apiBenchmarks[srv.id];
                      const isActive = settings.apiRouteMethod === srv.id;
                      const secText = bench?.loading
                        ? '測定中...'
                        : bench?.ok === false
                          ? '応答エラー'
                          : bench?.ms != null
                            ? `${(bench.ms / 1000).toFixed(2)}秒`
                            : '--';
                      const speedClass = bench?.loading || bench?.ms == null
                        ? ''
                        : !bench.ok
                          ? 'err'
                          : bench.ms <= 600
                            ? 'fast'
                            : 'slow';
                      return (
                        <button
                          key={srv.id}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          className={`api-route-card${isActive ? ' active' : ''}`}
                          onClick={() => {
                            const updated = { ...settings, apiRouteMethod: srv.id };
                            setSettings(updated);
                            saveSettings(updated);
                            if (srv.id === 'worker') setApiRouteStatus('Cloudflare Worker (niconico-2.na8526130.workers.dev) を使用中');
                            else if (srv.id === 'render') setApiRouteStatus(`Render #1 (${RENDER_SERVER_URLS[0]}) を使用中`);
                            else if (srv.id === 'render2') setApiRouteStatus(`Render #2 (${RENDER_SERVER_URLS[1]}) を使用中`);
                            else if (srv.id === 'render3') setApiRouteStatus(`Render #3 (${RENDER_SERVER_URLS[2]}) を使用中`);
                            else if (srv.id === 'vercel') setApiRouteStatus(`Vercel API (${getConfiguredVercelUrl() || '同一オリジン /api/*'}) を使用中`);
                            else if (srv.id === 'direct') setApiRouteStatus('メインサーバー直通を使用中');
                            else setApiRouteStatus(`自動選択（分散）: ${autoNodeInfo.label}`);
                          }}
                        >
                          <div className="api-route-main">
                            <div className="api-route-title-row">
                              <span className="api-route-name">{srv.name}</span>
                              <span className={`api-route-badge${srv.recommended ? ' recommended' : ''}`}>
                                {srv.badge}
                              </span>
                              {isActive && (
                                <span className="api-route-badge recommended">選択中</span>
                              )}
                            </div>
                            <div className="api-route-url">{srv.urlLabel}</div>
                            <div className="api-route-desc">{srv.desc}</div>
                          </div>
                          <div className="api-route-metrics">
                            <span className={`api-route-time ${speedClass}`}>{secText}</span>
                            <span className="api-route-sub">
                              {bench?.ms != null && !bench.loading ? `${bench.ms}ms` : bench?.loading ? '計測中' : '未測定'}
                            </span>
                            <span className="api-route-sub">{srv.typical}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="vercel-url-row">
                    <label className="setting-label" htmlFor="vercel-api-url-input" style={{ marginBottom: '4px' }}>
                      外部 Vercel API URL（任意・VercelにデプロイしたURL）
                    </label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <input
                        id="vercel-api-url-input"
                        type="url"
                        className="zero-input"
                        style={{ flex: '1 1 220px' }}
                        placeholder="https://your-app.vercel.app"
                        value={vercelUrlDraft}
                        onChange={(e) => setVercelUrlDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="zero-secondary-btn"
                        onClick={() => {
                          const cleaned = vercelUrlDraft.trim().replace(/\/+$/, '');
                          const updated = { ...settings, vercelApiUrl: cleaned };
                          setSettings(updated);
                          saveSettings(updated);
                          setAutoNodeInfo(getAutoNodeDisplayInfo());
                          if (settings.apiRouteMethod === 'vercel') {
                            setApiRouteStatus(`Vercel API (${cleaned || '同一オリジン /api/*'}) を使用中`);
                          }
                          void measureApiServers();
                        }}
                      >
                        Vercel URLを保存
                      </button>
                    </div>
                  </div>

                  <p id="api-route-status" className="api-route-status" aria-live="polite">{apiRouteStatus}</p>
                  <p className="setting-hint">※通常は「自動選択（分散）」または「Cloudflare Worker」がおすすめです。</p>

                  <div className="setting-group">
                    <label className="setting-label" htmlFor="thumbMethod">サムネイルの取得方法</label>
                    <select
                      id="thumbMethod"
                      value={settings.thumbMethod}
                      onChange={(e) => {
                        const updated = { ...settings, thumbMethod: e.target.value as any };
                        setSettings(updated);
                        saveSettings(updated);
                      }}
                    >
                      <option value="server">サーバー経由 Base64 (デフォルト・安全)</option>
                      <option value="direct">直接リンク (ブラウザ直読)</option>
                    </select>
                    <p className="setting-hint">「Base64」はサーバー経由で画像をData URL変換して取得し、直リンクのブロックやIP露出を防ぎます。</p>
                  </div>
                </section>
              </div>
            </div>

            {/* 8. Reviews View */}
            <div id="reviews-view" className={`view ${currentView === 'reviews' ? 'active' : ''}`}>
              <div className="reviews-card">
                <div className="site-rating-hero">
                  <h2>このサイトの評価</h2>
                  <div className="rating-figure">
                    <div id="review-average">{avgReview}</div>
                    <div className="rating-side">
                      <div>平均評価</div>
                      <div id="review-total">（{reviews.length}件）</div>
                    </div>
                  </div>
                  <div id="review-average-stars">
                    {'★'.repeat(Math.round(Number(avgReview) || 5)) + '☆'.repeat(5 - Math.round(Number(avgReview) || 5))}
                  </div>
                </div>

                <div className="review-form">
                  <h3 id="my-review-heading">{myReview ? 'あなたのレビュー' : 'このサイトを評価'}</h3>
                  <div className="review-star-picker" aria-label="星評価">
                    {[1, 2, 3, 4, 5].map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`review-star-button ${st <= selectedRating ? 'selected' : ''}`}
                        onClick={() => setSelectedRating(st)}
                      >
                        ★
                      </button>
                    ))}
                  </div>

                  <div className="review-comment-row">
                    <input
                      id="review-comment"
                      className="review-comment-input"
                      type="text"
                      maxLength={20}
                      placeholder="ひとこと（任意・20文字以内）"
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                    />
                    <button
                      id="review-submit"
                      className="review-submit"
                      type="button"
                      onClick={handleSaveReview}
                    >
                      {myReview ? '編集を保存' : '投稿する'}
                    </button>
                  </div>

                  <div id="review-count" className="review-count">
                    {Array.from(reviewComment).length} / 20文字
                  </div>
                  <div id="review-mode-note" className="review-mode-note">
                    {myReview ? 'この端末から投稿済みです。内容を編集できます。' : '星だけでも投稿できます。'}
                  </div>
                  {reviewStatus && (
                    <div id="review-status" className="review-status" style={{ color: '#0088cc' }}>
                      {reviewStatus}
                    </div>
                  )}
                </div>

                <div id="review-list" className="review-list">
                  {reviews.map((r) => (
                    <article key={r.id} className="review-item">
                      <div className="review-item-header">
                        <div className="review-avatar">{r.iconInitial}</div>
                        <div>
                          <div className="review-author">{r.displayName}</div>
                          <div className="review-time">{new Date(r.createdAt).toLocaleDateString('ja-JP')}</div>
                        </div>
                      </div>
                      <div style={{ color: '#f5a623', letterSpacing: '2px', marginTop: '6px' }}>
                        {'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)}
                      </div>
                      {r.comment && <p>{r.comment}</p>}
                    </article>
                  ))}
                </div>
              </div>
            </div>

            {/* 9. Player View */}
            <div id="player-view" className={`view ${currentView === 'player' ? 'active' : ''}`}>
              {currentVideo && (
                <div className="player-layout">
                  <div className="video-section">
                    {/* Player mode tabs */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => switchPlayerMode('freemake')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '1px solid ' + (playerMode === 'freemake' ? 'var(--accent-strong)' : 'var(--border-color)'),
                            background: playerMode === 'freemake' ? 'var(--accent)' : 'var(--bg-surface-alt)',
                            color: playerMode === 'freemake' ? '#ffffff' : 'var(--text-main)',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                        >
                          <span className="material-icons" style={{ fontSize: '15px' }}>stream</span>
                          <span>{currentVideo.isLive ? 'ライブHLS再生' : 'Freemake ストリーム再生'}</span>
                          {freemakeStreamType && playerMode === 'freemake' && (
                            <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.28)', padding: '1px 5px', borderRadius: '4px', color: '#ffffff' }}>
                              {freemakeStreamType.toUpperCase()}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => switchPlayerMode('embed')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '1px solid ' + (playerMode === 'embed' ? 'var(--accent-strong)' : 'var(--border-color)'),
                            background: playerMode === 'embed' ? 'var(--accent)' : 'var(--bg-surface-alt)',
                            color: playerMode === 'embed' ? '#ffffff' : 'var(--text-main)',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span>{currentVideo.isLive ? '公式生放送プレイヤー' : '公式ニコニコプレイヤー'}</span>
                          <span style={{ fontSize: '10px', background: playerMode === 'embed' ? 'rgba(0,0,0,0.25)' : 'var(--accent-soft)', padding: '1px 5px', borderRadius: '4px', color: playerMode === 'embed' ? '#fde047' : 'var(--accent-strong)' }}>★即時</span>
                        </button>
                        {!currentVideo.isLive && (
                          <button
                            type="button"
                            className="action-btn"
                            onClick={() => switchPlayerMode('custom')}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '8px',
                              border: '1px solid ' + (playerMode === 'custom' ? 'var(--accent-strong)' : 'var(--border-color)'),
                              background: playerMode === 'custom' ? 'var(--accent)' : 'var(--bg-surface-alt)',
                              color: playerMode === 'custom' ? '#ffffff' : 'var(--text-main)',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              cursor: 'pointer'
                            }}
                          >
                            HTML5キャッシュ再生
                          </button>
                        )}
                        {playerMode === 'freemake' && !currentVideo.isLive && !radioMode && (
                          <select
                            aria-label="ストリーム画質"
                            value={freemakeQuality}
                            onChange={(e) => setFreemakeQuality(e.target.value)}
                            style={{
                              background: 'var(--bg-input)',
                              color: 'var(--text-main)',
                              border: '1px solid var(--accent)',
                              borderRadius: '8px',
                              padding: '5px 8px',
                              fontSize: '12px',
                              fontWeight: 'bold'
                            }}
                          >
                            <option value="1080">1080p</option>
                            <option value="720">720p (HD)</option>
                            <option value="480">480p</option>
                            <option value="360">360p (軽量)</option>
                          </select>
                        )}
                        <button
                          type="button"
                          id="radio-mode-toggle-btn"
                          className="action-btn"
                          onClick={toggleRadioMode}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '8px',
                            border: '1px solid ' + (radioMode ? '#0284c7' : 'var(--border-color)'),
                            background: radioMode ? '#0369a1' : 'var(--bg-surface-alt)',
                            color: radioMode ? '#ffffff' : 'var(--text-main)',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                          title="音声のみを受信して通信量を節約し、バックグラウンド再生に対応します"
                        >
                          <span className="material-icons" style={{ fontSize: '15px' }}>headphones</span>
                          <span>{radioMode ? 'ラジオモード ON (省データ)' : 'ラジオモード (音声のみ)'}</span>
                        </button>
                      </div>

                      <a
                        href={
                          currentVideo.isLive
                            ? `https://live.nicovideo.jp/watch/${currentVideo.nicoId || currentVideo.id}`
                            : `https://www.nicovideo.jp/watch/${currentVideo.nicoId || currentVideo.id}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-surface)',
                          color: 'var(--accent-strong)',
                          fontSize: '12px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span className="material-icons" style={{ fontSize: '15px' }}>open_in_new</span>
                        ニコニコ本家で開く
                      </a>
                    </div>

                    {playerNotification && (
                      <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--text-main)', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                        <span className="material-icons" style={{ fontSize: '18px', color: 'var(--accent-strong)' }}>info</span>
                        <span>{playerNotification}</span>
                      </div>
                    )}

                    {playerMode === 'custom' && (
                      <div style={{ background: 'var(--bg-surface-alt)', border: '1px solid #d97706', color: 'var(--text-main)', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="material-icons" style={{ fontSize: '18px', color: '#d97706' }}>sync</span>
                          <span>読み込みが止まる場合は「Freemake ストリーム再生」や「公式プレイヤー」へ切り替えられます</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => switchPlayerMode('freemake')}
                          style={{
                            padding: '5px 10px',
                            background: 'var(--accent)',
                            color: '#ffffff',
                            border: 0,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Freemakeストリーム
                        </button>
                      </div>
                    )}

                    {playerMode === 'embed' ? (
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', minHeight: '260px', maxHeight: '560px', background: '#000', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                        <iframe
                          src={getEmbedUrl(currentVideo)}
                          style={{ width: '100%', height: '100%', border: 0 }}
                          allow="autoplay; fullscreen"
                          allowFullScreen
                          title={currentVideo.title}
                        />

                        {/* Danmaku layer overlaid directly on top of authentic Nico video */}
                        {nicoCommentsOn && !radioMode && (
                          <div id="nico-comment-layer" className="nico-comment-layer" style={{ pointerEvents: 'none' }}>
                            {activeDanmaku.map((d) => (
                              <div
                                key={d.key}
                                className="nico-flow-comment"
                                style={{ top: `${d.topPercent}%`, color: d.color }}
                              >
                                {d.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="video-container" id="video-container-inner" ref={videoContainerRef}>
                        {radioMode ? (
                          <div className="radio-mode-stage">
                            <div className="radio-mode-card-row">
                              <div className="radio-mode-art-wrap">
                                {currentVideo.thumbnail ? (
                                  <ThumbImg
                                    src={currentVideo.thumbnail}
                                    alt={currentVideo.title}
                                    className="radio-mode-art"
                                    thumbMethod={settings.thumbMethod}
                                    apiRouteMethod={settings.apiRouteMethod}
                                  />
                                ) : (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span className="material-icons" style={{ fontSize: '40px', color: '#7dd3fc' }}>headphones</span>
                                  </div>
                                )}
                              </div>
                              <div className="radio-mode-meta">
                                <div className="radio-mode-kicker">
                                  <span className="material-icons" style={{ fontSize: '15px' }}>headphones</span>
                                  <span>ラジオモード · 音声のみ（省データ）</span>
                                </div>
                                <h3 className="radio-mode-title">{currentVideo.title}</h3>
                                <div className="radio-mode-channel">{currentVideo.channel}</div>
                              </div>
                            </div>

                            <audio
                              id="audio-player"
                              ref={audioRef}
                              className="radio-mode-audio"
                              src={playerMode === 'custom' && currentVideo ? getStreamUrl(currentVideo) : undefined}
                              controls
                              autoPlay={autoPlayEnabled}
                              playsInline
                              preload="auto"
                              loop={playerLoop}
                              onPlay={(e) => {
                                userPausedRef.current = false;
                                setNextAutoPlayState(null);
                                setIsVideoPlaying(true);
                                setIsVideoLoading(false);
                                setIsAutoMutedFallback(e.currentTarget.muted);
                              }}
                              onPause={(e) => {
                                if (!e.currentTarget.ended && !isVideoLoading) {
                                  userPausedRef.current = true;
                                }
                                setIsVideoPlaying(false);
                              }}
                              onLoadedMetadata={(e) => {
                                if (!autoPlayRef.current) {
                                  e.currentTarget.pause();
                                } else if (!userPausedRef.current && e.currentTarget.paused) {
                                  void attemptAutoPlay(e.currentTarget);
                                }
                                setIsVideoLoading(false);
                                setVideoLoadingPercent(100);
                              }}
                              onLoadedData={(e) => {
                                if (autoPlayRef.current && !userPausedRef.current && e.currentTarget.paused && !e.currentTarget.ended) {
                                  void attemptAutoPlay(e.currentTarget);
                                }
                              }}
                              onCanPlay={(e) => {
                                setVideoLoadingPercent(100);
                                setVideoLoadingStage('音声再生準備完了！');
                                setIsVideoLoading(false);
                                if (autoPlayRef.current && !userPausedRef.current && e.currentTarget.paused && !e.currentTarget.ended) {
                                  void attemptAutoPlay(e.currentTarget);
                                }
                              }}
                              onPlaying={(e) => {
                                userPausedRef.current = false;
                                setVideoLoadingPercent(100);
                                setIsVideoLoading(false);
                                setIsVideoPlaying(true);
                                setVideoError(null);
                                setIsAutoMutedFallback(e.currentTarget.muted);
                              }}
                              onVolumeChange={(e) => {
                                if (!e.currentTarget.muted) setIsAutoMutedFallback(false);
                              }}
                              onError={() => {
                                setIsVideoLoading(false);
                              }}
                              onTimeUpdate={handleTimeUpdate}
                              onEnded={handleMediaEnded}
                            />

                            {nextAutoPlayState && (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '10px',
                                  width: 'min(560px, 100%)',
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                  background: 'rgba(2, 132, 199, 0.22)',
                                  border: '1px solid rgba(56, 189, 248, 0.45)',
                                  color: '#ffffff',
                                  fontSize: '12px'
                                }}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  次の動画を自動再生 ({nextAutoPlayState.secondsLeft}秒): {nextAutoPlayState.nextVideo.title}
                                </span>
                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    className="zero-primary-btn"
                                    style={{ padding: '4px 10px', fontSize: '11px' }}
                                    onClick={() => {
                                      const target = nextAutoPlayState.nextVideo;
                                      setNextAutoPlayState(null);
                                      playVideo(target, playerMode === 'custom' ? 'custom' : 'freemake');
                                    }}
                                  >
                                    今すぐ再生
                                  </button>
                                  <button
                                    type="button"
                                    className="zero-secondary-btn"
                                    style={{ padding: '4px 10px', fontSize: '11px' }}
                                    onClick={() => setNextAutoPlayState(null)}
                                  >
                                    キャンセル
                                  </button>
                                </div>
                              </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', width: 'min(560px, 100%)' }}>
                              <p className="radio-mode-hint">
                                映像データを読み込まず音声のみ再生します。アプリ切替や画面ロック中も継続再生できます。
                              </p>
                              <button
                                type="button"
                                className="zero-secondary-btn"
                                onClick={toggleRadioMode}
                                style={{ padding: '5px 12px', fontSize: '12px', background: 'rgba(255,255,255,0.12)', color: '#ffffff', borderColor: 'rgba(255,255,255,0.28)' }}
                              >
                                映像も表示する
                              </button>
                            </div>
                          </div>
                        ) : (
                          <video
                            id="video-player"
                            ref={videoRef}
                            src={playerMode === 'custom' && currentVideo ? getStreamUrl(currentVideo) : undefined}
                            controls
                            autoPlay={autoPlayEnabled}
                            playsInline
                            preload="auto"
                            loop={playerLoop}
                            onPlay={(e) => {
                              userPausedRef.current = false;
                              setNextAutoPlayState(null);
                              setIsVideoPlaying(true);
                              setIsVideoLoading(false);
                              setIsAutoMutedFallback(e.currentTarget.muted);
                            }}
                            onPause={(e) => {
                              if (!e.currentTarget.ended && !isVideoLoading) {
                                userPausedRef.current = true;
                              }
                              setIsVideoPlaying(false);
                            }}
                            onLoadedMetadata={(e) => {
                              if (!autoPlayRef.current) {
                                e.currentTarget.pause();
                              } else if (!userPausedRef.current && e.currentTarget.paused) {
                                void attemptAutoPlay(e.currentTarget);
                              }
                              setIsVideoLoading(false);
                              setVideoLoadingPercent(100);
                            }}
                            onLoadedData={(e) => {
                              if (autoPlayRef.current && !userPausedRef.current && e.currentTarget.paused && !e.currentTarget.ended) {
                                void attemptAutoPlay(e.currentTarget);
                              }
                            }}
                            onCanPlay={(e) => {
                              setVideoLoadingPercent(100);
                              setVideoLoadingStage('動画準備完了！');
                              setIsVideoLoading(false);
                              if (autoPlayRef.current && !userPausedRef.current && e.currentTarget.paused && !e.currentTarget.ended) {
                                void attemptAutoPlay(e.currentTarget);
                              }
                            }}
                            onPlaying={(e) => {
                              userPausedRef.current = false;
                              setVideoLoadingPercent(100);
                              setIsVideoLoading(false);
                              setIsVideoPlaying(true);
                              setVideoError(null);
                              setIsAutoMutedFallback(e.currentTarget.muted);
                            }}
                            onVolumeChange={(e) => {
                              if (!e.currentTarget.muted) setIsAutoMutedFallback(false);
                            }}
                            onError={(e) => {
                              console.warn('HTML5 Video player error:', e);
                              setIsVideoLoading(false);
                            }}
                            onTimeUpdate={handleTimeUpdate}
                            onSeeked={() => danmakuTimerRef.current.clear()}
                            onEnded={handleMediaEnded}
                            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                          >
                            {subtitleEnabled && subtitleVttUrl && fullscreenMode !== 'native-video' && (
                              <track kind="subtitles" srcLang="ja" label="日本語字幕" src={subtitleVttUrl} />
                            )}
                          </video>
                        )}

                        {/* One-tap unmute button when browser blocked unmuted autoplay */}
                        {isVideoPlaying && isAutoMutedFallback && !radioMode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const el = getActiveMediaEl();
                              if (el) {
                                el.muted = false;
                                if (el.volume === 0) el.volume = 1;
                                setIsAutoMutedFallback(false);
                              }
                            }}
                            style={{
                              position: 'absolute',
                              top: '12px',
                              left: '12px',
                              zIndex: 22,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '7px 12px',
                              borderRadius: '20px',
                              border: '1px solid rgba(255,255,255,0.3)',
                              background: 'rgba(0, 0, 0, 0.78)',
                              color: '#ffffff',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              boxShadow: '0 4px 14px rgba(0,0,0,0.45)'
                            }}
                          >
                            <span className="material-icons" style={{ fontSize: '16px', color: '#38bdf8' }}>volume_off</span>
                            <span>消音で自動再生中（タップで音声ON）</span>
                          </button>
                        )}

                        {/* Next Video Continuous Auto-Play Countdown Overlay */}
                        {nextAutoPlayState && !radioMode && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '12px',
                              background: 'rgba(0, 0, 0, 0.82)',
                              backdropFilter: 'blur(6px)',
                              zIndex: 24,
                              padding: '20px',
                              color: '#ffffff',
                              textAlign: 'center'
                            }}
                          >
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>
                              次の動画を自動再生します（あと {nextAutoPlayState.secondsLeft} 秒）
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 700, maxWidth: '420px', lineHeight: 1.4 }}>
                              {nextAutoPlayState.nextVideo.title}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  const target = nextAutoPlayState.nextVideo;
                                  setNextAutoPlayState(null);
                                  playVideo(target, playerMode === 'custom' ? 'custom' : 'freemake');
                                }}
                                style={{
                                  padding: '8px 18px',
                                  borderRadius: '8px',
                                  border: 0,
                                  background: '#0284c7',
                                  color: '#ffffff',
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                今すぐ再生
                              </button>
                              <button
                                type="button"
                                onClick={() => setNextAutoPlayState(null)}
                                style={{
                                  padding: '8px 18px',
                                  borderRadius: '8px',
                                  border: '1px solid rgba(255,255,255,0.28)',
                                  background: 'rgba(255,255,255,0.12)',
                                  color: '#ffffff',
                                  fontSize: '13px',
                                  cursor: 'pointer'
                                }}
                              >
                                キャンセル
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Big Centered Play Button when media is paused & ready */}
                        {!isVideoPlaying && !isVideoLoading && !videoError && !radioMode && !nextAutoPlayState && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              userPausedRef.current = false;
                              const el = getActiveMediaEl();
                              if (el) {
                                el.muted = false;
                                el.play().then(() => {
                                  setIsVideoPlaying(true);
                                  setIsAutoMutedFallback(false);
                                }).catch(() => {
                                  if (el && !radioMode) {
                                    el.muted = true;
                                    el.play().then(() => {
                                      setIsVideoPlaying(true);
                                      setIsAutoMutedFallback(true);
                                    }).catch(() => {});
                                  }
                                });
                              }
                            }}
                            onTouchEnd={(e) => {
                              e.stopPropagation();
                              userPausedRef.current = false;
                              const el = getActiveMediaEl();
                              if (el) {
                                el.muted = false;
                                el.play().then(() => {
                                  setIsVideoPlaying(true);
                                  setIsAutoMutedFallback(false);
                                }).catch(() => {
                                  if (el && !radioMode) {
                                    el.muted = true;
                                    el.play().then(() => {
                                      setIsVideoPlaying(true);
                                      setIsAutoMutedFallback(true);
                                    }).catch(() => {});
                                  }
                                });
                              }
                            }}
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.35)',
                              cursor: 'pointer',
                              zIndex: 10,
                              transition: 'background 0.2s ease'
                            }}
                          >
                            <div
                              style={{
                                width: '76px',
                                height: '76px',
                                borderRadius: '50%',
                                background: 'rgba(0, 136, 204, 0.95)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 24px rgba(0, 136, 204, 0.65)',
                                transition: 'transform 0.15s ease',
                                transform: 'scale(1)'
                              }}
                            >
                              <span className="material-icons" style={{ fontSize: '46px', color: '#fff', marginLeft: '4px' }}>play_arrow</span>
                            </div>
                            <span style={{ marginTop: '10px', fontSize: '13px', color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '4px 14px', borderRadius: '14px', fontWeight: 'bold' }}>
                              タップして再生（音声あり）
                            </span>
                          </div>
                        )}

                        {/* Loading Overlay with Real-time Percentage & Time */}
                        {isVideoLoading && !videoError && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'rgba(0,0,0,0.88)',
                              backdropFilter: 'blur(6px)',
                              zIndex: 18,
                              padding: '24px',
                              textAlign: 'center',
                              color: '#fff'
                            }}
                          >
                            {/* Close / Dismiss button in top-right so the user is never stuck */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsVideoLoading(false);
                              }}
                              style={{
                                position: 'absolute',
                                top: '14px',
                                right: '14px',
                                background: 'rgba(255,255,255,0.15)',
                                border: 'none',
                                color: '#fff',
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer'
                              }}
                              title="閉じる"
                            >
                              <span className="material-icons" style={{ fontSize: '18px' }}>close</span>
                            </button>

                            {/* Center sync spinner */}
                            <span className="material-icons spin-icon" style={{ fontSize: '36px', color: '#0088cc', marginBottom: '12px' }}>sync</span>

                            {/* Loading message */}
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '10px', letterSpacing: '0.02em' }}>
                              {videoLoadingPercent >= 100 ? '動画準備完了！ 再生を開始します' : videoLoadingStage || '動画を準備中...'}
                            </div>

                            {/* Percentage progress value */}
                            <div style={{ fontSize: '28px', fontWeight: 800, color: '#00d4ff', fontVariantNumeric: 'tabular-nums', marginBottom: '10px' }}>
                              {videoLoadingPercent}%
                            </div>

                            {/* Linear progress bar */}
                            <div style={{ width: 'min(300px, 80vw)', height: '7px', background: 'rgba(255,255,255,0.18)', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                              <div style={{
                                width: `${Math.max(4, Math.min(100, videoLoadingPercent))}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #0088cc, #00d4ff)',
                                borderRadius: '4px',
                                transition: 'width 0.25s ease'
                              }} />
                            </div>

                            {/* Loading elapsed and estimated remaining time */}
                            <div className="loading-time" style={{ color: '#ccc', fontSize: '12px', marginBottom: '18px' }}>
                              <span className="loading-elapsed">経過 {formatLoadingDuration(loadingElapsedSec)}</span>
                              <span className="loading-remaining">推定残り 約{formatLoadingDuration(estimatedRemainingSec)}</span>
                              {videoSpeed && <span style={{ color: '#00d4ff' }}>速度 {videoSpeed}</span>}
                            </div>

                            {/* Instant Option: Switch to Official Embed Player (Zero wait time) */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsVideoLoading(false);
                                switchPlayerMode('embed');
                              }}
                              style={{
                                padding: '9px 18px',
                                background: 'rgba(255,255,255,0.12)',
                                border: '1px solid rgba(255,255,255,0.25)',
                                color: '#fff',
                                borderRadius: '8px',
                                fontSize: '12px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                            >
                              <span className="material-icons" style={{ fontSize: '16px', color: '#00d4ff' }}>bolt</span>
                              公式プレイヤーで即時視聴（待ち時間なし）
                            </button>
                          </div>
                        )}

                        {/* Error banner with reload in lightweight HTML5 player */}
                        {videoError && (
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.88)', zIndex: 18, padding: '24px', textAlign: 'center' }}>
                            <span className="material-icons" style={{ fontSize: '46px', color: '#0088cc', marginBottom: '8px' }}>info_outline</span>
                            <p style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold', marginBottom: '6px' }}>動画の読み込み</p>
                            <p style={{ color: '#bbb', fontSize: '13px', marginBottom: '18px', maxWidth: '380px' }}>{videoError}</p>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                              {currentVideo?.isLive && videoError.includes('満員') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVideoError(null);
                                    switchView('home');
                                  }}
                                  style={{
                                    padding: '10px 18px',
                                    background: '#16a34a',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontWeight: 'bold',
                                    fontSize: '13px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  通常動画一覧を見る
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setVideoError(null);
                                  switchPlayerMode('embed');
                                }}
                                style={{
                                  padding: '10px 20px',
                                  background: 'linear-gradient(135deg, #0088cc, #00d4ff)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontWeight: 'bold',
                                  fontSize: '13px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  boxShadow: '0 4px 14px rgba(0, 136, 204, 0.4)'
                                }}
                              >
                                <span className="material-icons" style={{ fontSize: '18px' }}>play_circle</span>
                                公式プレイヤーで再生 (待ち時間なし)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setVideoError(null);
                                  loadedStreamKeyRef.current = '';
                                  setIsVideoLoading(true);
                                  setVideoLoadingPercent(10);
                                  setVideoLoadingStage('再読み込みを開始...');
                                  videoRetryCountRef.current = 0;
                                  const el = getActiveMediaEl();
                                  if (el) {
                                    el.load();
                                    el.play().catch(() => {});
                                  }
                                }}
                                style={{
                                  padding: '10px 18px',
                                  background: 'rgba(255,255,255,0.1)',
                                  border: '1px solid rgba(255,255,255,0.2)',
                                  color: '#ddd',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  cursor: 'pointer'
                                }}
                              >
                                再試行
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Danmaku layer (normal & container fullscreen) */}
                        {nicoCommentsOn && !radioMode && (
                          <div id="nico-comment-layer" className="nico-comment-layer">
                            {activeDanmaku.map((d) => (
                              <div
                                key={d.key}
                                className="nico-flow-comment"
                                style={{ top: `${d.topPercent}%`, color: d.color }}
                              >
                                {d.text}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Video Subtitle Overlay (bottom center) */}
                        {subtitleEnabled && !radioMode && activeSubtitleText && (
                          <div className="video-subtitle-overlay" aria-live="polite">
                            {activeSubtitleText}
                          </div>
                        )}

                        {/* Fullscreen (Danmaku) & Gear Settings Buttons (Top-Right) */}
                        <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 20, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {!radioMode && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRequestFullscreen();
                              }}
                              style={{
                                background: 'rgba(0,0,0,0.55)',
                                backdropFilter: 'blur(4px)',
                                border: '1px solid rgba(255,255,255,0.18)',
                                color: '#ffffff',
                                borderRadius: '50%',
                                width: '32px',
                                height: '32px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                padding: 0,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                                transition: 'all 0.2s ease'
                              }}
                              title={fullscreenMode !== 'none' ? '全画面解除' : '全画面表示（弾幕コメント付き）'}
                            >
                              <span className="material-icons" style={{ fontSize: '18px' }}>
                                {fullscreenMode !== 'none' ? 'fullscreen_exit' : 'fullscreen'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowPlayerSettings((prev) => !prev);
                            }}
                            style={{
                              background: 'rgba(0,0,0,0.55)',
                              backdropFilter: 'blur(4px)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              color: '#ffffff',
                              borderRadius: '50%',
                              width: '32px',
                              height: '32px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              padding: 0,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                              transition: 'all 0.2s ease'
                            }}
                            title="プレイヤー設定"
                          >
                            <span className="material-icons" style={{ fontSize: '18px' }}>settings</span>
                          </button>
                        </div>

                        {/* Player Settings Dropdown (Only appears when settings icon is clicked) */}
                        {showPlayerSettings && (
                          <div
                            className="custom-overlay"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute',
                              top: '48px',
                              right: '10px',
                              background: 'rgba(24, 24, 24, 0.95)',
                              backdropFilter: 'blur(10px)',
                              borderRadius: '10px',
                              padding: '12px 14px',
                              minWidth: '180px',
                              zIndex: 25,
                              boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              animation: 'fadeIn 0.15s ease'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#aaa' }}>プレイヤー設定</span>
                              <button
                                type="button"
                                onClick={() => setShowPlayerSettings(false)}
                                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }}
                              >
                                <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
                              </button>
                            </div>
                            <div className="overlay-row">
                              <label style={{ fontSize: '12px', color: '#ccc' }}>画質:</label>
                              <select id="player-quality-select" className="overlay-select">
                                <option value="">自動 (最適画質)</option>
                                <option value="1080">1080p</option>
                                <option value="720">720p</option>
                                <option value="480">480p</option>
                                <option value="360">360p (軽量)</option>
                              </select>
                            </div>
                            <button
                              type="button"
                              className="overlay-btn"
                              onClick={() => {
                                const next = !subtitleEnabled;
                                const updated = { ...settings, subtitleEnabled: next };
                                setSettings(updated);
                                saveSettings(updated);
                                showPlayerNotification(next ? '動画字幕をONにしました' : '動画字幕をOFFにしました');
                              }}
                            >
                              字幕: {subtitleEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              className="overlay-btn"
                              onClick={() => subtitleFileInputRef.current?.click()}
                            >
                              字幕読込 (.vtt/.srt/.ass)
                            </button>
                            {subtitleEnabled && activeSubtitleCues.length > 0 && (
                              <div style={{ padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: '4px' }}>
                                <div style={{ fontSize: '10.5px', color: '#94a3b8', marginBottom: '4px' }}>
                                  {activeSubtitleSourceLabel} ({activeSubtitleCues.length}行)
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <button
                                    type="button"
                                    className="overlay-btn"
                                    style={{ flex: 1, padding: '4px 6px', fontSize: '11px' }}
                                    onClick={() => setSubtitleOffsetMs((p) => Math.max(-5000, p - 500))}
                                  >
                                    -0.5秒
                                  </button>
                                  <button
                                    type="button"
                                    className="overlay-btn"
                                    style={{ flex: 1, padding: '4px 6px', fontSize: '11px' }}
                                    onClick={() => setSubtitleOffsetMs(0)}
                                    title="タイミングリセット"
                                  >
                                    {subtitleOffsetMs === 0 ? '同期0s' : `${subtitleOffsetMs > 0 ? '+' : ''}${(subtitleOffsetMs / 1000).toFixed(1)}s`}
                                  </button>
                                  <button
                                    type="button"
                                    className="overlay-btn"
                                    style={{ flex: 1, padding: '4px 6px', fontSize: '11px' }}
                                    onClick={() => setSubtitleOffsetMs((p) => Math.min(5000, p + 500))}
                                  >
                                    +0.5秒
                                  </button>
                                </div>
                              </div>
                            )}
                            <button
                              type="button"
                              className="overlay-btn"
                              onClick={() => {
                                const next = !autoPlayEnabled;
                                const updated = { ...settings, autoPlay: next };
                                setSettings(updated);
                                saveSettings(updated);
                                showPlayerNotification(next ? '自動再生をONにしました' : '自動再生をOFFにしました');
                              }}
                            >
                              自動再生: {autoPlayEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              className="overlay-btn loop-toggle"
                              onClick={() => {
                                const next = !playerLoop;
                                setPlayerLoop(next);
                                safeStorage.setItem('playerLoopEnabled', next ? 'on' : 'off');
                              }}
                            >
                              ループ: {playerLoop ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              className="overlay-btn"
                              onClick={async () => {
                                if (videoRef.current) {
                                  try {
                                    if (document.pictureInPictureElement) {
                                      await document.exitPictureInPicture();
                                    } else if (videoRef.current.requestPictureInPicture) {
                                      await videoRef.current.requestPictureInPicture();
                                    }
                                  } catch (err) {
                                    console.warn('PiP failed', err);
                                  }
                                }
                              }}
                            >
                              <span className="material-icons" style={{ fontSize: '15px', marginRight: '4px', verticalAlign: 'middle' }}>picture_in_picture_alt</span>
                              PiP
                            </button>
                            <button className="overlay-btn" onClick={handleRequestFullscreen}>
                              {fullscreenMode !== 'none' ? '全画面解除' : '全画面表示'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}


                    <h2 id="video-title" className="video-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {currentVideo.isLive && (
                        <span style={{ background: '#dc2626', color: '#ffffff', fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '6px', letterSpacing: '0.04em' }}>
                          LIVE
                        </span>
                      )}
                      <span>{currentVideo.title}</span>
                    </h2>

                    <div className="channel-action-row">
                      <div
                        className="channel-info-area"
                        id="channel-click-area"
                        onClick={() => {
                          void openChannelProfile({
                            url: currentVideo.channel_url || '',
                            name: currentVideo.channel,
                            avatar: currentVideo.channelAvatar,
                            userId: currentVideo.userId
                          });
                        }}
                      >
                        <div
                          className="channel-avatar"
                          id="channel-avatar-img"
                          style={{ backgroundImage: currentVideo.channelAvatar ? `url('${currentVideo.channelAvatar}')` : 'none' }}
                        >
                          {!currentVideo.channelAvatar && (currentVideo.channel[0] || 'チ')}
                        </div>
                        <div className="channel-text">
                          <h4 id="video-channel" style={{ margin: 0 }}>{currentVideo.channel}</h4>
                          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '12px' }}>チャンネルを見る</p>
                        </div>
                      </div>

                      <div className="action-buttons">
                        <button
                          className="subscribe-button"
                          id="subscribe-action-btn"
                          type="button"
                          onClick={() => toggleSubscriptionState({ url: currentVideo.channel_url || '', name: currentVideo.channel, avatar: currentVideo.channelAvatar, userId: currentVideo.userId })}
                        >
                          <span>{isSubscribed(currentVideo.channel_url, currentVideo.channel) ? '登録済み' : '登録'}</span>
                        </button>

                        <button
                          className="action-btn"
                          id="nico-comment-toggle-main"
                          type="button"
                          onClick={() => {
                            const next = !nicoCommentsOn;
                            setNicoCommentsOn(next);
                            safeStorage.setItem('nicoCommentDisplay', next ? 'on' : 'off');
                          }}
                        >
                          コメント: {nicoCommentsOn ? 'ON' : 'OFF'}
                        </button>

                        <button
                          className="action-btn"
                          id="subtitle-toggle-main"
                          type="button"
                          onClick={() => {
                            const next = !subtitleEnabled;
                            const updated = { ...settings, subtitleEnabled: next };
                            setSettings(updated);
                            saveSettings(updated);
                            showPlayerNotification(next ? '動画字幕をONにしました' : '動画字幕をOFFにしました');
                          }}
                          style={{
                            color: subtitleEnabled ? 'var(--accent-strong)' : 'var(--text-main)',
                            borderColor: subtitleEnabled ? 'var(--accent)' : undefined,
                            background: subtitleEnabled ? 'var(--accent-soft)' : undefined
                          }}
                        >
                          <span className="material-icons" style={{ fontSize: '17px' }}>subtitles</span>
                          字幕: {subtitleEnabled ? 'ON' : 'OFF'}
                        </button>

                        <input
                          ref={subtitleFileInputRef}
                          type="file"
                          accept=".vtt,.srt,.ass,.ssa,text/vtt,application/x-subrip"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              const cues = parseSubtitleFileText(String(reader.result || ''));
                              if (cues.length === 0) {
                                showPlayerNotification('有効なVTT/SRT字幕を読み込めませんでした');
                                return;
                              }
                              setCustomSubtitles(cues);
                              if (!subtitleEnabled) {
                                const updated = { ...settings, subtitleEnabled: true };
                                setSettings(updated);
                                saveSettings(updated);
                              }
                              showPlayerNotification(`字幕ファイルを読み込みました (${cues.length}件)`);
                            };
                            reader.readAsText(file, 'utf-8');
                          }}
                        />

                        <button
                          className="action-btn"
                          id="subtitle-upload-btn"
                          type="button"
                          onClick={() => subtitleFileInputRef.current?.click()}
                          title=".vtt または .srt 字幕ファイルを読み込む"
                        >
                          <span className="material-icons" style={{ fontSize: '17px' }}>upload_file</span>
                          {customSubtitles ? `字幕(${customSubtitles.length})` : '字幕読込'}
                        </button>

                        {customSubtitles && (
                          <button
                            className="action-btn"
                            type="button"
                            onClick={() => {
                              setCustomSubtitles(null);
                              showPlayerNotification('カスタム字幕を解除しました（自動字幕に戻ります）');
                            }}
                            title="読み込んだ字幕ファイルを解除"
                          >
                            字幕解除
                          </button>
                        )}

                        <button
                          className="action-btn"
                          id="playlist-action-btn"
                          type="button"
                          onClick={() => setIsPlaylistDialogOpen(true)}
                        >
                          <span className="material-icons" style={{ fontSize: '18px' }}>playlist_add</span> リスト
                        </button>

                        <button
                          className="action-btn"
                          id="dl-action-btn"
                          onClick={() => setIsDownloadDialogOpen(true)}
                        >
                          <span className="material-icons" style={{ fontSize: '18px' }}>download</span> DL
                        </button>

                        <button
                          className="action-btn"
                          id="loop-action-btn"
                          type="button"
                          onClick={() => {
                            const next = !playerLoop;
                            setPlayerLoop(next);
                            safeStorage.setItem('playerLoopEnabled', next ? 'on' : 'off');
                          }}
                          style={{
                            color: playerLoop ? 'var(--accent-strong)' : 'var(--text-main)',
                            borderColor: playerLoop ? 'var(--accent)' : undefined,
                            background: playerLoop ? 'var(--accent-soft)' : undefined
                          }}
                        >
                          <span className="material-icons" style={{ fontSize: '18px' }}>repeat</span>
                          {playerLoop ? 'ループ中' : 'ループ'}
                        </button>

                        {!radioMode && (
                          <button
                            className="action-btn"
                            id="pip-action-btn"
                            type="button"
                            onClick={async () => {
                              if (videoRef.current) {
                                try {
                                  if (document.pictureInPictureElement) {
                                    await document.exitPictureInPicture();
                                  } else if (videoRef.current.requestPictureInPicture) {
                                    await videoRef.current.requestPictureInPicture();
                                  }
                                } catch (err) {
                                  console.warn('PiP failed', err);
                                }
                              }
                            }}
                            title="ピクチャーインピクチャー (小窓で再生)"
                          >
                            <span className="material-icons" style={{ fontSize: '18px' }}>picture_in_picture_alt</span> PiP
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Engagement / Meta with Watched Percentage */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', margin: '8px 0 12px' }}>
                      <div id="video-engagement" className="video-engagement">
                        <span className="material-icons">thumb_up</span>
                        <span>いいね {(currentVideo.likeCount ?? 0).toLocaleString()}</span>
                      </div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                        {currentVideo.views.toLocaleString()}回再生
                        {typeof currentVideo.commentCount === 'number' ? ` • コメ ${currentVideo.commentCount.toLocaleString()}` : ''}
                        {typeof currentVideo.mylistCount === 'number' ? ` • マイリス ${currentVideo.mylistCount.toLocaleString()}` : ''}
                        {` • ${currentVideo.uploadedAt || '2026/02/10'}`}
                      </span>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-strong)',
                        padding: '3px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--accent)',
                        fontSize: '12px',
                        fontWeight: 600
                      }}>
                        <span className="material-icons" style={{ fontSize: '14px' }}>timelapse</span>
                        再生進捗: {videoPlayPercent}%
                      </span>
                    </div>

                    {/* Video Tags (clickable to search or preview Nicopedia) */}
                    {currentVideo.tags && currentVideo.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                        {currentVideo.tags.map((t) => (
                          <div key={t.name} style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '6px', background: 'var(--bg-surface-alt)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                            <button
                              type="button"
                              onClick={() => void handleSearch(t.name, 1)}
                              style={{
                                padding: '4px 9px',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-main)',
                                fontSize: '12px',
                                fontWeight: 500,
                                cursor: 'pointer'
                              }}
                              title={`「${t.name}」で動画を検索`}
                            >
                              {t.isLocked ? '🔒 ' : ''}{t.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => void openNicopediaModal(t.name)}
                              style={{
                                padding: '4px 6px',
                                background: 'var(--bg-surface)',
                                border: 'none',
                                borderLeft: '1px solid var(--border-color)',
                                color: 'var(--accent-strong)',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                              title={`「${t.name}」をニコニコ大百科で読む`}
                            >
                              百
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Expandable Description */}
                    <div
                      className={`video-description ${descExpanded ? 'expanded' : ''}`}
                      id="video-desc"
                      onClick={() => setDescExpanded(!descExpanded)}
                    >
                      {currentVideo.description || '動画の説明はありません。'}
                    </div>

                    {/* Content Tree (親作品・子作品) */}
                    {videoTree && (videoTree.parentsTotal > 0 || videoTree.childrenTotal > 0) && (
                      <div style={{ marginTop: '12px', padding: '12px 14px', borderRadius: '10px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', fontSize: '12px' }}>
                        <div style={{ fontWeight: 'bold', color: 'var(--accent-strong)', marginBottom: '6px' }}>
                          コンテンツツリー（親作品 {videoTree.parentsTotal}件 / 子作品 {videoTree.childrenTotal}件）
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {videoTree.parents.map((p) => (
                            <a
                              key={`p-${p.globalId}`}
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ padding: '3px 8px', borderRadius: '6px', background: 'var(--accent-soft)', color: 'var(--accent-strong)', fontWeight: 600, textDecoration: 'none' }}
                            >
                              親: {p.globalId}
                            </a>
                          ))}
                          {videoTree.children.slice(0, 6).map((c) => (
                            <a
                              key={`c-${c.globalId}`}
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ padding: '3px 8px', borderRadius: '6px', background: 'var(--bg-surface-alt)', color: 'var(--text-main)', textDecoration: 'none' }}
                            >
                              子: {c.globalId}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* VOD Comment Section (コメント欄) */}
                    {!currentVideo.isLive && (
                      <section className="vod-comments-panel" aria-label="コメント欄">
                        <div className="vod-comments-header">
                          <h3 className="vod-comments-title">
                            <span className="material-icons" style={{ fontSize: '18px', color: 'var(--accent-strong)' }}>comment</span>
                            コメント欄
                            <span className="live-chat-count">({visibleVodComments.length}件)</span>
                          </h3>
                          <div className="vod-comments-controls">
                            <button
                              type="button"
                              className={`vod-comments-sort-btn${vodCommentSort === 'time' ? ' active' : ''}`}
                              onClick={() => setVodCommentSort('time')}
                            >
                              再生時間順
                            </button>
                            <button
                              type="button"
                              className={`vod-comments-sort-btn${vodCommentSort === 'newest' ? ' active' : ''}`}
                              onClick={() => setVodCommentSort('newest')}
                            >
                              新しい順
                            </button>
                            <input
                              type="search"
                              className="vod-comments-filter"
                              placeholder="コメント検索..."
                              value={vodCommentFilter}
                              onChange={(e) => setVodCommentFilter(e.target.value)}
                              aria-label="コメント検索"
                            />
                          </div>
                        </div>

                        <form className="vod-comment-form" onSubmit={handleSubmitVodComment}>
                          <input
                            type="text"
                            className="vod-comment-input"
                            placeholder="コメントを追加（現在の再生時間に弾幕として流れます）..."
                            maxLength={120}
                            value={vodCommentInput}
                            onChange={(e) => setVodCommentInput(e.target.value)}
                          />
                          <div className="vod-comment-colors" aria-label="コメント色">
                            {['#ffffff', '#ff5252', '#ffd600', '#38bdf8', '#4ade80'].map((col) => (
                              <button
                                key={col}
                                type="button"
                                className={`vod-color-dot${vodCommentColor === col ? ' active' : ''}`}
                                style={{ background: col }}
                                onClick={() => setVodCommentColor(col)}
                                aria-label={`色 ${col}`}
                                title="弾幕カラー"
                              />
                            ))}
                          </div>
                          <button
                            type="submit"
                            className="vod-comment-submit"
                            disabled={!vodCommentInput.trim()}
                          >
                            投稿
                          </button>
                        </form>

                        <div className="vod-comments-list">
                          {vodCommentsLoading && visibleVodComments.length === 0 ? (
                            <div className="live-chat-empty">コメントを読み込み中...</div>
                          ) : visibleVodComments.length === 0 ? (
                            <div className="live-chat-empty">
                              {vodCommentFilter.trim()
                                ? '一致するコメントが見つかりませんでした'
                                : 'コメントはまだありません。最初のコメントを投稿してみましょう！'}
                            </div>
                          ) : (
                            visibleVodComments.slice(0, 200).map((c) => {
                              const dateLabel = c.postedAt
                                ? new Date(c.postedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                                : '';
                              return (
                                <div key={c.id} className="vod-comment-row">
                                  <button
                                    type="button"
                                    className="vod-comment-time-btn"
                                    onClick={() => seekToCommentTime(c.timeMs)}
                                    title="この再生時間に移動"
                                  >
                                    {formatCommentTimeMs(c.timeMs)}
                                  </button>
                                  <div className="vod-comment-body">
                                    {c.color && c.color.toLowerCase() !== '#ffffff' && (
                                      <span
                                        style={{
                                          display: 'inline-block',
                                          width: '8px',
                                          height: '8px',
                                          borderRadius: '50%',
                                          background: c.color,
                                          marginRight: '6px',
                                          verticalAlign: 'middle'
                                        }}
                                      />
                                    )}
                                    {c.text}
                                  </div>
                                  {(dateLabel || (typeof c.nicoruCount === 'number' && c.nicoruCount > 0)) && (
                                    <div className="vod-comment-meta">
                                      {typeof c.nicoruCount === 'number' && c.nicoruCount > 0 && (
                                        <span>👍 {c.nicoruCount}</span>
                                      )}
                                      {dateLabel && <span>{dateLabel}</span>}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>
                    )}

                    {/* Nicopedia Preview Modal */}
                    {dicModal && (
                      <div
                        className="modal-backdrop show"
                        onClick={() => setDicModal(null)}
                        role="dialog"
                      >
                        <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <h3 style={{ margin: 0 }}>{dicModal.title || dicModal.word}（ニコニコ大百科）</h3>
                            <button type="button" onClick={() => setDicModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                              <span className="material-icons">close</span>
                            </button>
                          </div>
                          {dicModal.loading ? (
                            <p style={{ color: 'var(--text-muted)' }}>大百科を読み込み中...</p>
                          ) : dicModal.error ? (
                            <p style={{ color: '#dc2626' }}>{dicModal.error}</p>
                          ) : (
                            <p style={{ color: 'var(--text-main)', fontSize: '13px', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto' }}>
                              {dicModal.summary}
                            </p>
                          )}
                          {dicModal.url && (
                            <a href={dicModal.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-strong)', fontWeight: 600, fontSize: '13px', display: 'inline-block', marginTop: '8px' }}>
                              大百科ページを開く ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Related Videos / Live Comment Feed Column */}
                  <div className="related-videos">
                    {currentVideo.isLive ? (
                      <section className="live-chat-panel" aria-label="ライブコメント">
                        <div className="live-chat-header">
                          <h3>
                            <span className="material-icons" style={{ fontSize: '18px', color: 'var(--accent-strong)' }}>forum</span>
                            ライブコメント（リアルタイム）
                          </h3>
                          <span className="live-chat-count">{liveComments.length}件</span>
                        </div>
                        <div className="live-chat-list" ref={liveChatListRef}>
                          {liveCommentsLoading && liveComments.length === 0 ? (
                            <div className="live-chat-empty">ライブコメントに接続しています...</div>
                          ) : liveComments.length === 0 ? (
                            <div className="live-chat-empty">新しいコメントを待機中...</div>
                          ) : (
                            liveComments.map((c) => {
                              const timeLabel = new Date(c.atMs).toLocaleTimeString('ja-JP', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                              });
                              return (
                                <div key={c.id} className={`live-chat-row${c.isSystem ? ' system' : ''}`}>
                                  <div className="live-chat-meta">
                                    <span className="live-chat-no">
                                      {c.isSystem ? '案内' : typeof c.no === 'number' ? `#${c.no}` : 'コメ'}
                                    </span>
                                    {c.name && <span className="live-chat-name">{c.name}</span>}
                                    <span className="live-chat-time">{timeLabel}</span>
                                  </div>
                                  <div className="live-chat-text">{c.text}</div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>
                    ) : (
                      <>
                        <h3 style={{ marginTop: 0 }}>関連動画</h3>
                        <div id="related-results" className="related-list">
                          {relatedVideos.map((r) => (
                            <div key={r.id} className="related-card" onClick={() => playVideo(r)}>
                              <ThumbImg
                                src={r.thumbnail}
                                alt={r.title}
                                loading="lazy"
                                thumbMethod={settings.thumbMethod}
                                apiRouteMethod={settings.apiRouteMethod}
                              />
                              <div className="related-info">
                                <h4>{r.title}</h4>
                                <p>{r.channel}<br />{r.views.toLocaleString()}回視聴</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Floating Mini Player (when browsing other pages while video/radio is active) */}
      {floatingPlayerVisible && currentVideo && currentView !== 'player' && (
        <aside id="floating-player" aria-label="ミニプレイヤー">
          {radioMode && playerMode !== 'embed' ? (
            <div style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', background: '#0f172a', color: '#ffffff' }}>
              <button
                type="button"
                onClick={() => {
                  const el = audioRef.current;
                  if (!el) return;
                  if (el.paused) {
                    el.play().catch(() => {});
                  } else {
                    el.pause();
                  }
                }}
                aria-label={isVideoPlaying ? '一時停止' : '再生'}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  border: 'none',
                  background: '#0284c7',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <span className="material-icons" style={{ fontSize: '20px' }}>{isVideoPlaying ? 'pause' : 'play_arrow'}</span>
              </button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '10.5px', color: '#7dd3fc', fontWeight: 700 }}>ラジオモード再生中</div>
                <div style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {currentVideo.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => switchView('player')}
                aria-label="再生ページに戻る"
                title="再生ページに戻る"
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <span className="material-icons" style={{ fontSize: '16px' }}>open_in_full</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  audioRef.current?.pause();
                  setFloatingPlayerVisible(false);
                }}
                aria-label="停止して閉じる"
                title="停止して閉じる"
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
              </button>
            </div>
          ) : (
            <>
              <div id="floating-player-media">
                {playerMode === 'embed' ? (
                  <iframe
                    src={getEmbedUrl(currentVideo)}
                    style={{ width: '100%', height: '100%', border: 0 }}
                    allow="autoplay; fullscreen"
                    title={currentVideo.title}
                  />
                ) : (
                  <video
                    ref={floatingVideoRef}
                    src={playerMode === 'freemake' && freemakeResolvedUrl ? freemakeResolvedUrl : getStreamUrl(currentVideo)}
                    autoPlay={autoPlayEnabled}
                    playsInline
                    loop={playerLoop}
                    onError={() => setPlayerMode('embed')}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                )}
                <button
                  className="floating-player-open"
                  type="button"
                  onClick={() => switchView('player')}
                  aria-label="再生ページに戻る"
                  title="再生ページに戻る"
                >
                  <span className="material-icons" style={{ fontSize: '16px' }}>open_in_full</span>
                </button>
                <button
                  className="floating-player-close"
                  type="button"
                  onClick={() => setFloatingPlayerVisible(false)}
                  aria-label="閉じる"
                  title="閉じる"
                >
                  <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
                </button>
              </div>
              <div id="floating-player-info">
                <div id="floating-player-title" title={currentVideo.title}>{currentVideo.title}</div>
              </div>
            </>
          )}
        </aside>
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav">
        <div
          className={`bottom-nav-item ${currentView === 'home' ? 'active' : ''}`}
          id="bot-nav-home"
          onClick={() => switchView('home')}
        >
          <span className="material-icons">home</span>
          <span>ホーム</span>
        </div>
        <div
          className={`bottom-nav-item ${currentView === 'history' ? 'active' : ''}`}
          id="bot-nav-history"
          onClick={() => switchView('history')}
        >
          <span className="material-icons">history</span>
          <span>履歴</span>
        </div>
        <div
          className={`bottom-nav-item ${currentView === 'subscriptions' || currentView === 'library' ? 'active' : ''}`}
          id="bot-nav-subscriptions"
          onClick={() => switchView('subscriptions')}
        >
          <span className="material-icons">subscriptions</span>
          <span>登録</span>
          {favoriteLiveAlerts.length > 0 && (
            <span className="bottom-nav-badge">{favoriteLiveAlerts.length}</span>
          )}
        </div>
        <div
          className={`bottom-nav-item ${currentView === 'playlists' ? 'active' : ''}`}
          id="bot-nav-playlists"
          onClick={() => switchView('playlists')}
        >
          <span className="material-icons">playlist_play</span>
          <span>リスト</span>
        </div>
        <div
          className={`bottom-nav-item ${currentView === 'downloader' ? 'active' : ''}`}
          id="bot-nav-downloader"
          onClick={() => switchView('downloader')}
        >
          <span className="material-icons">download_for_offline</span>
          <span>保存</span>
        </div>
        <div
          className={`bottom-nav-item ${currentView === 'nico-hub' ? 'active' : ''}`}
          id="bot-nav-nico-hub"
          onClick={() => switchView('nico-hub')}
        >
          <span className="material-icons">sensors</span>
          <span>探索</span>
          {favoriteLiveAlerts.length > 0 && (
            <span className="bottom-nav-badge">L</span>
          )}
        </div>
        <div
          className={`bottom-nav-item ${currentView === 'settings' ? 'active' : ''}`}
          id="bot-nav-settings"
          onClick={() => switchView('settings')}
        >
          <span className="material-icons">settings</span>
          <span>設定</span>
        </div>
      </nav>
    </div>
  );
}
