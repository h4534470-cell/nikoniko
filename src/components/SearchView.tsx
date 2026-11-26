import React, { useState } from 'react';
import { Video } from '../types';
import { VideoCard } from './VideoCard';
import { Search, Play, ChevronLeft, ChevronRight, Link as LinkIcon } from 'lucide-react';

interface SearchViewProps {
  query: string;
  videos: Video[];
  onSelectVideo: (v: Video) => void;
  onDirectPlayUrl?: (url: string) => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  query,
  videos,
  onSelectVideo,
  onDirectPlayUrl
}) => {
  const [currentPage, setCurrentPage] = useState<number>(0);
  const itemsPerPage = 6;

  const isNicoUrl = /nicovideo\.jp\/watch\/|sm\d+/i.test(query);

  const searchResults = videos.filter((v) => {
    const q = query.toLowerCase();
    return (
      v.title.toLowerCase().includes(q) ||
      v.channel.toLowerCase().includes(q) ||
      (v.description && v.description.toLowerCase().includes(q)) ||
      (v.category && v.category.toLowerCase().includes(q)) ||
      (v.nicoId && v.nicoId.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(searchResults.length / itemsPerPage));
  const displayedVideos = searchResults.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-12">
      {/* Search Header */}
      <div className="flex items-center justify-between gap-4 mb-6 pb-2 border-b border-[#333]">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-[#0088cc]" />
          <h2 className="text-base md:text-lg font-bold text-zinc-100">
            「{query}」の検索結果 ({searchResults.length}件)
          </h2>
        </div>
      </div>

      {/* Direct URL Detection Card */}
      {isNicoUrl && onDirectPlayUrl && (
        <div
          onClick={() => onDirectPlayUrl(query)}
          className="mb-6 p-4 rounded-xl border border-[#444] bg-[#292929] hover:border-[#0088cc] flex items-center justify-between gap-4 cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#0088cc] text-white flex items-center justify-center shrink-0">
              <LinkIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">指定されたsm番号 / URLを直接再生</h3>
              <p className="text-xs text-zinc-400 truncate max-w-md">{query}</p>
            </div>
          </div>
          <button className="px-4 py-2 rounded-lg bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>再生する</span>
          </button>
        </div>
      )}

      {/* Results Grid */}
      {searchResults.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-zinc-400 text-sm mb-2">
            該当する動画が見つかりませんでした。
          </p>
          <p className="text-xs text-zinc-500">
            sm番号やキーワード（例: ボカロ, ゆっくり実況, アニメ）で検索してみてください。
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
            {displayedVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onClick={onSelectVideo}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-3 mt-10">
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className={`flex items-center gap-1 px-4 py-2 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                currentPage === 0
                  ? 'opacity-40 cursor-not-allowed border-zinc-800 text-zinc-600'
                  : 'border-[#444] text-white hover:bg-[#333]'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>前のページ</span>
            </button>

            <span className="text-xs font-semibold px-2 tabular-nums text-zinc-400">
              {currentPage + 1} / {totalPages} ページ目
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className={`flex items-center gap-1 px-4 py-2 rounded-full border text-xs font-bold transition-all cursor-pointer ${
                currentPage >= totalPages - 1
                  ? 'opacity-40 cursor-not-allowed border-zinc-800 text-zinc-600'
                  : 'border-[#444] text-white hover:bg-[#333]'
              }`}
            >
              <span>次のページ</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};
