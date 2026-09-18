import { useEffect, useState } from 'react';
import {
  fetchServers,
  createServer,
  deleteServer,
  checkServer,
  checkAllServers,
} from '../api/vpnServers';
import { errorMessage } from '../api/client';
import VpnServerForm from '../components/VpnServerForm';
import VpnServerTable from '../components/VpnServerTable';

export default function VpnServersPage() {
  const [servers, setServers] = useState([]);
  const [error, setError] = useState(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const load = async () => {
    try {
      const data = await fetchServers();
      setServers(data);
    } catch (err) {
      setError('Не вдалося завантажити сервери');
    }
  };

  useEffect(() => {
    load();
    // Backend re-checks all servers every 5 minutes on its own — poll more often than
    // that so the status/lastCheckedAt columns stay current without a manual refresh.
    const interval = setInterval(load, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      await createServer(data);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося додати сервер'));
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await deleteServer(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити сервер'));
    }
  };

  const handleCheck = async (id) => {
    setError(null);
    try {
      await checkServer(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити сервер'));
    }
  };

  const handleCheckAll = async () => {
    setError(null);
    setCheckingAll(true);
    try {
      await checkAllServers();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося перевірити сервери'));
    } finally {
      setCheckingAll(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>VPN сервери</h2>
          <p className="page-subtitle">Облік серверів і сесій підключення — автоперевірка кожні 5 хв</p>
        </div>
        <button className="btn" onClick={handleCheckAll} disabled={checkingAll}>
          {checkingAll ? 'Перевірка всіх...' : 'Перевірити всі'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <div className="card-title">Новий сервер</div>
        <VpnServerForm onCreate={handleCreate} />
      </div>
      <VpnServerTable servers={servers} onCheck={handleCheck} onDelete={handleDelete} />
    </div>
  );
}
