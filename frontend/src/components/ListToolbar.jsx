import { useMemo, useState } from 'react';

// Спільний рядок керування списком: пошук, фільтри, сортування, лічильник.
// Вибір запам'ятовується в браузері окремо для кожного списку (storageKey).
//
// const view = useListView('posts', posts, {
//   search: (p) => p.text,                          // текст, у якому шукати
//   filters: [{ id, label, kind: 'chips'|'select', options: [{ id, label, test }] }],
//   sorts: [{ id, label, compare }],                // перший - за замовчуванням
// });
// <ListToolbar view={view} placeholder="Пошук у текстах" />  ...  view.shown

function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(`treds.list.${key}`) || 'null');
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(`treds.list.${key}`, JSON.stringify(value));
  } catch {
    // приватний режим - просто не запам'ятовуємо
  }
}

const norm = (s) => String(s || '').toLowerCase();

export function useListView(storageKey, items, { search, filters = [], sorts = [] }) {
  const defaults = useMemo(
    () => ({
      filters: Object.fromEntries(filters.map((f) => [f.id, f.options[0]?.id])),
      sort: sorts[0]?.id || '',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );
  const [state, setState] = useState(() => {
    const saved = readSaved(storageKey);
    return {
      query: '',
      filters: { ...defaults.filters, ...(saved?.filters || {}) },
      sort: sorts.some((s) => s.id === saved?.sort) ? saved.sort : defaults.sort,
    };
  });

  const update = (patch) =>
    setState((prev) => {
      const next = { ...prev, ...patch };
      save(storageKey, { filters: next.filters, sort: next.sort });
      return next;
    });

  const list = items || [];
  const q = norm(state.query).trim();
  const passes = (item, skipId) =>
    filters.every((f) => {
      if (f.id === skipId) return true;
      const opt = f.options.find((o) => o.id === state.filters[f.id]) || f.options[0];
      return !opt?.test || opt.test(item);
    }) && (!q || !search || norm(search(item)).includes(q));

  const shown = list.filter((item) => passes(item));
  const sorter = sorts.find((s) => s.id === state.sort) || sorts[0];
  if (sorter?.compare) shown.sort(sorter.compare);

  // Скільки елементів дасть кожен варіант фільтра з урахуванням інших фільтрів.
  const countFor = (filterId, option) =>
    list.filter((item) => passes(item, filterId) && (!option.test || option.test(item))).length;

  const isDefault =
    !q && state.sort === defaults.sort && filters.every((f) => state.filters[f.id] === defaults.filters[f.id]);

  return {
    ...state,
    total: list.length,
    shown,
    filters,
    sorts,
    countFor,
    isDefault,
    setQuery: (query) => update({ query }),
    setFilter: (id, value) => update({ filters: { ...state.filters, [id]: value } }),
    setSort: (sort) => update({ sort }),
    reset: () => update({ query: '', filters: defaults.filters, sort: defaults.sort }),
  };
}

export default function ListToolbar({ view, placeholder = 'Пошук', noun = ['запис', 'записи', 'записів'] }) {
  const plural = (n) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return noun[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return noun[1];
    return noun[2];
  };
  const chips = view.filters.filter((f) => f.kind !== 'select');
  const selects = view.filters.filter((f) => f.kind === 'select');

  return (
    <div className="list-toolbar">
      <div className="list-toolbar-row">
        <label className="list-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4" />
          </svg>
          <input
            type="search"
            value={view.query}
            onChange={(e) => view.setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
        </label>
        {selects.map((f) => (
          <label key={f.id} className="list-select">
            <span className="visually-hidden">{f.label}</span>
            <select value={view.filters[f.id] ?? ''} onChange={(e) => view.setFilter(f.id, e.target.value)}>
              {f.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {view.sorts.length > 1 && (
          <label className="list-select list-sort">
            <span className="visually-hidden">Сортування</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
            </svg>
            <select value={view.sort} onChange={(e) => view.setSort(e.target.value)}>
              {view.sorts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {chips.map((f) => (
        <div key={f.id} className="chip-row" role="group" aria-label={f.label}>
          {f.options.map((o) => {
            const active = view.filters[f.id] === o.id;
            return (
              <button
                key={o.id}
                type="button"
                className={`chip${active ? ' chip-active' : ''}`}
                aria-pressed={active}
                onClick={() => view.setFilter(f.id, o.id)}
              >
                {o.dot && <span className={`dot dot-${o.dot}`} aria-hidden="true" />}
                {o.label}
                <span className="chip-count">{view.countFor(f.id, o)}</span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="list-toolbar-meta">
        <span>
          {view.shown.length === view.total
            ? `${view.total} ${plural(view.total)}`
            : `Показано ${view.shown.length} з ${view.total}`}
        </span>
        {!view.isDefault && (
          <button type="button" className="link-btn" onClick={view.reset}>
            Скинути фільтри
          </button>
        )}
      </div>
    </div>
  );
}
