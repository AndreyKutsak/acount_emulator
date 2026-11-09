import { useEffect, useState } from "react";
import {
  deviceDefaults,
  deviceProfile,
  deviceProfileSave,
  deviceCurrent,
  deviceApply,
  deviceApplyPersistent,
  emulatorProfiles,
} from "../api/android";
import { errorMessage } from "../api/client";

// Опис полів профілю, згруповано за шарами. type: text | number | select.
const GROUPS = [
  {
    title: "Шар A — build-пропси (що застосунок читає першим)",
    fields: [
      { k: "manufacturer", label: "Виробник (ro.product.manufacturer)" },
      { k: "brand", label: "Бренд (ro.product.brand)" },
      { k: "model", label: "Модель (ro.product.model)" },
      { k: "device", label: "Пристрій (ro.product.device)" },
      { k: "product", label: "Продукт (ro.product.name)" },
      { k: "fingerprint", label: "Fingerprint (ro.build.fingerprint)", wide: true },
      { k: "build_id", label: "Build ID (ro.build.id)" },
      { k: "android_release", label: "Версія Android (release)" },
      { k: "sdk", label: "SDK", type: "number" },
      { k: "security_patch", label: "Security patch (YYYY-MM-DD)" },
    ],
  },
  {
    title: "Шар Б — «залізо» / поведінка",
    fields: [
      { k: "imei", label: "IMEI (15 цифр)" },
      { k: "sim_operator", label: "Оператор SIM (назва)" },
      { k: "sim_operator_code", label: "Код оператора (MCC+MNC)" },
      { k: "sim_country", label: "Країна SIM (ISO, напр. ua)" },
      { k: "phone_number", label: "Номер телефону" },
      {
        k: "gpu_mode",
        label: "Режим GPU",
        type: "select",
        options: ["host", "swiftshader_indirect", "angle_indirect", "guest"],
      },
      { k: "gl_renderer", label: "GL_RENDERER (рядок відеокарти)" },
      { k: "battery_level", label: "Батарея, %", type: "number" },
      {
        k: "battery_status",
        label: "Статус батареї",
        type: "select",
        options: ["discharging", "charging", "not-charging", "full"],
      },
      { k: "density", label: "Щільність, dpi", type: "number" },
      { k: "screen_w", label: "Ширина екрана, px", type: "number" },
      { k: "screen_h", label: "Висота екрана, px", type: "number" },
    ],
  },
];

// Пояснення статусів застосування (чесно, що реально застосувалось).
const STATUS_TONE = {
  applied: { color: "#22c55e", text: "застосовано" },
  "readonly-reboot": { color: "#f59e0b", text: "ro-проп: треба build.prop + ребут" },
  "on-next-launch": { color: "#f59e0b", text: "при старті емулятора" },
  "needs-root-module": { color: "#ef4444", text: "потрібен root-модуль (Magisk)" },
  "no-root": { color: "#ef4444", text: "немає root (adb root не вдався)" },
  error: { color: "#ef4444", text: "помилка" },
};

