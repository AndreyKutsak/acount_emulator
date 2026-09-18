import { useEffect, useState } from 'react';
import { fetchServers } from '../api/vpnServers';
import { fetchUserAgentPresets } from '../api/socialAccounts';

const initial = {
  platform: 'instagram',
  displayName: '',
  username: '',
  password: '',
  vpnServer: '',
  notes: '',
  userAgent: '',
};

export default function SocialAccountForm({ onCreate }) {
  const [form, setForm] = useState(initial);
  const [servers, setServers] = useState([]);
  const [uaPresets, setUaPresets] = useState([]);

  useEffect(() => {
    fetchServers().then(setServers).catch(() => setServers([]));
    fetchUserAgentPresets().then(setUaPresets).catch(() => setUaPresets([]));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.username.trim() || !form.password.trim()) return;
    onCreate({ ...form, vpnServer: form.vpnServer || null });
    setForm(initial);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Платформа</span>
          <select name="platform" value={form.platform} onChange={handleChange}>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="tiktok">TikTok</option>
            <option value="twitter">Twitter/X</option>
            <option value="youtube">YouTube</option>
            <option value="threads">Threads</option>
            <option value="other">Інше</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Назва (клієнт/бренд)</span>
          <input name="displayName" value={form.displayName} onChange={handleChange} />
        </label>
        <label className="field">
          <span className="field-label">Логін</span>
          <input name="username" value={form.username} onChange={handleChange} />
        </label>
        <label className="field">
          <span className="field-label">Пароль</span>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
          />
        </label>
        <label className="field">
          <span className="field-label">VPN сервер</span>
          <select name="vpnServer" value={form.vpnServer} onChange={handleChange}>
            <option value="">Без VPN</option>
            {servers.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} ({s.host})
              </option>
            ))}
          </select>
        </label>
        <label className="field field-wide">
          <span className="field-label">User-Agent (закріпити за акаунтом)</span>
          <input
            name="userAgent"
            list="ua-presets"
            placeholder="Порожньо = звичайний Chrome на Windows"
            value={form.userAgent}
            onChange={handleChange}
          />
          <datalist id="ua-presets">
            {uaPresets.map((p) => (
              <option key={p.label} value={p.value} label={p.label} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">Нотатки</span>
          <input name="notes" value={form.notes} onChange={handleChange} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          Додати акаунт
        </button>
      </div>
    </form>
  );
}
