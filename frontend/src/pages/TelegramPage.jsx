import { useEffect, useState } from 'react';
import { fetchTelegramAccounts, createTelegramAccount, deleteTelegramAccount } from '../api/telegram';
import { errorMessage } from '../api/client';
import TelegramAccountForm from '../components/TelegramAccountForm';
import TelegramAccountTable from '../components/TelegramAccountTable';
import TelegramChatsPanel from '../components/TelegramChatsPanel';
import TelegramLoginModal from '../components/TelegramLoginModal';
import TelegramTemplatesPanel from '../components/TelegramTemplatesPanel';
import TelegramAutoCommentPanel from '../components/TelegramAutoCommentPanel';
import TelegramAutoReplyPanel from '../components/TelegramAutoReplyPanel';
import TelegramLimitsPanel from '../components/TelegramLimitsPanel';

const SECTIONS = [
  { id: 'accounts', label: 'Акаунти й чати' },
  { id: 'templates', label: 'Заготовки коментарів' },
  { id: 'auto', label: 'Автокоментування' },
  { id: 'replies', label: 'Автовідповіді в особистих' },
  { id: 'limits', label: 'Ліміти й безпека' },
];

export default function TelegramPage() {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [section, setSection] = useState('accounts');
  // Account just added: its login dialog opens right away with the chosen method.
  const [newLogin, setNewLogin] = useState(null);
  // Set by a chat's "Автокоментар" button: opens the task form for that chat.
  const [autoPreset, setAutoPreset] = useState(null);

  const load = async () => {
    try {
      setAccounts(await fetchTelegramAccounts());
    } catch (err) {
      setError('Не вдалося завантажити Telegram-акаунти');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (data) => {
    setError(null);
    try {
      const account = await createTelegramAccount(data);
      load();
      setNewLogin({ account, startWith: data.loginMethod });
      return true;
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося додати акаунт'));
      return false;
    }
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      await deleteTelegramAccount(id);
      if (selectedId === id) setSelectedId(null);
      load();
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося видалити акаунт'));
    }
  };

  // The chats panel only makes sense for an account that is still logged in.
  const selected = accounts.find((a) => a._id === selectedId && a.authStatus === 'authorized');

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Telegram</h2>
          <p className="page-subtitle">
            Акаунти Telegram, їхні групи й канали, коментарі до постів, автокоментування за розкладом і автовідповіді в особистих
          </p>
        </div>
      </div>
      <div className="account-checkboxes" style={{ marginBottom: 16 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`btn${section === s.id ? ' btn-primary' : ''}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {section === 'accounts' && (
        <>
          <div className="card">
            <div className="card-title">Новий акаунт</div>
            <TelegramAccountForm onCreate={handleCreate} />
          </div>
          {newLogin && (
            <TelegramLoginModal
              account={newLogin.account}
              startWith={newLogin.startWith}
              isNew
              onClose={() => {
                setNewLogin(null);
                load();
              }}
              onChange={load}
            />
          )}
          <TelegramAccountTable
            accounts={accounts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={handleDelete}
            onChange={load}
          />
          {selected && (
            <TelegramChatsPanel
              account={selected}
              onAutoComment={(chat) => {
                setAutoPreset({ accountId: selected._id, chat });
                setSection('auto');
              }}
            />
          )}
        </>
      )}
      {section === 'templates' && <TelegramTemplatesPanel />}
      {section === 'replies' && <TelegramAutoReplyPanel accounts={accounts} />}
      {section === 'limits' && <TelegramLimitsPanel accounts={accounts} />}
      {section === 'auto' && (
        <TelegramAutoCommentPanel
          accounts={accounts}
          preset={autoPreset}
          onPresetUsed={() => setAutoPreset(null)}
          onAccountsChanged={load}
        />
      )}
    </div>
  );
}
