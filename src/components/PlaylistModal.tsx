import React, { useState } from 'react';
import { Video, Playlist } from '../types';
import { Plus, Check, X, FolderPlus } from 'lucide-react';

interface PlaylistModalProps {
  video: Video | null;
  playlists: Playlist[];
  isOpen: boolean;
  onClose: () => void;
  onAddToPlaylist: (playlistId: string, video: Video) => void;
  onCreatePlaylist: (name: string) => void;
}

export const PlaylistModal: React.FC<PlaylistModalProps> = ({
  video,
  playlists,
  isOpen,
  onClose,
  onAddToPlaylist,
  onCreatePlaylist
}) => {
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

  if (!isOpen || !video) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    onCreatePlaylist(newPlaylistName.trim());
    setNewPlaylistName('');
  };

  const handleAdd = (playlistId: string) => {
    onAddToPlaylist(playlistId, video);
    setAddedIds((prev) => ({ ...prev, [playlistId]: true }));
    setTimeout(() => {
      setAddedIds((prev) => ({ ...prev, [playlistId]: false }));
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
      <div className="relative w-full max-w-sm bg-white text-zinc-900 rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-200">
          <h2 className="text-base font-bold flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-blue-600" />
            <span>再生リストに保存</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Existing Playlists */}
        <div className="max-h-56 overflow-y-auto space-y-2 mb-4">
          {playlists.map((pl) => {
            const isAlreadyAdded = pl.videos.some((v) => v.id === video.id);
            const justAdded = addedIds[pl.id];

            return (
              <div
                key={pl.id}
                className="flex items-center justify-between p-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 transition-colors"
              >
                <div className="min-w-0 pr-2">
                  <h4 className="text-xs font-bold truncate">{pl.name}</h4>
                  <p className="text-[10px] text-zinc-400">
                    {pl.videos.length}本の動画
                  </p>
                </div>

                <button
                  onClick={() => handleAdd(pl.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    justAdded || isAlreadyAdded
                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {justAdded || isAlreadyAdded ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>追加済</span>
                    </>
                  ) : (
                    <span>追加</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Create new playlist input */}
        <form onSubmit={handleCreate} className="pt-3 border-t border-zinc-200">
          <label className="block text-xs font-bold text-zinc-600 mb-1.5">
            新しい再生リストを作成
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="リスト名を入力..."
              className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-zinc-300 outline-none"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim()}
              className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>作成</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
