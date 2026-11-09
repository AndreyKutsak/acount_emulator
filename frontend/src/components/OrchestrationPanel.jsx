import { useEffect, useState } from "react";
import { fetchAccounts } from "../api/socialAccounts";
import { orchestrateAccount, orchestrateQueue } from "../api/android";
import { errorMessage } from "../api/client";

// Панель оркестрації життєвого циклу: піднятти профіль-телефон акаунта →
// (спуф) → пост → закрити застосунок → згасити емулятор. Для кількох акаунтів —
// послідовна черга (один емулятор за раз).
export default function OrchestrationPanel() {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState({}); // id -> bool
  const [text, setText] = useState("");
  const [publish, setPublish] = useState(false);
  const [stopAfter, setStopAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [results, setResults] = useState(null);

  const flash = (m) => {
    setMsg(m);
    setError(null);
    setTimeout(() => setMsg(null), 3000);
  };
  const fail = (err, fb) => setError(errorMessage(err, fb) || err?.message || fb);

  const load = async () => {
    try {
      const all = await fetchAccounts();
      setAccounts(Array.isArray(all) ? all : []);
    } catch (err) {
      fail(err, "Не вдалося завантажити акаунти");
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Прив'язані до телефону акаунти (придатні для оркестрації).
  const bound = accounts.filter((a) => a.androidProfileId);
  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const runOne = async (accountId) => {
    if (!text.trim()) return fail(null, "Введіть текст поста");
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const r = await orchestrateAccount({
        accountId,
        text,
        publish,
        stopAfter,
      });
      setResults({ count: 1, results: [r] });
      flash(`Готово: ${r.account} (${r.serial || "?"})`);
    } catch (err) {
      fail(err, "Оркестрація не вдалась");
    } finally {
      setBusy(false);
    }
  };

  const runQueue = async () => {
    if (!text.trim()) return fail(null, "Введіть текст поста");
    if (!selectedIds.length) return fail(null, "Виберіть хоча б один акаунт");
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const items = selectedIds.map((accountId) => ({ accountId, text, publish }));
      const r = await orchestrateQueue({ items, gapMs: 1500 });
      setResults(r);
      flash(`Черга завершена: ${r.count} акаунт(ів)`);
    } catch (err) {
      fail(err, "Черга не виконалась");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">Оркестрація акаунтів (пост → закрити → згасити)</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Для кожного акаунта піднімається його власний профіль-телефон, застосовується
        маскування, виконується пост, закривається застосунок і (за потреби) гаситься
        емулятор. Черга — послідовно, один емулятор за раз.
      </p>

      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="текст поста…"
        rows={3}
        style={{ width: "100%", resize: "vertical", marginBottom: 8 }}
      />
      <div className="form-actions" style={{ gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          публікувати (інакше — лише заповнити, dry-run)
        </label>
        <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={stopAfter} onChange={(e) => setStopAfter(e.target.checked)} />
          гасити емулятор після
        </label>
        <button className="btn btn-primary" disabled={busy || !selectedIds.length} onClick={runQueue}>
          Запустити чергу для вибраних ({selectedIds.length})
        </button>
      </div>

      {!bound.length ? (
        <p className="empty-state">
          Немає акаунтів із прив'язаним Android-профілем. Прив'яжіть профіль-телефон у формі акаунта.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="vpn-table">
            <thead>
              <tr>
                <th></th>
                <th>Акаунт</th>
                <th>Платформа</th>
                <th>Профіль-телефон</th>
                <th>Дія</th>
              </tr>
            </thead>
            <tbody>
              {bound.map((a) => (
                <tr key={a._id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!selected[a._id]}
                      onChange={() => toggle(a._id)}
                    />
                  </td>
                  <td>{a.displayName || a.username}</td>
                  <td>{a.platform}</td>
                  <td className="muted">{a.androidProfileId}</td>
                  <td>
                    <button className="btn btn-sm" disabled={busy} onClick={() => runOne(a._id)}>
                      Запустити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results && (
        <div style={{ marginTop: 12 }}>
          <div className="card-title" style={{ fontSize: 14 }}>Результат</div>
          {results.results.map((r, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: r.ok ? "#22c55e" : "#ef4444" }}>●</span>{" "}
              <strong>{r.account || r.accountId}</strong>{" "}
              {r.ok ? `· ${r.serial || ""} · ${r.tookMs ? Math.round(r.tookMs / 1000) + "с" : ""}` : `· помилка: ${r.error}`}
              {r.log && (
                <span className="muted">
                  {" "}
                  [{r.log.map((s) => `${s.step}:${s.ok ? "ok" : "fail"}`).join(" → ")}]
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
