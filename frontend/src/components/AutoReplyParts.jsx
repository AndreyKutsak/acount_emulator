// Спільні частини панелей автовідповідей (Telegram і особисті Threads): правила,
// перевірка тексту, журнал і статистика. Різниця між платформами - в об'єкті api:
//   fetchRules, createRule, updateRule, deleteRule, testRule, fetchLogs, fetchStats,
//   accountLabel(account), replyPlaceholder, replyHint, testHint?, sampleName?
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';
import Modal from './Modal';

const MATCH_TYPES = {
  contains: 'Містить слово або фразу',
  exact: 'Повідомлення дорівнює',
  regex: 'Регулярний вираз',
};

const LOG_STATUS = {
  replied: { label: 'відповідь', className: 'auth-authorized' },
  ignored: { label: 'без відповіді', className: 'auth-unknown' },
  no_match: { label: 'без збігу', className: 'auth-unknown' },
  skipped: { label: 'пропущено', className: 'auth-unknown' },
  failed: { label: 'помилка', className: 'auth-failed' },
};

const REPLY_SEPARATOR = '\n===\n';

const emptyRule = {
  name: '',
  category: '',
  action: 'reply',
  excludeKeywords: '',
  keywords: '',
  matchType: 'contains',
  matchMode: 'any',
  isFallback: false,
  replies: '',
  priority: 0,
  oncePerUser: false,
  enabled: true,
  accounts: [],
};

function ruleToForm(rule) {
  return {
    ...emptyRule,
    ...rule,
    category: rule.category || '',
    action: rule.action || 'reply',
    excludeKeywords: (rule.excludeKeywords || []).join('\n'),
    keywords: (rule.keywords || []).join('\n'),
    replies: (rule.replies || []).join(REPLY_SEPARATOR),
    accounts: (rule.accounts || []).map(String),
  };
}

const lines = (text) => text.split('\n').map((k) => k.trim()).filter(Boolean);

// The category a rule assigns: its own, or its name.
const categoryOf = (rule) => rule.category || rule.name;

function formToRule(form) {
  return {
    name: form.name,
    category: form.category.trim(),
    action: form.action,
    excludeKeywords: lines(form.excludeKeywords),
    keywords: lines(form.keywords),
    matchType: form.matchType,
    matchMode: form.matchMode,
    isFallback: form.isFallback,
    // Variants are separated by a line with "===".
    replies: form.replies.split(/^\s*===\s*$/m).map((r) => r.trim()).filter(Boolean),
    priority: Number(form.priority) || 0,
    oncePerUser: form.oncePerUser,
    enabled: form.enabled,
    accounts: form.accounts,
  };
}

