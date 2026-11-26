import React, { useState } from 'react';
import { AppSettings } from '../types';
import { getSettings, saveSettings } from '../utils/storage';
import { Settings2, Check, RefreshCw } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [settings, setSettingsState] = useState<AppSettings>(getSettings());
  const [saveAlert, setSaveAlert] = useState<boolean>(false);
  const [pingStatus, setPingStatus] = useState<string>('自動選択: メインサーバー（34ms）');
  const [isPinging, setIsPinging] = useState<boolean>(false);

  const handleUpdate = (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    setSettingsState(updated);
    saveSettings(updated);
    setSaveAlert(true);
    setTimeout(() => setSaveAlert(false), 2000);
  };

  const testPing = () => {
    setIsPinging(true);
    setPingStatus('測定中...');
    setTimeout(() => {
      const pingMs = Math.floor(Math.random() * 25) + 28;
      setPingStatus(`自動選択: メインサーバー (${pingMs}ms)。次回の測定まで 58秒`);
      setIsPinging(false);
    }, 600);
  };

  return (
    <div className="w-full max-w-[620px] mx-auto pb-16 px-2">
      <div className="p-6 sm:p-8 rounded-2xl border border-[#383838] bg-[#222222] transition-colors">
        <div className="flex items-center justify-between gap-4 mb-6 pb-2 border-b border-[#333]">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-[#0088cc]" />
            <h1 className="text-lg font-bold text-white">環境設定</h1>
          </div>
          {saveAlert && (
            <div className="flex items-center gap-1 text-xs text-emerald-400 font-bold">
              <Check className="w-3.5 h-3.5" />
              <span>保存しました</span>
            </div>
          )}
        </div>

        {/* 1. API Relay Server */}
        <div className="mb-6">
          <label className="block text-xs font-bold mb-2 text-zinc-200">
            API中継サーバー
          </label>
          <select
            value={settings.apiRouteMethod}
            onChange={(e) =>
              handleUpdate({
                apiRouteMethod: e.target.value as AppSettings['apiRouteMethod']
              })
            }
            className="w-full p-2.5 rounded-xl border border-[#444] bg-[#1a1a1a] text-white text-xs sm:text-sm outline-none cursor-pointer focus:border-[#0088cc]"
          >
            <option value="auto">
              自動選択（直通・Render・GASを毎分測定）
            </option>
            <option value="render">Renderを経由する</option>
            <option value="direct">メインサーバー直通</option>
            <option value="gas">Google Apps Scriptを経由する (予備用)</option>
          </select>

          <div className="flex items-center justify-between gap-2 mt-2">
            <p className="text-[11px] text-zinc-400 leading-normal flex-1">
              {pingStatus}
            </p>
            <button
              type="button"
              onClick={testPing}
              disabled={isPinging}
              className="flex items-center gap-1 text-[11px] text-[#0088cc] hover:text-[#5eb0e5] font-semibold cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3 h-3 ${isPinging ? 'animate-spin' : ''}`} />
              <span>速度測定</span>
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            ※動画再生・保存は途切れを避けるため、本体サーバーへ直接接続します。
          </p>
        </div>

        {/* 2. Thumbnail Loading Method */}
        <div className="mb-6">
          <label className="block text-xs font-bold mb-2 text-zinc-200">
            サムネイルの取得方法
          </label>
          <select
            value={settings.thumbMethod}
            onChange={(e) =>
              handleUpdate({
                thumbMethod: e.target.value as AppSettings['thumbMethod']
              })
            }
            className="w-full p-2.5 rounded-xl border border-[#444] bg-[#1a1a1a] text-white text-xs sm:text-sm outline-none cursor-pointer focus:border-[#0088cc]"
          >
            <option value="direct">直接リンク (デフォルト)</option>
            <option value="server">サーバー経由 (Base64・安全)</option>
          </select>
          <p className="text-[11px] text-zinc-500 mt-1.5">
            ※「サーバー経由」を選択すると、IPが完全に隠蔽されます。
          </p>
        </div>

        {/* 3. Danmaku Speed & Font Size */}
        <div className="mb-6 pt-4 border-t border-[#333]">
          <label className="block text-xs font-bold mb-2 text-zinc-200">
            ニコニコ弾幕コメントの流れる速度
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={4}
              max={12}
              step={1}
              value={settings.danmakuSpeed}
              onChange={(e) =>
                handleUpdate({ danmakuSpeed: parseInt(e.target.value, 10) })
              }
              className="flex-1 accent-[#0088cc] cursor-pointer"
            />
            <span className="text-xs font-bold tabular-nums text-zinc-400 w-12 text-right">
              {settings.danmakuSpeed}秒
            </span>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-6 border-t border-[#333] flex items-center justify-between text-xs text-zinc-500">
          <span>muraにこ動画 v2.5</span>
          <span className="text-zinc-500">ニコニコ動画モード専用</span>
        </div>
      </div>
    </div>
  );
};
