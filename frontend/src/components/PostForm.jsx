import { useEffect, useState } from 'react';
import { fetchAccounts } from '../api/socialAccounts';

function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

export default function PostForm({ onCreate, onSave, post, onCancel }) {
  const [text, setText] = useState('');
  const [imagesText, setImagesText] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(post);
  const images = imagesText
    .split('\n')
    .map((image) => image.trim())
    .filter(Boolean);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    setText(post?.text || '');
    setImagesText((post?.images || []).join('\n'));
    setScheduledAt(toLocalDateTime(post?.scheduledAt));
    setSelectedIds([]);
  }, [post]);

  const toggleAccount = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((accountId) => accountId !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving || (!isEditing && selectedIds.length === 0)) return;

    const data = {
      text,
      images,
      scheduledAt: scheduledAt || null,
    };

    setSaving(true);
    try {
      const succeeded = isEditing
        ? await onSave(post._id, data)
        : await onCreate({ ...data, accountIds: selectedIds });

      if (succeeded && !isEditing) {
        setText('');
        setImagesText('');
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
        <span className="post-field-hint">{text.length} символів</span>
      </label>

      <div className="post-form-secondary">
        <label className="field">
          <span className="field-label">Фото або відео</span>
          <textarea
            value={imagesText}
            onChange={(event) => setImagesText(event.target.value)}
            placeholder={'Вставте URL медіафайлів\nКожне посилання — з нового рядка'}
            rows={4}
          />
          <span className="post-field-hint">
            {images.length ? `${images.length} файлів` : 'Можна додати кілька посилань'}
          </span>
        </label>
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
          disabled={saving || (!isEditing && selectedIds.length === 0)}
        >
          {saving ? 'Збереження...' : isEditing ? 'Зберегти зміни' : 'Створити пост'}
        </button>
      </div>
    </form>
  );
}
