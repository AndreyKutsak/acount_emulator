import { useEffect, useState } from "react";
import {
  emulatorProfiles,
  emulatorStatus,
  emulatorStart,
  emulatorStop,
} from "../api/android";
import { errorMessage } from "../api/client";

// Керування Android-емулятором (запуск/зупинка профілю ManyFaces) з головного застосунку.
export default function EmulatorControl({ compact = false }) {
  const [profiles, setProfiles] = useState([]);
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const [p, s] = await Promise.all([
        emulatorProfiles(),
        emulatorStatus().catch(() => null),
      ]);
      setProfiles(p || []);
      setEngine(s);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "ManyFaces недоступний (запусти емулятор-менеджер)"));
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn, id) => {
    setBusy(id);
    setError(null);
    try {
      await fn(id);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Помилка"));
    } finally {
      setBusy("");
    }
  };

  const statusColor = (s, running) =>
    running || s === "running" ? "#22c55e" : s === "launching" ? "#f59e0b" : "#8b949e";

  return (
    <div className="card">
      <div className="card-title">
        Android емулятор
        {engine ? (
          <span className="muted" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>
            {engine.ready ? "рушій готовий" : "рушій не готовий"}
            {engine.accel ? ` · прискорення ${engine.accel.ok ? "ok" : "немає"}` : ""}
          </span>
        ) : null}
      </div>

      {error && <p className="error">{error}</p>}

      {profiles.length === 0 && !error ? (
        <p className="muted">Немає Android-профілів. Створи пристрій у ManyFaces (:8000).</p>
      ) : null}

      {profiles.map((p) => {
        const running = p.running || p.status === "running";
        const launching = p.status === "launching";
        return (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 0",
              borderTop: "1px solid #2a313c",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>
                <span style={{ color: statusColor(p.status, p.running) }}>●</span> {p.name}
              </div>
              {!compact && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {launching ? "завантажується…" : running ? "працює" : "зупинено"}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {running || launching ? (
                <button
                  className="btn btn-sm"
                  disabled={busy === p.id}
                  onClick={() => act(emulatorStop, p.id)}
                >
                  {busy === p.id ? "…" : "Зупинити"}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy === p.id}
                  onClick={() => act(emulatorStart, p.id)}
                >
                  {busy === p.id ? "запуск…" : "▶ Запустити"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {!compact && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Перше завантаження емулятора — 30–90 с. Автостарт: `ANDROID_AUTOSTART=true` у backend/.env.
        </p>
      )}
    </div>
  );
}
