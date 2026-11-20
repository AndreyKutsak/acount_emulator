import { useEffect, useMemo, useState } from 'react';
import { fetchAccounts } from '../api/socialAccounts';
import {
  fetchDmRules,
  createDmRule,
  updateDmRule,
  deleteDmRule,
  testDmRule,
  fetchDmSettings,
  updateDmSettings,
  runDmNow,
  fetchDmLogs,
  fetchDmStats,
} from '../api/threadsDm';
import { errorMessage } from '../api/client';
import { formatDate } from '../components/StatusBadge';
import { RulesCard, LogCard, StatsCard } from '../components/AutoReplyParts';

const accountLabel = (a) => (a.displayName ? `${a.displayName} (@${a.username})` : `@${a.username}`);

const SPINTAX_HINT =
  'Рядок «===» розділяє варіанти відповіді. Вони чергуються випадково й без повторів: однакові повідомлення (наприклад «+») отримують різні відповіді, а той самий варіант повториться лише після всіх інших. {Вітаю|Привіт} обирає випадкове слово. «Добрий день», «Доброго ранку», «Добрий вечір» і токен {привітання} завжди підлаштовуються під поточну пору доби. Імені співрозмовника Threads не дає, тож {name} просто прибирається.';

// Усе, чим розділи відрізняються: тексти й канал у запитах.
const CHANNELS = {
  dm: {
    label: 'Особисті',
    title: 'Автовідповіді в особистих',
    replyPlaceholder:
      'Вітаю! Дякую, що написали. Уся інформація про вакансію - за посиланням у шапці профілю.\n===\n{Добрий день|Вітаю}! Рада, що вакансія зацікавила. Деталі - за посиланням у профілі.',
    replyHint: `${SPINTAX_HINT} Рядок «---» ділить відповідь на кілька повідомлень поспіль.`,
    running: 'Особисті перевіряються щоразу, коли телефон піднімається: після публікації поста й після збору статистики.',
    note: 'Чат відкривається лише тоді, коли на повідомлення є відповідь. Без відповідного правила чат лишається непрочитаним, і ви побачите його в застосунку самі. Кожне повідомлення обробляється один раз.',
  },
  comments: {
    label: 'Коментарі',
    title: 'Автовідповіді на коментарі',
    replyPlaceholder:
      'Вітаю! Рада, що ви відгукнулися. Уся інформація - за посиланням у профілі.\n===\n{Дякую за інтерес|Вітаю}! Деталі й умови - за посиланням у шапці профілю.',
    replyHint: `${SPINTAX_HINT} Відповідь публікується одним коментарем, усі рядки разом. Її бачать усі, тож для неї діють заборонені слова постів: без валюти й без Telegram.`,
    running: 'Коментарі під вашими постами перевіряються в тому ж сеансі, що й особисті: після публікації й після збору статистики.',
    note: 'Коментарі беруться з «Дії → Розмови». Коментарі ваших власних акаунтів пропускаються. Кожен коментар обробляється один раз.',
  },
};

function makeApi(channel) {
  const c = CHANNELS[channel];
  return {
    fetchRules: (accountId) => fetchDmRules(accountId, channel),
    createRule: (data) => createDmRule(data, channel),
    updateRule: updateDmRule,
    deleteRule: deleteDmRule,
    testRule: (data) => testDmRule(data, channel),
    fetchLogs: (accountId, params) => fetchDmLogs(accountId, params, channel),
    fetchStats: (accountId, days) => fetchDmStats(accountId, days, channel),
    accountLabel,
    replyPlaceholder: c.replyPlaceholder,
    replyHint: c.replyHint,
  };
}

const numberField = (label, name, draft, change, min, max) => (
  <label className="field">
    <span className="field-label">{label}</span>
    <input
      type="number"
      min={min}
      max={max}
      value={draft[name]}
      onChange={(e) => change({ [name]: e.target.value === '' ? '' : Number(e.target.value) })}
    />
  </label>
);

function summaryText(r, channel) {
  const found =
    channel === 'comments' && r.found != null
      ? `Знайдено коментарів: ${r.found}, підходять (свіжі, без відповіді, під вакансією): ${r.scanned}.`
      : `Перевірено ${channel === 'comments' ? 'коментарів' : 'чатів'}: ${r.scanned}.`;
  return `${found} Відповіли: ${r.replied}, без збігу: ${r.noMatch}, без відповіді: ${r.ignored}, пропущено: ${r.skipped}, помилок: ${r.failed}.`;
}

