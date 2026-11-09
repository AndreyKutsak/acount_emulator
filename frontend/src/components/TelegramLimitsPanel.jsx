import { useEffect, useState } from 'react';
import {
  fetchTelegramLimits,
  updateTelegramLimits,
  clearTelegramLimitBlock,
  joinTelegramChat,
} from '../api/telegram';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';

// Quotas shown with a usage bar: [limit key, label, window].
const USAGE = [
  ['messagesPerHour', 'Усі повідомлення', 'за годину'],
  ['messagesPerDay', 'Усі повідомлення', 'за добу'],
  ['dmChatsPerDay', 'Різні люди в особистих', 'за добу'],
  ['dmLinksPerDay', 'Посилання в особистих', 'за добу'],
  ['chatMessagesPerHour', 'Повідомлення й коментарі в чатах', 'за годину'],
  ['chatMessagesPerDay', 'Повідомлення й коментарі в чатах', 'за добу'],
  ['chatLinksPerDay', 'Посилання в чатах', 'за добу'],
  ['joinsPerDay', 'Вступи в канали й групи', 'за добу'],
  ['joinsPerWeek', 'Вступи в канали й групи', 'за 7 днів'],
];

// Editable quotas, grouped: [key, label].
const GROUPS = [
  {
    title: 'Усі повідомлення акаунта',
    fields: [
      ['messagesPerHour', 'Повідомлень за годину'],
      ['messagesPerDay', 'Повідомлень за добу'],
    ],
  },
  {
    title: 'Особисті повідомлення',
    fields: [
      ['dmChatsPerDay', 'Різних людей за добу'],
      ['dmMessagesPerChatPerDay', 'Повідомлень одній людині за добу'],
      ['dmLinksPerDay', 'Повідомлень з посиланнями за добу'],
    ],
  },
  {
    title: 'Групи, канали, коментарі',
    fields: [
      ['chatMessagesPerHour', 'Повідомлень у чатах за годину'],
      ['chatMessagesPerDay', 'Повідомлень у чатах за добу'],
      ['chatMessagesPerChatPerDay', 'Повідомлень в одному чаті за добу'],
      ['chatLinksPerDay', 'Повідомлень з посиланнями в чатах за добу'],
    ],
  },
  {
    title: 'Вступ у канали й групи',
    fields: [
      ['joinsPerDay', 'Вступів за добу'],
      ['joinsPerWeek', 'Вступів за 7 днів'],
      ['joinGapMinutes', 'Пауза між вступами (хв)'],
      ['maxChannels', 'Найбільше каналів і груп (Telegram дозволяє 500)'],
    ],
  },
  {
    title: 'Нові чати',
    fields: [
      ['freshChatQuietHours', 'Не писати після вступу (год)'],
      ['freshChatDays', 'Чат вважається новим (днів)'],
      ['freshChatMessagesPerDay', 'Повідомлень у новому чаті за добу'],
    ],
  },
  {
    title: 'Прогрів нового акаунта',
    fields: [
      ['warmupDays', 'Днів прогріву після додавання'],
      ['warmupPercent', 'Ліміти під час прогріву (%)'],
    ],
  },
];

