import { useEffect, useState } from "react";
import { fetchStats } from "../api/stats";
import { errorMessage } from "../api/client";
import { formatDate } from "../components/StatusBadge";
import PostStatusBadge from "../components/PostStatusBadge";

const PLATFORM_LABELS = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  twitter: "Twitter",
  youtube: "YouTube",
  threads: "Threads",
  other: "Інше",
};

const POST_STATUS_LABELS = {
  draft: "Чернетки",
  active: "Активні",
  published_partial: "Частково",
  published_all: "Всюди",
};

const COMMENT_STATUS_LABELS = {
  new: "Нові",
  replied: "Відповіли",
  handled: "Опрацьовані",
};

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`stat-card${tone ? ` stat-${tone}` : ""}`}>
      <div className="stat-value">{value ?? 0}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function BreakdownList({ items, labels }) {
  const entries = Object.entries(items || {}).filter(([, v]) => v > 0);
  if (entries.length === 0) return <p className="muted">Немає даних</p>;
  return (
    <ul className="breakdown-list">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span>{labels?.[key] || key}</span>
          <strong>{value}</strong>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setStats(await fetchStats());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Не вдалося завантажити статистику"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="muted">Завантаження...</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Огляд</h2>
          <p className="page-subtitle">Зведена статистика бот-ферми</p>
        </div>
        <button className="btn" onClick={load}>
          Оновити
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stat-grid">
        <StatCard
          label="Акаунти"
          value={stats.accounts.total}
          hint={`Авторизовано: ${stats.accounts.auth.authorized}`}
        />
        <StatCard
          label="Пости"
          value={stats.posts.total}
          hint={`Опубліковано всюди: ${stats.posts.byStatus.published_all}`}
        />
        <StatCard label="Перегляди" value={stats.posts.metrics.views} />
        <StatCard label="Лайки" value={stats.posts.metrics.likes} />
        <StatCard
          label="Коментарі (всього)"
          value={stats.posts.metrics.comments}
        />
        <StatCard
          label="VPN сервери"
          value={stats.vpn.total}
          hint={`Онлайн: ${stats.vpn.byStatus.online}`}
          tone={
            stats.vpn.byStatus.online > 0
              ? "success"
              : stats.vpn.byStatus.offline > 0
                ? "danger"
                : ""
          }
        />
      </div>

      <div className="stat-grid stat-grid-cols-3">
        <div className="card">
          <div className="card-title">Акаунти за платформами</div>
          <BreakdownList
            items={stats.accounts.byPlatform}
            labels={PLATFORM_LABELS}
          />
        </div>
        <div className="card">
          <div className="card-title">Статуси постів</div>
          <BreakdownList
            items={stats.posts.byStatus}
            labels={POST_STATUS_LABELS}
          />
        </div>
        <div className="card">
          <div className="card-title">Коментарі Threads</div>
          <BreakdownList
            items={stats.comments.byStatus}
            labels={COMMENT_STATUS_LABELS}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Автоматизація</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Планувальник {stats.scheduler.enabled ? "увімкнено" : "вимкнено"} ·
          інтервал {Math.round(stats.scheduler.intervalMs / 1000)} с · останній
          запуск: {formatDate(stats.scheduler.lastRunAt)}
        </p>
        {stats.scheduler.lastSummary && (
          <p className="muted">
            Останній цикл: опубліковано{" "}
            {stats.scheduler.lastSummary.published?.filter((p) => p.published)
              .length || 0}
            , оновлено метрик{" "}
            {stats.scheduler.lastSummary.metrics?.filter((m) => m.refreshed)
              .length || 0}
            , коментарів зібрано{" "}
            {stats.scheduler.lastSummary.comments?.reduce(
              (a, c) => a + (c.fetched || 0),
              0,
            ) || 0}
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-title">Останні пости</div>
        {!stats.posts.recent?.length ? (
          <p className="empty-state">Постів ще немає</p>
        ) : (
          <div className="table-wrap">
            <table className="vpn-table">
              <thead>
                <tr>
                  <th>Текст</th>
                  <th>Статус</th>
                  <th>Акаунти</th>
                  <th>Перегляди</th>
                  <th>Лайки</th>
                  <th>Коментарі</th>
                  <th>Створено</th>
                </tr>
              </thead>
              <tbody>
                {stats.posts.recent.map((post) => (
                  <tr key={post._id}>
                    <td className="post-text-cell" data-label="Текст">
                      {post.text || "-"}
                    </td>
                    <td data-label="Статус">
                      <PostStatusBadge status={post.overallStatus} />
                    </td>
                    <td data-label="Акаунти">{post.accountsCount}</td>
                    <td data-label="Перегляди">{post.metrics.views}</td>
                    <td data-label="Лайки">{post.metrics.likes}</td>
                    <td data-label="Коментарі">{post.metrics.comments}</td>
                    <td data-label="Створено">{formatDate(post.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
