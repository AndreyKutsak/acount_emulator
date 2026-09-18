export default function ItemList({ items, onDelete }) {
  if (!items.length) return <p className="empty-state">Немає елементів</p>;

  return (
    <div className="table-wrap">
      <ul className="item-list">
        {items.map((item) => (
          <li key={item._id}>
            <strong>{item.name}</strong>
            {item.description && <span className="muted"> - {item.description}</span>}
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(item._id)}>
              Видалити
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
