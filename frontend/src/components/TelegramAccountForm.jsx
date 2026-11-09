import { useState } from 'react';

// Login method picked when adding an account. api_id / api_hash are not asked for:
// the backend stores the pair from .env on the account automatically.
export const LOGIN_METHODS = [
  { id: 'phone', label: 'Номер телефону', hint: 'Telegram надішле код у застосунок, SMS, дзвінком або на пошту' },
  { id: 'qr', label: 'QR-код', hint: 'Скануйте QR-код телефоном, де Telegram уже відкритий' },
  { id: 'session', label: 'Готова сесія', hint: 'Рядок сесії GramJS, Telethon або Pyrogram' },
];

const initial = { displayName: '', phone: '', notes: '', loginMethod: 'phone' };

export default function TelegramAccountForm({ onCreate }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.loginMethod === 'phone' && !form.phone.trim()) return;
    setBusy(true);
    try {
      const ok = await onCreate({ ...form, phone: form.loginMethod === 'phone' ? form.phone : '' });
      if (ok) setForm(initial);
    } finally {
      setBusy(false);
    }
  };

  const method = LOGIN_METHODS.find((m) => m.id === form.loginMethod);

  return (
    <form onSubmit={handleSubmit}>
      <div className="account-checkboxes" style={{ marginBottom: 12 }}>
        {LOGIN_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`btn btn-sm${form.loginMethod === m.id ? ' btn-primary' : ''}`}
            onClick={() => setForm((prev) => ({ ...prev, loginMethod: m.id }))}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
        {method.hint}
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Назва (клієнт/бренд)</span>
          <input name="displayName" value={form.displayName} onChange={handleChange} />
        </label>
        {form.loginMethod === 'phone' && (
          <label className="field">
            <span className="field-label">Телефон</span>
            <input
              name="phone"
              type="tel"
              placeholder="+380..."
              autoComplete="off"
              value={form.phone}
              onChange={handleChange}
              required
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">Нотатки</span>
          <input name="notes" value={form.notes} onChange={handleChange} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Створення...' : form.loginMethod === 'phone' ? 'Додати й надіслати код' : 'Додати й увійти'}
        </button>
      </div>
    </form>
  );
}
