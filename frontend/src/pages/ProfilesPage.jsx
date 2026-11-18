import { useEffect, useState } from 'react';
import {
  fetchProfiles,
  fetchDevices,
  fetchAndroidStatus,
  createProfile,
  updateProfile,
  deleteProfile,
  cloneProfile,
  startProfile,
  stopProfile,
  mfError,
  MANYFACES_UI_URL,
} from '../api/manyfaces';
import { fetchAccounts } from '../api/socialAccounts';
import { formatDate } from '../components/StatusBadge';
import Modal from '../components/Modal';
import ListToolbar, { useListView } from '../components/ListToolbar';

// «Профілі»: віртуальні телефони й браузерні профілі ManyFaces - створення, запуск,
// перейменування, копія, видалення. Працює через прокси /mf, тож і з телефона, і з
// будь-якого домену. Рідкісні налаштування (відбиток, проксі, інсталятор Android) -
// у повному інтерфейсі ManyFaces за кнопкою.

const ENGINES = {
  android: 'Android-телефон',
  chromium: 'Браузер Chromium',
  camoufox: 'Браузер Camoufox',
};

const stateOf = (p) =>
  p.running || p.status === 'running'
    ? 'running'
    : p.status === 'launching'
      ? 'launching'
      : p.status === 'error' || p.launch_error
        ? 'error'
        : 'stopped';

const STATE = {
  running: { label: 'увімкнений', edge: 'success' },
  launching: { label: 'вмикається...', edge: 'warning' },
  error: { label: 'помилка запуску', edge: 'danger' },
  stopped: { label: 'вимкнений', edge: 'idle' },
};
const ORDER = { running: 0, launching: 1, error: 2, stopped: 3 };

