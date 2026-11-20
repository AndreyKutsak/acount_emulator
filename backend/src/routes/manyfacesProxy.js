// Прокси до ManyFaces (менеджер емуляторів, http://127.0.0.1:8000) за адресою
// самого сайту: /mf/... -> ManyFaces/...
//
// Навіщо: браузер, який відкрив CRM з іншого домену чи з телефона, не бачить
// «localhost:8000» - це адреса ПК, а не його. Через прокси і наша сторінка
// «Профілі» (/mf/api/...), і оригінальний інтерфейс ManyFaces (/mf/) працюють з
// будь-якої адреси, з якої відкрито CRM.
//
// Оригінальний інтерфейс звертається за абсолютними шляхами /api/... і /static/...,
// які на нашому сайті належать іншим сервісам, тому в HTML і JS ці шляхи на льоту
// переписуються на /mf/api/... і /mf/static/.... Сам ManyFaces не змінюється.
//
// Монтувати ДО express.json(): тіло запиту пересилається як є.

const express = require("express");

const TARGET = (process.env.MANYFACES_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const PREFIX = "/mf";
const TIMEOUT_MS = 120000;
// Відповіді, у яких переписуємо абсолютні шляхи.
const REWRITE_TYPES = /text\/html|javascript|text\/css/;
// Заголовки, які не можна пересилати як є (їх виставляє сам fetch / наш сервер).
const HOP = new Set([
  "host", "connection", "content-length", "transfer-encoding", "accept-encoding",
  "keep-alive", "upgrade", "proxy-connection", "te", "trailer",
]);

function rewrite(text) {
  return text.replace(/(["'`(])\/(api|static)\//g, `$1${PREFIX}/$2/`);
}

const router = express.Router();

router.use(express.raw({ type: () => true, limit: "20mb" }));

router.all("*", async (req, res) => {
  const url = TARGET + (req.url === "" ? "/" : req.url);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
  }
  const hasBody = !["GET", "HEAD"].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: ctrl.signal,
    });
    res.status(upstream.status);
    const type = upstream.headers.get("content-type") || "";
    for (const [k, v] of upstream.headers) {
      const key = k.toLowerCase();
      if (HOP.has(key) || key === "content-encoding") continue;
      if (key === "location" && v.startsWith("/")) {
        res.setHeader(k, PREFIX + v);
        continue;
      }
      res.setHeader(k, v);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (REWRITE_TYPES.test(type)) {
      const body = rewrite(buf.toString("utf8"));
      res.setHeader("content-length", Buffer.byteLength(body));
      res.send(body);
    } else {
      res.setHeader("content-length", buf.length);
      res.end(buf);
    }
  } catch (err) {
    res.status(502).json({
      message: "ManyFaces недоступний: запустіть менеджер емуляторів (svc-manyfaces.bat)",
      detail: err.name === "AbortError" ? "timeout" : err.message,
    });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = { router, rewrite, PREFIX };
