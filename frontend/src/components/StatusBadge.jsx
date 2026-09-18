const LABELS = {
  online: 'Онлайн',
  offline: 'Офлайн',
  unknown: 'Невідомо',
};

export default function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status] || status}</span>;
}

export function formatDate(date) {
  if (!date) return 'Ніколи';
  const d = new Date(date);
  return d.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
