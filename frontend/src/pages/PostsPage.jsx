import { useEffect, useState } from 'react';
import { fetchPosts, createPost, updatePost, deletePost } from '../api/posts';
import { errorMessage } from '../api/client';
import PostForm from '../components/PostForm';
import PostTable from '../components/PostTable';
import Modal from '../components/Modal';

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingPost, setEditingPost] = useState(null);

  const load = async () => {
    try {
      setPosts(await fetchPosts());
      setError(null);
      return true;
    } catch (err) {
      setError('Не вдалося завантажити пости');
      return false;
    }
  };

  useEffect(() => {
    load();
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
    setError(null);
    try {
      await deletePost(id);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити пост'));
    }
  };

  const scheduledCount = posts.filter(
    (post) => post.scheduledAt && post.overallStatus !== 'published_all'
  ).length;
  const publishedCount = posts.filter(
    (post) => post.overallStatus === 'published_all'
  ).length;

  return (
    <div className="posts-page">
      <div className="page-header">
        <div>
          <h2>Пости</h2>
          <p className="page-subtitle">Створення, планування та статистика публікацій</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((value) => !value)}>
          {creating ? 'Закрити форму' : '+ Створити пост'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="posts-overview">
        <div className="posts-overview-card">
          <span className="posts-overview-value">{posts.length}</span>
          <span className="posts-overview-label">Усього постів</span>
        </div>
        <div className="posts-overview-card">
          <span className="posts-overview-value">{scheduledCount}</span>
          <span className="posts-overview-label">Заплановано</span>
        </div>
        <div className="posts-overview-card">
          <span className="posts-overview-value">{publishedCount}</span>
          <span className="posts-overview-label">Опубліковано всюди</span>
        </div>
      </div>

      {creating && (
        <section className="card post-create-card">
          <div className="post-section-heading">
            <div>
              <h3>Нова публікація</h3>
              <p>Підготуйте текст, медіа та акаунти для публікації</p>
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

      <section className="posts-list-section">
        <div className="posts-list-heading">
          <h3>Ваші публікації</h3>
          <span>{posts.length} постів</span>
        </div>
        <PostTable
          posts={posts}
          onDelete={handleDelete}
          onEdit={setEditingPost}
          onChange={load}
        />
      </section>

      {editingPost && (
        <Modal
          title="Редагувати пост"
          onClose={() => setEditingPost(null)}
          className="post-editor-dialog"
        >
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
