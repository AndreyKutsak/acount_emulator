import { useEffect, useState } from 'react';
import {
  fetchServerSessions,
  createSession,
  closeSession,
  deleteSession,
} from '../api/vpnServers';
import { errorMessage } from '../api/client';
import { formatDate } from './StatusBadge';

export default function ServerSessions({ server }) {
  const [sessions, setSessions] = useState([]);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchServerSessions(server._id);
      setSessions(data);
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити сесії'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [server._id]);

  const handleConnect = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await createSession(server._id, { label });
      setLabel('');
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося створити сесію'));
    }
  };

  const handleClose = async (id) => {
    setError(null);
    try {
      await closeSession(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося відключити сесію'));
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await deleteSession(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити сесію'));
    }
  };

  return (
    <div className="server-sessions">
      <form onSubmit={handleConnect} className="form-grid">
        <label className="field">
          <span className="field-label">Назва сесії</span>
          <input
            placeholder="напр. laptop-ivan"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <button type="submit" className="btn btn-primary btn-sm">
            Нове підключення
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Завантаження...</p>
      ) : sessions.length === 0 ? (
        <p className="empty-state">Сесій ще не було</p>
      ) : (
        <div className="table-wrap">
          <table className="sessions-table">
            <thead>
              <tr>
                <th>Сесія</th>
                <th>Статус</th>
                <th>Початок</th>
                <th>Кінець</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s._id}>
                  <td data-label="Сесія">{s.label || '-'}</td>
                  <td data-label="Статус">
                    <span className={`session-status session-${s.status}`}>
                      {s.status === 'active' ? 'Активна' : 'Закрита'}
                    </span>
                  </td>
                  <td data-label="Початок">{formatDate(s.startedAt)}</td>
                  <td data-label="Кінець">{formatDate(s.endedAt)}</td>
                  <td className="vpn-actions">
                    {s.status === 'active' ? (
                      <button className="btn btn-sm" onClick={() => handleClose(s._id)}>
                        Відключити
                      </button>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s._id)}>
                        Видалити
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
