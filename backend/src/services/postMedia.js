// Фото до постів: прийом файлу з браузера й підготовка локальних файлів для
// публікації з телефона.
//
// Браузер шле сирий файл (application/octet-stream, ім'я в ?name=). Файл
// зберігається в backend/uploads/posts і віддається як /uploads/posts/<ім'я>;
// цей шлях і пишеться в Post.images (поруч зі сторонніми посиланнями http(s)).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { downloadAllToTempFiles, cleanupTempFiles } = require("./tempDownload");

const UPLOADS_ROOT = path.join(__dirname, "../../uploads");
const POSTS_DIR = path.join(UPLOADS_ROOT, "posts");
const PUBLIC_PREFIX = "/uploads/posts/";
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_BYTES = 15 * 1024 * 1024;
// Threads приймає до 10 фото в одному пості.
const MAX_IMAGES = 10;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// POST /api/posts/upload-image?name=photo.jpg -> { url, name, size }
async function saveUpload(req) {
  const name = path.basename(String(req.query.name || "").trim());
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_EXT.includes(ext)) {
    throw badRequest(`Цей тип файлу не підтримується (${ext || name}). Підійдуть JPG, PNG або WEBP.`);
  }
  await fs.promises.mkdir(POSTS_DIR, { recursive: true });
  // Ім'я латиницею без пробілів: його ж отримає файл на телефоні, а кирилиця й
  // пробіли ламають shell-команди медіасканера.
  const file = path.join(POSTS_DIR, `post_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`);
  let size = 0;
  try {
    await pipeline(
      req,
      async function* limit(source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > MAX_BYTES) throw badRequest("Фото завелике: до 15 МБ.");
          yield chunk;
        }
      },
      fs.createWriteStream(file),
    );
    if (!size) throw badRequest("Порожній файл.");
  } catch (err) {
    await fs.promises.rm(file, { force: true });
    throw err;
  }
  return { url: PUBLIC_PREFIX + path.basename(file), name, size };
}

// Локальні файли для публікації з телефона (міст працює на цій же машині).
// Свої /uploads/posts/... беруться з диска, сторонні http(s) - завантажуються
// в тимчасові файли. -> { paths, cleanup() }
async function localFiles(images) {
  const list = (images || []).filter(Boolean).slice(0, MAX_IMAGES);
  const paths = [];
  const remote = [];
  for (const src of list) {
    if (String(src).startsWith(PUBLIC_PREFIX)) {
      const file = path.join(POSTS_DIR, path.basename(src));
      if (!fs.existsSync(file)) throw new Error(`фото не знайдено на сервері: ${src}`);
      paths.push(file);
    } else {
      remote.push(src);
    }
  }
  // Порядок фото як у пості: завантажені з інтернету йдуть на свої місця.
  const temp = remote.length ? await downloadAllToTempFiles(remote) : [];
  const ordered = [];
  let r = 0;
  let l = 0;
  for (const src of list) {
    ordered.push(String(src).startsWith(PUBLIC_PREFIX) ? paths[l++] : temp[r++]);
  }
  return { paths: ordered, cleanup: () => cleanupTempFiles(temp) };
}

module.exports = { saveUpload, localFiles, MAX_IMAGES, PUBLIC_PREFIX };
