import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import {
  sendTelegramCode,
  resendTelegramCode,
  signInTelegram,
  checkTelegramPassword,
  sendTelegramLoginEmail,
  verifyTelegramLoginEmail,
  requestTelegramPasswordRecovery,
  confirmTelegramPasswordRecovery,
  startTelegramQrLogin,
  pollTelegramQrLogin,
  importTelegramSession,
  deleteTelegramAccount,
  fetchTelegramAuthLog,
} from '../api/telegram';
import { errorMessage } from '../api/client';

const QR_POLL_MS = 2000;

// Where Telegram sent the code (account.login.codeType).
function codeDestination(login) {
  switch (login?.codeType) {
    case 'app':
      return 'Код надіслано в застосунок Telegram на іншому вашому пристрої (чат «Telegram» зі синьою галочкою).';
    case 'sms':
      return 'Код надіслано SMS-повідомленням.';
    case 'call':
      return 'Вам зателефонують і продиктують код.';
    case 'flash_call':
    case 'missed_call':
      return 'Вам надійде дзвінок: код це останні цифри номера, з якого дзвонили.';
    case 'email':
      return `Код надіслано на пошту ${login.emailPattern || ''}.`;
    case 'fragment':
      return 'Код надіслано на Fragment (анонімний номер).';
    default:
      return 'Код надіслано.';
  }
}

const NEXT_CHANNEL = {
  sms: 'SMS',
  call: 'дзвінком',
  flash_call: 'дзвінком',
  missed_call: 'дзвінком',
  fragment: 'через Fragment',
};

function stepFromStatus(account) {
  switch (account.authStatus) {
    case 'code_sent':
      return 'code';
    case 'email_setup_needed':
      return 'email_setup';
    case 'email_code_sent':
      return 'email_code';
    case 'password_needed':
      return 'password';
    case 'password_recovery':
      return 'recovery_code';
    case 'qr_pending':
      return 'qr';
    default:
      return 'choose';
  }
}

function useCountdown(login) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!login?.codeTimeout || !login?.codeSentAt) return 0;
  const left = Math.ceil((new Date(login.codeSentAt).getTime() + login.codeTimeout * 1000 - now) / 1000);
  return Math.max(left, 0);
}

const LOG_EVENTS = {
  'code.request': 'Запит коду',
  'code.sent': 'Telegram надіслав код',
  'code.request.failed': 'Помилка запиту коду',
  'code.resend': 'Повторне надсилання',
  'code.resend.failed': 'Помилка повторного надсилання',
  'dc.migrated': 'Перехід в інший дата-центр',
  'connection.failed': 'Збій з’єднання',
  'signin.attempt': 'Введено код',
  'signin.failed': 'Код не прийнято',
  'password.required': 'Потрібен пароль 2FA',
  'password.attempt': 'Перевірка пароля',
  'password.failed': 'Пароль не прийнято',
  'password.recovery_sent': 'Надіслано код відновлення',
  'password.recovery_failed': 'Код відновлення не прийнято',
  'password.recovered': 'Доступ відновлено',
  'email.code_sent': 'Код на пошту надіслано',
  'email.verified': 'Пошту підтверджено',
  'qr.token': 'Новий QR-код',
  'qr.scanned': 'QR-код відскановано',
  'qr.migrate': 'QR: перехід в інший дата-центр',
  'qr.failed': 'Помилка QR-входу',
  'session.import': 'Імпорт сесії',
  'session.invalid': 'Сесію не розпізнано',
  'session.unauthorized': 'Сесія недійсна',
  'login.success': 'Вхід виконано',
  'login.duplicate': 'Акаунт уже додано',
  'login.cancelled': 'Вхід скасовано',
  'step.done': 'Крок завершено',
  'step.failed': 'Крок завершився помилкою',
};

const HIDDEN_LOG_KEYS = ['at', 'account', 'event'];

