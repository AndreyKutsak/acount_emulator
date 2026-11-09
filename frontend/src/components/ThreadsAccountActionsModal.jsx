import { useState } from 'react';
import Modal from './Modal';
import { runThreadsAction, openAccountBrowser, openAccountBrowserManual, saveBrowserAuth, closeBrowserSession } from '../api/socialAccounts';
import { errorMessage } from '../api/client';

export default function ThreadsAccountActionsModal({ account, onClose, onChange }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [browserSessionId, setBrowserSessionId] = useState(null);
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserError, setBrowserError] = useState(null);
  const [manualLogin, setManualLogin] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);
  const [authMessage, setAuthMessage] = useState(null);
  const [authSaveError, setAuthSaveError] = useState(null);

  const resting = account.restUntil && new Date(account.restUntil) > new Date();

  const handleOpenBrowser = async () => {
    setBrowserOpening(true);
    setBrowserError(null);
    setAuthMessage(null);
    setAuthSaveError(null);
    try {
      const res = await openAccountBrowser(account._id);
      setBrowserSessionId(res.sessionId);
      setManualLogin(false);
    } catch (err) {
      setBrowserError(errorMessage(err, 'Не вдалося відкрити браузер'));
    } finally {
      setBrowserOpening(false);
    }
  };

  const handleOpenManualBrowser = async () => {
    setBrowserOpening(true);
    setBrowserError(null);
    setAuthMessage(null);
    setAuthSaveError(null);
    try {
      const res = await openAccountBrowserManual(account._id);
      setBrowserSessionId(res.sessionId);
      setManualLogin(true);
    } catch (err) {
      setBrowserError(errorMessage(err, 'Не вдалося відкрити браузер'));
    } finally {
      setBrowserOpening(false);
    }
  };

  const handleSaveAuth = async () => {
    if (!browserSessionId) return;
    setSavingAuth(true);
    setAuthSaveError(null);
    setAuthMessage(null);
    try {
      await saveBrowserAuth(browserSessionId, account._id);
      setAuthMessage('Сесію збережено — автоматизація більше не проситиме логін для цього акаунта.');
      onChange?.();
    } catch (err) {
      setAuthSaveError(errorMessage(err, 'Не вдалося зберегти сесію'));
    } finally {
      setSavingAuth(false);
    }
  };

  const handleCloseBrowser = async () => {
    if (!browserSessionId) return;
    try {
      await closeBrowserSession(browserSessionId);
    } catch {
      // Window may already be closed manually — nothing to clean up on our side either way.
    } finally {
      setBrowserSessionId(null);
      setManualLogin(false);
      setAuthMessage(null);
      setAuthSaveError(null);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runThreadsAction(account._id, 'createPost', { text });
      setResult(res.result);
      setText('');
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Дія не виконана'));
    } finally {
      setRunning(false);
    }
  };

  const resultText = result ? JSON.stringify(result, null, 2).slice(0, 4000) : null;

  return (
    <Modal title={`Дії: ${account.displayName || account.username}`} onClose={onClose}>
      {resting && (
        <p className="error-inline" style={{ marginBottom: 12 }}>
          Акаунт відпочиває до {new Date(account.restUntil).toLocaleString('uk-UA')} — автоматичні дії
          будуть відхилені сервером, але ручний логін доступний.
        </p>
      )}

      <div className="card" style={{ marginBottom: 16, background: 'var(--surface-2)' }}>
        <div className="card-title">Реальний інтерфейс Threads</div>
        <p className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
          Threads забороняє показ свого сайту у чужому вікні (iframe) — тому відкривається справжнє
          вікно Chrome на цьому комп'ютері. Можна відкрити вже залогінений акаунт або залогінитись
          вручну (наприклад, щоб пройти 2FA/капчу) і зберегти сесію.
        </p>
        {!browserSessionId ? (
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" onClick={handleOpenBrowser} disabled={browserOpening || resting}>
              {browserOpening ? 'Відкриття...' : 'Відкрити акаунт у Chrome'}
            </button>
            <button className="btn btn-sm" onClick={handleOpenManualBrowser} disabled={browserOpening}>
              Залогінитись вручну
            </button>
          </div>
        ) : (
          <div className="form-actions">
            {manualLogin && (
              <button className="btn btn-primary btn-sm" onClick={handleSaveAuth} disabled={savingAuth}>
                {savingAuth ? 'Збереження...' : 'Я залогінився — зберегти сесію'}
              </button>
            )}
            <button className="btn btn-sm" onClick={handleCloseBrowser}>
              Закрити вікно браузера
            </button>
          </div>
        )}
        {authMessage && <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>{authMessage}</p>}
        {authSaveError && <p className="error-inline" style={{ marginTop: 8 }}>{authSaveError}</p>}
        {browserError && <p className="error-inline" style={{ marginTop: 8 }}>{browserError}</p>}
      </div>

      <div className="card-title">Опублікувати пост</div>
      <p className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
        Публікація йде через кліки по сторінці (браузерна автоматизація), тому лайки/підписки/
        репости/блокування тут недоступні — лише публікація тексту.
      </p>
      <label className="field" style={{ marginBottom: 14 }}>
        <span className="field-label">Текст поста</span>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Текст, який буде опубліковано від імені акаунта"
        />
      </label>

      {error && <p className="error-inline" style={{ marginBottom: 10 }}>{error}</p>}
      {resultText && (
        <pre
          style={{
            background: 'var(--surface-2)',
            padding: 10,
            borderRadius: 6,
            fontSize: 12,
            overflowX: 'auto',
            marginBottom: 10,
          }}
        >
          {resultText}
        </pre>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleRun} disabled={running || !text.trim()}>
          {running ? 'Публікація...' : 'Опублікувати'}
        </button>
        <button className="btn btn-sm" onClick={onClose} disabled={running}>
          Закрити
        </button>
      </div>
      {browserSessionId && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Вікно браузера залишиться відкритим і після закриття цієї модалки — закрийте його вручну
          або кнопкою вище.
        </p>
      )}
    </Modal>
  );
}
