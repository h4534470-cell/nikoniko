import React, { useState, useEffect, useRef } from 'react';
import {
  ThumbsUp,
  FolderPlus,
  Download,
  Maximize2,
  Repeat,
  Send,
  MessageSquare,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  Tv,
  Layers,
  ExternalLink
} from 'lucide-react';
import { Video, VideoComment, NicoComment } from '../types';
import {
  getVideoComments,
  addVideoComment,
  getVideoDanmaku,
  addDanmakuComment,
  isCommentLiked,
  toggleCommentLike,
  isVideoLiked,
  toggleVideoLike,
  isChannelSubscribed,
  toggleSubscription
} from '../utils/storage';
import { VideoCard } from './VideoCard';

interface ActiveDanmakuItem {
  id: string;
  text: string;
  color: string;
  topPercent: number;
  key: string;
}

interface PlayerViewProps {
  video: Video;
  relatedVideos: Video[];
  onSelectVideo: (v: Video) => void;
  onOpenChannel: (channelUrl: string, channelName: string) => void;
  onOpenDownload: (video: Video) => void;
  onOpenPlaylistModal: (video: Video) => void;
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  video,
  relatedVideos,
  onSelectVideo,
  onOpenChannel,
  onOpenDownload,
  onOpenPlaylistModal
}) => {
  // Player mode: 'embed' (official nicovideo embed) or 'custom' (html5 with danmaku overlay)
  const [playerMode, setPlayerMode] = useState<'custom' | 'embed'>('custom');
  const [resolution, setResolution] = useState<string>('1080');
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [commentsVisible, setCommentsVisible] = useState<boolean>(true);
  const [descExpanded, setDescExpanded] = useState<boolean>(false);

  // Likes & Subscriptions
  const [liked, setLiked] = useState<boolean>(false);
  const [likeCount, setLikeCount] = useState<number>(video.likeCount || 1200);
  const [subscribed, setSubscribed] = useState<boolean>(false);

  // Comments
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [newCommentText, setNewCommentText] = useState<string>('');
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});

  // Danmaku
  const [danmakuPool, setDanmakuPool] = useState<NicoComment[]>([]);
  const [activeDanmaku, setActiveDanmaku] = useState<ActiveDanmakuItem[]>([]);
  const [danmakuInput, setDanmakuInput] = useState<string>('');
  const [danmakuColor, setDanmakuColor] = useState<string>('#ffffff');
  const triggeredDanmakuIds = useRef<Set<string>>(new Set());

  // Progress percentage
  const [videoPlayPercent, setVideoPlayPercent] = useState<number>(0);
  const [videoBufferPercent, setVideoBufferPercent] = useState<number>(0);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLiked(isVideoLiked(video.id));
    setLikeCount(video.likeCount || 1200);
    setSubscribed(isChannelSubscribed(video.channel_url));
    setComments(getVideoComments(video.id));
    setDanmakuPool(getVideoDanmaku(video.id));
    triggeredDanmakuIds.current.clear();
    setActiveDanmaku([]);
    setVideoPlayPercent(0);
    setVideoBufferPercent(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [video.id]);

  const handleToggleLike = () => {
    const newState = toggleVideoLike(video.id);
    setLiked(newState);
    setLikeCount((prev) => (newState ? prev + 1 : prev - 1));
  };

  const handleToggleSubscribe = () => {
    const isNowSub = toggleSubscription({
      url: video.channel_url || `https://nicovideo.jp/user/${video.channel}`,
      name: video.channel,
      avatar: video.channelAvatar,
      subscriberCount: video.subscribers
    });
    setSubscribed(isNowSub);
  };

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Video TimeUpdate to trigger Danmaku & track progress
  const handleTimeUpdate = () => {
    if (videoRef.current && videoRef.current.duration > 0) {
      setVideoPlayPercent(Math.min(100, Math.round((videoRef.current.currentTime / videoRef.current.duration) * 100)));
    }
    if (!videoRef.current || !commentsVisible) return;
    const currentTimeMs = videoRef.current.currentTime * 1000;

    danmakuPool.forEach((item) => {
      if (
        !triggeredDanmakuIds.current.has(item.id) &&
        Math.abs(item.timeMs - currentTimeMs) < 1500
      ) {
        triggeredDanmakuIds.current.add(item.id);
        const lane = Math.floor(Math.random() * 8); // 8 lanes
        const newItem: ActiveDanmakuItem = {
          id: item.id,
          text: item.text,
          color: item.color || '#ffffff',
          topPercent: 5 + lane * 11,
          key: `${item.id}-${Date.now()}`
        };

        setActiveDanmaku((prev) => [...prev, newItem]);

        setTimeout(() => {
          setActiveDanmaku((prev) => prev.filter((d) => d.key !== newItem.key));
        }, 8000);
      }
    });
  };

  const handlePostDanmaku = (e: React.FormEvent) => {
    e.preventDefault();
    if (!danmakuInput.trim()) return;

    const currentTimeMs = videoRef.current
      ? videoRef.current.currentTime * 1000
      : 1000;

    const updated = addDanmakuComment(
      video.id,
      danmakuInput.trim(),
      currentTimeMs,
      danmakuColor
    );
    setDanmakuPool(updated);

    const lane = Math.floor(Math.random() * 8);
    const userItem: ActiveDanmakuItem = {
      id: 'usr-' + Date.now(),
      text: danmakuInput.trim(),
      color: danmakuColor,
      topPercent: 5 + lane * 11,
      key: `usr-${Date.now()}`
    };
    setActiveDanmaku((prev) => [...prev, userItem]);
    setTimeout(() => {
      setActiveDanmaku((prev) => prev.filter((d) => d.key !== userItem.key));
    }, 8000);

    setDanmakuInput('');
  };

  const handlePostComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;
    const updated = addVideoComment(video.id, newCommentText.trim());
    setComments(updated);
    setNewCommentText('');
  };

  const handleCommentLike = (commentId: string) => {
    const isNowLiked = toggleCommentLike(commentId);
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === commentId) {
          return {
            ...c,
            likeCount: isNowLiked ? c.likeCount + 1 : Math.max(0, c.likeCount - 1)
          };
        }
        return c;
      })
    );
  };

  const toggleReplyThread = (commentId: string) => {
    setOpenReplies((prev) => ({
      ...prev,
      [commentId]: !prev[commentId]
    }));
  };

  const danmakuColors = [
    { label: '白', value: '#ffffff' },
    { label: '赤', value: '#ff5252' },
    { label: '青', value: '#6aa9ff' },
    { label: '黄', value: '#fff45c' },
    { label: '緑', value: '#77ee77' },
    { label: '桃', value: '#ff8ec7' }
  ];

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-16">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Player, Info, Comments */}
        <div className="lg:col-span-2 flex flex-col">
          {/* Player Mode Switch Bar */}
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[#222] border border-[#383838]">
              <button
                onClick={() => setPlayerMode('custom')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  playerMode === 'custom'
                    ? 'bg-[#0088cc] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>弾幕プレーヤー</span>
              </button>

              {video.nicoId && (
                <button
                  onClick={() => setPlayerMode('embed')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                    playerMode === 'embed'
                      ? 'bg-[#0088cc] text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                  <span>公式埋め込み</span>
                </button>
              )}
            </div>

            <a
              href={`https://www.nicovideo.jp/watch/${video.nicoId || ''}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-[#0088cc] hover:underline"
            >
              <span>ニコニコで開く</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Video Container */}
          <div
            ref={containerRef}
            className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-lg group select-none border border-[#333]"
          >
            {playerMode === 'embed' && video.nicoId ? (
              <iframe
                src={`https://embed.nicovideo.jp/watch/${video.nicoId}?jsapi=1`}
                title={video.title}
                className="w-full h-full border-0"
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={video.videoUrl || `/api/video/stream/${video.nicoId || video.id}`}
                  controls
                  autoPlay
                  playsInline
                  loop={isLooping}
                  onTimeUpdate={handleTimeUpdate}
                  onProgress={() => {
                    if (videoRef.current && videoRef.current.duration > 0 && videoRef.current.buffered.length > 0) {
                      const bufEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
                      setVideoBufferPercent(Math.min(100, Math.round((bufEnd / videoRef.current.duration) * 100)));
                    }
                  }}
                  className="w-full h-full object-contain bg-black outline-none"
                />

                {/* Danmaku Comment Layer */}
                {commentsVisible && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                    {activeDanmaku.map((item) => (
                      <div
                        key={item.key}
                        className="danmaku-item text-lg md:text-2xl font-bold tracking-wide"
                        style={{
                          top: `${item.topPercent}%`,
                          color: item.color
                        }}
                      >
                        {item.text}
                      </div>
                    ))}
                  </div>
                )}

                {/* In-Player Settings Overlay */}
                <div className="absolute top-3 right-3 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/80 backdrop-blur-xs text-white p-2 rounded-xl flex items-center gap-2 border border-white/10 text-xs">

                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-zinc-300">画質:</span>
                    <select
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      className="bg-black/90 text-white border border-zinc-700 rounded px-1.5 py-0.5 outline-none cursor-pointer"
                    >
                      <option value="1080">1080p</option>
                      <option value="720">720p</option>
                      <option value="480">480p</option>
                      <option value="360">360p</option>
                    </select>
                  </div>

                  <button
                    onClick={() => setIsLooping(!isLooping)}
                    title="ループ再生"
                    className={`p-1.5 rounded transition-colors cursor-pointer ${
                      isLooping ? 'bg-[#0088cc] text-white' : 'hover:bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    <Repeat className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handleFullscreen}
                    title="全画面"
                    className="p-1.5 rounded hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Live Danmaku Input Bar */}
          <form
            onSubmit={handlePostDanmaku}
            className="mt-3 p-2.5 rounded-xl border border-[#383838] bg-[#222222] text-white flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <MessageCircle className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                type="text"
                value={danmakuInput}
                onChange={(e) => setDanmakuInput(e.target.value)}
                placeholder="動画上に流す弾幕コメントを入力..."
                className="w-full text-xs sm:text-sm px-3 py-1.5 rounded-lg border outline-none bg-[#181818] border-[#444] text-white placeholder-zinc-500"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Color picker */}
              <div className="flex items-center gap-1">
                {danmakuColors.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setDanmakuColor(c.value)}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                    className={`w-4 h-4 rounded-full border border-black/30 transition-transform ${
                      danmakuColor === c.value ? 'scale-125 ring-2 ring-[#0088cc]' : 'opacity-80'
                    }`}
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={!danmakuInput.trim()}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  danmakuInput.trim()
                    ? 'bg-[#0088cc] hover:bg-[#0077b3] text-white'
                    : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>流す</span>
              </button>
            </div>
          </form>

          {/* Video Title */}
          <h1 className="text-lg md:text-xl font-bold mt-4 leading-snug text-zinc-100">
            {video.title}
          </h1>

          {/* Channel info & Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-4 mt-3 pb-3 border-b border-[#333]">
            {/* Channel Area */}
            <div
              onClick={() => onOpenChannel(video.channel_url || '', video.channel)}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700 shrink-0 flex items-center justify-center font-bold text-xs text-white">
                {video.channelAvatar ? (
                  <img
                    src={video.channelAvatar}
                    alt={video.channel}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{video.channel[0] || 'チ'}</span>
                )}
              </div>
              <div>
                <h3 className="text-sm font-bold group-hover:text-[#0088cc] transition-colors text-zinc-100">
                  {video.channel}
                </h3>
                <p className="text-xs text-zinc-400">
                  {video.subscribers
                    ? `フォロワー ${video.subscribers.toLocaleString()}人`
                    : 'チャンネルを見る'}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Danmaku Toggle */}
              <button
                onClick={() => setCommentsVisible(!commentsVisible)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold cursor-pointer transition-colors ${
                  commentsVisible
                    ? 'bg-[#0088cc]/20 border-[#0088cc] text-[#0088cc]'
                    : 'bg-[#2a2a2a] border-[#444] text-zinc-400'
                }`}
              >
                コメント: {commentsVisible ? 'ON' : 'OFF'}
              </button>

              {/* Follow / Subscribe button */}
              <button
                onClick={handleToggleSubscribe}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                  subscribed
                    ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                    : 'bg-[#0088cc] text-white hover:bg-[#0077b3]'
                }`}
              >
                {subscribed ? 'フォロー中' : 'フォロー'}
              </button>

              {/* Like button */}
              <button
                onClick={handleToggleLike}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  liked
                    ? 'bg-[#0088cc]/20 border-[#0088cc] text-[#0088cc]'
                    : 'bg-[#2a2a2a] border-[#444] text-zinc-300 hover:bg-[#333]'
                }`}
              >
                <ThumbsUp className={`w-3.5 h-3.5 ${liked ? 'fill-[#0088cc]' : ''}`} />
                <span className="tabular-nums">{likeCount.toLocaleString()}</span>
              </button>

              {/* Add to Playlist button */}
              <button
                onClick={() => onOpenPlaylistModal(video)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#444] bg-[#2a2a2a] text-zinc-300 hover:bg-[#333] transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>マイリスト</span>
              </button>

              {/* Download button */}
              <button
                onClick={() => onOpenDownload(video)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border border-zinc-600 bg-zinc-700 text-white hover:bg-zinc-600 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>保存</span>
              </button>
            </div>
          </div>

          {/* Video Description */}
          <div
            onClick={() => setDescExpanded(!descExpanded)}
            className="mt-4 p-4 rounded-xl cursor-pointer transition-all bg-[#222222] hover:bg-[#282828] text-zinc-200"
          >
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-2 font-medium">
              <span>{video.views.toLocaleString()} 回再生 · {video.uploadedAt}</span>
              <span className="flex items-center gap-0.5 text-[#0088cc]">
                {descExpanded ? '閉じる' : 'もっと見る'}
                {descExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            </div>
            <p
              className={`text-sm whitespace-pre-wrap leading-relaxed ${
                descExpanded ? '' : 'line-clamp-2'
              }`}
            >
              {video.description || '動画の説明はありません。'}
            </p>
          </div>

          {/* Comments Section */}
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-5 h-5 text-zinc-400" />
              <h2 className="text-base font-bold text-zinc-100">コメント {comments.length}件</h2>
            </div>

            {/* Post comment input */}
            <form onSubmit={handlePostComment} className="flex gap-3 mb-6">
              <div className="w-9 h-9 rounded-full bg-[#0088cc] text-white flex items-center justify-center font-bold text-xs shrink-0">
                ユ
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <input
                  type="text"
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="コメントを入力..."
                  className="w-full text-sm py-2 px-3 rounded-lg border outline-none bg-[#1e1e1e] border-[#444] text-white placeholder-zinc-500 focus:border-[#0088cc]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="submit"
                    disabled={!newCommentText.trim()}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                      newCommentText.trim()
                        ? 'bg-[#0088cc] text-white hover:bg-[#0077b3]'
                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    書き込む
                  </button>
                </div>
              </div>
            </form>

            {/* Comments List */}
            <div className="flex flex-col gap-4">
              {comments.map((comment) => {
                const likedThis = isCommentLiked(comment.id);
                const showReplies = openReplies[comment.id];

                return (
                  <div key={comment.id} className="flex gap-3">
                    <div className="w-9 h-9 rounded-full bg-zinc-700 overflow-hidden shrink-0 flex items-center justify-center font-bold text-xs text-zinc-200">
                      {comment.author_thumbnail ? (
                        <img
                          src={comment.author_thumbnail}
                          alt={comment.author}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{comment.author[0] || 'ア'}</span>
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-zinc-200">
                          {comment.author}
                        </span>
                        <span className="text-[11px] text-zinc-400">{comment.time}</span>
                      </div>
                      <p className="text-xs sm:text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                        {comment.text}
                      </p>

                      {/* Comment actions */}
                      <div className="flex items-center gap-4 mt-2">
                        <button
                          onClick={() => handleCommentLike(comment.id)}
                          className={`flex items-center gap-1 text-xs cursor-pointer ${
                            likedThis ? 'text-[#0088cc] font-bold' : 'text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <ThumbsUp className={`w-3.5 h-3.5 ${likedThis ? 'fill-[#0088cc]' : ''}`} />
                          <span className="tabular-nums">{comment.likeCount}</span>
                        </button>

                        {comment.replies && comment.replies.length > 0 && (
                          <button
                            onClick={() => toggleReplyThread(comment.id)}
                            className="text-xs text-[#0088cc] hover:underline cursor-pointer font-medium"
                          >
                            {showReplies ? '返信を隠す' : `返信 ${comment.replies.length}件を表示`}
                          </button>
                        )}
                      </div>

                      {/* Reply threads */}
                      {showReplies && comment.replies && (
                        <div className="mt-3 pl-4 border-l-2 border-zinc-700 flex flex-col gap-3">
                          {comment.replies.map((reply) => (
                            <div key={reply.id} className="flex gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center font-bold text-[10px] text-zinc-300">
                                {reply.author_thumbnail ? (
                                  <img
                                    src={reply.author_thumbnail}
                                    alt={reply.author}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span>{reply.author[0] || 'ア'}</span>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-xs font-semibold text-zinc-200">{reply.author}</span>
                                  <span className="text-[10px] text-zinc-400">{reply.time}</span>
                                </div>
                                <p className="text-xs text-zinc-300">
                                  {reply.text}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Related Videos */}
        <div className="flex flex-col">
          <h3 className="text-sm font-bold mb-3 px-1 text-zinc-200">関連動画</h3>
          <div className="flex flex-col gap-2">
            {relatedVideos.map((rv) => (
              <VideoCard
                key={rv.id}
                video={rv}
                onClick={onSelectVideo}
                layout="horizontal"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