function RuleForm({ api, rule, accounts, categories, onClose, onSaved }) {
  const [form, setForm] = useState(rule ? ruleToForm(rule) : emptyRule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (rule) await api.updateRule(rule._id, formToRule(form));
      else await api.createRule(formToRule(form));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти правило'));
    } finally {
      setSaving(false);
    }
  };

  const toggleAccount = (id) =>
    set({ accounts: form.accounts.includes(id) ? form.accounts.filter((a) => a !== id) : [...form.accounts, id] });

  return (
    <Modal title={rule ? `Правило: ${rule.name}` : 'Нове правило автовідповіді'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Назва</span>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="напр. Ціни" required />
          </label>
          <label className="field">
            <span className="field-label">Категорія повідомлення</span>
            <input
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
              placeholder={form.name || 'напр. Пошук роботи'}
              list="auto-reply-categories"
            />
            <datalist id="auto-reply-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span className="field-label">Пріоритет (більший перемагає)</span>
            <input type="number" value={form.priority} onChange={(e) => set({ priority: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Що робити з повідомленням</span>
            <select value={form.action} onChange={(e) => set({ action: e.target.value })}>
              <option value="reply">Відповісти текстом правила</option>
              <option value="ignore">Лише класифікувати, не відповідати</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
          Категорія показується в журналі й статистиці. Порожня означає, що категорією буде назва правила. «Лише
          класифікувати» підходить для спаму й образ: чат буде прочитано, але відповіді не буде.
        </p>

        <label className="checkbox-item" style={{ margin: '10px 0' }}>
          <input type="checkbox" checked={form.isFallback} onChange={(e) => set({ isFallback: e.target.checked })} />
          Відповідь за замовчуванням, коли жодне правило з ключовими словами не підійшло
        </label>

        {!form.isFallback && (
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Як шукати</span>
              <select value={form.matchType} onChange={(e) => set({ matchType: e.target.value })}>
                {Object.entries(MATCH_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Умова</span>
              <select value={form.matchMode} onChange={(e) => set({ matchMode: e.target.value })}>
                <option value="any">Будь-яке з ключових слів</option>
                <option value="all">Усі ключові слова разом</option>
              </select>
            </label>
            <label className="field field-wide">
              <span className="field-label">Ключові слова, кожне з нового рядка</span>
              <textarea
                rows={4}
                value={form.keywords}
                onChange={(e) => set({ keywords: e.target.value })}
                placeholder={'цін*\nпрайс\nскільки коштує'}
              />
            </label>
            <label className="field field-wide">
              <span className="field-label">Слова-винятки: якщо є хоч одне, правило не спрацьовує</span>
              <textarea
                rows={2}
                value={form.excludeKeywords}
                onChange={(e) => set({ excludeKeywords: e.target.value })}
                placeholder={'не шукаю*\nвже працюю'}
              />
            </label>
          </div>
        )}
        {!form.isFallback && form.matchType === 'contains' && (
          <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
            Регістр не важливий, слово шукається цілим. Зірочка в кінці означає будь-яке закінчення: «цін*» знаходить
            «ціна», «ціни», «ціну».
          </p>
        )}

        {form.action === 'reply' && (
          <>
            <label className="field field-wide" style={{ marginTop: 12 }}>
              <span className="field-label">Тексти відповіді</span>
              <textarea
                rows={6}
                value={form.replies}
                onChange={(e) => set({ replies: e.target.value })}
                placeholder={api.replyPlaceholder}
              />
            </label>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 8px' }}>
              {api.replyHint}
            </p>
          </>
        )}

        <div className="account-checkboxes" style={{ margin: '8px 0' }}>
          <label className="checkbox-item">
            <input type="checkbox" checked={form.oncePerUser} onChange={(e) => set({ oncePerUser: e.target.checked })} />
            Відповідати цим правилом кожній людині лише раз
          </label>
          <label className="checkbox-item">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Увімкнено
          </label>
        </div>

        <div className="field-label" style={{ margin: '8px 0 4px' }}>
          Акаунти (нічого не обрано означає всі)
        </div>
        <div className="account-checkboxes">
          {accounts.map((a) => (
            <label key={a._id} className="checkbox-item">
              <input type="checkbox" checked={form.accounts.includes(a._id)} onChange={() => toggleAccount(a._id)} />
              {api.accountLabel(a)}
            </label>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TestBox({ api, accountId }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(undefined);
  const [error, setError] = useState(null);

  const run = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      setResult(await api.testRule({ accountId, text, firstName: api.sampleName || '' }));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити'));
    }
  };

  return (
    <form onSubmit={run} style={{ marginTop: 12 }}>
      <div className="account-checkboxes">
        <input
          style={{ flex: '1 1 260px' }}
          placeholder="Введіть повідомлення, щоб перевірити, яке правило спрацює"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-sm" disabled={!text.trim()}>
          Перевірити
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && !result.match && <p className="muted">Жодне правило не спрацює.</p>}
      {result?.match && (
        <div style={{ marginTop: 8, fontSize: 13.5 }}>
          <div>
            Категорія: <strong>{result.category || result.match.category}</strong>
          </div>
          {result.candidates.length > 1 && (
            <div className="muted" style={{ fontSize: 12.5 }}>
              Також підходять: {result.candidates.slice(1).map((c) => c.category).join(', ')}
            </div>
          )}
          <div>
            {result.match.action === 'ignore' ? 'Без відповіді, правило' : 'Відповість правило'}{' '}
            <strong>{result.match.ruleName}</strong>
            {result.match.fallback
              ? ' (відповідь за замовчуванням)'
              : ` за словами: ${result.match.matchedKeywords.join(', ')}`}
          </div>
          {result.match.reply.length > 0 && (
            <>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {result.match.reply.map((part, i) => (
                  <li key={i} style={{ whiteSpace: 'pre-wrap' }}>
                    {part}
                  </li>
                ))}
              </ul>
              {api.sampleName && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Ім'я співрозмовника в прикладі: {api.sampleName}.
                </div>
              )}
            </>
          )}
        </div>
      )}
      {api.testHint && (
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          {api.testHint}
        </p>
      )}
    </form>
  );
}

function RulesCard({ api, accountId, accounts }) {
  const [rules, setRules] = useState(null);
  const [formRule, setFormRule] = useState(undefined); // undefined = closed, null = new
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setRules(await api.fetchRules(accountId));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити правила'));
      setRules([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const patch = async (rule, data, fallback) => {
    setError(null);
    try {
      await data();
      await load();
    } catch (err) {
      setError(errorMessage(err, fallback));
    }
  };

  const accountName = (id) => {
    const a = accounts.find((x) => x._id === String(id));
    return a ? api.accountLabel(a) : 'видалений акаунт';
  };

  const categories = [...new Set((rules || []).map(categoryOf))].sort((a, b) => a.localeCompare(b, 'uk'));

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Категорії: ключові слова й готові відповіді</span>
        <button className="btn btn-primary btn-sm" onClick={() => setFormRule(null)}>
          Нове правило
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {rules === null ? (
        <p className="muted">Завантаження...</p>
      ) : rules.length === 0 ? (
        <p className="empty-state">Правил ще немає. Додайте перше: ключові слова й текст, яким відповісти.</p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th>Правило</th>
                <th>Ключові слова</th>
                <th>Відповідь</th>
                <th>Акаунти</th>
                <th>Спрацювало</th>
                <th>Увімк.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule._id} style={rule.enabled ? undefined : { opacity: 0.55 }}>
                  <td data-label="Правило">
                    <span className="status-badge auth-unknown">{categoryOf(rule)}</span>
                    <div className="cell-title">{rule.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      пріоритет {rule.priority}
                      {rule.oncePerUser && ' · один раз на людину'}
                    </div>
                  </td>
                  <td data-label="Ключові слова" style={{ fontSize: 13 }}>
                    {rule.isFallback ? (
                      <span className="status-badge auth-unknown">за замовчуванням</span>
                    ) : (
                      <>
                        {rule.keywords.join(', ')}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {MATCH_TYPES[rule.matchType]}
                          {rule.matchMode === 'all' && ', усі разом'}
                        </div>
                        {rule.excludeKeywords?.length > 0 && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            крім: {rule.excludeKeywords.join(', ')}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td data-label="Відповідь" className="post-text-cell" title={rule.replies.join('\n\n')}>
                    {rule.action === 'ignore' ? <span className="muted">не відповідати</span> : rule.replies[0]}
                    {rule.action !== 'ignore' && rule.replies.length > 1 && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        варіантів: {rule.replies.length}
                      </div>
                    )}
                  </td>
                  <td data-label="Акаунти" className="td-inline" style={{ fontSize: 13 }}>
                    {rule.accounts.length === 0 ? 'усі' : rule.accounts.map(accountName).join(', ')}
                  </td>
                  <td data-label="Спрацювало" className="td-inline">{rule.usageCount}</td>
                  <td data-label="Увімк." className="td-inline">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        patch(rule, () => api.updateRule(rule._id, { enabled: e.target.checked }), 'Не вдалося змінити')
                      }
                    />
                  </td>
                  <td className="vpn-actions">
                    <button className="btn btn-sm" onClick={() => setFormRule(rule)}>
                      Змінити
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => patch(rule, () => api.deleteRule(rule._id), 'Не вдалося видалити')}
                    >
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TestBox api={api} accountId={accountId} />
      {formRule !== undefined && (
        <RuleForm
          api={api}
          rule={formRule}
          accounts={accounts}
          categories={categories}
          onClose={() => setFormRule(undefined)}
          onSaved={() => {
            setFormRule(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}

function LogCard({ api, accountId, category, onCategory }) {
  const [logs, setLogs] = useState(null);
  const [status, setStatus] = useState('');

  const load = () =>
    api.fetchLogs(accountId, {
      limit: 50,
      status: status || undefined,
      category: category ?? undefined,
    })
      .then(setLogs)
      .catch(() => setLogs([]));

  useEffect(() => {
    setLogs(null);
    load();
    const timer = setInterval(load, 20 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, status, category]);

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>Журнал діалогів</span>
        {category != null && (
          <button className="btn btn-sm" onClick={() => onCategory(null)} title="Показати всі категорії">
            Категорія: {category || 'без категорії'} ✕
          </button>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Усі</option>
          {Object.entries(LOG_STATUS).map(([value, s]) => (
            <option key={value} value={value}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={load}>
          Оновити
        </button>
      </div>
      {logs === null ? (
        <p className="muted">Завантаження...</p>
      ) : logs.length === 0 ? (
        <p className="empty-state">Записів ще немає</p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th>Час</th>
                <th>Від кого</th>
                <th>Повідомлення</th>
                <th>Результат</th>
                <th>Відповідь</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const st = LOG_STATUS[log.status];
                return (
                  <tr key={log._id}>
                    <td data-label="Час" style={{ fontSize: 13 }}>
                      {formatDate(log.receivedAt || log.createdAt)}
                      {log.readAt && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          прочитано {new Date(log.readAt).toLocaleTimeString('uk-UA')}
                        </div>
                      )}
                    </td>
                    <td data-label="Від кого">
                      {log.peerName || log.peerId}
                      {log.peerUsername && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          @{log.peerUsername}
                        </div>
                      )}
                    </td>
                    <td data-label="Повідомлення" className="post-text-cell" title={log.incomingText} style={{ whiteSpace: 'pre-wrap' }}>
                      {log.incomingText}
                    </td>
                    <td data-label="Результат">
                      <span className={`status-badge ${st.className}`}>{st.label}</span>
                      {log.category && (
                        <div style={{ fontSize: 12.5 }}>
                          <strong>{log.category}</strong>
                          {log.categories?.length > 1 && (
                            <span className="muted"> (також: {log.categories.filter((c) => c !== log.category).join(', ')})</span>
                          )}
                        </div>
                      )}
                      {log.ruleName && log.ruleName !== log.category && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          правило: {log.ruleName}
                        </div>
                      )}
                      {log.reason && (
                        <div className={log.status === 'failed' ? 'error-inline' : 'muted'} style={{ fontSize: 12 }}>
                          {log.reason}
                        </div>
                      )}
                    </td>
                    <td data-label="Відповідь" className="post-text-cell" title={log.replyText} style={{ whiteSpace: 'pre-wrap' }}>
                      {log.replyText || <span className="muted">-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STAT_COLUMNS = [
  ['replied', 'відповіли'],
  ['ignored', 'без відповіді'],
  ['skipped', 'пропущено'],
  ['failed', 'помилки'],
];

// How incoming private messages were classified: per category, how many came in
// and what happened to them. Clicking a category filters the log.
function StatsCard({ api, accountId, onCategory }) {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);

  const load = () =>
    api.fetchStats(accountId, days)
      .then(setStats)
      .catch(() => setStats({ total: 0, categories: [] }));

  useEffect(() => {
    setStats(null);
    load();
    const timer = setInterval(load, 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, days]);

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Класифікація повідомлень</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>за добу</option>
          <option value={7}>за 7 днів</option>
          <option value={30}>за 30 днів</option>
        </select>
      </div>
      {stats === null ? (
        <p className="muted">Завантаження...</p>
      ) : stats.total === 0 ? (
        <p className="empty-state">За цей період повідомлень не було</p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th>Категорія</th>
                <th>Повідомлень</th>
                <th>Людей</th>
                {STAT_COLUMNS.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                <th>Останнє</th>
              </tr>
            </thead>
            <tbody>
              {stats.categories.map((c) => (
                <tr key={c.category || '-'} style={{ cursor: 'pointer' }} onClick={() => onCategory(c.category)}>
                  <td data-label="Категорія">
                    {c.category ? <strong>{c.category}</strong> : <span className="muted">без категорії</span>}
                  </td>
                  <td data-label="Повідомлень">
                    {c.total}
                    <span className="muted" style={{ fontSize: 12 }}>
                      {' '}
                      ({Math.round((c.total / stats.total) * 100)}%)
                    </span>
                  </td>
                  <td data-label="Людей">{c.people}</td>
                  {STAT_COLUMNS.map(([key, label]) => (
                    <td key={key} data-label={label}>
                      {c.statuses[key] || <span className="muted">0</span>}
                    </td>
                  ))}
                  <td data-label="Останнє" style={{ fontSize: 13 }}>
                    {formatDate(c.lastAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        Натисніть на категорію, щоб побачити її повідомлення в журналі.
      </p>
    </div>
  );
}
export { RulesCard, LogCard, StatsCard, LOG_STATUS };
