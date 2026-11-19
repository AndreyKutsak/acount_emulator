import { useEffect, useRef, useState } from 'react';
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

export default function PostForm({ onCreate, onSave, post, onCancel, autoFocus = false }) {
  const [text, setText] = useState('');
  // Перевіряти за шаблоном вакансії. Вимкнено - пост не вакансія (про життя,
  // опитування): шаблон не вимагається, заборонені слова діють завжди.
  const [useTemplate, setUseTemplate] = useState(true);
  const [images, setImages] = useState([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const [template, setTemplate] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const formRef = useRef(null);
  const isEditing = Boolean(post);
  const hasErrors = Boolean(validation && !validation.ok);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
    fetchJobTemplate().then(setTemplate).catch(() => setTemplate(null));
  }, []);

  useEffect(() => {
    setText(post?.text || '');
    setUseTemplate(post ? post.jobTemplate !== false : true);
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
        jobTemplate: useTemplate,
      })
        .then((result) => !cancelled && setValidation(result))
        .catch(() => !cancelled && setValidation(null));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, scheduledAt, linkedKey, post?._id, useTemplate]);

  const toggleAccount = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((accountId) => accountId !== id) : [...prev, id]
    );
  };

  // Чого бракує для збереження - показується біля кнопки після першого натискання.
  const blockers = [
    !text.trim() && { id: 'text', text: 'напишіть текст поста', target: 'textarea' },
    text.trim() && hasErrors && { id: 'errors', text: 'виправте помилки перевірки', target: '.post-validation' },
    !isEditing && !scheduledAt && { id: 'date', text: 'вкажіть дату й час публікації', target: 'input[type="datetime-local"]' },
    !isEditing && selectedIds.length === 0 && { id: 'accounts', text: 'оберіть, де опублікувати', target: '.post-account-picker' },
  ].filter(Boolean);

  const jumpTo = (selector) => {
    const el = formRef.current?.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el.matches('input, textarea')) setTimeout(() => el.focus({ preventScroll: true }), 300);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (blockers.length) {
      setAttempted(true);
      jumpTo(blockers[0].target);
      return;
    }

    const data = {
      text,
      images,
      jobTemplate: useTemplate,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };

    setSaving(true);
    try {
      const succeeded = isEditing
        ? await onSave(post._id, data)
        : await onCreate({ ...data, accountIds: selectedIds });

      if (succeeded) setAttempted(false);
      if (succeeded && !isEditing) {
        setText('');
        setUseTemplate(true);
        setImages([]);
        setScheduledAt('');
        setSelectedIds([]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="post-form" onSubmit={handleSubmit} ref={formRef} noValidate>
      <label className="field field-wide">
        <span className="field-label">Текст публікації</span>
        <textarea
          className="post-composer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Напишіть текст поста..."
          rows={7}
          autoFocus={autoFocus}
        />
        <span className="post-template-row">
          <span className={`post-field-hint${[...text.trim()].length > 500 ? ' post-field-over' : ''}`}>
            {[...text.trim()].length} / 500 символів
            {template?.required && useTemplate ? ', перевіряється за шаблоном вакансії' : ''}
          </span>
          {template?.required && (
            <label className="checkbox-item post-template-toggle">
              <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
              Вакансія: перевіряти за шаблоном
            </label>
          )}
          {template && useTemplate && (
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
          {template?.shortText && useTemplate && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                if (!text.trim() || window.confirm('Замінити поточний текст коротким шаблоном?')) {
                  setText(template.shortText);
                }
              }}
            >
              Короткий шаблон
            </button>
          )}
        </span>
      </label>

      <PostValidation validation={validation} />

      <div className="post-form-secondary">
        <PostPhotos value={images} onChange={setImages} />
        <label className="field">
          <span className="field-label">Дата й час публікації</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            required={!isEditing}
          />
          <span className={`post-field-hint${!isEditing && !scheduledAt ? ' post-field-over' : ''}`}>
            {isEditing
              ? 'Порожньо - пост не публікується сам, лише вручну'
              : scheduledAt && new Date(scheduledAt) < new Date()
                ? 'Час уже минув: пост вийде протягом хвилини після створення'
                : "Обов'язково: коли опублікувати"}
          </span>
          {!isEditing && (
            <span className="schedule-quick">
              {[
                ['Через годину', 60],
                ['Через 3 години', 180],
                ['Найближча 9:00', null],
              ].map(([label, minutes]) => (
                <button
                  key={label}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const d = new Date();
                    if (minutes) d.setMinutes(d.getMinutes() + minutes, 0, 0);
                    else {
                      // Найближчий ранок: сьогодні, якщо ще немає 9:00, інакше завтра.
                      if (d.getHours() >= 9) d.setDate(d.getDate() + 1);
                      d.setHours(9, 0, 0, 0);
                    }
                    setScheduledAt(toLocalDateTime(d));
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
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

      {blockers.length > 0 && attempted && (
        <div className="form-blockers" role="alert">
          <strong>Щоб {isEditing ? 'зберегти' : 'створити пост'}:</strong>
          <ul>
            {blockers.map((b) => (
              <li key={b.id}>
                <button type="button" className="link-btn" onClick={() => jumpTo(b.target)}>
                  {b.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-actions post-form-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            Скасувати
          </button>
        )}
        {/* Кнопка не вимикається: на телефоні вимкнена кнопка мовчить, а тут натискання
            пояснює, чого бракує, і веде до цього поля. */}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Збереження...' : isEditing ? 'Зберегти зміни' : 'Створити пост'}
        </button>
      </div>
    </form>
  );
}
