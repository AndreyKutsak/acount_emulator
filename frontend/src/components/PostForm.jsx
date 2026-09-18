import { useEffect, useState } from 'react';
import { fetchAccounts } from '../api/socialAccounts';

export default function PostForm({ onCreate }) {
  const [text, setText] = useState('');
  const [imagesText, setImagesText] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  const toggleAccount = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;
    const images = imagesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    onCreate({
      text,
      images,
      scheduledAt: scheduledAt || null,
      accountIds: selectedIds,
    });

    setText('');
    setImagesText('');
    setScheduledAt('');
    setSelectedIds([]);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field field-wide">
          <span className="field-label">Текст поста</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        </label>
        <label className="field field-wide">
          <span className="field-label">URL фото (кожен з нового рядка)</span>
          <textarea
            value={imagesText}
            onChange={(e) => setImagesText(e.target.value)}
            rows={2}
          />
        </label>
        <label className="field">
          <span className="field-label">Час публікації</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>
      </div>

      <div className="field field-wide" style={{ marginTop: 14 }}>
        <span className="field-label">Акаунти для публікації</span>
        <div className="account-checkboxes">
          {accounts.length === 0 && <span className="muted">Немає доданих акаунтів</span>}
          {accounts.map((acc) => (
            <label key={acc._id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedIds.includes(acc._id)}
                onChange={() => toggleAccount(acc._id)}
              />
              {acc.platform}: {acc.username}
            </label>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={selectedIds.length === 0}>
          Створити пост
        </button>
      </div>
    </form>
  );
}
