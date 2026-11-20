import { useEffect, useState } from "react";
import {
  emulatorProfiles,
  emulatorStatus,
  emulatorStart,
  emulatorStop,
} from "../api/android";
import { fetchAccounts } from "../api/socialAccounts";
import { errorMessage } from "../api/client";
import ListToolbar, { useListView } from "./ListToolbar";

// Віртуальні телефони (профілі ManyFaces): стан, чий це телефон, запуск і зупинка.
// compact - коротка картка для «Огляду» (без пошуку й фільтрів).

const stateOf = (p) =>
  p.running || p.status === "running"
    ? "running"
    : p.status === "launching"
      ? "launching"
      : p.status === "error"
        ? "error"
        : "stopped";

const STATE = {
  running: { label: "увімкнений", edge: "success" },
  launching: { label: "вмикається...", edge: "warning" },
  error: { label: "помилка запуску", edge: "danger" },
  stopped: { label: "вимкнений", edge: "idle" },
};
const ORDER = { running: 0, launching: 1, error: 2, stopped: 3 };

export default function EmulatorControl({ compact = false }) {
  const [profiles, setProfiles] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const [p, s] = await Promise.all([emulatorProfiles(), emulatorStatus().catch(() => null)]);
      setProfiles(p || []);
      setEngine(s);
      setError(null);
    } catch (err) {
      setProfiles((prev) => prev || []);
      setError(errorMessage(err, "ManyFaces недоступний: запустіть менеджер емуляторів (порт 8000)"));
    }
  };

  useEffect(() => {
    load();
    fetchAccounts().then(setAccounts).catch(() => setAccounts([]));
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ownersOf = (p) => accounts.filter((a) => a.androidProfileId === p.id);
  const ownerNames = (p) => ownersOf(p).map((a) => `@${a.username}`).join(", ");

  const view = useListView("emulators", profiles || [], {
    search: (p) => `${p.name} ${p.id} ${ownerNames(p)}`,
    filters: [
      {
        id: "state",
        label: "Стан",
        options: [
          { id: "all", label: "Усі" },
          { id: "on", label: "Увімкнені", dot: "success", test: (p) => ["running", "launching"].includes(stateOf(p)) },
          { id: "off", label: "Вимкнені", dot: "idle", test: (p) => stateOf(p) === "stopped" },
          { id: "error", label: "З помилкою", dot: "danger", test: (p) => stateOf(p) === "error" },
        ],
      },
      {
        id: "owner",
        label: "Акаунт",
        kind: "select",
        options: [
          { id: "all", label: "З акаунтом і без" },
          { id: "with", label: "Прив'язані до акаунта", test: (p) => ownersOf(p).length > 0 },
          { id: "without", label: "Вільні", test: (p) => ownersOf(p).length === 0 },
        ],
      },
    ],
    sorts: [
      { id: "state", label: "Спершу увімкнені", compare: (a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)] },
      { id: "name", label: "За назвою", compare: (a, b) => a.name.localeCompare(b.name) },
      { id: "owner", label: "За акаунтом", compare: (a, b) => ownerNames(a).localeCompare(ownerNames(b)) },
    ],
  });

  const act = async (fn, id) => {
    setBusy(id);
    setError(null);
    try {
      await fn(id);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Не вдалося виконати дію"));
    } finally {
      setBusy("");
    }
  };

  // Компактна картка не показує фільтрів, тож і не застосовує збережені: усі телефони за станом.
  const all = [...(profiles || [])].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)]);
  const list = compact ? all.slice(0, 6) : view.shown;
  const hidden = compact ? all.length - list.length : 0;
  const onCount = (profiles || []).filter((p) => ["running", "launching"].includes(stateOf(p))).length;

  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">Телефони (емулятори)</div>
        {profiles && (
          <span className="muted">
            увімкнено {onCount} з {profiles.length}
            {engine && !engine.ready ? ", рушій Android не готовий" : ""}
          </span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {profiles === null ? (
        <p className="muted">Завантаження...</p>
      ) : profiles.length === 0 && !error ? (
        <p className="empty-state">
          Телефонів ще немає. Створіть профіль з рушієм Android у вкладці «Профілі».
        </p>
      ) : (
        <>
          {!compact && profiles.length > 0 && (
            <ListToolbar view={view} placeholder="Пошук за назвою, ID чи акаунтом" noun={["телефон", "телефони", "телефонів"]} />
          )}
          <ul className="device-list">
            {list.map((p) => {
              const st = stateOf(p);
              const owners = ownersOf(p);
              return (
                <li key={p.id} className="device-row state-edge" data-state={STATE[st].edge}>
                  <div className="device-main">
                    <div className="cell-title">
                      <span className={`dot dot-${STATE[st].edge}`} aria-hidden="true" /> {p.name}
                    </div>
                    <div className="cell-sub">
                      {STATE[st].label}
                      {p.serial ? `, ${p.serial}` : ""}
                      {owners.length ? (
                        <>
                          {", акаунт "}
                          {owners.map((a) => `@${a.username}`).join(", ")}
                        </>
                      ) : (
                        ", без акаунта"
                      )}
                    </div>
                  </div>
                  {st === "running" || st === "launching" ? (
                    <button className="btn btn-sm" disabled={busy === p.id} onClick={() => act(emulatorStop, p.id)}>
                      {busy === p.id ? "Вимикаю..." : "Вимкнути"}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy === p.id}
                      onClick={() => act(emulatorStart, p.id)}
                    >
                      {busy === p.id ? "Вмикаю..." : "Увімкнути"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && <p className="muted">І ще {hidden}: усі - у вкладці «Телефони».</p>}
          {!compact && view.shown.length === 0 && (
            <div className="empty-state">
              Жоден телефон не підходить під фільтри.{' '}
              <button type="button" className="link-btn" onClick={view.reset}>
                Скинути фільтри
              </button>
            </div>
          )}
        </>
      )}

      {!compact && (
        <p className="card-note">
          Перший запуск телефона триває 30-90 секунд. Одночасно працює один телефон: увімкнення іншого вимкне
          попередній.
        </p>
      )}
    </div>
  );
}
