import { useState } from 'react';
import PostStatusBadge from './PostStatusBadge';
import PostAccountsPanel from './PostAccountsPanel';
import { formatDate } from './StatusBadge';

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
