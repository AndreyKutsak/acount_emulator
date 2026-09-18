const LABELS = {
  draft: 'Чернетка',
  active: 'Активний',
  published_partial: 'Опубліковано частково',
  published_all: 'Опубліковано всюди',
};

export default function PostStatusBadge({ status }) {
  return <span className={`status-badge post-status-${status}`}>{LABELS[status] || status}</span>;
}
