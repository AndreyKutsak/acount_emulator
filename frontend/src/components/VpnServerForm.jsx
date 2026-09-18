import { useState } from 'react';

const initial = { name: '', host: '', port: 1194, protocol: 'openvpn', location: '', notes: '' };

export default function VpnServerForm({ onCreate }) {
  const [form, setForm] = useState(initial);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === 'port' ? Number(value) : value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.host.trim()) return;
    onCreate(form);
    setForm(initial);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Назва</span>
          <input name="name" value={form.name} onChange={handleChange} />
        </label>
        <label className="field">
          <span className="field-label">Хост / IP</span>
          <input name="host" value={form.host} onChange={handleChange} />
        </label>
        <label className="field">
          <span className="field-label">Порт</span>
          <input name="port" type="number" value={form.port} onChange={handleChange} />
        </label>
        <label className="field">
          <span className="field-label">Протокол</span>
          <select name="protocol" value={form.protocol} onChange={handleChange}>
            <option value="openvpn">OpenVPN</option>
            <option value="wireguard">WireGuard</option>
            <option value="ipsec">IPSec</option>
            <option value="other">Інше</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Країна</span>
          <input name="location" placeholder="напр. Romania" value={form.location} onChange={handleChange} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          Додати сервер
        </button>
      </div>
    </form>
  );
}
