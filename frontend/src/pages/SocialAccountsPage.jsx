import { useEffect, useState } from 'react';
import { fetchAccounts, createAccount, deleteAccount } from '../api/socialAccounts';
import { errorMessage } from '../api/client';
import SocialAccountForm from '../components/SocialAccountForm';
import SocialAccountTable from '../components/SocialAccountTable';

export default function SocialAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setAccounts(await fetchAccounts());
    } catch (err) {
      setError('Не вдалося завантажити акаунти');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      await createAccount(data);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося додати акаунт'));
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await deleteAccount(id);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити акаунт'));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Акаунти соцмереж</h2>
          <p className="page-subtitle">Облікові дані та прив'язка до VPN</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <div className="card-title">Новий акаунт</div>
        <SocialAccountForm onCreate={handleCreate} />
      </div>
      <SocialAccountTable accounts={accounts} onDelete={handleDelete} onChange={load} />
    </div>
  );
}
