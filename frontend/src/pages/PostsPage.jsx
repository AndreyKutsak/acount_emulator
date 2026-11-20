import { useEffect, useRef, useState } from 'react';
import { fetchPosts, createPost, updatePost, deletePost } from '../api/posts';
import { errorMessage } from '../api/client';
import PostForm from '../components/PostForm';
import PostTable from '../components/PostTable';
import Modal from '../components/Modal';
import DailyPostPlan from '../components/DailyPostPlan';
import ListToolbar, { useListView } from '../components/ListToolbar';
import PostWordsPanel from '../components/PostWordsPanel';

const entries = (p) => p.accounts || [];
const has = (status) => (p) => entries(p).some((a) => a.status === status);
const time = (v) => (v ? new Date(v).getTime() : null);
// Порожні значення - в кінець списку за будь-якого напрямку.
const byTime = (get, dir) => (a, b) => {
  const x = time(get(a));
  const y = time(get(b));
  if (x === y) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return dir * (x - y);
};
const byMetric = (key) => (a, b) => (b.metrics?.[key] || 0) - (a.metrics?.[key] || 0);

// Наступні публікації першими (від найближчої), далі минулі - від найсвіжішої.
const upcomingFirst = (a, b) => {
  const now = Date.now();
  const x = time(a.scheduledAt);
  const y = time(b.scheduledAt);
  const rank = (t) => (t == null ? 2 : t >= now ? 0 : 1);
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  return rank(x) === 0 ? x - y : (y || 0) - (x || 0);
};

const SORTS = [
  { id: 'next', label: 'Спершу найближчі публікації', compare: upcomingFirst },
  { id: 'latest', label: 'Спершу пізніші за розкладом', compare: byTime((p) => p.scheduledAt, -1) },
  { id: 'created', label: 'Спершу нові', compare: byTime((p) => p.createdAt, -1) },
  { id: 'views', label: 'Більше переглядів', compare: byMetric('views') },
  { id: 'likes', label: 'Більше лайків', compare: byMetric('likes') },
  { id: 'comments', label: 'Більше коментарів', compare: byMetric('comments') },
];

