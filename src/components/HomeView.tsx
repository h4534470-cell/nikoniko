import React, { useState } from 'react';
import { Video } from '../types';
import { VideoCard } from './VideoCard';
import { Sparkles, RefreshCw } from 'lucide-react';

interface HomeViewProps {
  videos: Video[];
  onSelectVideo: (v: Video) => void;
  onRefresh: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  videos,
  onSelectVideo,
  onRefresh
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('すべて');

  const categories = ['すべて', '音楽', 'ゲーム', 'アニメ', 'テクノロジー', '料理', '動物'];

  const filteredVideos =
    selectedCategory === 'すべて'
      ? videos
      : videos.filter((v) => v.category === selectedCategory);

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-12">
      {/* Category Filter Bar */}
      <div className="flex items-center justify-between gap-3 mb-6 pb-2 overflow-x-auto">
        <div className="flex items-center gap-2 shrink-0">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#0088cc] text-white shadow-xs'
                    : 'bg-[#292929] text-zinc-300 hover:bg-[#333] hover:text-white'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <button
          onClick={onRefresh}
          title="おすすめを再読み込み"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#444] text-zinc-300 hover:bg-[#2a2a2a] transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">シャッフル</span>
        </button>
      </div>

      {/* Header section title */}
      <div className="flex items-center gap-2 mb-4 px-1">
        <Sparkles className="w-4 h-4 text-amber-500" />
        <h2 className="text-base font-bold tracking-tight text-zinc-100">
          おすすめのニコニコ動画
        </h2>
      </div>

      {/* Videos Grid */}
      {filteredVideos.length === 0 ? (
        <div className="py-16 text-center text-zinc-400 text-sm">
          このカテゴリーの動画が見つかりませんでした。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {filteredVideos.map((video) => (
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
