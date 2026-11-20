import { useEffect, useState } from 'react';
import { fetchAccounts, createAccount, deleteAccount } from '../api/socialAccounts';
import { errorMessage } from '../api/client';
import SocialAccountForm from '../components/SocialAccountForm';
import SocialAccountTable from '../components/SocialAccountTable';
import ListToolbar, { useListView } from '../components/ListToolbar';

const AUTH_ORDER = { failed: 0, blocked: 1, unknown: 2, authorized: 3 };
const name = (a) => String(a.displayName || a.username || '').toLowerCase();
const hasPhone = (a) => Boolean(a.androidSerial || a.androidProfileId);

export default function SocialAccountsPage() {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);

  const platforms = [...new Set((accounts || []).map((a) => a.platform))].sort();
  const view = useListView('accounts', accounts || [], {
    search: (a) => `${a.displayName || ''} ${a.username || ''}`,
    filters: [
      {
        id: 'auth',
        label: 'Авторизація',
        options: [
          { id: 'all', label: 'Усі' },
          { id: 'authorized', label: 'Авторизовані', dot: 'success', test: (a) => a.authStatus === 'authorized' },
          {
            id: 'problem',
            label: 'Потребують уваги',
            dot: 'danger',
            test: (a) => a.authStatus === 'failed' || a.authStatus === 'blocked',
          },
          { id: 'unknown', label: 'Не перевірені', dot: 'idle', test: (a) => !a.authStatus || a.authStatus === 'unknown' },
        ],
      },
      {
        id: 'platform',
        label: 'Платформа',
        kind: 'select',
        options: [
          { id: 'all', label: 'Усі платформи' },
          ...platforms.map((p) => ({ id: p, label: p, test: (a) => a.platform === p })),
        ],
      },
      {
        id: 'phone',
        label: 'Телефон',
        kind: 'select',
        options: [
          { id: 'all', label: 'З телефоном і без' },
          { id: 'with', label: "Прив'язаний телефон", test: hasPhone },
          { id: 'without', label: 'Без телефону', test: (a) => !hasPhone(a) },
        ],
      },
    ],
    sorts: [
      { id: 'name', label: 'За назвою', compare: (a, b) => name(a).localeCompare(name(b)) },
      {
        id: 'auth',
        label: 'Спершу з проблемами',
        compare: (a, b) => (AUTH_ORDER[a.authStatus] ?? 2) - (AUTH_ORDER[b.authStatus] ?? 2),
      },
      {
        id: 'checked',
        label: 'Давно не перевірені',
        compare: (a, b) => new Date(a.authCheckedAt || 0) - new Date(b.authCheckedAt || 0),
      },
      { id: 'platform', label: 'За платформою', compare: (a, b) => a.platform.localeCompare(b.platform) },
    ],
  });

  const load = async () => {
    try {
      setAccounts(await fetchAccounts());
    } catch (err) {
      setError('Не вдалося завантажити акаунти');
      setAccounts((prev) => prev || []);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      await createAccount(data);
      setAdding(false);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося додати акаунт'));
    }
  };

  const handleDelete = async (id) => {
    const acc = (accounts || []).find((a) => a._id === id);
    if (!window.confirm(`Видалити акаунт ${acc ? `@${acc.username}` : ''}? Пости залишаться, але без цього акаунта.`)) return;
    setError(null);
    try {
      await deleteAccount(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити акаунт'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Акаунти</h2>
          <p className="page-subtitle">Облікові записи соцмереж, телефони й VPN</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Закрити форму' : 'Додати акаунт'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {adding && (
        <div className="card">
          <div className="card-title">Новий акаунт</div>
          <SocialAccountForm onCreate={handleCreate} />
        </div>
      )}
      {accounts === null ? (
        <div className="card">
          <p className="muted">Завантаження...</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          Акаунтів ще немає.{' '}
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            Додати перший
          </button>
        </div>
      ) : (
        <>
          <ListToolbar view={view} placeholder="Пошук за назвою чи логіном" noun={['акаунт', 'акаунти', 'акаунтів']} />
          {view.shown.length === 0 ? (
            <div className="empty-state">
              Жоден акаунт не підходить під фільтри.{' '}
              <button type="button" className="link-btn" onClick={view.reset}>
                Скинути фільтри
              </button>
            </div>
          ) : (
            <SocialAccountTable accounts={view.shown} onDelete={handleDelete} onChange={load} />
          )}
        </>
      )}
    </div>
  );
}
