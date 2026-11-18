import { useEffect, useState } from 'react';
import { revealPassword, checkAccountAuth, updateAccount, fetchUserAgentPresets } from '../api/socialAccounts';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';
import ThreadsAccountActionsModal from './ThreadsAccountActionsModal';

// Must match DEFAULT_USER_AGENT in backend/src/services/browserService.js —
// that's the UA actually applied when an account has none pinned.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

const AUTH_LABELS = {
  authorized: 'Авторизований',
  failed: 'Не авторизований',
  blocked: 'Тіньовий блок',
  unknown: 'Не перевірено',
};

// Колір смуги рядка за станом авторизації.
const AUTH_STATE = { authorized: 'success', failed: 'danger', blocked: 'danger', unknown: 'idle' };

function AuthBadge({ account }) {
  const status = account.authStatus || 'unknown';
  const debug = account.authDebug;
  const title =
    status === 'blocked'
      ? account.authError ||
        'Форма логіну приймається, але сесія не створюється — ймовірно тимчасове обмеження платформи через автоматизацію. Дайте акаунту відпочити кілька годин.'
      : status === 'failed'
        ? account.authError || 'Помилка авторизації'
        : account.authCheckedAt
          ? `Перевірено: ${formatDate(account.authCheckedAt)}`
          : 'Ще не перевірялось';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <span className={`status-badge auth-${status}`} title={title}>
        {AUTH_LABELS[status] || status}
      </span>
      {debug?.screenshotUrl && (
        <a
          href={debug.screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="muted"
          style={{ fontSize: 12 }}
          title={`Сторінка на момент помилки: ${debug.pageUrl || '?'}${
            debug.pageTitle ? ` («${debug.pageTitle}»)` : ''
          }`}
        >
          Скріншот сторінки Threads
        </a>
      )}
    </div>
  );
}

// «Chrome 131, Windows» замість повного рядка User-Agent (повний - у підказці).
function describeUA(ua) {
  const pick = (re, name) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  const browser =
    pick(/Edg\/(\d+)/, 'Edge') ||
    pick(/Firefox\/(\d+)/, 'Firefox') ||
    pick(/Chrome\/(\d+)/, 'Chrome') ||
    pick(/Version\/(\d+).*Safari/, 'Safari') ||
    'браузер';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser}, ${os}` : browser;
}

function UserAgentCell({ account, presets, onChange }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.userAgent || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateAccount(account._id, { userAgent: value });
      setEditing(false);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти'));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    const effectiveUA = account.userAgent || DEFAULT_USER_AGENT;
    return (
      <td data-label="User-Agent">
        <div className="cell-sub" title={effectiveUA}>
          {account.userAgent ? describeUA(effectiveUA) : `стандартний, ${describeUA(effectiveUA)}`}
        </div>
        <button className="link-btn ua-edit" onClick={() => setEditing(true)}>
          Змінити
        </button>
      </td>
    );
  }

  return (
    <td data-label="User-Agent">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
        <input
          list="ua-presets-table"
          placeholder="Порожньо = стандартний Chrome/Windows"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <datalist id="ua-presets-table">
          {presets.map((p) => (
            <option key={p.label} value={p.value} label={p.label} />
          ))}
        </datalist>
        <div className="vpn-actions">
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
          <button className="btn btn-sm" onClick={() => setEditing(false)} disabled={saving}>
            Відмінити
          </button>
        </div>
        {error && <span className="error-inline">{error}</span>}
      </div>
    </td>
  );
}

export default function SocialAccountTable({ accounts, onDelete, onChange }) {
  const [revealed, setRevealed] = useState({});
  const [checkingId, setCheckingId] = useState(null);
  const [error, setError] = useState(null);
  const [uaPresets, setUaPresets] = useState([]);
  const [actionsAccount, setActionsAccount] = useState(null);

  useEffect(() => {
    fetchUserAgentPresets().then(setUaPresets).catch(() => setUaPresets([]));
  }, []);

  const handleReveal = async (id) => {
    if (revealed[id]) {
      setRevealed((prev) => ({ ...prev, [id]: null }));
      return;
    }
    setError(null);
    try {
      const password = await revealPassword(id);
      setRevealed((prev) => ({ ...prev, [id]: password }));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося показати пароль'));
    }
  };

  const handleCheckAuth = async (id) => {
    setError(null);
    setCheckingId(id);
    try {
      await checkAccountAuth(id);
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити авторизацію'));
    } finally {
      setCheckingId(null);
    }
  };

  if (!accounts.length) return <p className="empty-state">Акаунтів ще немає</p>;

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="vpn-table">
          <thead>
            <tr>
              <th>Акаунт</th>
              <th>Телефон</th>
              <th>Пароль</th>
              <th>VPN</th>
              <th>Авторизація</th>
              <th>User-Agent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((acc) => (
              <tr key={acc._id} className="state-edge" data-state={AUTH_STATE[acc.authStatus] || 'idle'}>
                <td data-label="Акаунт">
                  <div className="cell-title">{acc.displayName || acc.username}</div>
                  <div className="cell-sub">
                    @{acc.username} <span className="tag">{acc.platform}</span>
                  </div>
                </td>
                <td data-label="Телефон">
                  {acc.androidSerial ? (
                    <span title="Фізичний телефон (adb)">{acc.androidSerial}</span>
                  ) : acc.androidProfileId ? (
                    <span title="Профіль ManyFaces">емулятор {acc.androidProfileId}</span>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td data-label="Пароль">
                  <span className="password-cell">{revealed[acc._id] || '••••••••'}</span>
                  <button className="btn btn-sm" onClick={() => handleReveal(acc._id)}>
                    {revealed[acc._id] ? 'Сховати' : 'Показати'}
                  </button>
                </td>
                <td data-label="VPN">{acc.vpnServer ? `${acc.vpnServer.name} (${acc.vpnServer.status})` : '-'}</td>
                <td data-label="Авторизація">
                  <AuthBadge account={acc} />
                </td>
                <UserAgentCell account={acc} presets={uaPresets} onChange={onChange} />
                <td className="vpn-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => handleCheckAuth(acc._id)}
                    disabled={checkingId === acc._id}
                  >
                    {checkingId === acc._id ? 'Перевірка...' : 'Перевірити'}
                  </button>
                  {acc.platform === 'threads' && (
                    <button className="btn btn-sm" onClick={() => setActionsAccount(acc)}>
                      Дії
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(acc._id)}>
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actionsAccount && (
        <ThreadsAccountActionsModal
          account={actionsAccount}
          onClose={() => setActionsAccount(null)}
          onChange={onChange}
        />
      )}
    </div>
  );
}