function ProfileForm({ profile, devices, onClose, onSaved }) {
  const editing = Boolean(profile);
  const [name, setName] = useState(profile?.name || '');
  const [engine, setEngine] = useState(profile?.engine || 'android');
  const [device, setDevice] = useState('');
  const [notes, setNotes] = useState(profile?.notes || '');
  const [tags, setTags] = useState((profile?.tags || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const phones = devices.filter((d) => d.os === 'android');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const data = {
      name: name.trim(),
      notes: notes.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      if (editing) await updateProfile(profile.id, data);
      else await createProfile({ ...data, engine, ...(device ? { device } : {}) });
      onSaved();
    } catch (err) {
      setError(mfError(err, 'Не вдалося зберегти профіль'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? `Профіль ${profile.name}` : 'Новий профіль'} onClose={onClose}>
      <form onSubmit={submit} className="stack-form">
        <label className="field">
          <span className="field-label">Назва</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. Ліза ніжна" required autoFocus />
        </label>
        {!editing && (
          <>
            <label className="field">
              <span className="field-label">Тип</span>
              <select value={engine} onChange={(e) => setEngine(e.target.value)}>
                {Object.entries(ENGINES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Модель телефону</span>
              <select value={device} onChange={(e) => setDevice(e.target.value)}>
                <option value="">Випадкова</option>
                {phones.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span className="post-field-hint">
                Від моделі залежить «відбиток» пристрою: екран, User-Agent, мова. Для Threads підходить будь-яка.
              </span>
            </label>
          </>
        )}
        <label className="field">
          <span className="field-label">Нотатки</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Для чого цей профіль" />
        </label>
        <label className="field">
          <span className="field-label">Мітки через кому</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="вінниця, вакансії" />
        </label>
        {!editing && engine === 'android' && (
          <p className="card-note">
            Перший запуск нового телефона триває кілька хвилин. Потім установіть Threads і увійдіть в акаунт на вкладці
            «Телефони».
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Збереження...' : editing ? 'Зберегти' : 'Створити профіль'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [engineStatus, setEngineStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(undefined); // undefined - закрито, null - новий

  const load = async () => {
    try {
      setProfiles(await fetchProfiles());
      setError(null);
    } catch (err) {
      setProfiles((prev) => prev || []);
      setError(mfError(err, 'ManyFaces недоступний: запустіть менеджер емуляторів'));
    }
  };

  useEffect(() => {
    load();
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
    fetchDevices().then(setDevices).catch(() => setDevices([]));
    fetchAndroidStatus().then(setEngineStatus).catch(() => setEngineStatus(null));
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const ownersOf = (p) => accounts.filter((a) => a.androidProfileId === p.id);

  const view = useListView('profiles', profiles || [], {
    search: (p) => `${p.name} ${p.id} ${p.notes} ${(p.tags || []).join(' ')} ${p.fingerprint?.device_name || ''} ${ownersOf(p).map((a) => a.username).join(' ')}`,
    filters: [
      {
        id: 'state',
        label: 'Стан',
        options: [
          { id: 'all', label: 'Усі' },
          { id: 'on', label: 'Увімкнені', dot: 'success', test: (p) => ['running', 'launching'].includes(stateOf(p)) },
          { id: 'off', label: 'Вимкнені', dot: 'idle', test: (p) => stateOf(p) === 'stopped' },
          { id: 'error', label: 'З помилкою', dot: 'danger', test: (p) => stateOf(p) === 'error' },
        ],
      },
      {
        id: 'engine',
        label: 'Тип',
        kind: 'select',
        options: [
          { id: 'all', label: 'Усі типи' },
          { id: 'android', label: 'Телефони Android', test: (p) => p.engine === 'android' },
          { id: 'browser', label: 'Браузерні профілі', test: (p) => p.engine !== 'android' },
        ],
      },
    ],
    sorts: [
      { id: 'state', label: 'Спершу увімкнені', compare: (a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)] },
      { id: 'name', label: 'За назвою', compare: (a, b) => a.name.localeCompare(b.name) },
      { id: 'new', label: 'Спершу нові', compare: (a, b) => String(b.created_at).localeCompare(String(a.created_at)) },
    ],
  });

  const act = async (id, fn, fallback) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(mfError(err, fallback));
    } finally {
      setBusy('');
    }
  };

  const remove = (p) => {
    const owners = ownersOf(p);
    const warn = owners.length
      ? ` До нього прив'язано ${owners.map((a) => `@${a.username}`).join(', ')}: ці акаунти втратять телефон.`
      : '';
    if (!window.confirm(`Видалити профіль «${p.name}» разом із телефоном і всіма даними в ньому?${warn}`)) return;
    act(p.id, () => deleteProfile(p.id), 'Не вдалося видалити профіль');
  };

  const androidCount = (profiles || []).filter((p) => p.engine === 'android').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Профілі</h2>
          <p className="page-subtitle">Віртуальні телефони й браузерні профілі (ManyFaces)</p>
        </div>
        <div className="page-header-actions">
          <a className="btn" href={MANYFACES_UI_URL} target="_blank" rel="noreferrer">
            Повний ManyFaces
          </a>
          <button className="btn btn-primary" onClick={() => setForm(null)}>
            Новий профіль
          </button>
        </div>
      </div>

      {engineStatus && !engineStatus.ready && (
        <div className="notice notice-warning">
          Android-рушій ще не встановлено, тож телефони не запустяться. Відкрийте{' '}
          <a href={MANYFACES_UI_URL} target="_blank" rel="noreferrer">
            повний ManyFaces
          </a>{' '}
          і запустіть інсталятор Android (кілька гігабайт, 10-30 хвилин).
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {profiles === null ? (
        <div className="card">
          <p className="muted">Завантаження...</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="empty-state">
          Профілів ще немає.{' '}
          <button type="button" className="link-btn" onClick={() => setForm(null)}>
            Створити перший телефон
          </button>
        </div>
      ) : (
        <>
          <ListToolbar view={view} placeholder="Пошук за назвою, моделлю, акаунтом чи міткою" noun={['профіль', 'профілі', 'профілів']} />
          {view.shown.length === 0 ? (
            <div className="empty-state">
              Жоден профіль не підходить під фільтри.{' '}
              <button type="button" className="link-btn" onClick={view.reset}>
                Скинути фільтри
              </button>
            </div>
          ) : (
            <ul className="profile-grid">
              {view.shown.map((p) => {
                const st = stateOf(p);
                const owners = ownersOf(p);
                const on = st === 'running' || st === 'launching';
                return (
                  <li key={p.id} className="profile-card state-edge" data-state={STATE[st].edge}>
                    <div className="profile-card-head">
                      <div className="profile-card-title">
                        <span className={`dot dot-${STATE[st].edge}`} aria-hidden="true" />
                        <strong>{p.name}</strong>
                      </div>
                      <span className="tag">{p.engine === 'android' ? 'Android' : p.engine}</span>
                    </div>
                    <dl className="profile-facts">
                      <div>
                        <dt>Стан</dt>
                        <dd>
                          {STATE[st].label}
                          {p.serial ? `, ${p.serial}` : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Акаунт</dt>
                        <dd>{owners.length ? owners.map((a) => `@${a.username}`).join(', ') : <span className="muted">вільний</span>}</dd>
                      </div>
                      {p.fingerprint?.device_name && (
                        <div>
                          <dt>Модель</dt>
                          <dd>{p.fingerprint.device_name}</dd>
                        </div>
                      )}
                      {p.created_at && (
                        <div>
                          <dt>Створено</dt>
                          <dd>{formatDate(p.created_at)}</dd>
                        </div>
                      )}
                    </dl>
                    {p.notes && <p className="profile-notes">{p.notes}</p>}
                    {(p.tags || []).length > 0 && (
                      <div className="profile-tags">
                        {p.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.launch_error && st === 'error' && <p className="error-inline">{p.launch_error}</p>}
                    <div className="profile-actions">
                      {on ? (
                        <button
                          className="btn"
                          disabled={busy === p.id}
                          onClick={() => act(p.id, () => stopProfile(p.id), 'Не вдалося вимкнути')}
                        >
                          {busy === p.id ? 'Вимикаю...' : 'Вимкнути'}
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary"
                          disabled={busy === p.id}
                          onClick={() => act(p.id, () => startProfile(p.id), 'Не вдалося увімкнути')}
                        >
                          {busy === p.id ? 'Вмикаю...' : 'Увімкнути'}
                        </button>
                      )}
                      <button className="btn" onClick={() => setForm(p)} disabled={busy === p.id}>
                        Змінити
                      </button>
                      <details className="profile-more">
                        <summary className="btn">Ще</summary>
                        <div className="profile-more-menu">
                          <button
                            type="button"
                            className="btn"
                            disabled={busy === p.id}
                            onClick={() => act(p.id, () => cloneProfile(p.id), 'Не вдалося скопіювати')}
                          >
                            Створити копію
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={busy === p.id || on}
                            title={on ? 'Спершу вимкніть профіль' : undefined}
                            onClick={() => remove(p)}
                          >
                            Видалити
                          </button>
                        </div>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="card-note">
            Телефонів Android: {androidCount}. Кожен бере близько 2 ГБ пам'яті, тож тримайте увімкненим один: перед
            публікацією система сама вимикає зайві. Прив'язати телефон до акаунта можна у вкладці «Акаунти».
          </p>
        </>
      )}

      {form !== undefined && (
        <ProfileForm
          profile={form}
          devices={devices}
          onClose={() => setForm(undefined)}
          onSaved={() => {
            setForm(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}
