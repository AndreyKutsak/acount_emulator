import { useEffect, useRef, useState } from "react";
import { androidPhones, androidPhoneBind, androidThreadsMetrics } from "../api/android";
import { fetchAccounts } from "../api/socialAccounts";
import { errorMessage } from "../api/client";

const POLL_MS = 8000;

// Стан пристрою -> [підпис, клас бейджа].
function stateBadge(d) {
  if (d.state === "device" && d.ready) return ["готовий", "status-online"];
  if (d.state === "device") return ["потрібна дія", "post-status-published_partial"];
  if (d.state === "absent") return ["відключений", "status-offline"];
  if (d.state === "unauthorized") return ["не авторизований", "post-status-published_partial"];
  return [d.state, "status-offline"];
}

// Панель фізичних телефонів: автоматично виявляє пристрої в adb, перевіряє, чи
// встановлено Threads, і дозволяє прив'язати акаунт до телефону. Прив'язаний
// акаунт публікує й збирає метрики через цей телефон (оркестратор, шедулер).
export default function PhonesPanel() {
  const [devices, setDevices] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [auto, setAuto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // ключ дії, що виконується
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const known = useRef(null); // серіали з попереднього опитування

  const flash = (m) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 6000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await androidPhones();
      const list = r.devices || [];
      // Повідомити про щойно підключені пристрої (крім першого завантаження).
      if (known.current) {
        const fresh = list.filter((d) => d.state !== "absent" && !known.current.has(d.serial));
        if (fresh.length) {
          flash(
            "Підключено: " +
              fresh.map((d) => `${d.model || d.serial}${d.ready ? "" : ` (${d.hint})`}`).join(", "),
          );
        }
      }
      known.current = new Set(list.filter((d) => d.state !== "absent").map((d) => d.serial));
      setDevices(list);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Не вдалося отримати список пристроїв"));
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = () =>
    fetchAccounts()
      .then((a) => setAccounts(Array.isArray(a) ? a : []))
      .catch(() => setAccounts([]));

  useEffect(() => {
    load();
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [auto]);

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (okMsg) flash(typeof okMsg === "function" ? okMsg(r) : okMsg);
      await Promise.all([load(), loadAccounts()]);
    } catch (err) {
      setError(errorMessage(err, "Помилка") || err?.message);
    } finally {
      setBusy(null);
    }
  };

  const bind = (serial, accountId) =>
    act(`bind:${serial}`, () => androidPhoneBind(accountId, serial), "Акаунт прив'язано до телефону");
  const unbind = (accountId) =>
    act(`unbind:${accountId}`, () => androidPhoneBind(accountId, ""), "Акаунт відв'язано");
  const metrics = (a) =>
    act(
      `metrics:${a._id}`,
      () => androidThreadsMetrics(a._id),
      (r) => `${a.username}: зчитано ${r.rows} дописів, оновлено ${r.matched?.length ?? 0} постів`,
    );

  // Threads-акаунти, ще не прив'язані до жодного фізичного телефону.
  const free = accounts.filter((a) => a.platform === "threads" && !a.androidSerial);

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>Фізичні телефони (adb)</span>
        <span style={{ flex: 1 }} />
        <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          автовиявлення
        </label>
        <button className="btn btn-sm" disabled={loading} onClick={load}>
          {loading ? "Опитування…" : "Оновити"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Увімкніть на телефоні «Параметри розробника → Налагодження по USB» і під'єднайте кабель
        (або по Wi-Fi: <code>adb tcpip 5555</code>, потім <code>adb connect IP:5555</code>). Телефон
        з'явиться тут автоматично. Блокування екрана має бути вимкнене або «свайпом». Прив'язаний
        акаунт публікує й збирає метрики через цей телефон — без емулятора й без маскування.
      </p>

      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      {!devices.length ? (
        <p className="empty-state">Жодного пристрою в adb. Під'єднайте телефон.</p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th>Пристрій</th>
                <th>Стан</th>
                <th>Екран</th>
                <th>Threads</th>
                <th>Акаунти</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const [label, cls] = stateBadge(d);
                const threads = (d.apps || []).find((a) => a.package === "com.instagram.barcelona");
                return (
                  <tr key={d.serial}>
                    <td data-label="Пристрій">
                      <div>
                        <strong>{[d.manufacturer, d.model].filter(Boolean).join(" ") || d.serial}</strong>
                        {d.emulator && <span className="muted"> · емулятор</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {d.wifi ? "Wi-Fi · " : ""}
                        {d.serial}
                        {d.android_version ? ` · Android ${d.android_version}` : ""}
                      </div>
                    </td>
                    <td data-label="Стан">
                      <span className={`status-badge ${cls}`}>{label}</span>
                      {d.hint && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 260 }}>
                          {d.hint}
                        </div>
                      )}
                    </td>
                    <td data-label="Екран" className="muted">
                      {d.width ? `${d.width}×${d.height}` : "—"}
                      {d.state === "device" && (
                        <div style={{ fontSize: 12 }}>
                          {d.screen_on === false ? "вимкнений" : "увімкнений"}
                          {d.locked ? " · заблокований" : ""}
                        </div>
                      )}
                    </td>
                    <td data-label="Threads">
                      {d.state !== "device" ? (
                        <span className="muted">—</span>
                      ) : threads?.installed ? (
                        <span>✓ {threads.version || "встановлено"}</span>
                      ) : (
                        <span style={{ color: "var(--danger)" }}>не встановлено</span>
                      )}
                    </td>
                    <td data-label="Акаунти">
                      {d.emulator ? (
                        <span className="muted" style={{ fontSize: 12 }}>
                          керується через профіль ManyFaces
                        </span>
                      ) : (
                        <div style={{ display: "grid", gap: 6 }}>
                          {(d.accounts || []).map((a) => (
                            <div key={a._id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <strong>{a.displayName || a.username}</strong>
                              <button
                                className="btn btn-sm"
                                disabled={!!busy || !d.ready}
                                title="Відкрити «Статистику» в Threads і оновити перегляди/лайки/відповіді постів"
                                onClick={() => metrics(a)}
                              >
                                {busy === `metrics:${a._id}` ? "Збір…" : "Метрики"}
                              </button>
                              <button className="btn btn-sm" disabled={!!busy} onClick={() => unbind(a._id)}>
                                Відв'язати
                              </button>
                            </div>
                          ))}
                          {d.state !== "absent" && free.length > 0 && (
                            <select
                              value=""
                              disabled={!!busy}
                              onChange={(e) => e.target.value && bind(d.serial, e.target.value)}
                            >
                              <option value="">+ прив'язати акаунт…</option>
                              {free.map((a) => (
                                <option key={a._id} value={a._id}>
                                  {a.displayName || a.username}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
