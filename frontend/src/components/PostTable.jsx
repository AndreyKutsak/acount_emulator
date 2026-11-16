import { useState } from 'react';
import PostStatusBadge from './PostStatusBadge';
import PostAccountsPanel from './PostAccountsPanel';
import { formatDate } from './StatusBadge';

const ENTRY_STATUS = {
  published: ['Опубліковано', 'post-status-published_all'],
  pending: ['Очікує', 'post-status-active'],
  failed: ['Помилка', 'status-offline'],
};

// Один акаунт поста: хто публікує, статус і метрики саме цієї публікації.
function PostAccountRow({ entry }) {
  const account = entry.account || {};
  const [label, cls] = ENTRY_STATUS[entry.status] || [entry.status, 'status-unknown'];
  const name = account.displayName || account.username || 'видалений акаунт';
  const published = entry.status === 'published';
  const counters = [
    ['Перегляди', entry.views],
    ['Лайки', entry.likes],
    ['Коментарі', entry.comments],
    ['Репости', entry.reposts],
    ['Поширення', entry.shares],
  ].filter(([, value], idx) => idx < 3 || value > 0);

  return (
    <li className="post-account">
      <div className="post-account-who">
        <strong>{name}</strong>
        {account.username && account.displayName && (
          <span className="muted">@{account.username}</span>
        )}
        {account.platform && <span className="post-account-platform">{account.platform}</span>}
      </div>
      <div className="post-account-status">
        <span className={`status-badge ${cls}`}>{label}</span>
        {published && entry.publishedAt && (
          <span className="muted">{formatDate(entry.publishedAt)}</span>
        )}
        {entry.postUrl && (
          <a href={entry.postUrl} target="_blank" rel="noreferrer">
            відкрити
          </a>
        )}
      </div>
      {published && (
        <div className="post-account-metrics">
          {counters.map(([title, value]) => (
            <span key={title}>
              <strong>{value || 0}</strong> {title.toLowerCase()}
            </span>
          ))}
          <span className="muted post-account-updated">
            {entry.metricsUpdatedAt
              ? `оновлено ${formatDate(entry.metricsUpdatedAt)}`
              : 'метрики ще не збирались'}
          </span>
        </div>
      )}
    </li>
  );
}

export default function PostTable({ posts, onDelete, onEdit, onChange }) {
  const [expandedId, setExpandedId] = useState(null);

  const toggle = (id) => setExpandedId((previous) => (previous === id ? null : id));

  if (!posts.length) {
    return (
      <div className="empty-state posts-empty">
        <span className="posts-empty-icon" aria-hidden="true">✎</span>
        <strong>Публікацій поки немає</strong>
        <span>Створіть пост, щоб підготувати першу публікацію.</span>
      </div>
    );
  }

  return (
    <div className="posts-list">
      {posts.map((post) => {
        const expanded = expandedId === post._id;
        const metrics = post.metrics || {};

        return (
          <article className="post-card" key={post._id}>
            <div className="post-card-main">
              <div className="post-card-topline">
                <PostStatusBadge status={post.overallStatus} />
                <span className="post-schedule">
                  {post.scheduledAt
                    ? `Заплановано: ${formatDate(post.scheduledAt)}`
                    : 'Без розкладу'}
                </span>
              </div>

              <p className="post-card-text">{post.text || 'Пост без тексту'}</p>

              <div className="post-card-meta">
                <span>{post.images?.length || 0} медіа</span>
                <span>{post.accounts?.length || 0} акаунтів</span>
              </div>

              <div className="post-card-stats" aria-label="Статистика публікації">
                <div>
                  <strong>{metrics.views || 0}</strong>
                  <span>Перегляди</span>
                </div>
                <div>
                  <strong>{metrics.likes || 0}</strong>
                  <span>Лайки</span>
                </div>
                <div>
                  <strong>{metrics.comments || 0}</strong>
                  <span>Коментарі</span>
                </div>
              </div>

              {post.accounts?.length > 0 && (
                <ul className="post-accounts" aria-label="Публікація по акаунтах">
                  {post.accounts.map((entry, i) => (
                    <PostAccountRow key={entry.account?._id || i} entry={entry} />
                  ))}
                </ul>
              )}

              <div className="post-card-actions">
                <button className="btn btn-primary btn-sm" onClick={() => onEdit(post)}>
                  Редагувати
                </button>
                <button className="btn btn-sm" onClick={() => toggle(post._id)}>
                  {expanded ? 'Сховати акаунти' : 'Акаунти та публікація'}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => onDelete(post._id)}
                >
                  Видалити
                </button>
              </div>
            </div>

            {expanded && (
              <div className="post-card-details">
                <PostAccountsPanel post={post} onChange={onChange} />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
