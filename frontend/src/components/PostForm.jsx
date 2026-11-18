import { useEffect, useState } from 'react';
import { fetchAccounts } from '../api/socialAccounts';
import { fetchJobTemplate, validatePost } from '../api/posts';
import PostValidation from './PostValidation';
import PostPhotos from './PostPhotos';

function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export default function PostForm({ onCreate, onSave, post, onCancel }) {
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const [template, setTemplate] = useState(null);
  const isEditing = Boolean(post);
  const hasErrors = Boolean(validation && !validation.ok);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
    fetchJobTemplate().then(setTemplate).catch(() => setTemplate(null));
  }, []);

  useEffect(() => {
    setText(post?.text || '');
    setImages(post?.images || []);
    setScheduledAt(toLocalDateTime(post?.scheduledAt));
    setSelectedIds([]);
  }, [post]);

  // Жива перевірка правил Threads (з паузою, щоб не смикати API на кожну літеру).
  const linkedIds = isEditing
    ? (post.accounts || []).map((entry) => entry.account?._id).filter(Boolean)
    : selectedIds;
  const linkedKey = linkedIds.join(',');
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      validatePost({
        text,
        accountIds: linkedIds,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        postId: post?._id,
      })
        .then((result) => !cancelled && setValidation(result))
        .catch(() => !cancelled && setValidation(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, scheduledAt, linkedKey, post?._id]);

  const toggleAccount = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((accountId) => accountId !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving || hasErrors || (!isEditing && selectedIds.length === 0)) return;

    const data = {
      text,
      images,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };

    setSaving(true);
    try {
      const succeeded = isEditing
        ? await onSave(post._id, data)
        : await onCreate({ ...data, accountIds: selectedIds });

      if (succeeded && !isEditing) {
        setText('');
        setImages([]);
        setScheduledAt('');
        setSelectedIds([]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="post-form" onSubmit={handleSubmit}>
      <label className="field field-wide">
        <span className="field-label">Текст публікації</span>
        <textarea
          className="post-composer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Напишіть текст поста..."
          rows={7}
        />
        <span className="post-template-row">
          <span className={`post-field-hint${[...text.trim()].length > 500 ? ' post-field-over' : ''}`}>
            {[...text.trim()].length} / 500 символів
            {template?.required ? ' · для Threads обов’язковий шаблон вакансії' : ''}
          </span>
          {template && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                if (!text.trim() || window.confirm('Замінити поточний текст шаблоном?')) {
                  setText(template.text);
                }
              }}
            >
              Вставити шаблон
            </button>
          )}
        </span>
      </label>

      <PostValidation validation={validation} />

      <div className="post-form-secondary">
        <PostPhotos value={images} onChange={setImages} />
        <label className="field">
          <span className="field-label">Запланувати публікацію</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
          <span className="post-field-hint">Залиште порожнім для публікації вручну</span>
        </label>
      </div>

      {isEditing ? (
        <div className="post-linked-accounts">
          <span className="field-label">Акаунти цього поста</span>
          <div className="account-checkboxes">
            {post.accounts?.length ? (
              post.accounts.map((entry, index) => (
                <span className="checkbox-item" key={entry.account?._id || index}>
                  {entry.account
                    ? `${entry.account.platform}: ${entry.account.username}`
                    : 'Акаунт видалено'}
                </span>
              ))
            ) : (
              <span className="muted">До поста не прив’язано акаунтів</span>
            )}
          </div>
          <span className="post-field-hint">
            Список акаунтів змінюється під час створення поста.
          </span>
        </div>
      ) : (
        <fieldset className="post-account-picker">
          <legend className="field-label">Де опублікувати</legend>
          {accounts.length === 0 ? (
            <p className="muted post-no-accounts">Немає доданих акаунтів</p>
          ) : (
            <div className="account-checkboxes">
              {accounts.map((account) => (
                <label key={account._id} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(account._id)}
                    onChange={() => toggleAccount(account._id)}
                  />
                  {account.platform}: {account.username}
                </label>
              ))}
            </div>
          )}
          <span className="post-field-hint">
            {selectedIds.length
              ? `Обрано акаунтів: ${selectedIds.length}`
              : 'Оберіть один або кілька акаунтів'}
          </span>
        </fieldset>
      )}

      <div className="form-actions post-form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            Скасувати
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving || hasErrors || (!isEditing && selectedIds.length === 0)}
          title={hasErrors ? 'Спершу виправте помилки перевірки' : undefined}
        >
          {saving ? 'Збереження...' : isEditing ? 'Зберегти зміни' : 'Створити пост'}
        </button>
      </div>
    </form>
  );
}
