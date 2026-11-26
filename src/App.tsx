import React, { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import { Video, ViewType, Review, ChannelSubscription, Playlist, NicoComment } from './types';
import { INITIAL_VIDEOS, INITIAL_REVIEWS } from './data/mockVideos';
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
  getVisitCount,
  getSavedCustomVideos,
  saveCustomVideo,
  getSearchHistory,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory
} from './utils/storage';

interface ActiveDanmakuItem {
  id: string;
  text: string;
  topPercent: number;
  color: string;
  key: string;
}

const ANNOUNCEMENTS = [
  {
    id: 'ann-1',
    date: '2026/03/15',
    title: 'muraにこ動画へようこそ！',
    body: 'ニコニコ動画の動画検索・再生・弾幕コメント表示・保存に完全対応しました。'
  },
  {
    id: 'ann-2',
    date: '2026/03/01',
    title: 'ミニプレイヤー＆バックグラウンド再生機能を追加',
    body: '動画再生中に他のページ（履歴・ライブラリ・設定など）へ移動しても、画面右下のミニプレイヤーで継続して動画を視聴できるようになりました。'
  },
  {
    id: 'ann-3',
    date: '2026/02/20',
    title: 'リアルタイム弾幕コメント投稿に対応',
    body: '動画再生画面から自分でも弾幕コメントを直接送信できるようになりました。'
  }
];

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visitCount, setVisitCount] = useState<number>(12845);
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
  }>>([]);
  const [isLoadingLive, setIsLoadingLive] = useState<boolean>(false);
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

  // Search History & Intro state
  const [searchHistory, setSearchHistory] = useState<string[]>(() => getSearchHistory());
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);
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
    return `https://embed.nicovideo.jp/watch/${encodeURIComponent(v.nicoId || v.id)}`;
  };

  const switchPlayerMode = (mode: 'freemake' | 'embed' | 'custom') => {
    setPlayerMode(mode);
    setVideoError(null);
    safeStorage.setItem('playerModePreference', mode);

    if (mode === 'embed') {
      setIsVideoLoading(false);
      setVideoLoadingPercent(100);
      return;
    }

    if (mode === 'freemake') {
      setIsVideoLoading(true);
      setVideoLoadingPercent(25);
      setVideoLoadingStage('Freemake ストリームを解析中...');
      return;
    }

    setIsVideoLoading(false);
    setVideoLoadingPercent(100);

    if (mode === 'custom' && currentVideo && videoRef.current) {
      const streamUrl = getStreamUrl(currentVideo);
      if (!videoRef.current.src.endsWith(streamUrl)) {
        videoRef.current.src = streamUrl;
        videoRef.current.load();
      }
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.play().catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().catch(() => {});
            }
          });
        }
      }, 50);
    }
  };

  // Player controls
  const [playerLoop, setPlayerLoop] = useState<boolean>(() => safeStorage.getItem('playerLoopEnabled') === 'on');
  const [nicoCommentsOn, setNicoCommentsOn] = useState<boolean>(() => safeStorage.getItem('nicoCommentDisplay') !== 'off');
  const [showPlayerSettings, setShowPlayerSettings] = useState<boolean>(false);
  const [descExpanded, setDescExpanded] = useState<boolean>(false);
  const [activeDanmaku, setActiveDanmaku] = useState<ActiveDanmakuItem[]>([]);
  const [danmakuPool, setDanmakuPool] = useState<NicoComment[]>([]);
  const [floatingPlayerVisible, setFloatingPlayerVisible] = useState<boolean>(false);

  // Library & Playlists
  const [subscriptions, setSubscriptions] = useState<ChannelSubscription[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistIndex, setSelectedPlaylistIndex] = useState<number | null>(null);
  const [isPlaylistDialogOpen, setIsPlaylistDialogOpen] = useState<boolean>(false);

  // Announcements
  const [isAnnouncementsOpen, setIsAnnouncementsOpen] = useState<boolean>(false);

  // Reviews
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [reviewStatus, setReviewStatus] = useState<string>('');
  const [myReview, setMyReview] = useState<Review | undefined>(undefined);

  // Settings
  const [settings, setSettings] = useState(() => getSettings());
  const [apiRouteStatus, setApiRouteStatus] = useState<string>('メインサーバー を使用中');
  const [themeMode, setThemeMode] = useState<string>(() => safeStorage.getItem('zeroThemeMode') || 'light');

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
      safeStorage.setItem('dlRecentJobs', JSON.stringify(dlRecentJobs));
    } catch {}
  }, [dlRecentJobs]);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const floatingVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const danmakuTimerRef = useRef<Set<string>>(new Set());
  const dlIntervalRef = useRef<number | null>(null);
  const videoRetryCountRef = useRef<number>(0);
  const hlsRef = useRef<Hls | null>(null);

  // Real-time stream attachment for Freemake (HLS / Range Proxy / ffmpeg) & Custom HTML5 player
  useEffect(() => {
    if ((playerMode !== 'custom' && playerMode !== 'freemake') || !currentVideo || currentView !== 'player') {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (playerMode === 'custom') {
      const directStreamUrl = getStreamUrl(currentVideo);
      if (!videoEl.src.endsWith(directStreamUrl)) {
        videoEl.src = directStreamUrl;
      }
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsVideoPlaying(true))
          .catch(() => setIsVideoPlaying(false));
      }
      return;
    }

    // Freemake Real-Time Stream Mode
    let cancelled = false;
    const targetUrl =
      currentVideo.url ||
      (currentVideo.nicoId
        ? `https://www.nicovideo.jp/watch/${currentVideo.nicoId}`
        : currentVideo.id);

    setIsVideoLoading(true);
    setVideoError(null);
    setVideoLoadingPercent(30);
    setVideoLoadingStage(`Freemake ストリーム接続中 (${freemakeQuality}p)...`);
    setFreemakeStreamType(null);
    setFreemakeResolvedUrl(null);

    (async () => {
      try {
        const resp = await fetch(
          `/api/freemake/stream-info?url=${encodeURIComponent(targetUrl)}&quality=${encodeURIComponent(freemakeQuality)}`
        );
        const data = await resp.json();
        if (cancelled) return;

        if (!data.ok || !data.streamUrl) {
          throw new Error(data.error || 'Freemakeストリームの取得に失敗しました');
        }

        setFreemakeStreamType(data.mode || 'proxy');
        setFreemakeResolvedUrl(data.streamUrl);
        setVideoLoadingPercent(85);
        setVideoLoadingStage('再生バッファを開始中...');

        const isHls = data.mode === 'hls' || String(data.streamUrl).includes('.m3u8');
        if (isHls) {
          if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = data.streamUrl;
            videoEl.play().then(() => {
              setIsVideoPlaying(true);
              setIsVideoLoading(false);
              setVideoLoadingPercent(100);
            }).catch(() => {
              setIsVideoLoading(false);
              setIsVideoPlaying(false);
            });
          } else if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              maxBufferLength: 30
            });
            hlsRef.current = hls;
            hls.loadSource(data.streamUrl);
            hls.attachMedia(videoEl);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (cancelled) return;
              setVideoLoadingPercent(100);
              setIsVideoLoading(false);
              videoEl.play().then(() => setIsVideoPlaying(true)).catch(() => {
                videoEl.muted = true;
                videoEl.play().then(() => setIsVideoPlaying(true)).catch(() => {});
              });
            });
            hls.on(Hls.Events.ERROR, (_event, errData) => {
              if (errData.fatal) {
                setIsVideoLoading(false);
                setVideoError('HLSストリームの読み込みに失敗しました。公式プレイヤーでお試しください。');
              }
            });
          } else {
            videoEl.src = data.streamUrl;
          }
        } else {
          videoEl.src = data.streamUrl;
          videoEl.load();
          videoEl.play().then(() => {
            setIsVideoPlaying(true);
            setIsVideoLoading(false);
            setVideoLoadingPercent(100);
          }).catch(() => {
            setIsVideoLoading(false);
            setIsVideoPlaying(false);
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        setIsVideoLoading(false);
        setVideoError(err?.message || 'ストリームの取得に失敗しました');
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playerMode, currentVideo?.id, currentView, freemakeQuality]);

  useEffect(() => {
    if (themeMode === 'dark') {
      document.body.classList.add('niconico-theme');
    } else {
      document.body.classList.remove('niconico-theme');
    }
    safeStorage.setItem('zeroThemeMode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    setVisitCount(getVisitCount());
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
      const res = await fetch(`/api/nico/ranking?genre=${encodeURIComponent(genre)}&term=${encodeURIComponent(activeTerm)}`);
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

  const loadNicoLivePrograms = async () => {
    setIsLoadingLive(true);
    try {
      const res = await fetch('/api/nico/live?sort=viewCount');
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        setLivePrograms(data.items);
      }
    } catch {} finally {
      setIsLoadingLive(false);
    }
  };

  const openNicopediaModal = async (word: string) => {
    setDicModal({ word, loading: true });
    try {
      const res = await fetch(`/api/nico/dic/${encodeURIComponent(word)}`);
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
      const res = await fetch(`/api/nico/user/${encodeURIComponent(userMatch)}`);
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
    if (currentView === 'player' && view !== 'player' && currentVideo) {
      if (videoRef.current && !videoRef.current.paused) {
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

    // Seed initial danmaku while authentic nvcomment loads
    const baseDanmaku = getVideoDanmaku(v.id);
    const initialDanmakuList = v.initialDanmaku && v.initialDanmaku.length > 0 ? v.initialDanmaku : [];
    const liveComments: NicoComment[] = initialDanmakuList.map((text, idx) => ({
      id: `live-cmt-${v.id}-${idx}`,
      text,
      timeMs: (idx * 2000) % 60000,
      color: ['#ffffff', '#ffffff', '#ffdd00', '#66ccff', '#ff9999', '#77ff77'][idx % 6]
    }));
    setDanmakuPool([...liveComments, ...baseDanmaku]);

    // 1. Fetch authentic watch/v3_guest metadata (tags, counts, real owner, description)
    if (/^(sm|so|nm)\d+$/i.test(targetNicoId)) {
      fetch(`/api/nico/video/${encodeURIComponent(targetNicoId)}`)
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
      fetch(`/api/nico/comments/${encodeURIComponent(targetNicoId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.comments) && data.comments.length > 0) {
            const apiComments: NicoComment[] = data.comments.map((c: any, idx: number) => ({
              id: `nico-live-${c.id}-${idx}`,
              text: c.text,
              timeMs: c.timeMs,
              commands: c.commands,
              color: c.color || '#ffffff',
              position: c.position || 'naka',
              size: c.size || 'medium',
              postedAt: c.postedAt,
              score: c.score
            }));
            setDanmakuPool(data.source === 'nvcomment' ? apiComments : [...apiComments, ...baseDanmaku]);
          }
        })
        .catch(() => {});

      // 3. Fetch real nvapi related recommendations
      fetch(`/api/nico/related/${encodeURIComponent(targetNicoId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.items)) {
            setLiveRelatedVideos(data.items);
          }
        })
        .catch(() => {});

      // 4. Fetch content tree (親作品・子作品)
      fetch(`/api/nico/tree/${encodeURIComponent(targetNicoId)}`)
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
    }

    danmakuTimerRef.current.clear();
    setActiveDanmaku([]);
    setDescExpanded(false);
    setFloatingPlayerVisible(false);
    setShowPlayerSettings(false);
    switchView('player');
  };

  // Continuous Danmaku comment flow when watching in lightweight HTML5 or embed mode
  useEffect(() => {
    if (currentView !== 'player' || !nicoCommentsOn || danmakuPool.length === 0) return;

    let idx = 0;
    // Initial burst of comments so comments flow immediately across the video
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
      if (playerMode === 'custom' && videoRef.current && videoRef.current.paused) return;

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
  }, [playerMode, currentView, nicoCommentsOn, danmakuPool, currentVideo?.id]);

  useEffect(() => {
    if (playerMode === 'custom' && currentVideo && videoRef.current) {
      videoRef.current.play().catch(() => {
        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }
      });
    }
  }, [playerMode, currentVideo?.id]);

  const [onlineSearchResults, setOnlineSearchResults] = useState<Video[] | null>(null);
  const [onlineSearchError, setOnlineSearchError] = useState<string | null>(null);

  const handleSearch = async (
    overrideQuery?: string,
    page: number = 1,
    overrideSort?: string
  ) => {
    const targetQ = typeof overrideQuery === 'string' ? overrideQuery : searchQuery;
    const raw = targetQ.trim();
    const sortParam = overrideSort || searchSort;
    if (typeof overrideQuery === 'string') {
      setSearchQuery(overrideQuery);
    }
    if (overrideSort) {
      setSearchSort(overrideSort);
    }
    setSearchApiPage(page);

    // If empty query, show all
    if (!raw) {
      setOnlineSearchResults(null);
      setOnlineSearchError(null);
      setSearchTotalCount(videos.length);
      setSearchHasNext(false);
      setSearchPage(0);
      switchView('search');
      return;
    }

    // Save to muratube search history
    addSearchHistory(raw);
    setSearchHistory(getSearchHistory());
    setIsSearchFocused(false);

    const q = raw.toLowerCase();

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
        const res = await fetch(`/api/nico/video/${smId}`);
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

    // If user pasted any external video URL (TikTok, X, Vimeo, etc.), open Freemake-style Downloader & inspect
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
      const endpoint = `/api/nico/search?q=${encodeURIComponent(raw)}&sort=${sortParam}&order=d&page=${page}`;
      const resp = await fetch(endpoint);
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
    if (videoRef.current && videoRef.current.duration > 0) {
      const cur = videoRef.current.currentTime;
      const dur = videoRef.current.duration;
      setVideoPlayPercent(Math.min(100, Math.round((cur / dur) * 100)));
    }

    if (!videoRef.current || !nicoCommentsOn) return;
    const timeMs = videoRef.current.currentTime * 1000;

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

  const toggleSubscriptionState = (channel: { url: string; name: string; avatar?: string }) => {
    if (!channel.url && !channel.name) return;
    const url = channel.url || `https://www.nicovideo.jp/user/${encodeURIComponent(channel.name)}`;
    toggleSubscription({
      url,
      name: channel.name,
      avatar: channel.avatar
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

    setIsDownloadDialogOpen(false);
    setIsDownloadingOverlay(true);
    setDlProgress(3);
    setDlProgressSize('接続中...');
    setDlStageText('yt-dlp ダウンロードジョブを開始しています...');
    setDlSpeedText('');
    setDlEtaText('');
    setDlReadyFileUrl(null);
    setDlReadyFileName('');
    setDlJobError(null);
    setDlActiveJobId(null);

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
            const fileName = pData.fileName || `video.${format === 'mp3' ? 'mp3' : format}`;
            const sizeMb = pData.fileSize ? `${(pData.fileSize / (1024 * 1024)).toFixed(1)} MB` : pData.totalSize || '';

            setDlProgress(100);
            setDlProgressSize(sizeMb ? `完了 (${sizeMb})` : '完了！');
            setDlReadyFileUrl(fileUrl);
            setDlReadyFileName(fileName);
            setDlRecentJobs((prev) => [
              { jobId, title, format: format.toUpperCase(), quality: format === 'mp3' ? '320kbps' : `${quality}p`, fileUrl, fileName, sizeMb },
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
    if (dlActiveJobId && !dlReadyFileUrl) {
      fetch(`/api/dl/cancel/${dlActiveJobId}`, { method: 'POST' }).catch(() => {});
    }
    setIsDownloadingOverlay(false);
    setDlProgress(0);
    setDlActiveJobId(null);
    setDlReadyFileUrl(null);
    setDlJobError(null);
  };

  const handleDeleteRecentJob = async (jobId: string) => {
    setDlRecentJobs((prev) => prev.filter((item) => item.jobId !== jobId));
    try {
      await fetch(`/api/dl/job/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    } catch {}
  };

  const handleClearAllRecentJobs = async () => {
    const targets = dlRecentJobs.map((j) => j.jobId);
    setDlRecentJobs([]);
    await Promise.all(
      targets.map((jobId) =>
        fetch(`/api/dl/job/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => {})
      )
    );
  };

  const handleRequestFullscreen = () => {
    const el = videoContainerRef.current as any;
    if (el) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
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
  const avgReview = reviews.length ? (reviews.reduce((a, b) => a + b.rating, 0) / reviews.length).toFixed(1) : '4.9';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 0. Site Intro (YouTube style intro from muratube) */}
      {showSiteIntro && (
        <div id="site-intro" role="status" aria-label="muratube を読み込み中">
          <span className="site-intro-line" aria-hidden="true" />
          <div className="site-intro-mark">
            <span className="site-intro-icon">
              <span className="material-icons" style={{ fontSize: '38px', color: '#fff' }}>play_arrow</span>
            </span>
            <span className="site-intro-name">muratube</span>
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
              : 'yt-dlp ＋ ffmpeg で実ファイルを生成しています。このままお待ちください。'}
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

      {/* 4. Announcements Dialog */}
      <div
        id="announcements-dialog"
        className={`modal-backdrop ${isAnnouncementsOpen ? 'show' : ''}`}
        role="dialog"
      >
        <div className="modal-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
            <h2 id="announcements-title" style={{ margin: 0, fontSize: '20px' }}>お知らせ</h2>
            <button className="terms-button secondary" type="button" onClick={() => setIsAnnouncementsOpen(false)}>
              閉じる
            </button>
          </div>
          <div id="announcements-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {ANNOUNCEMENTS.map((a) => (
              <article key={a.id} style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--accent-strong)', fontSize: '12px', fontWeight: 'bold' }}>{a.date}</span>
                  <h4 style={{ margin: 0, fontSize: '15px' }}>{a.title}</h4>
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>{a.body}</p>
              </article>
            ))}
          </div>
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
                setIsAnnouncementsOpen(true);
              }}
            >
              お知らせ ({ANNOUNCEMENTS.length})
            </button>
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
                placeholder="動画名・sm番号・URL"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  setSearchHistory(getSearchHistory());
                  setIsSearchFocused(true);
                }}
                onBlur={() => {
                  setTimeout(() => setIsSearchFocused(false), 260);
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="zero-search-clear"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchPage(0);
                  }}
                  title="クリア"
                  aria-label="検索文字をクリア"
                >
                  <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
                </button>
              )}

              {/* Search History Dropdown */}
              {isSearchFocused && searchHistory.length > 0 && (
                <div
                  id="search-history-dropdown"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="history-dropdown-header">
                    <span>検索履歴 ({searchHistory.length}件)</span>
                    <button
                      type="button"
                      onClick={() => {
                        clearSearchHistory();
                        setSearchHistory([]);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px' }}
                    >
                      履歴を全削除
                    </button>
                  </div>
                  {searchHistory.map((item) => (
                    <div
                      key={item}
                      className="history-dropdown-item"
                      onClick={() => {
                        setSearchQuery(item);
                        setIsSearchFocused(false);
                        handleSearch(item);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ width: '15px', height: '15px', flexShrink: 0, opacity: 0.65 }}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item}
                      </span>
                      <button
                        type="button"
                        className="history-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSearchHistory(item);
                          setSearchHistory(getSearchHistory());
                        }}
                        title="履歴から削除"
                      >
                        削除
                      </button>
                    </div>
                  ))}
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
              </div>

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
                        <img src={video.thumbnail} alt={video.title} loading="lazy" referrerPolicy="no-referrer" />
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
                </div>
              </div>

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
                          <img src={video.thumbnail} alt={video.title} loading="lazy" referrerPolicy="no-referrer" />
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
                        <img src={video.thumbnail} alt={video.title} loading="lazy" referrerPolicy="no-referrer" />
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
                <h2 style={{ marginTop: 0 }}>登録チャンネル</h2>
                <div id="subscriptions-list" className="library-list subscription-list">
                  {subscriptions.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', padding: '24px 0', color: '#888' }}>
                      登録チャンネルはありません。動画再生画面の「登録」ボタンからお気に入りのチャンネルを登録できます。
                    </div>
                  ) : (
                    subscriptions.map((sub) => (
                      <article key={sub.url} className="library-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                          <div
                            className="channel-avatar"
                            style={{ backgroundImage: sub.avatar ? `url('${sub.avatar}')` : 'none', width: '42px', height: '42px' }}
                          >
                            {!sub.avatar && (sub.name[0] || 'チ')}
                          </div>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '15px' }}>{sub.name}</h3>
                            <p style={{ margin: '2px 0 0', color: '#888', fontSize: '12px' }}>このサイト内で登録済み</p>
                          </div>
                        </div>
                        <div className="library-card-actions">
                          <button
                            type="button"
                            onClick={() => {
                              void openChannelProfile({ url: sub.url, name: sub.name, avatar: sub.avatar });
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
                    ))
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
                            <img src={v.thumbnail} alt={v.title} loading="lazy" />
                            <h3>{v.title}</h3>
                            <p>{v.channel}<br />{v.duration}</p>
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
                                          const r = await fetch(`/api/nico/mylist/${m.id}`);
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
                                    <img src={v.thumbnail} alt={v.title} loading="lazy" referrerPolicy="no-referrer" />
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
                              <img src={video.thumbnail} alt={video.title} loading="lazy" referrerPolicy="no-referrer" />
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
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>現在放送中のニコニコ生放送（視聴者数順）</span>
                      <button
                        type="button"
                        className="zero-secondary-btn"
                        onClick={() => void loadNicoLivePrograms()}
                      >
                        更新
                      </button>
                    </div>
                    {isLoadingLive ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        <span className="material-icons spin-icon" style={{ fontSize: '32px', color: 'var(--accent)' }}>sync</span>
                        <p>生放送一覧を取得中...</p>
                      </div>
                    ) : (
                      <div className="video-grid">
                        {livePrograms.map((p) => (
                          <a
                            key={p.id}
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="video-card-grid"
                            style={{ textDecoration: 'none' }}
                          >
                            <div className="video-card-thumb-wrap">
                              <img src={p.thumbnail} alt={p.title} loading="lazy" referrerPolicy="no-referrer" />
                              <span className="video-rank-tag top3">
                                LIVE
                              </span>
                            </div>
                            <div className="video-card-body">
                              <h3>{p.title}</h3>
                              <p>{p.providerName} · 来場 {p.watchCount.toLocaleString()} · コメ {p.commentCount.toLocaleString()}</p>
                            </div>
                          </a>
                        ))}
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
                          const r = await fetch(`/api/nico/seiga/${encodeURIComponent(seigaInput.trim())}`);
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
                        <img src={seigaResult.thumbnailUrl} alt={seigaResult.title} referrerPolicy="no-referrer" style={{ maxWidth: '240px', borderRadius: '8px', background: '#000' }} />
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
                          const r = await fetch(`/api/nico/dic/${encodeURIComponent(dicInput.trim())}`);
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
                            const r = await fetch(`/api/nico/jikkyo?channel=${encodeURIComponent(jikkyoChannel)}&starttime=${start}&endtime=${end}`);
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
                        <img
                          src={dlInspectedInfo.thumbnail}
                          alt={dlInspectedInfo.title}
                          referrerPolicy="no-referrer"
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
                  <h3 className="settings-section-title"><span className="material-icons">play_circle</span>動画再生方式</h3>
                  <p className="settings-section-note">途切れを防止するため、本体サーバーの高速ストリーミングを使用します。</p>
                  <div className="setting-group">
                    <label className="setting-label">再生方式</label>
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
                </section>

                <section className="settings-section">
                  <h3 className="settings-section-title"><span className="material-icons">cloud</span>API中継サーバー</h3>
                  <p className="settings-section-note">読み込みが遅いときは、API中継サーバーを変更できます。</p>
                  <div className="setting-group">
                    <label className="setting-label">API中継サーバー</label>
                    <select
                      id="apiRouteMethod"
                      value={settings.apiRouteMethod}
                      onChange={(e) => {
                        const updated = { ...settings, apiRouteMethod: e.target.value as any };
                        setSettings(updated);
                        saveSettings(updated);
                        setApiRouteStatus(e.target.value === 'auto' ? '自動選択: メインサーバー (28ms・最速)' : `${e.target.value} を使用中`);
                      }}
                    >
                      <option value="auto">自動選択（3経路を毎分測定・最速）</option>
                      <option value="direct">メインサーバー直通（最速）</option>
                      <option value="render">Render中継（Render Cloud・安定）</option>
                      <option value="gas">Google Apps Script（予備用）</option>
                    </select>
                    <p id="api-route-status" className="api-route-status" aria-live="polite">{apiRouteStatus}</p>
                    <p className="setting-hint">※動画再生・保存は、途切れを避けるため本体サーバーへ直接接続します。</p>
                  </div>

                  <div className="setting-group">
                    <label className="setting-label">サムネイルの取得方法</label>
                    <select
                      id="thumbMethod"
                      value={settings.thumbMethod}
                      onChange={(e) => {
                        const updated = { ...settings, thumbMethod: e.target.value as any };
                        setSettings(updated);
                        saveSettings(updated);
                      }}
                    >
                      <option value="direct">直接リンク (デフォルト)</option>
                      <option value="server">サーバー経由 (Base64・安全)</option>
                    </select>
                    <p className="setting-hint">「サーバー経由」はIPを隠して取得します。</p>
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
                            padding: '6px 14px',
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
                          <span>Freemake ストリーム再生</span>
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
                            padding: '6px 14px',
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
                          <span>公式ニコニコプレイヤー</span>
                          <span style={{ fontSize: '10px', background: playerMode === 'embed' ? 'rgba(0,0,0,0.25)' : 'var(--accent-soft)', padding: '1px 5px', borderRadius: '4px', color: playerMode === 'embed' ? '#fde047' : 'var(--accent-strong)' }}>★即時</span>
                        </button>
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => switchPlayerMode('custom')}
                          style={{
                            padding: '6px 14px',
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
                        {playerMode === 'freemake' && (
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
                      </div>

                      <a
                        href={`https://www.nicovideo.jp/watch/${currentVideo.nicoId || currentVideo.id}`}
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
                        {nicoCommentsOn && (
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
                        <video
                          id="video-player"
                          ref={videoRef}
                          src={playerMode === 'custom' && currentVideo ? getStreamUrl(currentVideo) : undefined}
                          controls
                          autoPlay
                          playsInline
                          preload="auto"
                          loop={playerLoop}
                          onPlay={() => {
                            setIsVideoPlaying(true);
                            setIsVideoLoading(false);
                          }}
                          onPause={() => setIsVideoPlaying(false)}
                          onLoadedMetadata={() => {
                            setIsVideoLoading(false);
                            setVideoLoadingPercent(100);
                          }}
                          onCanPlay={() => {
                            setVideoLoadingPercent(100);
                            setVideoLoadingStage('動画準備完了！');
                            setIsVideoLoading(false);
                          }}
                          onPlaying={() => {
                            setVideoLoadingPercent(100);
                            setIsVideoLoading(false);
                            setIsVideoPlaying(true);
                            setVideoError(null);
                          }}
                          onError={(e) => {
                            console.warn('HTML5 Video player error:', e);
                            setIsVideoLoading(false);
                          }}
                          onTimeUpdate={handleTimeUpdate}
                          onSeeked={() => danmakuTimerRef.current.clear()}
                          onEnded={() => {
                            danmakuTimerRef.current.clear();
                            setIsVideoPlaying(false);
                          }}
                          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                        />

                        {/* Big Centered Play Button when video is paused & ready */}
                        {!isVideoPlaying && !isVideoLoading && !videoError && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              if (videoRef.current) {
                                videoRef.current.muted = false;
                                videoRef.current.play().then(() => {
                                  setIsVideoPlaying(true);
                                }).catch(() => {
                                  if (videoRef.current) {
                                    videoRef.current.muted = true;
                                    videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(() => {});
                                  }
                                });
                              }
                            }}
                            onTouchEnd={(e) => {
                              e.stopPropagation();
                              if (videoRef.current) {
                                videoRef.current.muted = false;
                                videoRef.current.play().then(() => {
                                  setIsVideoPlaying(true);
                                }).catch(() => {
                                  if (videoRef.current) {
                                    videoRef.current.muted = true;
                                    videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(() => {});
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

                        {/* Loading Overlay matching muratube startLoadingPlayer with Real-time Percentage & Time */}
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

                            {/* Center sync spinner matching muratube */}
                            <span className="material-icons spin-icon" style={{ fontSize: '36px', color: '#0088cc', marginBottom: '12px' }}>sync</span>

                            {/* Loading message */}
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '10px', letterSpacing: '0.02em' }}>
                              {videoLoadingPercent >= 100 ? '動画準備完了！ 再生を開始します' : videoLoadingStage || '動画を準備中...'}
                            </div>

                            {/* Percentage progress value */}
                            <div style={{ fontSize: '28px', fontWeight: 800, color: '#00d4ff', fontVariantNumeric: 'tabular-nums', marginBottom: '10px' }}>
                              {videoLoadingPercent}%
                            </div>

                            {/* Linear progress bar matching muratube */}
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
                                  setIsVideoLoading(true);
                                  setVideoLoadingPercent(10);
                                  setVideoLoadingStage('再読み込みを開始...');
                                  videoRetryCountRef.current = 0;
                                  if (videoRef.current) {
                                    videoRef.current.load();
                                    videoRef.current.play().catch(() => {});
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

                        {/* Danmaku layer */}
                        {nicoCommentsOn && (
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

                        {/* Subtle Gear Settings Button (Top-Right) */}
                        <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 20 }}>
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
                              全画面表示
                            </button>
                          </div>
                        )}
                      </div>
                    )}


                    <h2 id="video-title" className="video-title">{currentVideo.title}</h2>

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
                          onClick={() => toggleSubscriptionState({ url: currentVideo.channel_url || '', name: currentVideo.channel, avatar: currentVideo.channelAvatar })}
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

                  {/* Related Videos Column */}
                  <div className="related-videos">
                    <h3 style={{ marginTop: 0 }}>関連動画</h3>
                    <div id="related-results" className="related-list">
                      {relatedVideos.map((r) => (
                        <div key={r.id} className="related-card" onClick={() => playVideo(r)}>
                          <img src={r.thumbnail} alt={r.title} loading="lazy" />
                          <div className="related-info">
                            <h4>{r.title}</h4>
                            <p>{r.channel}<br />{r.views.toLocaleString()}回視聴</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* App Footer */}
          <footer className="app-footer">
            <div className="footer-summary">
              <div className="footer-visits" title="総アクセス数">
                <small>閲覧数</small>
                <strong id="visit-count-val">{visitCount.toLocaleString()}</strong>
              </div>
            </div>
            &copy; 2026 mura<br />
            <a
              href="https://script.google.com/macros/s/AKfycbwOzNapEk-Vyh4lciFXyN-29481VuJNy1q3B71lwySZ69Cievt_vd1joijJJpf-d5NR/exec"
              target="_blank"
              rel="noreferrer"
            >
              ソースコード
            </a>
            <span style={{ margin: '0 8px', color: '#bbb' }}>|</span>
            <button
              id="footer-rating-button"
              className="footer-rating-button"
              type="button"
              onClick={() => switchView('reviews')}
            >
              ★ <span id="footer-rating-average">{avgReview}</span>（評価）
            </button>
          </footer>
        </main>
      </div>

      {/* Floating Mini Player (when browsing other pages while video is active) */}
      {floatingPlayerVisible && currentVideo && currentView !== 'player' && (
        <aside id="floating-player" aria-label="ミニプレイヤー">
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
                autoPlay
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
