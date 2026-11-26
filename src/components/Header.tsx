import React from 'react';
import { Menu, Search, Eye, Tv } from 'lucide-react';

interface HeaderProps {
  onToggleSidebar: () => void;
  onLogoClick: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  visitCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onLogoClick,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  visitCount
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchSubmit();
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center justify-between px-3 md:px-5 bg-[#252525] border-b border-[#383838] text-white">
      {/* Left: Menu & Brand */}
      <div className="flex items-center gap-3 md:gap-5 min-w-[200px]">
        <button
          onClick={onToggleSidebar}
          aria-label="メニューを開閉"
          className="p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-[#333333] text-white"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div
          onClick={onLogoClick}
          className="flex items-center gap-2 cursor-pointer select-none group"
        >
          <div className="w-7 h-5 rounded border border-white/80 flex items-center justify-center text-white bg-transparent">
            <Tv className="w-3.5 h-3.5" />
          </div>

          <span className="font-bold text-lg tracking-tight font-sans">
            muraにこ動画
          </span>

          <span
            className="hidden sm:flex items-center gap-1 text-[11px] font-normal text-zinc-400 ml-1.5"
            title="総アクセス数"
          >
            <Eye className="w-3 h-3 text-zinc-400" />
            <span className="tabular-nums">{visitCount.toLocaleString()}</span>
          </span>
        </div>
      </div>

      {/* Center: Search input */}
      <div className="flex items-center flex-1 max-w-[560px] mx-2 md:mx-6">
        <div className="relative w-full flex items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ニコニコ動画を検索、またはURL (sm番号)"
            className="w-full h-9 md:h-10 pl-4 pr-10 rounded-l-full border text-sm outline-none bg-[#1e1e1e] border-[#444] text-white placeholder-zinc-400 focus:border-[#0088cc] transition-colors"
          />
          <button
            onClick={onSearchSubmit}
            aria-label="検索"
            className="h-9 md:h-10 px-4 md:px-5 border border-l-0 rounded-r-full flex items-center justify-center cursor-pointer bg-[#333] border-[#444] hover:bg-[#3d3d3d] text-zinc-200 transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right area: badge indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs px-2.5 py-1 rounded-full bg-[#333] border border-[#444] text-[#0088cc] font-bold">
          ニコニコ
        </span>
      </div>
    </header>
  );
};
