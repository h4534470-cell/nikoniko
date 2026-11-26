import React, { useState, useEffect } from 'react';
import { Video } from '../types';
import { VideoCard } from './VideoCard';
import { isChannelSubscribed, toggleSubscription } from '../utils/storage';
import { Check, Plus } from 'lucide-react';

interface ChannelViewProps {
  channelName: string;
  channelUrl: string;
  videos: Video[];
  onSelectVideo: (v: Video) => void;
}

export const ChannelView: React.FC<ChannelViewProps> = ({
  channelName,
  channelUrl,
  videos,
  onSelectVideo
}) => {
  const [subscribed, setSubscribed] = useState<boolean>(false);

  const channelVideos = videos.filter((v) => v.channel === channelName);
  const sampleVideo = channelVideos[0];

  useEffect(() => {
    setSubscribed(isChannelSubscribed(channelUrl));
  }, [channelUrl]);

  const handleSubscribeToggle = () => {
    const isNowSub = toggleSubscription({
      url: channelUrl,
      name: channelName,
      avatar: sampleVideo?.channelAvatar,
      subscriberCount: sampleVideo?.subscribers || 100000
    });
    setSubscribed(isNowSub);
  };

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-12">
      {/* Channel Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-[#333] mb-6">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-700 flex items-center justify-center text-2xl font-bold text-white shrink-0 shadow-sm">
            {sampleVideo?.channelAvatar ? (
              <img
                src={sampleVideo.channelAvatar}
                alt={channelName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-zinc-300">{channelName[0] || 'チ'}</span>
            )}
          </div>

          <div>
            <h1 className="text-xl md:text-2xl font-bold leading-tight mb-1 text-white">
              {channelName}
            </h1>
            <p className="text-xs text-zinc-400 mb-2">
              {sampleVideo?.subscribers
                ? `フォロワー ${sampleVideo.subscribers.toLocaleString()}人`
                : '投稿者'}
              {' · '}
              <span>動画 {channelVideos.length}本</span>
            </p>
            <p className="text-xs text-zinc-400 max-w-xl line-clamp-2">
              {sampleVideo?.description || 'ユーザーのプロフィールです。'}
            </p>
          </div>
        </div>

        <button
          onClick={handleSubscribeToggle}
          className={`px-5 py-2 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer self-start md:self-center shrink-0 ${
            subscribed
              ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
              : 'bg-[#0088cc] text-white hover:bg-[#0077b3] shadow-sm'
          }`}
        >
          {subscribed ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>フォロー中</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              <span>ユーザーをフォロー</span>
            </>
          )}
        </button>
      </div>

      {/* Videos Section */}
      <h3 className="text-sm font-bold mb-4 px-1 text-zinc-200">投稿動画</h3>
      {channelVideos.length === 0 ? (
        <div className="py-16 text-center text-zinc-400 text-xs">
          このユーザーの投稿動画はありません。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {channelVideos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onClick={onSelectVideo}
            />
          ))}
        </div>
      )}
    </div>
  );
};
