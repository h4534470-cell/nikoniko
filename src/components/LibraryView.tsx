import React, { useState } from 'react';
import { Video, ChannelSubscription, Playlist } from '../types';
import { VideoCard } from './VideoCard';
import {
  Plus,
  Play,
  Trash2,
  Tv,
  ListVideo,
  X,
  Check
} from 'lucide-react';

interface LibraryViewProps {
  subscriptions: ChannelSubscription[];
  playlists: Playlist[];
  onOpenChannel: (url: string, name: string) => void;
  onUnsubscribe: (url: string) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onRemoveFromPlaylist: (playlistId: string, videoId: string) => void;
  onSelectVideo: (v: Video) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  subscriptions,
  playlists,
  onOpenChannel,
  onUnsubscribe,
  onCreatePlaylist,
  onDeletePlaylist,
  onRemoveFromPlaylist,
  onSelectVideo
}) => {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState<boolean>(false);
  const [newPlaylistName, setNewPlaylistName] = useState<string>('');

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPlaylistName.trim()) {
      onCreatePlaylist(newPlaylistName.trim());
      setNewPlaylistName('');
      setIsCreatingPlaylist(false);
    }
  };

  return (
    <div className="w-full max-w-[1440px] mx-auto pb-12">
      {/* 1. Subscriptions Section */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#333]">
          <Tv className="w-5 h-5 text-[#0088cc]" />
          <h2 className="text-base font-bold text-zinc-100">
            フォロー中のユーザー ({subscriptions.length})
          </h2>
        </div>

        {subscriptions.length === 0 ? (
          <div className="p-8 text-center bg-[#222] rounded-xl text-zinc-400 text-xs">
            フォロー中のユーザーはいません。動画プレーヤーから「フォロー」ボタンで追加できます。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {subscriptions.map((sub) => (
              <div
                key={sub.url}
                className="p-3.5 rounded-xl border border-[#383838] bg-[#222] flex flex-col justify-between transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700 shrink-0 flex items-center justify-center font-bold text-xs text-zinc-200">
                    {sub.avatar ? (
                      <img
                        src={sub.avatar}
                        alt={sub.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{sub.name[0] || 'チ'}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold truncate text-zinc-100">{sub.name}</h4>
                    <p className="text-[11px] text-zinc-400">
                      {sub.subscriberCount
                        ? `フォロワー ${sub.subscriberCount.toLocaleString()}人`
                        : 'フォロー中'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-zinc-700/60">
                  <button
                    onClick={() => onOpenChannel(sub.url, sub.name)}
                    className="flex-1 py-1.5 px-2 bg-[#0088cc]/20 text-[#0088cc] rounded-lg text-xs font-bold hover:bg-[#0088cc]/30 transition-colors cursor-pointer"
                  >
                    開く
                  </button>
                  <button
                    onClick={() => onUnsubscribe(sub.url)}
                    className="py-1.5 px-2 text-zinc-400 hover:text-red-400 rounded-lg text-xs transition-colors cursor-pointer"
                    title="フォロー解除"
                  >
                    解除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Playlists / Mylist Section */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-4 pb-2 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <ListVideo className="w-5 h-5 text-[#0088cc]" />
            <h2 className="text-base font-bold text-zinc-100">
              マイリスト ({playlists.length})
            </h2>
          </div>

          <button
            onClick={() => setIsCreatingPlaylist(!isCreatingPlaylist)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0088cc] hover:bg-[#0077b3] text-white rounded-full text-xs font-bold transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新規作成</span>
          </button>
        </div>

        {/* Inline Create Playlist Form */}
        {isCreatingPlaylist && (
          <form
            onSubmit={handleCreateSubmit}
            className="mb-4 p-3.5 rounded-xl border border-[#444] bg-[#222] flex items-center gap-2"
          >
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="新しいマイリスト名を入力..."
              autoFocus
              className="flex-1 px-3 py-1.5 bg-[#181818] border border-[#555] rounded-lg text-xs text-white outline-none focus:border-[#0088cc]"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim()}
              className="px-3.5 py-1.5 bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-40"
            >
              作成
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingPlaylist(false)}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </form>
        )}

        {playlists.length === 0 ? (
          <div className="p-8 text-center bg-[#222] rounded-xl text-zinc-400 text-xs">
            マイリストがありません。「新規作成」からお好きなリストを作成できます。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all ${
                  selectedPlaylistId === pl.id
                    ? 'bg-[#282828] border-[#0088cc]'
                    : 'bg-[#222] border-[#383838]'
                }`}
              >
                <div>
                  <h4 className="text-xs font-bold mb-1 truncate text-zinc-100">{pl.name}</h4>
                  <p className="text-[11px] text-zinc-400 mb-3">
                    {pl.videos.length}本の動画
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-zinc-700/60">
                  <button
                    onClick={() =>
                      setSelectedPlaylistId(
                        selectedPlaylistId === pl.id ? null : pl.id
                      )
                    }
                    className="flex-1 py-1.5 px-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs font-bold transition-colors cursor-pointer text-zinc-200"
                  >
                    {selectedPlaylistId === pl.id ? '閉じる' : '中身を見る'}
                  </button>

                  <button
                    onClick={() => onDeletePlaylist(pl.id)}
                    className="py-1.5 px-2 text-zinc-400 hover:text-red-400 rounded-lg text-xs transition-colors cursor-pointer"
                    title="マイリストを削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Selected Playlist Videos detail */}
        {selectedPlaylist && (
          <div className="mt-8 p-5 rounded-2xl border border-zinc-700 bg-zinc-800/40">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="text-sm font-bold text-zinc-100">
                「{selectedPlaylist.name}」の動画 ({selectedPlaylist.videos.length}本)
              </h3>
              {selectedPlaylist.videos.length > 0 && (
                <button
                  onClick={() => onSelectVideo(selectedPlaylist.videos[0])}
                  className="flex items-center gap-1.5 px-3 py-1 bg-[#0088cc] hover:bg-[#0077b3] text-white rounded-full text-xs font-bold cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-white" />
                  <span>最初から再生</span>
                </button>
              )}
            </div>

            {selectedPlaylist.videos.length === 0 ? (
              <p className="text-xs text-zinc-400 py-6 text-center">
                このマイリストにはまだ動画が追加されていません。動画再生画面の「マイリスト」から追加できます。
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {selectedPlaylist.videos.map((vid) => (
                  <div key={vid.id} className="relative group">
                    <VideoCard
                      video={vid}
                      onClick={onSelectVideo}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromPlaylist(selectedPlaylist.id, vid.id);
                      }}
                      title="このリストから削除"
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/80 hover:bg-red-600 text-white text-xs opacity-0 group-hover:opacity-100 transition-all cursor-pointer shadow-sm"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