export default function DeviceSpoofPanel({ serial }) {
  const [profile, setProfile] = useState(null);
  const [current, setCurrent] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [androidProfiles, setAndroidProfiles] = useState([]);
  // Ключ сховища = обраний ManyFaces profileId (per-телефон). Порожньо = прив'язка
  // до серіала запущеного емулятора (один спільний набір).
  const [profileKey, setProfileKey] = useState("");

  const flash = (m) => {
    setMsg(m);
    setError(null);
    setTimeout(() => setMsg(null), 3000);
  };
  const fail = (err, fb) => setError(errorMessage(err, fb) || err?.message || fb);

  const load = async () => {
    try {
      const d = await deviceProfile(serial, profileKey || undefined);
      setProfile(d.profile);
    } catch (err) {
      // якщо немає збереженого — беремо дефолти
      try {
        setProfile(await deviceDefaults());
      } catch (e2) {
        fail(e2, "Не вдалося завантажити профіль");
      }
    }
  };

  useEffect(() => {
    emulatorProfiles()
      .then((list) => setAndroidProfiles(Array.isArray(list) ? list : []))
      .catch(() => setAndroidProfiles([]));
  }, []);

  useEffect(() => {
    setResults(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, profileKey]);

  const setField = (k, v) => setProfile((p) => ({ ...p, [k]: v }));

  const resetDefaults = async () => {
    try {
      setProfile(await deviceDefaults());
      flash("Повернуто значення за умовчанням (не збережено)");
    } catch (err) {
      fail(err, "Помилка");
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await deviceProfileSave(profile, serial, profileKey || undefined);
      setProfile(d.profile);
      flash(profileKey ? "Профіль збережено (per-телефон)" : "Профіль збережено");
    } catch (err) {
      fail(err, "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const d = await deviceApply(profile, serial, profileKey || undefined);
      setResults(d);
      const gpu = d.gpu_saved_to_profile ? ` · GPU→профіль: ${d.gpu_saved_to_profile}` : "";
      flash(
        `Застосовано полів: ${d.applied_count}/${d.total} · root: ${d.root ? "так" : "ні"}${gpu}`,
      );
    } catch (err) {
      fail(err, "Не вдалося застосувати");
    } finally {
      setBusy(false);
    }
  };

  const applyPersistent = async () => {
    if (
      !window.confirm(
        "Повна підміна перепише /system/build.prop і ПЕРЕЗАВАНТАЖИТЬ емулятор " +
          "(може зайняти кілька хвилин, інколи вимагає disable-verity). Продовжити?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const d = await deviceApplyPersistent(profile, serial, profileKey || undefined);
      if (d.ok) {
        flash(`build.prop оновлено й емулятор перезавантажено (ключів: ${d.updated_keys?.length || 0})`);
        setTimeout(readCurrent, 1500);
      } else {
        fail(null, `Не вдалося: ${d.stage || ""} ${JSON.stringify(d.detail || d.error || "")}`);
      }
    } catch (err) {
      fail(err, "Повна підміна не вдалась");
    } finally {
      setBusy(false);
    }
  };

  const readCurrent = async () => {
    setBusy(true);
    setError(null);
    try {
      setCurrent(await deviceCurrent(serial));
      flash("Прочитано фактичні значення з пристрою");
    } catch (err) {
      fail(err, "Не вдалося прочитати пристрій");
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return <p className="muted">Завантаження профілю…</p>;

  return (
    <div className="card">
      <div className="card-title">
        Маскування пристрою (anti-detect){serial ? ` · ${serial}` : ""}
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Параметри, які бачать застосунки. Відредагуй → «Зберегти» → «Застосувати до пристрою».
        Статуси застосування чесні: ro-пропси у рантаймі часто read-only (треба build.prop + ребут),
        IMEI/SIM/GL_RENDERER підміняються лише Magisk-модулем, режим GPU — при старті емулятора.
      </p>

      <label
        className="field"
        style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 420, marginBottom: 12 }}
      >
        <span className="muted" style={{ fontSize: 12 }}>
          Профіль-телефон (per-профіль конфіг). Порожньо = прив'язка до серіала.
        </span>
        <select value={profileKey} onChange={(e) => setProfileKey(e.target.value)}>
          <option value="">— за серіалом ({serial || "default"}) —</option>
          {androidProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.id}){p.running ? " · running" : ""}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      {GROUPS.map((g) => (
        <div key={g.title} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, margin: "8px 0", fontSize: 14 }}>{g.title}</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}
          >
            {g.fields.map((f) => {
              const res = results?.results?.[f.k] || results?.results?.[statusAlias(f.k)];
              const tone = res ? STATUS_TONE[res.status] : null;
              const cur = current?.[f.k];
              return (
                <label
                  key={f.k}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    gridColumn: f.wide ? "1 / -1" : "auto",
                  }}
                >
                  <span className="muted" style={{ fontSize: 12 }}>
                    {f.label}
                    {cur != null && cur !== "" && (
                      <span style={{ color: "#64748b" }}> · зараз: {String(cur)}</span>
                    )}
                  </span>
                  {f.type === "select" ? (
                    <select
                      value={profile[f.k] ?? ""}
                      onChange={(e) => setField(f.k, e.target.value)}
                    >
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      value={profile[f.k] ?? ""}
                      onChange={(e) =>
                        setField(
                          f.k,
                          f.type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                  {tone && (
                    <span style={{ fontSize: 11, color: tone.color }}>● {tone.text}</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="form-actions" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Зберегти
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={apply}>
          Застосувати до пристрою
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={applyPersistent}
          title="Перепише /system/build.prop і перезавантажить емулятор"
        >
          Повна підміна (build.prop + ребут)
        </button>
        <button className="btn" disabled={busy} onClick={readCurrent}>
          Прочитати з пристрою
        </button>
        <button className="btn" disabled={busy} onClick={resetDefaults}>
          За умовчанням
        </button>
      </div>
    </div>
  );
}

// Деякі результати застосування мають агреговані ключі (battery, screen),
// що покривають кілька полів форми.
function statusAlias(k) {
  if (k === "battery_level" || k === "battery_status") return "battery";
  if (k === "screen_w" || k === "screen_h") return "screen";
  return k;
}
