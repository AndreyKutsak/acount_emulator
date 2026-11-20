import { useEffect, useState } from 'react';
import {
  fetchAutoReplyRules,
  createAutoReplyRule,
  updateAutoReplyRule,
  deleteAutoReplyRule,
  testAutoReply,
  fetchAutoReplySettings,
  updateAutoReplySettings,
  fetchAutoReplyLogs,
  fetchAutoReplyStats,
} from '../api/telegram';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';
import { RulesCard, LogCard, StatsCard } from './AutoReplyParts';

const telegramApi = {
  fetchRules: fetchAutoReplyRules,
  createRule: createAutoReplyRule,
  updateRule: updateAutoReplyRule,
  deleteRule: deleteAutoReplyRule,
  testRule: testAutoReply,
  fetchLogs: fetchAutoReplyLogs,
  fetchStats: fetchAutoReplyStats,
  accountLabel: (a) => a.displayName || a.phone,
  replyPlaceholder:
    'Привіт, {name}! Прайс надішлю за хвилину.\n---\nОсь він: https://...\n===\n{Вітаю|Добрий день}, {name}! Ціни тут: https://...',
  replyHint:
    "Рядок «===» розділяє варіанти відповіді, з них береться випадковий. Рядок «---» ділить відповідь на кілька повідомлень поспіль. {name} підставляє ім'я співрозмовника, а {Вітаю|Добрий день} обирає випадковий варіант. Посилання в особистих рахуються в лімітах активності акаунта.",
  testHint: 'Голосові, фото і стікери надходять у правила як «[голосове]», «[фотографія]», «[стікер]», «[відео]», «[файл]».',
  sampleName: 'Олена',
};

function NumberField({ label, name, settings, onChange, step = 1 }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={settings[name]}
        onChange={(e) => onChange({ [name]: e.target.value === '' ? '' : Number(e.target.value) })}
      />
    </label>
  );
}

function SettingsCard({ accountId }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const res = await fetchAutoReplySettings(accountId);
      setData(res);
      setDraft(res.settings);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити налаштування'));
    }
  };

  useEffect(() => {
    setData(null);
    setDraft(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const save = async (patch = {}) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await updateAutoReplySettings(accountId, { ...draft, ...patch });
      setData(res);
      setDraft(res.settings);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти налаштування'));
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="card">
        {error ? <p className="error">{error}</p> : <p className="muted">Завантаження...</p>}
      </div>
    );
  }

  const change = (patch) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const worker = data?.status?.worker;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>Автовідповідач</span>
        <button
          className={`btn${data.settings.enabled ? ' btn-danger' : ' btn-primary'}`}
          disabled={saving}
          onClick={() => save({ enabled: !data.settings.enabled })}
        >
          {data.settings.enabled ? 'Вимкнути' : 'Увімкнути'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        {!data.status.enabled
          ? 'Фоновий автовідповідач вимкнено на сервері (SCHEDULER_ENABLED або TELEGRAM_AUTOREPLY_ENABLED = false).'
          : !data.settings.enabled
            ? 'Вимкнено для цього акаунта.'
            : worker
              ? `Слухає повідомлення${worker.connected ? '' : ' (перепідключення...)'}. Останнє повідомлення: ${
                  worker.lastEventAt ? formatDate(worker.lastEventAt) : 'ще не було'
                }. Чатів у роботі: ${worker.pendingChats}.`
              : 'Запускається...'}
        {worker?.lastError && <span className="error-inline"> {worker.lastError}</span>}
      </p>

      <div className="form-grid">
        <NumberField label="Прочитати через, від (с)" name="readDelayMinSec" settings={draft} onChange={change} />
        <NumberField label="до (с)" name="readDelayMaxSec" settings={draft} onChange={change} />
        <NumberField label="Пауза перед набором, від (с)" name="thinkDelayMinSec" settings={draft} onChange={change} />
        <NumberField label="до (с)" name="thinkDelayMaxSec" settings={draft} onChange={change} />
        <NumberField label="Швидкість набору, символів/с" name="typingCharsPerSec" settings={draft} onChange={change} />
        <NumberField label="«Друкує» щонайменше (с)" name="typingMinSec" settings={draft} onChange={change} />
        <NumberField label="«Друкує» щонайбільше (с)" name="typingMaxSec" settings={draft} onChange={change} />
        <NumberField label="Пауза до наступної відповіді тій самій людині (хв)" name="cooldownMinutes" settings={draft} onChange={change} />
        <NumberField label="Макс. відповідей одній людині на день" name="maxRepliesPerUserPerDay" settings={draft} onChange={change} />
        <NumberField label="Підхоплювати непрочитані за останні (год)" name="catchUpHours" settings={draft} onChange={change} />
      </div>
      <div className="account-checkboxes" style={{ margin: '10px 0' }}>
        <label className="checkbox-item">
          <input
            type="checkbox"
            checked={draft.markReadWithoutMatch}
            onChange={(e) => change({ markReadWithoutMatch: e.target.checked })}
          />
          Позначати прочитаним, навіть якщо правило не знайдено
        </label>
        <label className="checkbox-item">
          <input type="checkbox" checked={draft.onlyNonContacts} onChange={(e) => change({ onlyNonContacts: e.target.checked })} />
          Відповідати лише тим, кого немає в контактах
        </label>
        <label className="checkbox-item">
          <input type="checkbox" checked={draft.replyToBots} onChange={(e) => change({ replyToBots: e.target.checked })} />
          Відповідати ботам
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Кілька повідомлень, надісланих поспіль до прочитання, отримують одну відповідь. Службові повідомлення Telegram
        (коди входу) ніколи не обробляються.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        {saved && <span className="muted">Збережено</span>}
        <button className="btn btn-primary" onClick={() => save()} disabled={saving}>
          {saving ? 'Збереження...' : 'Зберегти налаштування'}
        </button>
      </div>
    </div>
  );
}

export default function TelegramAutoReplyPanel({ accounts }) {
  const authorized = accounts.filter((a) => a.authStatus === 'authorized');
  const [accountId, setAccountId] = useState(authorized[0]?._id || '');
  // null = every category; '' = messages without a category.
  const [category, setCategory] = useState(null);

  useEffect(() => {
    setCategory(null);
  }, [accountId]);

  useEffect(() => {
    if (!authorized.some((a) => a._id === accountId) && authorized[0]) setAccountId(authorized[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  if (authorized.length === 0) {
    return (
      <div className="card">
        <p className="empty-state">Немає авторизованих Telegram-акаунтів. Увійдіть в акаунт на вкладці «Акаунти й чати».</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <label className="field" style={{ maxWidth: 360 }}>
          <span className="field-label">Акаунт</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {authorized.map((a) => (
              <option key={a._id} value={a._id}>
                {a.displayName || a.phone}
                {a.profile?.username ? ` (@${a.profile.username})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {accountId && (
        <>
          <SettingsCard accountId={accountId} />
          <RulesCard api={telegramApi} accountId={accountId} accounts={accounts} />
          <StatsCard api={telegramApi} accountId={accountId} onCategory={setCategory} />
          <LogCard api={telegramApi} accountId={accountId} category={category} onCategory={setCategory} />
        </>
      )}
    </div>
  );
}
