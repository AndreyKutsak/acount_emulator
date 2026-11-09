import { useEffect, useState } from 'react';
import {
  fetchCommentTemplates,
  fetchTemplateLanguages,
  createCommentTemplates,
  updateCommentTemplate,
  deleteCommentTemplate,
  previewCommentTemplate,
  fetchCommentTopics,
  createCommentTopic,
  updateCommentTopic,
  deleteCommentTopic,
  classifyPostText,
} from '../api/telegram';
import { errorMessage } from '../api/client';
import Modal from './Modal';
import { LANGUAGES, languageLabel } from './telegramLanguages';

const emptyForm = { language: 'uk', category: '', text: '', perLine: true };
const emptyTopic = { name: '', description: '', keywords: '', universal: false, avoid: false, order: 50, enabled: true };

function splitTexts(text, perLine) {
  if (!perLine) return [text.trim()].filter(Boolean);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function topicKind(topic) {
  if (topic.avoid) return <span className="status-badge auth-failed">не коментувати</span>;
  if (topic.universal) return <span className="status-badge auth-unknown">універсальна</span>;
  return null;
}

// ---------- topics ----------

function TopicForm({ topic, onClose, onSaved }) {
  const [form, setForm] = useState(
    topic ? { ...emptyTopic, ...topic, keywords: (topic.keywords || []).join('\n') } : emptyTopic
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const data = {
      name: form.name,
      description: form.description,
      keywords: form.keywords.split('\n').map((k) => k.trim()).filter(Boolean),
      universal: form.universal,
      avoid: form.avoid,
      order: Number(form.order) || 0,
      enabled: form.enabled,
    };
    try {
      if (topic) await updateCommentTopic(topic._id, data);
      else await createCommentTopic(data);
      onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти тему'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={topic ? `Тема: ${topic.name}` : 'Нова тема'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Назва</span>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field-label">Порядок (менший вище, вирішує нічию)</span>
            <input type="number" value={form.order} onChange={(e) => set({ order: e.target.value })} />
          </label>
          <label className="field field-wide">
            <span className="field-label">Опис</span>
            <input value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
        </div>
        <div className="account-checkboxes" style={{ margin: '10px 0' }}>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={form.universal}
              onChange={(e) => set({ universal: e.target.checked, avoid: e.target.checked ? false : form.avoid })}
            />
            Універсальна: коментарі до будь-якого поста, коли тему не визначено
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={form.avoid}
              onChange={(e) => set({ avoid: e.target.checked, universal: e.target.checked ? false : form.universal })}
            />
            Не коментувати пости на цю тему
          </label>
          <label className="checkbox-item">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Увімкнена
          </label>
        </div>
        {!form.universal && (
          <label className="field field-wide">
            <span className="field-label">Ключові слова для розпізнавання поста, кожне з нового рядка</span>
            <textarea
              rows={6}
              value={form.keywords}
              onChange={(e) => set({ keywords: e.target.value })}
              placeholder={'подорож*\nпутешеств*\nвідпустк*'}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Пишіть українською і російською. Зірочка в кінці означає будь-яке закінчення: «подорож*» знаходить
              «подорожі», «подорожувати». Пост отримує тему, у якій знайдено найбільше слів.
            </span>
          </label>
        )}
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

function ClassifyBox() {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('uk');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      setResult(await classifyPostText(text, language));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити'));
    }
  };

  return (
    <form onSubmit={run} style={{ marginTop: 14 }}>
      <div className="field-label" style={{ marginBottom: 6 }}>
        Перевірити пост: яку тему він отримає і який коментар
      </div>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Вставте текст поста" style={{ width: '100%' }} />
      <div className="account-checkboxes" style={{ marginTop: 6 }}>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-sm" disabled={!text.trim()}>
          Перевірити
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div style={{ marginTop: 8, fontSize: 13.5 }}>
          {result.avoid ? (
            <span className="error-inline">
              Чутлива тема «{result.avoid}» ({result.matchedKeywords.join(', ')}): такий пост не коментуватиметься.
            </span>
          ) : (
            <>
              <div>
                Тема:{' '}
                <strong>{result.topic || `не визначено, буде «${result.fallback || 'без теми'}»`}</strong>
                {result.matchedKeywords.length > 0 && (
                  <span className="muted"> за словами: {result.matchedKeywords.join(', ')}</span>
                )}
              </div>
              <div className="muted">
                Приклад коментаря: {result.sample || 'для цієї теми немає заготовок цією мовою'}
              </div>
            </>
          )}
        </div>
      )}
    </form>
  );
}

