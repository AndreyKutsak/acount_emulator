import { useEffect, useRef, useState } from "react";
import {
  androidHealth,
  androidInfo,
  androidApps,
  androidStartApp,
  androidStopApp,
  androidInstall,
  androidPushMedia,
  androidTap,
  androidType,
  androidPress,
  androidSwipe,
  androidThreadsPost,
  androidScreenshotUrl,
} from "../api/android";
import { errorMessage } from "../api/client";
import EmulatorControl from "../components/EmulatorControl";
import DeviceSpoofPanel from "../components/DeviceSpoofPanel";
import OrchestrationPanel from "../components/OrchestrationPanel";

export default function AndroidPage() {
  const [info, setInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [current, setCurrent] = useState("");
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState("");
  const [allApps, setAllApps] = useState(false);
  const [typeText, setTypeText] = useState("");
  const [apkSource, setApkSource] = useState("");
  const [mediaSource, setMediaSource] = useState("");
  const [postText, setPostText] = useState("");
  const [publish, setPublish] = useState(false);
  const [shot, setShot] = useState(androidScreenshotUrl());
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const imgRef = useRef(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const flash = (m) => {
    setMsg(m);
    setError(null);
    setTimeout(() => setMsg(null), 2500);
  };
  const fail = (err, fb) => setError(errorMessage(err, fb) || err?.message || fb);
  const refreshShot = () => setShot(androidScreenshotUrl());

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (okMsg) flash(okMsg);
      refreshShot();
      return r;
    } catch (err) {
      fail(err, "Помилка");
    } finally {
      setBusy(false);
    }
  };

  const loadHeader = async () => {
    try {
      const h = await androidHealth();
      setConnected(!!h.connected);
      setCurrent(h.current || "");
      if (h.connected && !info) {
        try {
          setInfo(await androidInfo());
        } catch {
          /* ignore */
        }
      }
    } catch {
      setConnected(false);
    }
  };

  const loadApps = async () => {
    try {
      const d = await androidApps(!allApps);
      setApps((d.packages || []).slice().sort());
    } catch (err) {
      fail(err, "Не вдалося отримати список застосунків");
    }
  };

  useEffect(() => {
    loadHeader();
    loadApps();
    const t = setInterval(loadHeader, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allApps]);

  // Жива трансляція екрана
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => {
      if (liveRef.current) setShot(androidScreenshotUrl());
    }, 1200);
    return () => clearInterval(t);
  }, [live]);

  // Клік по екрану -> тап у координатах пристрою
  const onScreenClick = (e) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * img.naturalWidth);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * img.naturalHeight);
    run(() => androidTap(x, y));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Android емулятор</h2>
          <p className="page-subtitle">
            Керування пристроєм і автопостинг у Threads через нативний застосунок
          </p>
        </div>
        <div className="muted">
          <span style={{ color: connected ? "#22c55e" : "#ef4444" }}>●</span>{" "}
          {connected
            ? info
              ? `${info.model} · Android ${info.android_version} · ${info.width}×${info.height}`
              : "підключено"
            : "не підключено"}
          {current ? ` · ${current}` : ""}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      <div style={{ marginBottom: 16 }}>
        <EmulatorControl />
      </div>

      <div style={{ marginBottom: 16 }}>
        <OrchestrationPanel />
      </div>

      <div style={{ marginBottom: 16 }}>
        <DeviceSpoofPanel serial={info?.serial || undefined} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* ЖИВИЙ ЕКРАН */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <img
            ref={imgRef}
            src={shot}
            alt="екран"
            onClick={onScreenClick}
            title="клік = тап"
            style={{ width: 240, height: "auto", borderRadius: 10, border: "1px solid #2a313c", cursor: "crosshair", background: "#000" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> live
            </label>
            <button className="btn btn-sm" onClick={refreshShot}>↻ Оновити</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidPress("back"))}>◀ Back</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidPress("home"))}>● Home</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidPress("recent"))}>■ Recent</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidSwipe("up"))}>↑</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidSwipe("down"))}>↓</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidSwipe("left"))}>←</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => run(() => androidSwipe("right"))}>→</button>
          </div>
        </div>

        {/* КЕРУВАННЯ */}
        <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* ПОСТ У THREADS */}
          <div className="card">
            <div className="card-title">Пост у Threads (ручний запуск)</div>
            <textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder="текст поста…"
              rows={3}
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="form-actions" style={{ marginTop: 8, alignItems: "center" }}>
              <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                публікувати (інакше — лише заповнити)
              </label>
              <button
                className="btn btn-primary"
                disabled={busy || !postText.trim()}
                onClick={() =>
                  run(
                    () => androidThreadsPost(postText, publish),
                    publish ? "Опубліковано" : "Чернетку заповнено (без публікації)",
                  )
                }
              >
                {publish ? "Опублікувати" : "Заповнити (dry-run)"}
              </button>
            </div>
          </div>

          {/* ВВІД ТЕКСТУ */}
          <div className="card">
            <div className="card-title">Ввід тексту</div>
            <div className="form-actions">
              <input
                value={typeText}
                onChange={(e) => setTypeText(e.target.value)}
                placeholder="текст у активне поле"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !typeText}
                onClick={() => run(() => androidType(typeText), "Введено")}
              >
                Ввести
              </button>
            </div>
          </div>

          {/* ЗАСТОСУНКИ */}
          <div className="card">
            <div className="card-title">Застосунки</div>
            <div className="form-actions" style={{ marginBottom: 8 }}>
              <select value={selectedApp} onChange={(e) => setSelectedApp(e.target.value)} style={{ flex: 1 }}>
                <option value="">— оберіть застосунок —</option>
                {apps.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={busy || !selectedApp} onClick={() => run(() => androidStartApp(selectedApp), "Запущено")}>Запустити</button>
              <button className="btn" disabled={busy || !selectedApp} onClick={() => run(() => androidStopApp(selectedApp), "Зупинено")}>Стоп</button>
            </div>
            <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={allApps} onChange={(e) => setAllApps(e.target.checked)} /> показати всі
            </label>
          </div>

          {/* ВСТАНОВЛЕННЯ APK */}
          <div className="card">
            <div className="card-title">Встановити APK</div>
            <div className="form-actions">
              <input
                value={apkSource}
                onChange={(e) => setApkSource(e.target.value)}
                placeholder="C:\шлях\app.apk або https://…/app.apk"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !apkSource.trim()}
                onClick={() => run(() => androidInstall(apkSource.trim()), "Встановлено").then(loadApps)}
              >
                Встановити
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Образ x86_64: потрібен x86/universal APK (ARM-only не стане).
            </p>
          </div>

          {/* ДОДАТИ В ГАЛЕРЕЮ (з ПК) */}
          <div className="card">
            <div className="card-title">Додати фото/відео в галерею (з ПК)</div>
            <div className="form-actions">
              <input
                value={mediaSource}
                onChange={(e) => setMediaSource(e.target.value)}
                placeholder="C:\шлях\photo.jpg"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !mediaSource.trim()}
                onClick={() =>
                  run(() => androidPushMedia(mediaSource.trim()), "Додано в галерею")
                }
              >
                Залити
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Файл кладеться у DCIM/Camera і сканується, щоб його побачили галерея і Threads.
              Шлях — на тій машині, де запущений бекенд/міст.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
