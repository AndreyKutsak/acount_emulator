import { useEffect, useState } from 'react';
import { updatePostAccount, publishPostNow, refreshPostMetrics } from '../api/posts';
import { formatDate } from './StatusBadge';

function AccountRow({ postId, entry, onChange }) {
  const [views, setViews] = useState(entry.views);
  const [likes, setLikes] = useState(entry.likes);
  const [comments, setComments] = useState(entry.comments);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  useEffect(() => {
    setViews(entry.views);
    setLikes(entry.likes);
    setComments(entry.comments);
  }, [entry.views, entry.likes, entry.comments]);

  const accountLabel = entry.account
    ? `${entry.account.platform}: ${entry.account.username}`
    : 'Акаунт видалено';

  const handleMarkPublished = async () => {
    if (!entry.account) return;
    await updatePostAccount(postId, entry.account._id, { status: 'published' });
    onChange();
  };

  const handleSaveMetrics = async () => {
    if (!entry.account) return;
    await updatePostAccount(postId, entry.account._id, { views, likes, comments });
    onChange();
  };

  const handlePublishNow = async () => {
    if (!entry.account) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await publishPostNow(postId, entry.account._id);
      onChange();
    } catch (err) {
      setPublishError(err.response?.data?.message || 'Не вдалося опублікувати');
    } finally {
      setPublishing(false);
    }
  };

  const handleRefreshMetrics = async () => {
    if (!entry.account) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshPostMetrics(postId, entry.account._id);
      onChange();
    } catch (err) {
      setRefreshError(err.response?.data?.message || 'Не вдалося оновити метрики');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <tr>
      <td data-label="Акаунт">
        {accountLabel}
        {entry.postUrl && (
          <>
            {' '}
            <a href={entry.postUrl} target="_blank" rel="noreferrer">
              відкрити
            </a>
          </>
        )}
      </td>
      <td data-label="Статус">
        <span className={`session-status session-${entry.status === 'published' ? 'active' : 'closed'}`}>
          {entry.status === 'published' ? 'Опубліковано' : entry.status === 'failed' ? 'Помилка' : 'Очікує'}
        </span>
      </td>
      <td data-label="Опубліковано">{formatDate(entry.publishedAt)}</td>
      <td data-label="Перегляди">
        <input
          type="number"
          value={views}
          onChange={(e) => setViews(Number(e.target.value))}
          className="metric-input"
        />
      </td>
      <td data-label="Лайки">
        <input
          type="number"
          value={likes}
          onChange={(e) => setLikes(Number(e.target.value))}
          className="metric-input"
        />
      </td>
      <td data-label="Коментарі">
        <input
          type="number"
          value={comments}
          onChange={(e) => setComments(Number(e.target.value))}
          className="metric-input"
        />
      </td>
      <td className="vpn-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={handlePublishNow}
          disabled={!entry.account || publishing}
          title="Реальний автопостинг через Playwright"
        >
          {publishing ? 'Публікація...' : 'Опублікувати'}
        </button>
        <button
          className="btn btn-sm"
          onClick={handleRefreshMetrics}
          disabled={!entry.account || !entry.postUrl || refreshing}
          title={entry.postUrl ? 'Зняти перегляди/лайки/коментарі з реальної сторінки' : 'Немає збереженого URL поста'}
        >
          {refreshing ? 'Оновлення...' : 'Оновити метрики'}
        </button>
        {entry.status !== 'published' && (
          <button className="btn btn-sm" onClick={handleMarkPublished} disabled={!entry.account}>
            Позначити вручну
          </button>
        )}
        <button className="btn btn-sm" onClick={handleSaveMetrics} disabled={!entry.account}>
          Зберегти метрики
        </button>
        {publishError && <span className="error-inline">{publishError}</span>}
        {refreshError && <span className="error-inline">{refreshError}</span>}
      </td>
    </tr>
  );
}

export default function PostAccountsPanel({ post, onChange }) {
  return (
    <div className="table-wrap">
      <table className="sessions-table">
        <thead>
          <tr>
            <th>Акаунт</th>
            <th>Статус</th>
            <th>Опубліковано</th>
            <th>Перегляди</th>
            <th>Лайки</th>
            <th>Коментарі</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {post.accounts.map((entry, index) => (
            <AccountRow
              key={entry.account?._id || index}
              postId={post._id}
              entry={entry}
              onChange={onChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