function UsageBar({ used, limit }) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 1;
  const color = ratio >= 1 ? 'var(--danger)' : ratio >= 0.8 ? 'var(--warning)' : 'var(--success)';
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(ratio * 100)}%`, background: color, height: '100%' }} />
    </div>
  );
}

function StateCard({ data, onClear, busy }) {
  const { state, warmingUp, warmupUntil } = data;
  const blocks = [];
  if (state.frozenAt) {
    blocks.push({
      what: 'frozen',
      text: `Telegram заморозив акаунт (${formatDate(state.frozenAt)}). Усі дії зупинено. Подайте апеляцію в застосунку Telegram, а коли акаунт розморозять, зніміть позначку.`,
    });
  }
  if (state.spamBlockedUntil) {
    blocks.push({
      what: 'spam',
      text: `${state.spamBlockReason || 'Акаунт обмежено за спам'}. Надсилання зупинено до ${formatDate(
        state.spamBlockedUntil,
      )}. Перевірте стан у @SpamBot. Якщо обмеження знято раніше, зніміть паузу.`,
    });
  }
  if (state.floodWaitUntil) {
    blocks.push({
      what: 'flood',
      text: `Telegram попросив зачекати (FLOOD_WAIT) до ${formatDate(state.floodWaitUntil)}.`,
    });
  }

  return (
    <div className="card">
      <div className="card-title">Стан акаунта</div>
      {blocks.length === 0 ? (
        <p>
          <span className="status-badge auth-authorized">обмежень немає</span>
        </p>
      ) : (
        blocks.map((b) => (
          <div key={b.what} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span className="error-inline" style={{ flex: 1 }}>
              {b.text}
            </span>
            <button className="btn btn-sm" disabled={busy} onClick={() => onClear(b.what)}>
              Зняти
            </button>
          </div>
        ))
      )}
      {warmingUp && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          Прогрів: до {formatDate(warmupUntil)} усі ліміти зменшено до {data.limits.warmupPercent}%.
        </p>
      )}
    </div>
  );
}

function UsageCard({ data }) {
  return (
    <div className="card">
      <div className="card-title">Використано</div>
      {!data.quotas.enabled && <p className="error-inline">Ліміти вимкнено: діє лише пауза за відповідями Telegram.</p>}
      <div className="table-wrap">
        <table className="vpn-table">
          <thead>
            <tr>
              <th>Що</th>
              <th>Період</th>
              <th>Використано</th>
              <th style={{ width: '30%' }}></th>
            </tr>
          </thead>
          <tbody>
            {USAGE.map(([key, label, period]) => (
              <tr key={key}>
                <td data-label="Що">{label}</td>
                <td data-label="Період">{period}</td>
                <td data-label="Використано">
                  {data.used[key]} / {data.quotas[key] === 0 ? 'заборонено' : data.quotas[key]}
                </td>
                <td>
                  <UsageBar used={data.used[key]} limit={data.quotas[key]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Рахуються все, що надсилає програма: автовідповіді, автокоментарі і коментарі, надіслані вручну зі сторінки.
        Періоди ковзні: «за добу» означає за останні 24 години.
        {data.lastJoinAt && ` Останній вступ у чат: ${formatDate(data.lastJoinAt)}.`}
      </p>
    </div>
  );
}

function LimitsForm({ accountId, data, onSaved }) {
  const [draft, setDraft] = useState(data.limits);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(data.limits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const save = async (body) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateTelegramLimits(accountId, body);
      setDraft(res.limits);
      onSaved(res);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти ліміти'));
    } finally {
      setSaving(false);
    }
  };

  const change = (patch) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  return (
    <div className="card">
      <div className="card-title">Ліміти</div>
      <label className="checkbox-item" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={draft.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
        Обмежувати активність акаунта (рекомендовано)
      </label>
      {GROUPS.map((group) => (
        <div key={group.title} style={{ marginBottom: 12 }}>
          <div className="field-label" style={{ fontWeight: 600, marginBottom: 4 }}>
            {group.title}
          </div>
          <div className="form-grid">
            {group.fields.map(([key, label]) => (
              <label key={key} className="field">
                <span className="field-label">
                  {label}
                  {draft[key] !== data.defaults[key] && (
                    <span className="muted"> (стандартно {data.defaults[key]})</span>
                  )}
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft[key]}
                  onChange={(e) => change({ [key]: e.target.value === '' ? '' : Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 12.5 }}>
        0 означає «заборонено». Telegram не публікує точних лімітів для звичайних акаунтів. Найчастіше обмежують за
        повідомлення незнайомим людям, посилання й запрошення в особистих, рекламу в групах і різкий ріст активності
        нового акаунта. Тому стандартні значення обережні. Підвищуйте їх поступово.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        {saved && <span className="muted">Збережено</span>}
        <button className="btn" disabled={saving} onClick={() => save({ reset: true })}>
          Стандартні значення
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={() => save(draft)}>
          {saving ? 'Збереження...' : 'Зберегти ліміти'}
        </button>
      </div>
    </div>
  );
}

const JOIN_STATUS = {
  joined: 'Акаунт вступив у чат',
  requested: 'Заявку на вступ надіслано, чекає схвалення адміністратора',
  already: 'Акаунт уже є учасником цього чату',
};

function JoinCard({ accountId, onDone }) {
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!chat.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await joinTelegramChat(accountId, chat.trim()));
      setChat('');
      onDone();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося вступити в чат'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">Вступити в канал або групу</div>
      <form onSubmit={submit} className="account-checkboxes">
        <input
          style={{ flex: '1 1 280px' }}
          placeholder="@username, https://t.me/name або посилання-запрошення t.me/+..."
          value={chat}
          onChange={(e) => setChat(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !chat.trim()}>
          {busy ? 'Вступ...' : 'Вступити'}
        </button>
      </form>
      {result && (
        <p style={{ marginTop: 8 }}>
          {JOIN_STATUS[result.status]}
          {result.chat?.title && `: ${result.chat.title}`}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Вступ проходить через ліміти: кількість за добу й тиждень, пауза між вступами і стеля кількості каналів. Після
        вступу акаунт кілька годин не пише в цей чат, а перші дні пише менше.
      </p>
    </div>
  );
}

export default function TelegramLimitsPanel({ accounts }) {
  const authorized = accounts.filter((a) => a.authStatus === 'authorized');
  const [accountId, setAccountId] = useState(authorized[0]?._id || accounts[0]?._id || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetchTelegramLimits(accountId)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, 'Не вдалося завантажити ліміти')));

  useEffect(() => {
    if (!accounts.some((a) => a._id === accountId) && accounts[0]) setAccountId(authorized[0]?._id || accounts[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  useEffect(() => {
    if (!accountId) return undefined;
    setData(null);
    load();
    const timer = setInterval(load, 30 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const clear = async (what) => {
    setBusy(true);
    try {
      setData(await clearTelegramLimitBlock(accountId, what));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зняти обмеження'));
    } finally {
      setBusy(false);
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="card">
        <p className="empty-state">Немає Telegram-акаунтів.</p>
      </div>
    );
  }

  const selected = accounts.find((a) => a._id === accountId);

  return (
    <div>
      <div className="card">
        <label className="field" style={{ maxWidth: 360 }}>
          <span className="field-label">Акаунт</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.displayName || a.phone}
                {a.profile?.username ? ` (@${a.profile.username})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {data === null ? (
        !error && <p className="muted">Завантаження...</p>
      ) : (
        <>
          <StateCard data={data} onClear={clear} busy={busy} />
          <UsageCard data={data} />
          {selected?.authStatus === 'authorized' && <JoinCard accountId={accountId} onDone={load} />}
          <LimitsForm key={accountId} accountId={accountId} data={data} onSaved={setData} />
        </>
      )}
    </div>
  );
}
