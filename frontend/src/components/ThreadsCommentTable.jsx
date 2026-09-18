import { useState } from 'react';
import { replyThreadsComment, setThreadsCommentStatus, deleteThreadsComment } from '../api/threadsComments';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';

const STATUS_LABELS = {
  new: 'Новий',
  replied: 'Відповіли',
  handled: 'Опрацьовано',
};

function CommentStatusBadge({ status }) {
  return <span className={`status-badge comment-status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

function isResting(account) {
  return Boolean(account?.restUntil && new Date(account.restUntil) > new Date());
}

function CommentRow({ comment, onChange }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState(comment.replyText || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const resting = isResting(comment.account);

  const handleReply = async () => {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await replyThreadsComment(comment._id, text);
      setReplying(false);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося надіслати відповідь'));
    } finally {
      setSaving(false);
    }
  };

  const handleMark = async (status) => {
    setError(null);
    try {
      await setThreadsCommentStatus(comment._id, status);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося оновити статус'));
    }
  };

  const handleDelete = async () => {
    setError(null);
    try {
      await deleteThreadsComment(comment._id);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити'));
    }
  };

  return (
    <tr>
      <td data-label="Акаунт">
        {comment.account?.displayName || comment.account?.username || '-'}{' '}
        {resting && (
          <span
            className="status-badge auth-blocked"
            title={`Відпочиває до ${formatDate(comment.account.restUntil)}`}
          >
            відпочиває
          </span>
        )}
      </td>
      <td data-label="Пост">
        <a href={comment.postUrl} target="_blank" rel="noreferrer">
          відкрити
        </a>
      </td>
      <td data-label="Автор">{comment.author || '-'}</td>
      <td data-label="Коментар" className="post-text-cell" title={comment.text}>
        {comment.text}
      </td>
      <td data-label="Статус">
        <CommentStatusBadge status={comment.status} />
      </td>
      <td data-label="Відповідь">
        {replying ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
            <div className="vpn-actions">
              <button className="btn btn-primary btn-sm" onClick={handleReply} disabled={saving || resting}>
                {saving ? 'Надсилання...' : 'Надіслати'}
              </button>
              <button className="btn btn-sm" onClick={() => setReplying(false)} disabled={saving}>
                Відмінити
              </button>
            </div>
            {resting && <span className="error-inline">Акаунт відпочиває, спробуйте пізніше</span>}
            {error && <span className="error-inline">{error}</span>}
          </div>
        ) : (
          comment.replyText || <span className="muted">-</span>
        )}
      </td>
      <td className="vpn-actions">
        {!replying && (
          <button className="btn btn-sm" onClick={() => setReplying(true)}>
            Відповісти
          </button>
        )}
        {comment.status !== 'handled' ? (
          <button className="btn btn-sm" onClick={() => handleMark('handled')}>
            Опрацьовано
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => handleMark('new')}>
            Повернути
          </button>
        )}
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>
          Видалити
        </button>
      </td>
    </tr>
  );
}

export default function ThreadsCommentTable({ comments, onChange }) {
  if (!comments.length) return <p className="empty-state">Коментарів ще немає</p>;

  return (
    <div className="table-wrap">
      <table className="vpn-table">
        <thead>
          <tr>
            <th>Акаунт</th>
            <th>Пост</th>
            <th>Автор</th>
            <th>Коментар</th>
            <th>Статус</th>
            <th>Відповідь</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {comments.map((c) => (
            <CommentRow key={c._id} comment={c} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
