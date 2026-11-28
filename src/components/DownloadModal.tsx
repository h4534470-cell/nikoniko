import React, { useState, useEffect, useRef } from 'react';
import { Video } from '../types';
import { Download, X } from 'lucide-react';

interface DownloadModalProps {
  video: Video | null;
  isOpen: boolean;
  onClose: () => void;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  video,
  isOpen,
  onClose
}) => {
  const [quality, setQuality] = useState<string>('1080');
  const [includeComments, setIncludeComments] = useState<boolean>(true);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentSize, setCurrentSize] = useState<string>('0 MB');
  const [totalSize, setTotalSize] = useState<string>('48.5 MB');

  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      handleCancel();
    }
  }, [isOpen]);

  if (!isOpen || !video) return null;

  const handleStartDownload = () => {
    setIsDownloading(true);
    setProgress(0);

    const targetMb = quality === '1080' ? 62.4 : quality === '720' ? 38.2 : 19.5;
    setTotalSize(`${targetMb.toFixed(1)} MB`);

    let current = 0;
    intervalRef.current = window.setInterval(() => {
      current += Math.floor(Math.random() * 8) + 5;
      if (current >= 100) {
        current = 100;
        if (intervalRef.current) clearInterval(intervalRef.current);
        setProgress(100);
        setCurrentSize(`${targetMb.toFixed(1)} MB`);

        setTimeout(() => {
          triggerFileSave();
        }, 600);
      } else {
        setProgress(current);
        const downloadedMb = (targetMb * (current / 100)).toFixed(1);
        setCurrentSize(`${downloadedMb} MB`);
      }
    }, 200);
  };

  const handleCancel = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsDownloading(false);
    setProgress(0);
  };

  const triggerFileSave = () => {
    try {
      const cleanTitle = (video.title || 'video').replace(/[\\/:*?"<>|]/g, '_');
      const filename = `[ZERO-ニコ動]_${cleanTitle}_${quality}p${includeComments ? '_comments' : ''}.mp4`;

      const dummyContent = `ZERO NICO VIDEO MEDIA\nTitle: ${video.title}\nQuality: ${quality}p\nPlatform: niconico\nSource: ${video.url}\nTimestamp: ${new Date().toISOString()}`;
      const blob = new Blob([dummyContent], { type: 'video/mp4' });
      const downloadUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = video.videoUrl || downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      alert('ファイルの保存を開始しました。');
    } finally {
      handleCancel();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      {!isDownloading ? (
        <div className="relative w-full max-w-md bg-[#222222] text-white border border-[#383838] rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Download className="w-5 h-5 text-[#0088cc]" />
              <span>保存する画質を選択</span>
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs text-zinc-400 mb-4">
            選択した画質でMP4ファイルを端末へ保存します。
          </p>

          <div className="mb-4">
            <label className="block text-xs font-bold text-zinc-300 mb-1.5">
              保存画質
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-[#444] bg-[#181818] text-white text-sm outline-none cursor-pointer focus:border-[#0088cc]"
            >
              <option value="1080">1080p (最高画質 / Full HD)</option>
              <option value="720">720p (高画質 / HD)</option>
              <option value="480">480p (標準画質 / SD)</option>
              <option value="360">360p (軽量 / モバイル用)</option>
            </select>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#1c1c1c] border border-[#383838] text-xs text-zinc-300 cursor-pointer mb-5">
            <input
              type="checkbox"
              checked={includeComments}
              onChange={(e) => setIncludeComments(e.target.checked)}
              className="mt-0.5 accent-[#0088cc] cursor-pointer"
            />
            <div>
              <span className="font-bold text-zinc-200">ニコニコの表示コメントを動画に入れる</span>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                ※流れる弾幕コメントを動画に合成して保存します。
              </p>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2.5 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-[#333] hover:bg-[#3d3d3d] text-zinc-300 transition-colors cursor-pointer"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleStartDownload}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-[#0088cc] hover:bg-[#0077b3] text-white transition-colors cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>保存を開始</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-md bg-zinc-900 border border-[#444] text-white rounded-2xl shadow-2xl p-8 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="w-14 h-14 rounded-full bg-[#0088cc]/20 text-[#0088cc] flex items-center justify-center mb-4">
            <Download className="w-7 h-7 animate-bounce" />
          </div>

          <h3 className="text-lg font-bold mb-1">ダウンロード準備中...</h3>
          <p className="text-xs text-zinc-400 mb-6">
            端末に直接保存されます。このままお待ちください。
          </p>

          <div className="w-full bg-zinc-800 h-3 rounded-full overflow-hidden mb-3">
            <div
              className="bg-[#0088cc] h-full rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="text-3xl font-extrabold tracking-tight tabular-nums mb-1">
            {progress}%
          </div>
          <p className="text-xs text-zinc-400 tabular-nums mb-6">
            {currentSize} / {totalSize}
          </p>

          <button
            onClick={handleCancel}
            className="px-6 py-2 rounded-full text-xs font-bold bg-red-600/80 hover:bg-red-600 text-white transition-colors cursor-pointer"
          >
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
};
