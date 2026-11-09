import { useEffect, useState } from "react";
import { fetchServers } from "../api/vpnServers";
import { fetchUserAgentPresets } from "../api/socialAccounts";
import { emulatorProfiles } from "../api/android";

const initial = {
  platform: "instagram",
  displayName: "",
  username: "",
  password: "",
  vpnServer: "",
  notes: "",
  userAgent: "",
  profileId: "windows_chrome",
  androidProfileId: "",
  proxyType: "http",
  proxyHost: "",
  proxyPort: "",
  proxyUser: "",
  proxyPass: "",
};

export default function SocialAccountForm({ onCreate }) {
  const [form, setForm] = useState(initial);
  const [servers, setServers] = useState([]);
  const [uaPresets, setUaPresets] = useState([]);
  const [androidProfiles, setAndroidProfiles] = useState([]);

  useEffect(() => {
    fetchServers()
      .then(setServers)
      .catch(() => setServers([]));
    fetchUserAgentPresets()
      .then(setUaPresets)
      .catch(() => setUaPresets([]));
    emulatorProfiles()
      .then((list) => setAndroidProfiles(Array.isArray(list) ? list : []))
      .catch(() => setAndroidProfiles([]));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.username.trim() || !form.password.trim()) return;
    const { proxyType, proxyHost, proxyPort, proxyUser, proxyPass, ...rest } = form;
    const proxyConfig =
      proxyHost.trim() && proxyPort
        ? {
            type: proxyType,
            host: proxyHost.trim(),
            port: Number(proxyPort),
            username: proxyUser,
            password: proxyPass,
          }
        : null;
    onCreate({ ...rest, vpnServer: form.vpnServer || null, proxyConfig });
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
          <input
            name="displayName"
            value={form.displayName}
            onChange={handleChange}
          />
        </label>
        <label className="field">
          <span className="field-label">Логін</span>
          <input
            name="username"
            value={form.username}
            onChange={handleChange}
          />
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
          <select
            name="vpnServer"
            value={form.vpnServer}
            onChange={handleChange}
          >
            <option value="">Без VPN</option>
            {servers.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} ({s.host})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Fingerprint профіль</span>
          <select
            name="profileId"
            value={form.profileId}
            onChange={handleChange}
          >
            <option value="windows_chrome">Windows — Chrome</option>
            <option value="macos_safari">macOS — Safari</option>
            <option value="iphone_13">iPhone 13 — Safari</option>
            <option value="android_samsung_s23">Samsung S23 — Chrome</option>
          </select>
        </label>
        <label className="field field-wide">
          <span className="field-label">
            User-Agent (закріпити за акаунтом)
          </span>
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
          <span className="field-label">
            Android-профіль (окремий телефон)
          </span>
          <select
            name="androidProfileId"
            value={form.androidProfileId}
            onChange={handleChange}
          >
            <option value="">Не прив'язано</option>
            {androidProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Проксі/VPN — хост</span>
          <input
            name="proxyHost"
            value={form.proxyHost}
            onChange={handleChange}
            placeholder="напр. 1.2.3.4"
          />
        </label>
        <label className="field">
          <span className="field-label">Проксі — порт</span>
          <input
            name="proxyPort"
            type="number"
            value={form.proxyPort}
            onChange={handleChange}
            placeholder="напр. 8080"
          />
        </label>
        <label className="field">
          <span className="field-label">Проксі — тип</span>
          <select name="proxyType" value={form.proxyType} onChange={handleChange}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Проксі — логін (необов.)</span>
          <input name="proxyUser" value={form.proxyUser} onChange={handleChange} />
        </label>
        <label className="field">
          <span className="field-label">Проксі — пароль (необов.)</span>
          <input
            name="proxyPass"
            type="password"
            value={form.proxyPass}
            onChange={handleChange}
          />
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