function TopicsCard({ topics, onChanged }) {
  const [formTopic, setFormTopic] = useState(undefined); // undefined closed, null new
  const [confirmDelete, setConfirmDelete] = useState(null); // { topic, templates }
  const [error, setError] = useState(null);

  // A topic with comments is only deleted after a second, explicit confirmation.
  const remove = async (topic, withTemplates = false) => {
    setError(null);
    try {
      await deleteCommentTopic(topic._id, withTemplates);
      setConfirmDelete(null);
      onChanged();
    } catch (err) {
      if (err?.response?.status === 409) {
        setConfirmDelete({ topic, templates: err.response.data.templates });
      } else {
        setError(errorMessage(err, 'Не вдалося видалити тему'));
      }
    }
  };

  const toggle = async (topic, enabled) => {
    try {
      await updateCommentTopic(topic._id, { enabled });
      onChanged();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося змінити тему'));
    }
  };

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Теми коментарів</span>
        <button className="btn btn-primary btn-sm" onClick={() => setFormTopic(null)}>
          Нова тема
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        Тема поста визначається за ключовими словами, і коментар береться з цієї теми. Якщо тему не визначено,
        використовуються універсальні коментарі. Пости на чутливі теми не коментуються.
      </p>
      {error && <p className="error">{error}</p>}
      {confirmDelete && (
        <div className="error" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span>
            У темі «{confirmDelete.topic.name}» є коментарів: {confirmDelete.templates}. Вони будуть видалені разом із
            темою.
          </span>
          <button className="btn btn-sm btn-danger" onClick={() => remove(confirmDelete.topic, true)}>
            Видалити тему й коментарі
          </button>
          <button className="btn btn-sm" onClick={() => setConfirmDelete(null)}>
            Скасувати
          </button>
        </div>
      )}
      {topics === null ? (
        <p className="muted">Завантаження...</p>
      ) : topics.length === 0 ? (
        <p className="empty-state">Тем ще немає</p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th>Тема</th>
                <th>Ключові слова</th>
                <th>Коментарів</th>
                <th>Увімк.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic) => (
                <tr key={topic._id} style={topic.enabled ? undefined : { opacity: 0.55 }}>
                  <td data-label="Тема">
                    {topic.name} {topicKind(topic)}
                    {topic.description && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {topic.description}
                      </div>
                    )}
                  </td>
                  <td data-label="Ключові слова" className="post-text-cell" title={topic.keywords.join(', ')} style={{ fontSize: 12.5 }}>
                    {topic.universal ? <span className="muted">не потрібні</span> : topic.keywords.join(', ')}
                  </td>
                  <td data-label="Коментарів" style={{ fontSize: 13 }}>
                    {topic.avoid
                      ? '-'
                      : Object.entries(topic.templateCounts || {})
                          .map(([lang, n]) => `${lang}: ${n}`)
                          .join(', ') || <span className="error-inline">немає</span>}
                  </td>
                  <td data-label="Увімк.">
                    <input type="checkbox" checked={topic.enabled} onChange={(e) => toggle(topic, e.target.checked)} />
                  </td>
                  <td className="vpn-actions">
                    <button className="btn btn-sm" onClick={() => setFormTopic(topic)}>
                      Змінити
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(topic)}>
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ClassifyBox />
      {formTopic !== undefined && (
        <TopicForm
          topic={formTopic}
          onClose={() => setFormTopic(undefined)}
          onSaved={() => {
            setFormTopic(undefined);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------- templates ----------

function TemplateRow({ template, topics, onChanged, onError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template.text);
  const [busy, setBusy] = useState(false);

  const save = async (patch) => {
    setBusy(true);
    try {
      await updateCommentTemplate(template._id, patch);
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(errorMessage(err, 'Не вдалося зберегти заготовку'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteCommentTemplate(template._id);
      onChanged();
    } catch (err) {
      onError(errorMessage(err, 'Не вдалося видалити заготовку'));
      setBusy(false);
    }
  };

  return (
    <tr style={template.enabled ? undefined : { opacity: 0.55 }}>
      <td data-label="Текст" style={{ whiteSpace: 'pre-wrap', minWidth: 240 }}>
        {editing ? (
          <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%' }} />
        ) : (
          template.text
        )}
      </td>
      <td data-label="Мова">{languageLabel(template.language)}</td>
      <td data-label="Тема">
        <select value={template.category} disabled={busy} onChange={(e) => save({ category: e.target.value })}>
          <option value="">без теми</option>
          {topics
            .filter((t) => !t.avoid)
            .map((t) => (
              <option key={t._id} value={t.name}>
                {t.name}
              </option>
            ))}
          {template.category && !topics.some((t) => t.name === template.category) && (
            <option value={template.category}>{template.category}</option>
          )}
        </select>
      </td>
      <td data-label="Використано">{template.usageCount}</td>
      <td data-label="Увімкнено">
        <input type="checkbox" checked={template.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} />
      </td>
      <td className="vpn-actions">
        {editing ? (
          <>
            <button className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} onClick={() => save({ text: draft })}>
              Зберегти
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setDraft(template.text);
                setEditing(false);
              }}
            >
              Скасувати
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              Змінити
            </button>
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={remove}>
              Видалити
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

export default function TelegramTemplatesPanel() {
  const [templates, setTemplates] = useState(null);
  const [languages, setLanguages] = useState([]);
  const [topics, setTopics] = useState(null);
  const [languageFilter, setLanguageFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [samples, setSamples] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const [list, langs, topicList] = await Promise.all([
        fetchCommentTemplates(),
        fetchTemplateLanguages(),
        fetchCommentTopics(),
      ]);
      setTemplates(list);
      setLanguages(langs);
      setTopics(topicList);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити заготовки'));
      setTemplates([]);
      setTopics([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const texts = splitTexts(form.text, form.perLine);
  const topicList = topics || [];

  const handleAdd = async (e) => {
    e.preventDefault();
    if (texts.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await createCommentTemplates({ language: form.language, category: form.category, texts });
      setForm((prev) => ({ ...prev, text: '' }));
      setSamples(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося додати заготовки'));
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    const first = texts[0];
    if (!first) return;
    try {
      setSamples(await previewCommentTemplate(first));
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося побудувати приклади'));
    }
  };

  const query = search.trim().toLowerCase();
  const visible = (templates || []).filter(
    (t) =>
      (!languageFilter || t.language === languageFilter) &&
      (!topicFilter || (topicFilter === '__none' ? !t.category : t.category === topicFilter)) &&
      (!query || t.text.toLowerCase().includes(query))
  );

  const languageOptions = [
    ...LANGUAGES,
    ...languages.filter((l) => !LANGUAGES.some((x) => x.code === l.language)).map((l) => ({ code: l.language, label: l.language })),
  ];

  return (
    <div>
      <TopicsCard topics={topics} onChanged={load} />

      <div className="card">
        <div className="card-title">Нові коментарі</div>
        <form onSubmit={handleAdd}>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Мова</span>
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                {languageOptions.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label} ({l.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Тема</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">без теми</option>
                {topicList
                  .filter((t) => !t.avoid)
                  .map((t) => (
                    <option key={t._id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field field-wide">
              <span className="field-label">
                {form.perLine ? 'Тексти: кожен рядок окремий коментар' : 'Текст коментаря'}
              </span>
              <textarea
                rows={5}
                placeholder={'{Цікаво|Корисно}, дякую, що поділились\nА як ви самі до цього ставитесь?'}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </label>
          </div>
          <label className="checkbox-item" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={form.perLine} onChange={(e) => setForm({ ...form, perLine: e.target.checked })} />
            Кожен рядок окремий коментар (вимкніть для багаторядкового тексту)
          </label>
          <p className="muted" style={{ fontSize: 12.5, margin: '8px 0' }}>
            Щоб коментарі не виглядали спамом: без посилань і реклами, не більше одного емодзі, коротка реакція або
            питання до обговорення. Варіації у фігурних дужках через «|» щоразу підставляються випадково:
            «{'{Дякую|Спасибі}'} за пост».
          </p>
          {samples && (
            <ul className="muted" style={{ fontSize: 13, margin: '0 0 8px', paddingLeft: 18 }}>
              {samples.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-sm" onClick={handlePreview} disabled={!texts.length}>
              Приклади варіацій
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !texts.length}>
              {saving ? 'Збереження...' : `Додати${texts.length > 1 ? ` (${texts.length})` : ''}`}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">
          Бібліотека коментарів {templates && <span className="muted">({templates.length})</span>}
        </div>
        <div className="account-checkboxes" style={{ marginBottom: 12 }}>
          <button className={`btn btn-sm${!languageFilter ? ' btn-primary' : ''}`} onClick={() => setLanguageFilter('')}>
            Усі мови
          </button>
          {languages.map((l) => (
            <button
              key={l.language}
              className={`btn btn-sm${languageFilter === l.language ? ' btn-primary' : ''}`}
              onClick={() => setLanguageFilter(l.language)}
            >
              {languageLabel(l.language)} ({l.enabled}/{l.total})
            </button>
          ))}
          <select value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)}>
            <option value="">Усі теми</option>
            {topicList
              .filter((t) => !t.avoid)
              .map((t) => (
                <option key={t._id} value={t.name}>
                  {t.name}
                </option>
              ))}
            <option value="__none">Без теми</option>
          </select>
          <input placeholder="Пошук у тексті" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: '1 1 160px' }} />
        </div>
        {error && <p className="error">{error}</p>}
        {templates === null ? (
          <p className="muted">Завантаження...</p>
        ) : visible.length === 0 ? (
          <p className="empty-state">Коментарів не знайдено</p>
        ) : (
          <div className="table-wrap">
            <table className="vpn-table">
              <thead>
                <tr>
                  <th>Текст</th>
                  <th>Мова</th>
                  <th>Тема</th>
                  <th>Використано</th>
                  <th>Увімкнено</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <TemplateRow key={t._id} template={t} topics={topicList} onChanged={load} onError={setError} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
