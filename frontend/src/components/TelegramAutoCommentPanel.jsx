import { Fragment, useEffect, useState } from 'react';
import {
  fetchTelegramChats,
  fetchTemplateLanguages,
  fetchCommentTopics,
  fetchAutoCommentStatus,
  fetchAutoCommentTasks,
  createAutoCommentTask,
  updateAutoCommentTask,
  deleteAutoCommentTask,
  runAutoCommentTask,
  replanAutoCommentTask,
  fetchAutoCommentLogs,
  clearTelegramFloodWait,
} from '../api/telegram';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';
import Modal from './Modal';
import { LANGUAGES, languageLabel } from './telegramLanguages';

// Monday first, values as in JS Date#getDay (0 = Sunday).
const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Нд' },
];

const SLOT_STATUS = {
  pending: { label: 'заплановано', className: 'auth-unknown' },
  sent: { label: 'надіслано', className: 'auth-authorized' },
  skipped: { label: 'пропущено', className: 'auth-unknown' },
  failed: { label: 'помилка', className: 'auth-failed' },
  missed: { label: 'прострочено', className: 'auth-failed' },
};

const LOG_STATUS = {
  sent: { label: 'надіслано', className: 'auth-authorized' },
  skipped: { label: 'пропущено', className: 'auth-unknown' },
  failed: { label: 'помилка', className: 'auth-failed' },
};

const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv';
  } catch {
    return 'Europe/Kyiv';
  }
};

function defaultForm(chat) {
  return {
    chatId: chat?.id || '',
    language: 'uk',
    topicMode: 'auto',
    topics: [],
    fallbackUniversal: true,
    mode: 'slots',
    enabled: true,
    schedule: {
      timezone: browserTimezone(),
      days: [0, 1, 2, 3, 4, 5, 6],
      activeFrom: '09:00',
      activeTo: '21:00',
      commentsPerDay: 5,
      minIntervalMinutes: 30,
      delayMinMinutes: 5,
      delayMaxMinutes: 40,
    },
    targeting: { maxPostAgeHours: 24, onlyNewPosts: true, skipWithoutText: false, keywords: '' },
  };
}

function formFromTask(task) {
  return {
    chatId: task.chatId,
    language: task.language,
    topicMode: task.topicMode || 'auto',
    topics: task.topics?.length ? task.topics : task.category ? [task.category] : [],
    fallbackUniversal: task.fallbackUniversal !== false,
    mode: task.mode,
    enabled: task.enabled,
    schedule: { ...task.schedule },
    targeting: { ...task.targeting, keywords: (task.targeting?.keywords || []).join('\n') },
  };
}

function topicSummary(task) {
  const topics = task.topics?.length ? task.topics : task.category ? [task.category] : [];
  const parts = [
    task.topicMode === 'fixed'
      ? `теми: ${topics.join(', ') || 'усі'}`
      : `за змістом поста${topics.length ? `, теми: ${topics.join(', ')}` : ''}`,
  ];
  if (task.targeting?.keywords?.length) parts.push(`слова: ${task.targeting.keywords.join(', ')}`);
  return parts.join(' · ');
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function scheduleSummary(task) {
  const s = task.schedule;
  const days =
    s.days.length === 7
      ? 'щодня'
      : WEEKDAYS.filter((d) => s.days.includes(d.value))
          .map((d) => d.label)
          .join(', ');
  const window = `${s.activeFrom}–${s.activeTo}`;
  if (task.mode === 'perPost') {
    return `Кожен новий пост через ${s.delayMinMinutes}–${s.delayMaxMinutes} хв · ${days} ${window} · до ${s.commentsPerDay}/день`;
  }
  return `${s.commentsPerDay} коментарів на день · ${days} ${window} · інтервал від ${s.minIntervalMinutes} хв`;
}

function NumberField({ label, value, onChange, min, max }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </label>
  );
}

