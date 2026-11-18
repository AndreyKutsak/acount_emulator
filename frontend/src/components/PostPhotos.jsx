import { useRef, useState } from 'react';
import { uploadPostImage } from '../api/posts';
import { errorMessage } from '../api/client';

// Фото поста: завантаження з пристрою (на телефоні - з галереї чи камери),
// мініатюри в порядку публікації, зміна порядку й видалення. Значення - масив
// адрес (/uploads/posts/... або сторонні https-посилання).
const MAX = 10;
const ACCEPT = 'image/jpeg,image/png,image/webp';

export default function PostPhotos({ value, onChange }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(null); // { done, total }
  const [error, setError] = useState(null);
  const [link, setLink] = useState('');
  const left = MAX - value.length;

  const addFiles = async (fileList) => {
    const files = [...fileList].slice(0, left);
    if (!files.length) return;
    setError(null);
    const added = [];
    setUploading({ done: 0, total: files.length });
    try {
      for (const file of files) {
        const { url } = await uploadPostImage(file);
        added.push(url);
        setUploading({ done: added.length, total: files.length });
      }
    } catch (err) {
      setError(errorMessage(err, 'Не вдалося завантажити фото'));
    } finally {
      if (added.length) onChange([...value, ...added]);
      setUploading(null);
      if (input.current) input.current.value = '';
    }
    if (fileList.length > files.length) {
      setError(`У пості може бути до ${MAX} фото, зайві не додано.`);
    }
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
          {uploading ? `Завантаження ${uploading.done + 1} з ${uploading.total}...` : 'Додати фото'}
        </button>
        <span className="post-field-hint">
          {left > 0 ? `JPG, PNG або WEBP, до 15 МБ. Ще можна ${left} з ${MAX}.` : `Додано максимум: ${MAX} фото.`}
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
