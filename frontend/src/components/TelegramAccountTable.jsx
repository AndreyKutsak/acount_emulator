import { useState } from 'react';
import { refreshTelegramProfile, logOutTelegram } from '../api/telegram';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';
import TelegramLoginModal from './TelegramLoginModal';

const AUTH_LABELS = {
  authorized: 'Авторизований',
  code_sent: 'Очікує код',
  email_setup_needed: 'Потрібна пошта для входу',
  email_code_sent: 'Очікує код із пошти',
  qr_pending: 'Очікує сканування QR',
  password_needed: 'Потрібен пароль 2FA',
  password_recovery: 'Відновлення пароля',
  failed: 'Сесія недійсна',
  unknown: 'Не авторизований',
};

const AUTH_CLASSES = {
  authorized: 'auth-authorized',
  code_sent: 'auth-blocked',
  email_setup_needed: 'auth-blocked',
  email_code_sent: 'auth-blocked',
  qr_pending: 'auth-blocked',
  password_needed: 'auth-blocked',
  password_recovery: 'auth-blocked',
  failed: 'auth-failed',
  unknown: 'auth-unknown',
};

function ProfileCell({ profile }) {
  if (!profile?.telegramId) return <span className="muted">-</span>;
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title={profile.about || ''}>
      <span>
        {name || '-'}
        {profile.premium ? ' ★' : ''}
      </span>
      <span className="muted" style={{ fontSize: 12 }}>
        {profile.username ? `@${profile.username} · ` : ''}id {profile.telegramId}
      </span>
    </div>
  );
}

export default function TelegramAccountTable({ accounts, selectedId, onSelect, onDelete, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [loginAccount, setLoginAccount] = useState(null);

  const run = async (id, action, fallback) => {
    setError(null);
    setBusyId(id);
    try {
      await action(id);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusyId(null);
    }
  };

  if (!accounts.length) return <p className="empty-state">Telegram-акаунтів ще немає</p>;

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="vpn-table">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Телефон</th>
              <th>Профіль Telegram</th>
              <th>Авторизація</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => {
              const status = acc.authStatus || 'unknown';
              const authorized = status === 'authorized';
              return (
                <tr key={acc._id}>
                  <td data-label="Назва">{acc.displayName || '-'}</td>
                  <td data-label="Телефон">{acc.phone || <span className="muted">-</span>}</td>
                  <td data-label="Профіль Telegram">
                    <ProfileCell profile={acc.profile} />
                  </td>
                  <td data-label="Авторизація">
                    <span
                      className={`status-badge ${AUTH_CLASSES[status] || 'auth-unknown'}`}
                      title={
                        acc.authError ||
                        (acc.authCheckedAt ? `Перевірено: ${formatDate(acc.authCheckedAt)}` : '')
                      }
                    >
                      {AUTH_LABELS[status] || status}
                    </span>
                  </td>
                  <td className="vpn-actions">
                    {authorized ? (
                      <>
                        <button
                          className={`btn btn-sm${selectedId === acc._id ? ' btn-primary' : ''}`}
                          onClick={() => onSelect(selectedId === acc._id ? null : acc._id)}
                        >
                          Чати
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => run(acc._id, refreshTelegramProfile, 'Не вдалося оновити дані')}
                          disabled={busyId === acc._id}
                        >
                          {busyId === acc._id ? 'Оновлення...' : 'Оновити дані'}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => run(acc._id, logOutTelegram, 'Не вдалося вийти')}
                          disabled={busyId === acc._id}
                        >
                          Вийти
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => setLoginAccount(acc)}>
                        {status === 'unknown' || status === 'failed' ? 'Увійти' : 'Продовжити вхід'}
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => onDelete(acc._id)}>
                      Видалити
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {loginAccount && (
        <TelegramLoginModal
          account={loginAccount}
          onClose={() => setLoginAccount(null)}
          onChange={onChange}
        />
      )}
    </div>
  );
}
