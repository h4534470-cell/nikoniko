import React, { useState, useEffect } from 'react';
import { Review } from '../types';
import { getReviews, getMyReview, saveReview } from '../utils/storage';
import { CheckCircle, MessageSquare } from 'lucide-react';

export const ReviewsView: React.FC = () => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [commentText, setCommentText] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [hasMyReview, setHasMyReview] = useState<boolean>(false);

  useEffect(() => {
    loadReviewData();
  }, []);

  const loadReviewData = () => {
    const list = getReviews();
    setReviews(list);
    const mine = getMyReview();
    if (mine) {
      setHasMyReview(true);
      setSelectedRating(mine.rating);
      setCommentText(mine.comment);
    }
  };

  const averageRating =
    reviews.length > 0
      ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
      : 5.0;

  const handleStarClick = (rating: number) => {
    setSelectedRating(rating);
    setStatusMsg('');
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chars = Array.from(e.target.value);
    if (chars.length <= 20) {
      setCommentText(e.target.value);
    } else {
      setCommentText(chars.slice(0, 20).join(''));
    }
    setStatusMsg('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRating === 0) {
      setStatusMsg('星の評価を選択してください。');
      return;
    }

    const { reviews: updatedList, updated } = saveReview(
      selectedRating,
      commentText
    );
    setReviews(updatedList);
    setHasMyReview(true);
    setStatusMsg(
      updated ? 'レビューを更新しました！' : 'レビューを投稿しました！'
    );
  };

  const formatReviewDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="w-full max-w-[680px] mx-auto pb-16 px-2">
      {/* Hero: Site Rating Stats */}
      <div className="p-6 sm:p-8 rounded-2xl border border-[#383838] bg-[#222222] text-center mb-6">
        <h2 className="text-base font-bold text-zinc-400 mb-2">このサイトの評価</h2>

        <div className="flex items-center justify-center gap-4 my-2">
          <div className="text-6xl sm:text-7xl font-extrabold tracking-tight tabular-nums text-white">
            {averageRating.toFixed(1)}
          </div>
          <div className="text-left text-xs text-zinc-400">
            <div className="font-semibold text-zinc-300">平均評価</div>
            <div className="tabular-nums">（{reviews.length}件）</div>
          </div>
        </div>

        {/* Big gold stars */}
        <div className="flex items-center justify-center gap-1 text-amber-400 text-2xl tracking-wider my-3">
          {[1, 2, 3, 4, 5].map((star) => (
            <span key={star}>
              {star <= Math.round(averageRating) ? '★' : '☆'}
            </span>
          ))}
        </div>
      </div>

      {/* Review Form Card */}
      <form
        onSubmit={handleSubmit}
        className="p-6 sm:p-8 rounded-2xl border border-[#383838] bg-[#222222] mb-8"
      >
        <h3 className="text-sm sm:text-base font-bold mb-1 text-white">
          {hasMyReview ? 'あなたのレビュー（編集可能）' : 'このサイトを評価'}
        </h3>
        <p className="text-xs text-zinc-400 mb-4">
          星だけでも投稿できます。この端末からは1回投稿でき、後から内容をいつでも変更できます。
        </p>

        {/* Star Picker */}
        <div className="flex items-center gap-2 mb-4" aria-label="星評価の選択">
          {[1, 2, 3, 4, 5].map((star) => {
            const isSelected = star <= selectedRating;
            return (
              <button
                key={star}
                type="button"
                onClick={() => handleStarClick(star)}
                aria-label={`星${star}つ`}
                className={`text-3xl transition-transform hover:scale-110 cursor-pointer ${
                  isSelected ? 'text-amber-400' : 'text-zinc-600'
                }`}
              >
                ★
              </button>
            );
          })}
        </div>

        {/* Comment input row */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative flex-1">
            <input
              type="text"
              value={commentText}
              onChange={handleCommentChange}
              maxLength={20}
              placeholder="ひとこと（任意・20文字以内）"
              className="w-full py-2.5 px-3 rounded-xl border border-[#444] bg-[#1a1a1a] text-white placeholder-zinc-500 text-sm outline-none focus:border-[#0088cc]"
            />
            <span className="absolute right-3 top-3 text-[11px] text-zinc-500 tabular-nums">
              {Array.from(commentText).length} / 20文字
            </span>
          </div>

          <button
            type="submit"
            className="px-6 py-2.5 rounded-xl bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-xs"
          >
            {hasMyReview ? '編集を保存' : '投稿する'}
          </button>
        </div>

        {statusMsg && (
          <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-400 font-semibold">
            <CheckCircle className="w-4 h-4" />
            <span>{statusMsg}</span>
          </div>
        )}
      </form>

      {/* Community Reviews List */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-4 h-4 text-zinc-400" />
          <h3 className="text-sm font-bold text-zinc-200">みんなのレビュー ({reviews.length})</h3>
        </div>

        <div className="flex flex-col gap-3">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-xl border border-[#333] bg-[#1e1e1e]"
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#0088cc]/20 text-[#0088cc] flex items-center justify-center font-bold text-xs shrink-0">
                    {r.iconInitial || 'ユ'}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-200">{r.displayName}</h4>
                    <p className="text-[10px] text-zinc-500">
                      {formatReviewDate(r.updatedAt || r.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="text-amber-400 text-sm tracking-widest">
                  {'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)}
                </div>
              </div>

              {r.comment && (
                <p className="text-xs sm:text-sm text-zinc-300 mt-2 pl-10 leading-normal">
                  {r.comment}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
