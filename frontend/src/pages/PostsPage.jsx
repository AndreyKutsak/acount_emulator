import { useEffect, useState } from 'react';
import { fetchPosts, createPost, deletePost } from '../api/posts';
import { errorMessage } from '../api/client';
import PostForm from '../components/PostForm';
import PostTable from '../components/PostTable';

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setPosts(await fetchPosts());
    } catch (err) {
      setError('Не вдалося завантажити пости');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      await createPost(data);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося створити пост'));
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await deletePost(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити пост'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Пости</h2>
          <p className="page-subtitle">Публікації на кількох акаунтах і їхні метрики</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <div className="card-title">Новий пост</div>
        <PostForm onCreate={handleCreate} />
      </div>
      <PostTable posts={posts} onDelete={handleDelete} onChange={load} />
    </div>
  );
}