function accountFilter(posts) {
  const seen = new Map();
  for (const p of posts) {
    for (const e of entries(p)) {
      if (e.account?._id && !seen.has(e.account._id)) seen.set(e.account._id, e.account);
    }
  }
  return {
    id: 'account',
    label: 'Акаунт',
    kind: 'select',
    options: [
      { id: 'all', label: 'Усі акаунти' },
      ...[...seen.values()]
        .sort((a, b) => String(a.username).localeCompare(String(b.username)))
        .map((a) => ({
          id: a._id,
          label: a.displayName ? `${a.displayName} (@${a.username})` : `@${a.username}`,
          test: (p) => entries(p).some((e) => e.account?._id === a._id),
        })),
    ],
  };
}

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [planKey, setPlanKey] = useState(0);
  const [wordsOpen, setWordsOpen] = useState(false);
  const createRef = useRef(null);

  // Відкрили форму - показати її й поставити курсор у текст (на телефоні форма
  // інакше лишалась нижче першого екрана).
  useEffect(() => {
    if (!creating || !createRef.current) return;
    createRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const t = setTimeout(() => createRef.current?.querySelector('textarea')?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(t);
  }, [creating]);

  const view = useListView('posts', posts, {
    search: (p) => p.text,
    filters: [
      {
        id: 'status',
        label: 'Стан',
        options: [
          { id: 'all', label: 'Усі' },
          { id: 'waiting', label: 'Чекають', dot: 'warning', test: has('pending') },
          { id: 'published', label: 'Опубліковані', dot: 'success', test: has('published') },
          { id: 'failed', label: 'З помилкою', dot: 'danger', test: has('failed') },
          { id: 'photos', label: 'З фото', test: (p) => (p.images || []).length > 0 },
        ],
      },
      accountFilter(posts),
    ],
    sorts: SORTS,
  });

  // quiet - фонове оновлення: не чіпає повідомлення про помилку, яке людина читає.
  const load = async ({ quiet = false } = {}) => {
    try {
      setPosts(await fetchPosts());
      setPlanKey((key) => key + 1);
      if (!quiet) setError(null);
      return true;
    } catch (err) {
      if (!quiet) setError('Не вдалося завантажити пости');
      return false;
    }
  };

  // Статуси змінюються самі (планувальник публікує, збирає статистику), тож список
  // оновлюється кожні 20 секунд і щойно вкладка знову стає видимою (повернулись у
  // браузер на телефоні). Поки сторінка схована - не смикаємо сервер.
  useEffect(() => {
    load();
    const refresh = () => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    };
    const timer = setInterval(refresh, 20000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      await createPost(data);
      await load();
      setCreating(false);
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося створити пост'));
      return false;
    }
  };

  const handleUpdate = async (id, data) => {
    setError(null);
    try {
      await updatePost(id, data);
      await load();
      setEditingPost(null);
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося зберегти зміни поста'));
      return false;
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Видалити цей пост? Його не можна буде повернути.')) return;
    setError(null);
    try {
      await deletePost(id);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити пост'));
    }
  };

  const waitingCount = posts.filter(has('pending')).length;
  const publishedCount = posts.filter(has('published')).length;
  const failedCount = posts.filter(has('failed')).length;

  return (
    <div className="posts-page">
      <div className="page-header">
        <div>
          <h2>Пости</h2>
          <p className="page-subtitle">Планування, публікація і статистика вакансій</p>
        </div>
        <div className="page-header-actions">
          <button className="btn" onClick={() => setWordsOpen((v) => !v)} aria-expanded={wordsOpen}>
            Заборонені слова
          </button>
          <button className="btn btn-primary" onClick={() => setCreating((value) => !value)}>
            {creating ? 'Закрити форму' : 'Новий пост'}
          </button>
        </div>
      </div>

      {creating && (
        <section className="card post-create-card" ref={createRef}>
          <div className="post-section-heading">
            <div>
              <h3>Новий пост</h3>
              <p>Текст, фото, час і акаунти для публікації</p>
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Закрити форму створення"
              onClick={() => setCreating(false)}
            >
              ×
            </button>
          </div>
          <PostForm onCreate={handleCreate} />
        </section>
      )}

      {wordsOpen && <PostWordsPanel onClose={() => setWordsOpen(false)} />}

      {error && <p className="error">{error}</p>}

      <div className="summary-strip" aria-label="Підсумок">
        <div className="summary-item">
          <span className="summary-value">{posts.length}</span>
          <span className="summary-label">усього</span>
        </div>
        <div className="summary-item summary-warning">
          <span className="summary-value">{waitingCount}</span>
          <span className="summary-label">чекають</span>
        </div>
        <div className="summary-item summary-success">
          <span className="summary-value">{publishedCount}</span>
          <span className="summary-label">опубліковані</span>
        </div>
        <div className={`summary-item${failedCount ? ' summary-danger' : ''}`}>
          <span className="summary-value">{failedCount}</span>
          <span className="summary-label">з помилкою</span>
        </div>
      </div>

      <DailyPostPlan refreshKey={planKey} />

      <section className="posts-list-section">
        <div className="section-heading">
          <h3>Публікації</h3>
        </div>
        <ListToolbar view={view} placeholder="Пошук у текстах постів" noun={['пост', 'пости', 'постів']} />
        {view.shown.length === 0 && posts.length > 0 ? (
          <div className="empty-state">
            Жоден пост не підходить під фільтри.{' '}
            <button type="button" className="link-btn" onClick={view.reset}>
              Скинути фільтри
            </button>
          </div>
        ) : (
          <PostTable posts={view.shown} onDelete={handleDelete} onEdit={setEditingPost} onChange={load} />
        )}
      </section>

      {editingPost && (
        <Modal title="Редагувати пост" onClose={() => setEditingPost(null)} className="post-editor-dialog">
          <PostForm
            key={editingPost._id}
            post={editingPost}
            onSave={handleUpdate}
            onCancel={() => setEditingPost(null)}
          />
        </Modal>
      )}
    </div>
  );
}
