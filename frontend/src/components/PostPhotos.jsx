import { useRef, useState } from 'react';
import { uploadPostImage } from '../api/posts';
import { errorMessage } from '../api/client';

// Фото поста: завантаження з пристрою (на телефоні - з галереї чи камери),
// мініатюри в порядку публікації, зміна порядку й видалення. Значення - масив
// адрес (/uploads/posts/... або сторонні https-посилання).
const MAX = 10;
// Будь-яке фото з галереї чи камери (зокрема HEIC з iPhone і Samsung): перед
// відправкою браузер сам перетворює його на JPEG.
const ACCEPT = 'image/*';
// Найдовша сторона після стиснення: Threads більшого не показує, а файл стає в
// 10-20 разів меншим - швидко навіть через тунель і мобільний інтернет.
const MAX_SIDE = 2048;
const QUALITY = 0.86;

// Фото з телефона -> JPEG до MAX_SIDE px з правильним поворотом.
async function prepareImage(file) {
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 50) || 'photo';
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Браузер не вміє розкодувати формат (напр. HEIC у Chrome): JPG/PNG/WEBP шлемо як є.
    if (/\.(jpe?g|png|webp)$/i.test(file.name || '')) return file;
    throw new Error(
      `Не вдалося прочитати «${file.name || 'фото'}». Збережіть його як JPG (або зробіть знімок екрана) і спробуйте ще раз.`,
    );
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // прозорий PNG - на білому тлі, як у Threads
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error(`Не вдалося стиснути «${file.name || 'фото'}».`);
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

// Зрозуміла причина замість загального «не вдалося».
function uploadError(err, name) {
  if (err?.response) {
    // Порожня 5xx - відповів не наш сервер, а проксі перед ним: сервер недоступний
    // (перезапускається чи впав), а не «погане фото».
    if (err.response.status >= 500 && !err.response.data?.message) {
      return `«${name}»: сервер зараз не відповідає (код ${err.response.status}). Зачекайте хвилину й спробуйте ще раз.`;
    }
    const msg = err.response.data?.message || 'сервер відхилив файл';
    return `«${name}»: ${msg} (код ${err.response.status}).`;
  }
  if (err?.code === 'ERR_NETWORK' || err?.code === 'ECONNABORTED') {
    return `«${name}»: з'єднання обірвалось під час завантаження. Перевірте інтернет і спробуйте ще раз.`;
  }
  return err?.message || errorMessage(err, `Не вдалося завантажити «${name}».`);
}

export default function PostPhotos({ value, onChange }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(null); // { done, total, progress }
  const [error, setError] = useState(null);
  const [link, setLink] = useState('');
  const left = MAX - value.length;

  const addFiles = async (fileList) => {
    const all = [...(fileList || [])];
    const files = all.slice(0, left);
    if (input.current) input.current.value = '';
    if (!files.length) return;
    setError(null);
    const added = [];
    const problems = [];
    for (const [i, file] of files.entries()) {
      setUploading({ done: i, total: files.length, progress: 0 });
      try {
        const ready = await prepareImage(file);
        const { url } = await uploadPostImage(ready, (p) =>
          setUploading({ done: i, total: files.length, progress: Math.round(p * 100) }),
        );
        added.push(url);
      } catch (err) {
        problems.push(uploadError(err, file.name || `фото ${i + 1}`));
      }
    }
    if (added.length) onChange([...value, ...added]);
    setUploading(null);
    if (all.length > files.length) problems.push(`У пості може бути до ${MAX} фото, зайві не додано.`);
    if (problems.length) setError(problems.join(' '));
  };

  const move = (i, delta) => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    onChange(next);
  };

  const addLink = () => {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('Посилання має починатися з http:// або https://');
      return;
    }
    setError(null);
    onChange([...value, url]);
    setLink('');
  };

  return (
    <div className="field post-photos">
      <span className="field-label">Фото</span>
      {value.length > 0 && (
        <ol className="post-photos-grid" aria-label="Фото в порядку публікації">
          {value.map((src, i) => (
            <li key={`${src}-${i}`} className="post-photo">
              <img src={src} alt={`Фото ${i + 1}`} loading="lazy" />
              <span className="post-photo-index">{i + 1}</span>
              <div className="post-photo-actions">
                <button
                  type="button"
                  className="post-photo-btn"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Фото ${i + 1}: на крок раніше`}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="post-photo-btn"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  aria-label={`Фото ${i + 1}: на крок пізніше`}
                >
                  ›
                </button>
                <button
                  type="button"
                  className="post-photo-btn post-photo-remove"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={`Прибрати фото ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="post-photos-add">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <button
          type="button"
          className="btn"
          onClick={() => input.current?.click()}
          disabled={Boolean(uploading) || left <= 0}
        >
          {uploading ? `Завантаження ${uploading.done + 1} з ${uploading.total}: ${uploading.progress}%` : 'Додати фото'}
        </button>
        <span className="post-field-hint">
          {left > 0 ? `Будь-яке фото з галереї чи камери, стискається автоматично. Ще можна ${left} з ${MAX}.` : `Додано максимум: ${MAX} фото.`}
        </span>
      </div>
      <details className="post-photos-link">
        <summary>Додати за посиланням</summary>
        <div className="post-photos-link-row">
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <button type="button" className="btn btn-sm" onClick={addLink} disabled={!link.trim() || left <= 0}>
            Додати
          </button>
        </div>
      </details>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