function SettingsCard({ accountId, channel }) {
  const c = CHANNELS[channel];
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  const apply = (res) => {
    setData(res);
    setDraft(res.settings);
  };

  useEffect(() => {
    setData(null);
    setDraft(null);
    setError(null);
    setNotice('');
    fetchDmSettings(accountId, channel)
      .then(apply)
      .catch((err) => setError(errorMessage(err, 'Не вдалося завантажити налаштування')));
  }, [accountId, channel]);

  const save = async (patch = {}) => {
    setBusy('save');
    setError(null);
    setNotice('');
    try {
      apply(await updateDmSettings(accountId, { ...draft, ...patch }, channel));
      setNotice('Збережено');
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти налаштування'));
    } finally {
      setBusy('');
    }
  };

  const runNow = async () => {
    setBusy('run');
    setError(null);
    setNotice('');
    try {
      const res = await runDmNow(accountId, channel);
      apply(res);
      const r = res.result || {};
      if (r.error) setError(r.error);
      else setNotice(summaryText(r, channel));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити'));
    } finally {
      setBusy('');
    }
  };

  if (!draft) {
    return <div className="card">{error ? <p className="error">{error}</p> : <p className="muted">Завантаження...</p>}</div>;
  }

  const change = (patch) => {
    setNotice('');
    setDraft((d) => ({ ...d, ...patch }));
  };
  const on = data.settings.enabled;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>{c.title}</span>
        {on && (
          <button className="btn" disabled={Boolean(busy)} onClick={runNow}>
            {busy === 'run' ? 'Перевіряю... (до кількох хвилин)' : 'Перевірити зараз'}
          </button>
        )}
        <button
          className={`btn${on ? ' btn-danger' : ' btn-primary'}`}
          disabled={Boolean(busy) || (!on && !data.hasPhone)}
          onClick={() => save({ enabled: !on })}
        >
          {on ? 'Вимкнути' : 'Увімкнути'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        {!data.hasPhone
          ? "До акаунта не прив'язано телефон. Відповіді надсилаються із застосунку Threads на телефоні акаунта."
          : !data.androidPosting
            ? 'Публікація через телефон вимкнена на сервері (ANDROID_THREADS_POSTING), тому перевірка йде лише кнопкою «Перевірити зараз».'
            : on
              ? c.running
              : 'Вимкнено: нічого не читається й не отримує відповідей.'}{' '}
        {data.lastRunAt && `Остання перевірка: ${formatDate(data.lastRunAt)}.`}
        {data.lastError && <span className="error-inline"> {data.lastError}</span>}
      </p>

      <div className="form-grid">
        {numberField('Відповідей за один сеанс, не більше', 'maxPerSession', draft, change, 0, 50)}
        {numberField('Відповідей за добу, не більше', 'maxPerDay', draft, change, 0, 500)}
        {channel === 'comments' &&
          numberField('Відповідати лише на коментарі, молодші за (год)', 'maxAgeHours', draft, change, 1, 168)}
      </div>
      <div className="account-checkboxes" style={{ margin: '10px 0' }}>
        {channel === 'dm' ? (
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={draft.includeRequests}
              onChange={(e) => change({ includeRequests: e.target.checked })}
            />
            Відповідати й на «Запити» (від людей, на яких акаунт не підписаний). Відповідь приймає запит.
          </label>
        ) : (
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={draft.skipAnswered}
              onChange={(e) => change({ skipAnswered: e.target.checked })}
            />
            Не відповідати, якщо під коментарем уже є відповідь
          </label>
        )}
        {channel === 'comments' && (
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={draft.onlyJobPosts}
              onChange={(e) => change({ onlyJobPosts: e.target.checked })}
            />
            Лише під вакансіями (не під постами «про життя» й не на відповіді під вашими коментарями)
          </label>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>{c.note}</p>
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        {notice && <span className="muted">{notice}</span>}
        <button className="btn btn-primary" onClick={() => save()} disabled={Boolean(busy)}>
          {busy === 'save' ? 'Збереження...' : 'Зберегти налаштування'}
        </button>
      </div>
    </div>
  );
}

export default function ThreadsDmPage() {
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [channel, setChannel] = useState('dm');
  // null = усі категорії; '' = без категорії.
  const [category, setCategory] = useState(null);
  const [error, setError] = useState(null);
  const api = useMemo(() => makeApi(channel), [channel]);

  useEffect(() => {
    fetchAccounts()
      .then((list) => {
        const threads = list.filter((a) => a.platform === 'threads');
        setAccounts(threads);
        const withPhone = threads.find((a) => a.androidProfileId || a.androidSerial);
        setAccountId((withPhone || threads[0])?._id || '');
      })
      .catch((err) => {
        setError(errorMessage(err, 'Не вдалося завантажити акаунти'));
        setAccounts([]);
      });
  }, []);

  useEffect(() => setCategory(null), [accountId, channel]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Автовідповіді Threads</h2>
          <p className="page-subtitle">Готові відповіді на особисті й коментарі за ключовими словами</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {accounts === null ? (
        <div className="card">
          <p className="muted">Завантаження...</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="card">
          <p className="empty-state">Немає акаунтів Threads. Додайте акаунт на вкладці «Акаунти».</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ maxWidth: 360, flex: '1 1 260px', margin: 0 }}>
              <span className="field-label">Акаунт</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {accountLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <div className="account-checkboxes" role="tablist" aria-label="Що налаштовуємо">
              {Object.entries(CHANNELS).map(([id, c]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={channel === id}
                  className={`btn${channel === id ? ' btn-primary' : ''}`}
                  onClick={() => setChannel(id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {accountId && (
            <>
              <SettingsCard key={`settings-${channel}`} accountId={accountId} channel={channel} />
              <RulesCard key={`rules-${channel}`} api={api} accountId={accountId} accounts={accounts} />
              <StatsCard key={`stats-${channel}`} api={api} accountId={accountId} onCategory={setCategory} />
              <LogCard
                key={`log-${channel}`}
                api={api}
                accountId={accountId}
                category={category}
                onCategory={setCategory}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
