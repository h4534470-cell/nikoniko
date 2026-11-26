import React from 'react';
import { Home, History, FolderHeart, Star, Settings } from 'lucide-react';
import { ViewType } from '../types';

interface BottomNavProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentView,
  onViewChange
}) => {
  const navItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'ホーム', icon: <Home className="w-5 h-5" /> },
    { id: 'history', label: '履歴', icon: <History className="w-5 h-5" /> },
    { id: 'library', label: 'ライブラリ', icon: <FolderHeart className="w-5 h-5" /> },
    { id: 'reviews', label: 'レビュー', icon: <Star className="w-5 h-5" /> },
    { id: 'settings', label: '設定', icon: <Settings className="w-5 h-5" /> }
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 z-50 flex items-center justify-around border-t transition-colors bg-[#252525] border-[#383838] text-zinc-300">
      {navItems.map((item) => {
        const isActive = currentView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
              isActive
                ? 'text-[#0088cc] font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <div className="mb-0.5">{item.icon}</div>
            <span className="text-[10px]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
