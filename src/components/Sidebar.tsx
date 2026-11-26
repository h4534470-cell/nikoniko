import React from 'react';
import { Home, History, FolderHeart, Star, Settings } from 'lucide-react';
import { ViewType } from '../types';

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  isOpen: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onViewChange,
  isOpen
}) => {
  const navItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'ホーム', icon: <Home className="w-5 h-5" /> },
    { id: 'history', label: '履歴', icon: <History className="w-5 h-5" /> },
    { id: 'library', label: 'ライブラリ', icon: <FolderHeart className="w-5 h-5" /> },
    { id: 'reviews', label: 'レビュー', icon: <Star className="w-5 h-5" /> },
    { id: 'settings', label: '設定', icon: <Settings className="w-5 h-5" /> }
  ];

  if (!isOpen) return null;

  return (
    <aside className="hidden md:flex flex-col items-center w-[72px] shrink-0 fixed top-14 left-0 bottom-0 z-40 py-2 border-r transition-colors overflow-y-auto bg-[#1e1e1e] border-[#333] text-zinc-300">
      <div className="flex flex-col w-full gap-1">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`flex flex-col items-center justify-center py-3.5 px-1 rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'text-[#0088cc] font-bold bg-[#292929]'
                  : 'hover:bg-[#2a2a2a] text-zinc-400 hover:text-white'
              }`}
            >
              <div className="mb-1">{item.icon}</div>
              <span className="text-[10px] tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