function TaskForm({ account, task, presetChat, onClose, onSaved }) {
  const [form, setForm] = useState(task ? formFromTask(task) : defaultForm(presetChat));
  const [chats, setChats] = useState(null);
  const [languages, setLanguages] = useState([]);
  const [topics, setTopics] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTemplateLanguages()
      .then(setLanguages)
      .catch(() => setLanguages([]));
    fetchCommentTopics()
      .then(setTopics)
      .catch(() => setTopics([]));
    if (!task) {
      fetchTelegramChats(account._id)
        .then(setChats)
        .catch((err) => {
          setError(errorMessage(err, 'Не вдалося завантажити чати акаунта'));
          setChats([]);
        });
    }
  }, [account._id, task]);

  const setSchedule = (patch) => setForm((f) => ({ ...f, schedule: { ...f.schedule, ...patch } }));
  const setTargeting = (patch) => setForm((f) => ({ ...f, targeting: { ...f.targeting, ...patch } }));

  const toggleDay = (day) =>
    setSchedule({
      days: form.schedule.days.includes(day)
        ? form.schedule.days.filter((d) => d !== day)
        : [...form.schedule.days, day],
    });

  // Only chats where a comment can actually land: channels with a discussion
  // group, and supergroups (replies in a message's thread).
  const commentableChats = (chats || []).filter(
    (c) => (c.type === 'channel' && c.hasLinkedChat) || c.type === 'supergroup'
  );
  const chatOptions =
    presetChat && !commentableChats.some((c) => c.id === presetChat.id)
      ? [presetChat, ...commentableChats]
      : commentableChats;

  const languageOptions = [
    ...LANGUAGES,
    ...languages.filter((l) => !LANGUAGES.some((x) => x.code === l.language)).map((l) => ({ code: l.language, label: l.language })),
  ];
  const countFor = (code) => languages.find((l) => l.language === code)?.enabled || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        targeting: {
          ...form.targeting,
          keywords: String(form.targeting.keywords || '')
            .split('\n')
            .map((k) => k.trim())
            .filter(Boolean),
        },
      };
      if (task) {
        const { chatId, ...patch } = payload;
        await updateAutoCommentTask(task._id, patch);
      } else {
        await createAutoCommentTask(account._id, payload);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти завдання'));
    } finally {
      setSaving(false);
    }
  };

  const s = form.schedule;
  const t = form.targeting;

  return (
    <Modal title={task ? `Автокоментування: ${task.chatTitle}` : 'Нове завдання автокоментування'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          {!task && (
            <label className="field field-wide">
              <span className="field-label">Група або канал</span>
              <select value={form.chatId} onChange={(e) => setForm({ ...form, chatId: e.target.value })} required>
                <option value="">{chats === null ? 'Завантаження...' : 'Оберіть чат'}</option>
                {chatOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.type === 'channel' ? 'канал, коментарі під постами' : 'супергрупа, відповіді в гілках'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">Мова коментарів</span>
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              {languageOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} · заготовок: {countFor(l.code)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {countFor(form.language) === 0 && (
          <p className="error" style={{ fontSize: 13 }}>
            Немає увімкнених заготовок мовою «{languageLabel(form.language)}». Додайте їх на вкладці «Заготовки».
          </p>
        )}

        <div className="card-title" style={{ margin: '16px 0 8px' }}>
          Тематика коментарів
        </div>
        <div className="account-checkboxes" style={{ marginBottom: 8 }}>
          <label className="checkbox-item">
            <input type="radio" checked={form.topicMode === 'auto'} onChange={() => setForm({ ...form, topicMode: 'auto' })} />
            За змістом поста (тема визначається автоматично)
          </label>
          <label className="checkbox-item">
            <input type="radio" checked={form.topicMode === 'fixed'} onChange={() => setForm({ ...form, topicMode: 'fixed' })} />
            Лише обрані теми, незалежно від поста
          </label>
        </div>
        <div className="field-label" style={{ margin: '4px 0' }}>
          {form.topicMode === 'auto'
            ? 'Теми, дозволені в цьому чаті (нічого не обрано означає всі)'
            : 'Теми, з яких брати коментарі'}
        </div>
        <div className="account-checkboxes" style={{ marginBottom: 8 }}>
          {topics
            .filter((tp) => !tp.avoid && tp.enabled)
            .map((tp) => {
              const count = tp.templateCounts?.[form.language] || 0;
              return (
                <label key={tp._id} className="checkbox-item" title={tp.description}>
                  <input
                    type="checkbox"
                    checked={form.topics.includes(tp.name)}
                    onChange={() =>
                      setForm({
                        ...form,
                        topics: form.topics.includes(tp.name)
                          ? form.topics.filter((n) => n !== tp.name)
                          : [...form.topics, tp.name],
                      })
                    }
                  />
                  <span className={count ? undefined : 'muted'}>
                    {tp.name} ({count})
                  </span>
                </label>
              );
            })}
        </div>
        {form.topicMode === 'auto' && (
          <label className="checkbox-item" style={{ marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={form.fallbackUniversal}
              onChange={(e) => setForm({ ...form, fallbackUniversal: e.target.checked })}
            />
            Якщо тему поста не визначено, коментувати універсальним коментарем (інакше пропускати пост)
          </label>
        )}
        <p className="muted" style={{ fontSize: 12.5 }}>
          У дужках кількість коментарів мовою «{languageLabel(form.language)}». Пости на чутливі теми (загибель,
          обстріли тощо) не коментуються в жодному режимі.
        </p>

        <div className="card-title" style={{ margin: '16px 0 8px' }}>
          Розклад
        </div>
        <div className="account-checkboxes" style={{ marginBottom: 8 }}>
          <label className="checkbox-item">
            <input type="radio" checked={form.mode === 'slots'} onChange={() => setForm({ ...form, mode: 'slots' })} />
            N коментарів на день у випадковий час
          </label>
          <label className="checkbox-item">
            <input type="radio" checked={form.mode === 'perPost'} onChange={() => setForm({ ...form, mode: 'perPost' })} />
            Коментувати кожен новий пост
          </label>
        </div>
        <div className="account-checkboxes" style={{ marginBottom: 8 }}>
          {WEEKDAYS.map((d) => (
            <label key={d.value} className="checkbox-item">
              <input type="checkbox" checked={s.days.includes(d.value)} onChange={() => toggleDay(d.value)} />
              {d.label}
            </label>
          ))}
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Активно з</span>
            <input type="time" value={s.activeFrom} onChange={(e) => setSchedule({ activeFrom: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">до</span>
            <input type="time" value={s.activeTo} onChange={(e) => setSchedule({ activeTo: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Часовий пояс</span>
            <input value={s.timezone} onChange={(e) => setSchedule({ timezone: e.target.value })} />
          </label>
          <NumberField
            label={form.mode === 'slots' ? 'Коментарів на день' : 'Максимум на день'}
            value={s.commentsPerDay}
            min={1}
            max={200}
            onChange={(v) => setSchedule({ commentsPerDay: v })}
          />
          <NumberField
            label="Мін. інтервал між коментарями, хв"
            value={s.minIntervalMinutes}
            min={1}
            max={1440}
            onChange={(v) => setSchedule({ minIntervalMinutes: v })}
          />
          {form.mode === 'perPost' && (
            <>
              <NumberField
                label="Затримка після посту від, хв"
                value={s.delayMinMinutes}
                min={0}
                max={1440}
                onChange={(v) => setSchedule({ delayMinMinutes: v })}
              />
              <NumberField
                label="до, хв"
                value={s.delayMaxMinutes}
                min={0}
                max={1440}
                onChange={(v) => setSchedule({ delayMaxMinutes: v })}
              />
            </>
          )}
        </div>

        <div className="card-title" style={{ margin: '16px 0 8px' }}>
          Які пости коментувати
        </div>
        <label className="field field-wide" style={{ marginBottom: 8 }}>
          <span className="field-label">Лише пости з ключовими словами (необов'язково, кожне з нового рядка)</span>
          <textarea
            rows={3}
            value={t.keywords}
            onChange={(e) => setTargeting({ keywords: e.target.value })}
            placeholder={'ваканс*\nробот*\nработ*'}
          />
        </label>
        <div className="form-grid">
          <NumberField
            label="Не старші за, годин"
            value={t.maxPostAgeHours}
            min={1}
            max={720}
            onChange={(v) => setTargeting({ maxPostAgeHours: v })}
          />
        </div>
        <div className="account-checkboxes" style={{ margin: '8px 0' }}>
          <label className="checkbox-item">
            <input type="checkbox" checked={t.onlyNewPosts} onChange={(e) => setTargeting({ onlyNewPosts: e.target.checked })} />
            Лише пости, опубліковані після запуску завдання
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={t.skipWithoutText}
              onChange={(e) => setTargeting({ skipWithoutText: e.target.checked })}
            />
            Пропускати пости без тексту
          </label>
          <label className="checkbox-item">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Завдання увімкнене
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Один пост коментується цим акаунтом лише раз. Свої пости акаунт не коментує.
        </p>

        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || (!task && !form.chatId)}>
            {saving ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskDetails({ task, onChanged }) {
  const [logs, setLogs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadLogs = () =>
    fetchAutoCommentLogs(task._id, 30)
      .then(setLogs)
      .catch(() => setLogs([]));

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task._id, task.updatedAt]);

  const replan = async () => {
    setBusy(true);
    setError(null);
    try {
      await replanAutoCommentTask(task._id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перегенерувати розклад'));
    } finally {
      setBusy(false);
    }
  };

  const slots = task.plan?.slots || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="card-title" style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>
            Розклад на сьогодні{task.plan?.date ? ` (${task.plan.date}, ${task.plan.timezone})` : ''}
          </span>
          {task.mode === 'slots' && (
            <button className="btn btn-sm" onClick={replan} disabled={busy}>
              Перегенерувати
            </button>
          )}
        </div>
        {task.mode === 'perPost' ? (
          <p className="muted">
            Режим «кожен новий пост»: фіксованих слотів немає, новий пост отримує коментар через{' '}
            {task.schedule.delayMinMinutes}–{task.schedule.delayMaxMinutes} хв після публікації.
          </p>
        ) : slots.length === 0 ? (
          <p className="muted">
            На сьогодні слотів немає: вихідний, денний ліміт вичерпано або робоче вікно вже минуло. Новий розклад
            сформується автоматично завтра.
          </p>
        ) : (
          <div className="account-checkboxes">
            {slots.map((slot, i) => {
              const st = SLOT_STATUS[slot.status] || SLOT_STATUS.pending;
              return (
                <span key={i} className={`status-badge ${st.className}`} title={slot.note || st.label}>
                  {formatTime(slot.at)} · {st.label}
                </span>
              );
            })}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div>
        <div className="card-title" style={{ marginBottom: 8 }}>
          Журнал
        </div>
        {logs === null ? (
          <p className="muted">Завантаження...</p>
        ) : logs.length === 0 ? (
          <p className="muted">Ще нічого не надсилалось</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {logs.map((log) => {
              const st = LOG_STATUS[log.status];
              return (
                <li key={log._id}>
                  <span className={`status-badge ${st.className}`}>{st.label}</span>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatDate(log.createdAt)}
                    {log.trigger === 'manual' && ' · вручну'}
                  </span>
                  {log.text && <div style={{ whiteSpace: 'pre-wrap' }}>{log.text}</div>}
                  {log.postId && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      до поста{' '}
                      {log.postUrl ? (
                        <a href={log.postUrl} target="_blank" rel="noreferrer">
                          #{log.postId}
                        </a>
                      ) : (
                        `#${log.postId}`
                      )}
                      {log.postText && `: ${log.postText.slice(0, 80)}${log.postText.length > 80 ? '…' : ''}`}
                    </div>
                  )}
                  {log.topic && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      тема: {log.topic}
                      {log.matchedKeywords?.length ? ` (за словами: ${log.matchedKeywords.join(', ')})` : ''}
                    </div>
                  )}
                  {log.reason && (
                    <div className={log.status === 'failed' ? 'error-inline' : 'muted'} style={{ fontSize: 12 }}>
                      {log.reason}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function TelegramAutoCommentPanel({ accounts, preset, onPresetUsed, onAccountsChanged }) {
  const authorized = accounts.filter((a) => a.authStatus === 'authorized');
  const [accountId, setAccountId] = useState(preset?.accountId || authorized[0]?._id || '');
  const [tasks, setTasks] = useState(null);
  const [status, setStatus] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [formState, setFormState] = useState(null); // { task?, presetChat? }
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const account = authorized.find((a) => a._id === accountId);

  const load = async () => {
    if (!accountId) return;
    try {
      setTasks(await fetchAutoCommentTasks(accountId));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити завдання'));
      setTasks([]);
    }
  };

  useEffect(() => {
    fetchAutoCommentStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!accountId && authorized[0]) setAccountId(authorized[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  useEffect(() => {
    setTasks(null);
    setExpandedId(null);
    load();
    // Plans and counters move on their own; keep the table reasonably fresh.
    const timer = setInterval(load, 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Coming from the "Автокоментар" button of a chat: open the form for it.
  useEffect(() => {
    if (!preset) return;
    setAccountId(preset.accountId);
    setFormState({ presetChat: preset.chat });
    onPresetUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const act = async (task, fn, fallback) => {
    setBusyId(task._id);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusyId(null);
    }
  };

  const runNow = (task) =>
    act(
      task,
      async () => {
        const res = await runAutoCommentTask(task._id);
        setNotice(
          res.status === 'sent'
            ? `«${task.chatTitle}»: коментар надіслано`
            : `«${task.chatTitle}»: ${res.reason || 'не надіслано'}`
        );
      },
      'Не вдалося запустити завдання'
    );

  if (authorized.length === 0) {
    return (
      <div className="card">
        <p className="empty-state">Немає авторизованих Telegram-акаунтів. Увійдіть в акаунт на вкладці «Акаунти й чати».</p>
      </div>
    );
  }

  const floodUntil = account?.floodWaitUntil && new Date(account.floodWaitUntil) > new Date() ? account.floodWaitUntil : null;

  return (
    <div>
      <div className="card">
        <div className="account-checkboxes" style={{ alignItems: 'center' }}>
          <label className="field" style={{ flex: '1 1 240px' }}>
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
          <button className="btn btn-primary" onClick={() => setFormState({})} disabled={!account}>
            Нове завдання
          </button>
        </div>
        {status && !status.enabled && (
          <p className="error" style={{ marginTop: 8 }}>
            Фоновий запуск вимкнено на сервері (SCHEDULER_ENABLED або TELEGRAM_AUTOCOMMENT_ENABLED = false). Працює лише
            ручний запуск.
          </p>
        )}
        {status?.enabled && (
          <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
            Розклад перевіряється кожні {Math.round(status.intervalMs / 1000)} с. Між двома автокоментарями одного акаунта
            щонайменше {status.accountGapSec} с.
          </p>
        )}
        {floodUntil && (
          <p className="error" style={{ marginTop: 8 }}>
            Telegram обмежив акаунт до {formatDate(floodUntil)}, автокоментарі на паузі.{' '}
            <button
              className="btn btn-sm"
              onClick={() =>
                clearTelegramFloodWait(accountId)
                  .then(() => onAccountsChanged?.())
                  .catch((err) => setError(errorMessage(err, 'Не вдалося зняти паузу')))
              }
            >
              Зняти паузу
            </button>
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-title">Завдання автокоментування</div>
        {notice && <p className="muted">{notice}</p>}
        {error && <p className="error">{error}</p>}
        {tasks === null ? (
          <p className="muted">Завантаження...</p>
        ) : tasks.length === 0 ? (
          <p className="empty-state">
            Завдань ще немає. Натисніть «Нове завдання» або кнопку «Автокоментар» біля потрібного чату.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="vpn-table">
              <thead>
                <tr>
                  <th>Чат</th>
                  <th>Мова</th>
                  <th>Розклад</th>
                  <th>Сьогодні</th>
                  <th>Наступний</th>
                  <th>Стан</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <Fragment key={task._id}>
                    <tr>
                      <td data-label="Чат">
                        {task.chatTitle}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {task.chatType === 'channel' ? 'канал' : 'супергрупа'}
                        </div>
                      </td>
                      <td data-label="Мова">
                        {languageLabel(task.language)}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {topicSummary(task)}
                        </div>
                        <div className={task.templatesAvailable ? 'muted' : 'error-inline'} style={{ fontSize: 12 }}>
                          заготовок: {task.templatesAvailable}
                        </div>
                      </td>
                      <td data-label="Розклад" style={{ fontSize: 13 }}>
                        {scheduleSummary(task)}
                      </td>
                      <td data-label="Сьогодні">
                        {task.sentToday}/{task.schedule.commentsPerDay}
                      </td>
                      <td data-label="Наступний">
                        {!task.enabled ? (
                          <span className="muted">-</span>
                        ) : task.mode === 'perPost' ? (
                          <span className="muted">при новому пості</span>
                        ) : task.nextSlotAt ? (
                          formatTime(task.nextSlotAt)
                        ) : (
                          <span className="muted">завтра</span>
                        )}
                      </td>
                      <td data-label="Стан">
                        <label className="checkbox-item">
                          <input
                            type="checkbox"
                            checked={task.enabled}
                            disabled={busyId === task._id}
                            onChange={(e) =>
                              act(
                                task,
                                () => updateAutoCommentTask(task._id, { enabled: e.target.checked }),
                                'Не вдалося змінити стан'
                              )
                            }
                          />
                          {task.enabled ? 'увімкнено' : 'вимкнено'}
                        </label>
                        {task.lastError && (
                          <div className="error-inline" style={{ fontSize: 12 }}>
                            {task.lastError}
                          </div>
                        )}
                      </td>
                      <td className="vpn-actions">
                        <button
                          className={`btn btn-sm${expandedId === task._id ? ' btn-primary' : ''}`}
                          onClick={() => setExpandedId(expandedId === task._id ? null : task._id)}
                        >
                          Розклад і журнал
                        </button>
                        <button className="btn btn-sm" disabled={busyId === task._id} onClick={() => runNow(task)}>
                          {busyId === task._id ? '...' : 'Коментар зараз'}
                        </button>
                        <button className="btn btn-sm" onClick={() => setFormState({ task })}>
                          Змінити
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busyId === task._id}
                          onClick={() => act(task, () => deleteAutoCommentTask(task._id), 'Не вдалося видалити')}
                        >
                          Видалити
                        </button>
                      </td>
                    </tr>
                    {expandedId === task._id && (
                      <tr className="vpn-row-expanded">
                        <td colSpan={7}>
                          <TaskDetails task={task} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formState && account && (
        <TaskForm
          account={account}
          task={formState.task}
          presetChat={formState.presetChat}
          onClose={() => setFormState(null)}
          onSaved={() => {
            setFormState(null);
            load();
          }}
        />
      )}
    </div>
  );
}
