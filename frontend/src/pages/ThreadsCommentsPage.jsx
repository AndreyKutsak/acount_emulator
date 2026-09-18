import { useEffect, useState } from 'react';
import { fetchThreadsComments, refreshThreadsComments } from '../api/threadsComments';
import { errorMessage } from '../api/client';
import ThreadsCommentTable from '../components/ThreadsCommentTable';

const STATUS_FILTERS = [
  { id: '', label: 'Усі' },
  { id: 'new', label: 'Нові' },
  { id: 'replied', label: 'Відповіли' },
  { id: 'handled', label: 'Опрацьовані' },
];

export default function ThreadsCommentsPage() {
  const [comments, setComments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState(null);

  const load = async (status) => {
    try {
      setComments(await fetchThreadsComments(status ? { status } : {}));
    } catch (err) {
      setError('Не вдалося завантажити коментарі');
    }
  };

  useEffect(() => {
    load(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setRefreshSummary(null);
    try {
      const result = await refreshThreadsComments();
      setRefreshSummary(result.accounts || []);
      await load(statusFilter);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося оновити коментарі'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Коментарі Threads</h2>
          <p className="page-subtitle">
            Усі коментарі з постів Threads в одному місці — відповідайте та позначайте опрацьовані
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Оновлення...' : 'Оновити коментарі'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {refreshSummary && (
        <div className="card">
          <div className="card-title">Результат оновлення</div>
          {refreshSummary.length === 0 ? (
            <p className="muted">Немає акаунтів Threads</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {refreshSummary.map((r) => (
                <li key={r.accountId}>
                  {r.username}:{' '}
                  {r.skipped === 'resting'
                    ? `акаунт відпочиває до ${new Date(r.restUntil).toLocaleString('uk-UA')}`
                    : r.error
                      ? `помилка — ${r.error}`
                      : `знайдено/оновлено ${r.fetched} коментарів`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="card">
        <div className="account-checkboxes">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`btn btn-sm${statusFilter === f.id ? ' btn-primary' : ''}`}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ThreadsCommentTable comments={comments} onChange={() => load(statusFilter)} />
    </div>
  );
}
