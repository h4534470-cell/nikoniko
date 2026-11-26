import React, { useState } from 'react';
import { Video } from '../types';
import { VideoCard } from './VideoCard';
import { Trash2, History as HistoryIcon, Check, X } from 'lucide-react';

interface HistoryViewProps {
  historyVideos: Video[];
  onSelectVideo: (v: Video) => void;
  onClearHistory: () => void;
  onGoHome: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  historyVideos,
  onSelectVideo,
  onClearHistory,
  onGoHome
}) => {
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(false);

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-12">
      <div className="flex items-center justify-between gap-4 mb-6 pb-2 border-b border-[#333]">
        <div className="flex items-center gap-2">
          <HistoryIcon className="w-5 h-5 text-[#0088cc]" />
          <h1 className="text-base md:text-lg font-bold text-zinc-100">
            視聴履歴 ({historyVideos.length}件)
          </h1>
        </div>

        {historyVideos.length > 0 && (
          <div>
            {!isConfirmingClear ? (
              <button
                onClick={() => setIsConfirmingClear(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-900/50 text-red-400 hover:bg-red-950/40 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>履歴を削除</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-red-950/60 border border-red-800 rounded-full px-3 py-1 text-xs">
                <span className="text-red-300 font-medium mr-1">削除しますか？</span>
                <button
                  onClick={() => {
                    onClearHistory();
                    setIsConfirmingClear(false);
                  }}
                  className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold transition-colors cursor-pointer"
                >
                  はい
                </button>
                <button
                  onClick={() => setIsConfirmingClear(false)}
                  className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded font-medium transition-colors cursor-pointer"
                >
                  いいえ
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {historyVideos.length === 0 ? (
        <div className="py-20 text-center flex flex-col items-center justify-center">
          <HistoryIcon className="w-12 h-12 text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm mb-1 font-medium">
            視聴履歴がありません。
          </p>
          <p className="text-xs text-zinc-500 mb-4">
            再生した動画がここに自動的に記録されます。
          </p>
          <button
            onClick={onGoHome}
            className="px-4 py-2 bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs font-bold rounded-full transition-colors cursor-pointer"
          >
            動画を見つける
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {historyVideos.map((video) => (
            <VideoCard
              key={`${video.id}-hist`}
              video={video}
              onClick={onSelectVideo}
            />
          ))}
        </div>
      )}
    </div>
  );
};
