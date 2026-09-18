import { Fragment, useState } from 'react';
import PostStatusBadge from './PostStatusBadge';
import PostAccountsPanel from './PostAccountsPanel';
import { formatDate } from './StatusBadge';

export default function PostTable({ posts, onDelete, onChange }) {
  const [expandedId, setExpandedId] = useState(null);

  const toggle = (id) => setExpandedId((prev) => (prev === id ? null : id));

  if (!posts.length) return <p className="empty-state">Постів ще немає</p>;

  return (
    <div className="table-wrap">
      <table className="vpn-table">
        <thead>
          <tr>
            <th>Текст</th>
            <th>Фото</th>
            <th>Час публікації</th>
            <th>Статус</th>
            <th>Перегляди</th>
            <th>Лайки</th>
            <th>Коментарі</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <Fragment key={post._id}>
              <tr className="vpn-row">
                <td className="post-text-cell" data-label="Текст">{post.text || '-'}</td>
                <td data-label="Фото">{post.images.length}</td>
                <td data-label="Час публікації">{formatDate(post.scheduledAt)}</td>
                <td data-label="Статус">
                  <PostStatusBadge status={post.overallStatus} />
                </td>
                <td data-label="Перегляди">{post.metrics.views}</td>
                <td data-label="Лайки">{post.metrics.likes}</td>
                <td data-label="Коментарі">{post.metrics.comments}</td>
                <td className="vpn-actions">
                  <button className="btn btn-sm" onClick={() => toggle(post._id)}>
                    {expandedId === post._id ? 'Сховати' : 'Деталі'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(post._id)}>
                    Видалити
                  </button>
                </td>
              </tr>
              {expandedId === post._id && (
                <tr className="vpn-row-expanded">
                  <td colSpan={8}>
                    <PostAccountsPanel post={post} onChange={onChange} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