function AuthLog({ accountId }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const load = () =>
      fetchTelegramAuthLog(accountId, 40)
        .then((list) => setEntries(list.reverse()))
        .catch(() => setEntries([]));
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [open, accountId]);

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border, #333)', paddingTop: 8 }}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
        {open ? 'Сховати журнал входу' : 'Журнал входу'}
      </button>
      {open && (
        <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8, fontSize: 12 }}>
          {entries === null ? (
            <p className="muted">Завантаження...</p>
          ) : entries.length === 0 ? (
            <p className="muted">Записів ще немає</p>
          ) : (
            entries.map((entry, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <span className="muted">{new Date(entry.at).toLocaleTimeString('uk-UA')}</span>{' '}
                <strong className={entry.error ? 'error-inline' : undefined}>
                  {LOG_EVENTS[entry.event] || entry.event}
                </strong>
                <div className="muted" style={{ wordBreak: 'break-word' }}>
                  {Object.entries(entry)
                    .filter(([key, value]) => !HIDDEN_LOG_KEYS.includes(key) && value !== null && value !== undefined && value !== '')
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(' · ')}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CodeInput({ label, value, onChange, length }) {
  return (
    <label className="field" style={{ marginBottom: 14 }}>
      <span className="field-label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder={length ? '•'.repeat(length) : ''}
        maxLength={length ? length + 4 : undefined}
        autoFocus
      />
    </label>
  );
}

// Login dialog for every method Telegram offers: code (app / SMS / call / email /
// Fragment, with "send another way"), login email set-up, QR code, session import,
// and two-step verification with password recovery.
//
// `startWith` ('phone' | 'qr' | 'session') kicks the chosen method off right away;
// `isNew` means the account was created for this dialog and is removed again if
// the login is abandoned.
export default function TelegramLoginModal({ account: initialAccount, startWith, isNew, onClose, onChange }) {
  const [account, setAccount] = useState(initialAccount);
  const [step, setStep] = useState(() => (startWith ? 'starting' : stepFromStatus(initialAccount)));
  const [qrImage, setQrImage] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [session, setSession] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const doneRef = useRef(false);
  const login = account.login || {};
  const resendIn = useCountdown(login);

  // Applies a { next, account, qr } answer from any login step.
  const apply = (res) => {
    setAccount(res.account);
    setError(null);
    setCode('');
    if (res.qr) setQrImage(res.qr);
    if (res.next === 'done') doneRef.current = true;
    setStep(res.next);
    onChange?.();
  };

  // One login request at a time, even on a double click.
  const inFlightRef = useRef(false);
  const run = async (fn, fallback) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const startPhone = () => run(() => sendTelegramCode(account._id), 'Не вдалося надіслати код');
  const startQr = () => run(() => startTelegramQrLogin(account._id), 'Не вдалося отримати QR-код');

  // React StrictMode (dev) runs mount effects twice. Without this guard the login
  // started twice: two codes were requested at once (the second one cancelling the
  // first) and the second request tore down the first one's connection.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (startWith === 'phone') startPhone();
    else if (startWith === 'qr') startQr();
    else if (startWith === 'session') setStep('session');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR: poll until scanned (and confirmed on the phone), refreshing the image
  // whenever Telegram issues a new token.
  useEffect(() => {
    if (step !== 'qr') return undefined;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await pollTelegramQrLogin(account._id);
        if (stopped) return;
        if (res.next === 'qr') {
          if (res.qr) setQrImage(res.qr);
          setAccount(res.account);
        } else {
          apply(res);
        }
      } catch (err) {
        if (!stopped) setError(errorMessage(err, 'Не вдалося перевірити QR-вхід'));
      }
    };
    if (!qrImage) tick();
    const timer = setInterval(tick, QR_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, account._id]);

  const otherAccount =
    initialAccount.phone &&
    account.phone &&
    initialAccount.phone.replace(/\D/g, '') !== account.phone.replace(/\D/g, '');

  useEffect(() => {
    // A login into an unexpected account stays on screen so the warning is seen.
    if (step !== 'done' || otherAccount) return undefined;
    const timer = setTimeout(onClose, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleClose = async () => {
    // An account created just for this login is not left behind half-logged-in.
    if (isNew && !doneRef.current) {
      await deleteTelegramAccount(account._id).catch(() => {});
      onChange?.();
    }
    onClose();
  };

  const submit = (fn, fallback) => (e) => {
    e.preventDefault();
    run(fn, fallback);
  };

  const title = `Вхід у Telegram: ${account.displayName || account.phone || 'новий акаунт'}`;

  return (
    <Modal title={title} onClose={handleClose}>
      {step === 'starting' && <p className="muted">Зв'язок із Telegram...</p>}

      {step === 'choose' && (
        <>
          <p className="muted" style={{ marginBottom: 14, fontSize: 12.5 }}>
            Оберіть спосіб входу.
          </p>
          <div className="account-checkboxes">
            {account.phone && (
              <button className="btn btn-primary" onClick={startPhone} disabled={busy}>
                Код на {account.phone}
              </button>
            )}
            <button className="btn" onClick={startQr} disabled={busy}>
              QR-код
            </button>
            <button className="btn" onClick={() => setStep('session')} disabled={busy}>
              Готова сесія
            </button>
          </div>
        </>
      )}

      {step === 'code' && (
        <form onSubmit={submit(() => signInTelegram(account._id, { code }), 'Не вдалося увійти')}>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            {codeDestination(login)}
            {login.codeType === 'app' && !login.nextCodeType && (
              <>
                {' '}
                Шукайте його в чаті «Telegram» на телефоні або комп'ютері, де відкритий цей акаунт. Іншого способу
                (SMS чи дзвінок) Telegram для цього входу не пропонує.
              </>
            )}
            {login.codeType === 'fragment' && login.fragmentUrl && (
              <>
                {' '}
                <a href={login.fragmentUrl} target="_blank" rel="noreferrer">
                  Відкрити Fragment
                </a>
              </>
            )}
          </p>
          <CodeInput
            label={login.codeType === 'email' ? 'Код із листа' : 'Код підтвердження'}
            value={code}
            onChange={setCode}
            length={login.codeLength}
          />
          <div className="form-actions">
            {login.nextCodeType && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || resendIn > 0}
                onClick={() => run(() => resendTelegramCode(account._id), 'Не вдалося надіслати код ще раз')}
              >
                {resendIn > 0
                  ? `Надіслати ${NEXT_CHANNEL[login.nextCodeType] || 'інакше'} через ${resendIn} с`
                  : `Надіслати ${NEXT_CHANNEL[login.nextCodeType] || 'іншим способом'}`}
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={startPhone}>
              Новий код
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={startQr}>
              Увійти через QR-код
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
              {busy ? 'Вхід...' : 'Увійти'}
            </button>
          </div>
        </form>
      )}

      {step === 'email_setup' && (
        <form onSubmit={submit(() => sendTelegramLoginEmail(account._id, email), 'Не вдалося надіслати лист')}>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Telegram вимагає прив'язати пошту для входу. На неї прийде код підтвердження, а потім і код входу.
          </p>
          <label className="field" style={{ marginBottom: 14 }}>
            <span className="field-label">Пошта</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
              {busy ? 'Надсилання...' : 'Надіслати код на пошту'}
            </button>
          </div>
        </form>
      )}

      {step === 'email_code' && (
        <form onSubmit={submit(() => verifyTelegramLoginEmail(account._id, code), 'Не вдалося підтвердити пошту')}>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Код підтвердження надіслано на {login.emailPattern || email}.
          </p>
          <CodeInput label="Код із листа" value={code} onChange={setCode} length={login.codeLength} />
          <div className="form-actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setStep('email_setup')}>
              Інша пошта
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
              {busy ? 'Перевірка...' : 'Підтвердити'}
            </button>
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={submit(() => checkTelegramPassword(account._id, password), 'Не вдалося увійти')}>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            На акаунті ввімкнено двоетапну перевірку. Введіть хмарний пароль Telegram.
          </p>
          <label className="field" style={{ marginBottom: 14 }}>
            <span className="field-label">Пароль{login.passwordHint ? ` (підказка: ${login.passwordHint})` : ''}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Пароль перевіряється за протоколом SRP, на сервер Telegram він не передається і ніде не зберігається.
            </span>
          </label>
          <div className="form-actions">
            {login.hasRecovery && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => run(() => requestTelegramPasswordRecovery(account._id), 'Не вдалося надіслати код відновлення')}
              >
                Забули пароль?
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || !password}>
              {busy ? 'Вхід...' : 'Увійти'}
            </button>
          </div>
        </form>
      )}

      {step === 'recovery_code' && (
        <form
          onSubmit={submit(
            () => confirmTelegramPasswordRecovery(account._id, code),
            'Не вдалося відновити доступ'
          )}
        >
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Код відновлення надіслано на {login.recoveryEmailPattern || 'пошту двоетапної перевірки'}.
          </p>
          <p className="error-inline" style={{ marginBottom: 12, fontSize: 12.5 }}>
            Після входу з кодом відновлення Telegram вимкне двоетапну перевірку. Задайте новий пароль у застосунку
            Telegram.
          </p>
          <CodeInput label="Код із листа" value={code} onChange={setCode} />
          <div className="form-actions">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setStep('password')}>
              Я згадав пароль
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
              {busy ? 'Вхід...' : 'Увійти'}
            </button>
          </div>
        </form>
      )}

      {step === 'qr' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {qrImage ? (
            <img src={qrImage} alt="QR-код для входу в Telegram" width={240} height={240} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
          ) : (
            <p className="muted">Отримання QR-коду...</p>
          )}
          <ol className="muted" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
            <li>Відкрийте Telegram на телефоні, де вже виконано вхід у цей акаунт.</li>
            <li>Налаштування → Пристрої → Підключити пристрій.</li>
            <li>Наведіть камеру на QR-код і підтвердьте вхід.</li>
          </ol>
          <p className="muted" style={{ fontSize: 12 }}>
            Код оновлюється автоматично. Якщо ввімкнено двоетапну перевірку, далі буде запит пароля.
          </p>
        </div>
      )}

      {step === 'session' && (
        <form onSubmit={submit(() => importTelegramSession(account._id, session), 'Не вдалося імпортувати сесію')}>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Вставте рядок сесії GramJS або Telethon (починається з «1») чи Pyrogram. Сесія перевіряється в Telegram і
            зберігається зашифрованою.
          </p>
          <label className="field" style={{ marginBottom: 14 }}>
            <span className="field-label">Рядок сесії</span>
            <textarea rows={4} value={session} onChange={(e) => setSession(e.target.value)} spellCheck={false} autoFocus />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !session.trim()}>
              {busy ? 'Перевірка...' : 'Імпортувати'}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <>
          <p>
            Вхід виконано
            {account.profile?.firstName ? `: ${[account.profile.firstName, account.profile.lastName].filter(Boolean).join(' ')}` : ''}
            {account.profile?.username ? ` (@${account.profile.username})` : ''}
            {account.phone ? `, ${account.phone}` : ''}.
          </p>
          {initialAccount.phone &&
            account.phone &&
            initialAccount.phone.replace(/\D/g, '') !== account.phone.replace(/\D/g, '') && (
              <p className="error-inline" style={{ fontSize: 13 }}>
                Увага: увійшли в інший акаунт, ніж номер {initialAccount.phone}. Якщо це помилка, видаліть акаунт у
                таблиці й повторіть вхід потрібним акаунтом.
              </p>
            )}
        </>
      )}

      {error && (
        <p className="error-inline" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      <AuthLog accountId={account._id} />
      {error && step === 'starting' && (
        <div className="form-actions">
          <button className="btn btn-sm" onClick={() => setStep('choose')}>
            Інший спосіб входу
          </button>
        </div>
      )}
    </Modal>
  );
}
