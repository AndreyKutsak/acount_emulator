import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api/client';

// Заборонені й ризикові слова для постів Threads: групи з поясненням, слова-чіпи
// з видаленням, додавання своїх слів, вимкнення групи, перевірка тексту.
const fetchWords = () => api.get('/post-words').then((r) => r.data);

export default function PostWordsPanel({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [phrase, setPhrase] = useState('');
  const [group, setGroup] = useState('custom');
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState('');
  const [found, setFound] = useState(null);

  const load = () =>
    fetchWords()
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Не вдалося завантажити слова')));

  useEffect(() => {
    load();
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти'));
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    if (!phrase.trim()) return;
    run(async () => {
      await api.post('/post-words', { phrase, group });
      setPhrase('');
    });
  };

  const check = async (e) => {
    e.preventDefault();
    if (!sample.trim()) return;
    try {
      setFound((await api.post('/post-words/check', { text: sample })).data.found);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити'));
    }
  };

  if (!data) {
    return (
      <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Завантаження...</p>}</section>
    );
  }

  const groupLabel = (id) => data.groups.find((g) => g.id === id)?.label || id;

  return (
    <section className="card words-panel">
      <div className="post-section-heading">
        <div>
          <h3>Заборонені слова</h3>
          <p>
            Пост із забороненим словом не збережеться й не опублікується, навіть якщо його запланували раніше. Ризикові
            слова лише попереджають.
          </p>
        </div>
        <button type="button" className="modal-close" aria-label="Закрити" onClick={onClose}>
          ×
        </button>
      </div>

      <form className="words-add" onSubmit={add}>
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Слово чи фраза; кілька - через кому"
          aria-label="Нове слово"
        />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Група">
          {data.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label} ({g.severity === 'error' ? 'заборонено' : 'попередження'})
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={busy || !phrase.trim()}>
          Додати
        </button>
      </form>
      <p className="card-note">
        Слово шукається цілим, регістр не важливий. Зірочка в кінці - будь-яке закінчення: «долар*» знайде «долар»,
        «долари», «доларів». Символи на кшталт «$» шукаються як є.
      </p>
      {error && <p className="error">{error}</p>}

      <div className="words-groups">
        {data.groups.map((g) => {
          const words = data.words.filter((w) => w.group === g.id);
          if (!words.length && !g.id.startsWith('custom')) return null;
          const allOff = words.length > 0 && words.every((w) => !w.enabled);
          return (
            <div key={g.id} className={`words-group${allOff ? ' words-group-off' : ''}`}>
              <div className="words-group-head">
                <div>
                  <strong>{g.label}</strong>{' '}
                  <span className={`status-badge ${g.severity === 'error' ? 'status-offline' : 'auth-blocked'}`}>
                    {g.severity === 'error' ? 'заборонено' : 'попередження'}
                  </span>
                </div>
                {words.length > 0 && (
                  <label className="words-toggle">
                    <input
                      type="checkbox"
                      checked={!allOff}
                      disabled={busy}
                      onChange={(e) => run(() => api.patch(`/post-words/group/${g.id}`, { enabled: e.target.checked }))}
                    />
                    перевіряти
                  </label>
                )}
              </div>
              <p className="words-group-why">{g.message}</p>
              {words.length === 0 ? (
                <p className="muted">Поки порожньо.</p>
              ) : (
                <ul className="words-chips">
                  {words.map((w) => (
                    <li key={w._id} className={`word-chip${w.enabled ? '' : ' word-chip-off'}`}>
                      <span>{w.phrase}</span>
                      <button
                        type="button"
                        className="word-chip-remove"
                        aria-label={`Видалити «${w.phrase}»`}
                        disabled={busy}
                        onClick={() => run(() => api.delete(`/post-words/${w._id}`))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <form className="words-check" onSubmit={check}>
        <label className="field">
          <span className="field-label">Перевірити текст</span>
          <textarea rows={3} value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Вставте текст поста" />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={!sample.trim()}>
            Перевірити
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => api.post('/post-words/restore-defaults'))}
            title="Повертає видалені стандартні слова; ваші слова не змінюються"
          >
            Відновити стандартні слова
          </button>
        </div>
        {found &&
          (Object.keys(found).length === 0 ? (
            <p className="muted">Заборонених і ризикових слів не знайдено.</p>
          ) : (
            <ul className="help-list">
              {Object.entries(found).map(([gid, phrases]) => (
                <li key={gid}>
                  <strong>{groupLabel(gid)}:</strong> {phrases.map((p) => `«${p}»`).join(', ')}
                </li>
              ))}
            </ul>
          ))}
      </form>
    </section>
  );
}
