import { useEffect, useRef, useState } from "react";
import {
  androidPhones,
  androidInstall,
  androidPushMedia,
  androidUploadApk,
  androidUploadMedia,
} from "../api/android";

const APK_ACCEPT = ".apk,.xapk,.apks,.apkm";
const MEDIA_ACCEPT = "image/*,video/*,.heic,.heif";

const fmtSize = (b) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`;
const errText = (err, fb) =>
  err?.response?.data?.error || err?.response?.data?.message || err?.message || fb;

// Вибір цільового пристрою: емулятор або фізичний телефон (лише готові в adb).
function DevicePicker({ devices, value, onChange, onReload, disabled }) {
  return (
    <div className="form-actions" style={{ marginBottom: 8 }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{ flex: 1 }}
        aria-label="Пристрій"
      >
        {!devices.length && <option value="">немає готових пристроїв</option>}
        {devices.map((d) => (
          <option key={d.serial} value={d.serial}>
            {d.emulator ? "Емулятор" : "📱"} {[d.manufacturer, d.model].filter(Boolean).join(" ") || d.serial}
            {" · "}
            {d.serial}
          </option>
        ))}
      </select>
      <button className="btn btn-sm" onClick={onReload} disabled={disabled} title="Оновити список пристроїв">
        ↻
      </button>
    </div>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(value * 100)}>
      <div style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

// Картки «Встановити APK» і «Фото/відео в галерею»: файл обирається в
// провіднику Windows, завантажується на бекенд і звідти — на вибраний пристрій.
export default function DeviceUploads({ onInstalled }) {
  const [devices, setDevices] = useState([]);
  const [serial, setSerial] = useState("");

  const loadDevices = async () => {
    try {
      const r = await androidPhones();
      const ready = (r.devices || []).filter((d) => d.state === "device");
      setDevices(ready);
      setSerial((s) => (ready.some((d) => d.serial === s) ? s : ready[0]?.serial || ""));
    } catch {
      setDevices([]);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  return (
    <>
      <ApkCard
        devices={devices}
        serial={serial}
        setSerial={setSerial}
        reload={loadDevices}
        onInstalled={onInstalled}
      />
      <MediaCard devices={devices} serial={serial} setSerial={setSerial} reload={loadDevices} />
    </>
  );
}

function ApkCard({ devices, serial, setSerial, reload, onInstalled }) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // 0..1 під час завантаження
  const [status, setStatus] = useState(null); // { ok, text }
  const input = useRef(null);
  const physical = devices.find((d) => d.serial === serial && !d.emulator);

  const done = (ok, text) => {
    setStatus({ ok, text });
    setBusy(false);
    setProgress(null);
    if (ok) onInstalled?.();
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // щоб той самий файл можна було вибрати ще раз
    if (!file) return;
    setBusy(true);
    setStatus({ ok: true, text: `Завантаження ${file.name} (${fmtSize(file.size)})…` });
    setProgress(0);
    try {
      await androidUploadApk(file, serial, (p) => {
        setProgress(p);
        if (p >= 1) setStatus({ ok: true, text: `Встановлення ${file.name} на пристрій…` });
      });
      done(true, `Встановлено: ${file.name}`);
    } catch (err) {
      done(false, errText(err, "Не вдалося встановити"));
    }
  };

  const installByPath = async () => {
    setBusy(true);
    setStatus({ ok: true, text: "Встановлення…" });
    try {
      await androidInstall(source.trim(), serial);
      done(true, "Встановлено");
    } catch (err) {
      done(false, errText(err, "Не вдалося встановити"));
    }
  };

  return (
    <div className="card">
      <div className="card-title">Встановити APK</div>
      <DevicePicker devices={devices} value={serial} onChange={setSerial} onReload={reload} disabled={busy} />
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !serial} onClick={() => input.current?.click()}>
          Обрати файл…
        </button>
        <input ref={input} type="file" accept={APK_ACCEPT} onChange={pick} hidden />
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="або шлях / https://…/app.apk"
          style={{ flex: 1 }}
          disabled={busy}
        />
        <button className="btn" disabled={busy || !serial || !source.trim()} onClick={installByPath}>
          Встановити
        </button>
      </div>
      {progress !== null && <ProgressBar value={progress} />}
      {status && (
        <p className={status.ok ? "muted" : "error"} style={{ fontSize: 13, margin: "6px 0 0" }}>
          {status.text}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        APK, XAPK, APKS, APKM.{" "}
        {physical
          ? "Фізичний телефон: потрібен ARM/universal APK; на Samsung/Xiaomi підтвердіть встановлення на екрані, якщо попросить."
          : "Емулятор x86_64: потрібен x86/universal APK (ARM-only не стане)."}
      </p>
    </div>
  );
}

function MediaCard({ devices, serial, setSerial, reload }) {
  const [files, setFiles] = useState([]); // [{ file, state: 'wait'|'up'|'ok'|'err', progress, error }]
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState("");
  const [pathStatus, setPathStatus] = useState(null);
  const input = useRef(null);

  const pick = (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = "";
    if (!list.length) return;
    // Додаємо до вже вибраних, без дублікатів (ім'я + розмір).
    setFiles((prev) => {
      const seen = new Set(prev.map((x) => `${x.file.name}:${x.file.size}`));
      return [
        ...prev.filter((x) => x.state !== "ok"),
        ...list.filter((f) => !seen.has(`${f.name}:${f.size}`)).map((file) => ({ file, state: "wait", progress: 0 })),
      ];
    });
  };

  const patch = (i, data) => setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, ...data } : x)));

  // Послідовно, по одному файлу: телефон і adb не люблять паралельних push.
  const uploadAll = async () => {
    setBusy(true);
    const snapshot = files;
    for (let i = 0; i < snapshot.length; i += 1) {
      if (snapshot[i].state === "ok") continue;
      patch(i, { state: "up", progress: 0, error: null });
      try {
        await androidUploadMedia(snapshot[i].file, serial, (p) => patch(i, { progress: p }));
        patch(i, { state: "ok", progress: 1 });
      } catch (err) {
        patch(i, { state: "err", error: errText(err, "помилка") });
      }
    }
    setBusy(false);
  };

  const pushByPath = async () => {
    setBusy(true);
    try {
      await androidPushMedia(source.trim(), serial);
      setPathStatus({ ok: true, text: "Додано в галерею" });
    } catch (err) {
      setPathStatus({ ok: false, text: errText(err, "Не вдалося залити") });
    } finally {
      setBusy(false);
    }
  };

  const pending = files.filter((x) => x.state !== "ok").length;
  const doneCount = files.filter((x) => x.state === "ok").length;
  const total = files.reduce((s, x) => s + x.file.size, 0);

  return (
    <div className="card">
      <div className="card-title">Фото/відео в пам'ять телефону</div>
      <DevicePicker devices={devices} value={serial} onChange={setSerial} onReload={reload} disabled={busy} />
      <div className="form-actions">
        <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
          Обрати файли…
        </button>
        <input ref={input} type="file" accept={MEDIA_ACCEPT} multiple onChange={pick} hidden />
        <button className="btn btn-primary" disabled={busy || !serial || !pending} onClick={uploadAll}>
          {busy ? `Завантаження ${doneCount}/${files.length}…` : `Завантажити на пристрій${pending ? ` (${pending})` : ""}`}
        </button>
        {files.length > 0 && (
          <button className="btn btn-sm" disabled={busy} onClick={() => setFiles([])}>
            Очистити
          </button>
        )}
      </div>

      {files.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
            {files.length} файл(ів), {fmtSize(total)}
            {doneCount ? ` · завантажено ${doneCount}` : ""}
          </p>
          <ul className="upload-list">
            {files.map((x, i) => (
              <li key={`${x.file.name}:${x.file.size}`}>
                <span className="upload-icon" aria-hidden="true">
                  {x.file.type.startsWith("video") ? "🎬" : "🖼"}
                </span>
                <span className="upload-name" title={x.file.name}>
                  {x.file.name}
                </span>
                <span className="muted">{fmtSize(x.file.size)}</span>
                <span className={`upload-state upload-${x.state}`}>
                  {x.state === "wait" && "очікує"}
                  {x.state === "up" && `${Math.round(x.progress * 100)}%`}
                  {x.state === "ok" && "✓ у галереї"}
                  {x.state === "err" && "✗ помилка"}
                </span>
                {!busy && x.state !== "up" && (
                  <button
                    className="btn btn-sm"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Прибрати ${x.file.name}`}
                  >
                    ✕
                  </button>
                )}
                {x.state === "up" && <ProgressBar value={x.progress} />}
                {x.error && <span className="error upload-error">{x.error}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
          або вказати шлях на ПК
        </summary>
        <div className="form-actions" style={{ marginTop: 6 }}>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="C:\шлях\photo.jpg"
            style={{ flex: 1 }}
          />
          <button className="btn" disabled={busy || !serial || !source.trim()} onClick={pushByPath}>
            Залити
          </button>
        </div>
        {pathStatus && (
          <p className={pathStatus.ok ? "muted" : "error"} style={{ fontSize: 13, margin: "6px 0 0" }}>
            {pathStatus.text}
          </p>
        )}
      </details>

      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Можна вибрати кілька фото й відео одразу (Ctrl/Shift у провіднику). Файли кладуться в
        DCIM/Camera і скануються — їх видно в галереї телефону і при створенні поста в Threads.
      </p>
    </div>
  );
}
