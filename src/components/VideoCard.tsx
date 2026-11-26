import React from 'react';
import { Video } from '../types';

interface VideoCardProps {
  video: Video;
  onClick: (video: Video) => void;
  layout?: 'grid' | 'horizontal';
}

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  onClick,
  layout = 'grid'
}) => {
  if (layout === 'horizontal') {
    return (
      <div
        onClick={() => onClick(video)}
        className="flex gap-3 cursor-pointer group rounded-lg p-1.5 transition-colors hover:bg-zinc-800/60"
      >
        <div className="relative w-40 h-24 shrink-0 rounded-lg overflow-hidden bg-zinc-900">
          <img
            src={video.thumbnail}
            alt={video.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=320&auto=format&fit=crop&q=80';
            }}
          />
          <span className="absolute bottom-1 right-1 bg-black/85 text-white text-[11px] font-medium px-1.5 py-0.5 rounded tabular-nums">
            {video.duration}
          </span>
        </div>

        <div className="flex flex-col justify-start min-w-0 flex-1">
          <h4 className="text-xs font-semibold line-clamp-2 leading-snug mb-1 transition-colors text-zinc-100 group-hover:text-[#0088cc]">
            {video.title}
          </h4>
          <p className="text-[11px] text-zinc-400 truncate mb-0.5">{video.channel}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 tabular-nums">
            <span>{video.views.toLocaleString()}回再生</span>
            {video.uploadedAt && (
              <>
                <span>·</span>
                <span>{video.uploadedAt}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onClick(video)}
      className="flex flex-col cursor-pointer group rounded-xl transition-all hover:bg-zinc-800/40 p-1"
    >
      <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-zinc-900 mb-2.5 shadow-xs">
        <img
          src={video.thumbnail}
          alt={video.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=640&auto=format&fit=crop&q=80';
          }}
        />
        <span className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-xs font-medium px-1.5 py-0.5 rounded tabular-nums">
          {video.duration}
        </span>
      </div>

      <div className="flex gap-2.5">
        <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden bg-zinc-700 flex items-center justify-center font-bold text-xs text-white">
          {video.channelAvatar ? (
            <img
              src={video.channelAvatar}
              alt={video.channel}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="text-zinc-300">{video.channel[0] || 'チ'}</span>
          )}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug line-clamp-2 mb-1 transition-colors text-zinc-100 group-hover:text-[#0088cc]">
            {video.title}
          </h3>

          <p className="text-xs text-zinc-400 truncate hover:text-zinc-300">
            {video.channel}
          </p>

          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5 tabular-nums">
            <span>{video.views.toLocaleString()}回再生</span>
            {video.uploadedAt && (
              <>
                <span>·</span>
                <span>{video.uploadedAt}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
