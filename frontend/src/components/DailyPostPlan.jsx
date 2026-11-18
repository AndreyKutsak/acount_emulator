import { useEffect, useState } from 'react';
import { fetchDailyPlan } from '../api/posts';

const STATUS_LABEL = {
  ok: 'виконано',
  below: 'бракує',
  over: 'понад максимум',
};

// Обов'язковий денний план постів для кожного Threads-акаунта.
export default function DailyPostPlan({ refreshKey }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchDailyPlan()
      .then((data) => {
        setPlan(data);
        setError(false);
      })
      .catch(() => setError(true));
  }, [refreshKey]);

  if (error) return <p className="error">Не вдалося завантажити денний план постів</p>;
  if (!plan) return null;

  return (
    <section className="card daily-plan">
      <div className="daily-plan-head">
        <div>
          <h3>План на сьогодні, {new Date(plan.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</h3>
          <p className="page-subtitle">
            Обов'язковий мінімум — {plan.min} на кожен Threads-акаунт за день, максимум — {plan.max} ({plan.timezone})
          </p>
        </div>
        <span className={`daily-plan-total ${plan.accountsBelow ? 'is-below' : 'is-ok'}`}>
          {plan.accountsBelow
            ? `Бракує ${plan.missingTotal} постів у ${plan.accountsBelow} акаунтах`
            : 'План виконано'}
        </span>
      </div>

      {plan.accounts.length === 0 ? (
        <p className="muted">Немає Threads-акаунтів</p>
      ) : (
        <ul className="daily-plan-list">
          {plan.accounts.map((row) => (
            <li key={row.accountId} className={`daily-plan-row is-${row.status}`}>
              <span className="daily-plan-name">{row.displayName || row.username}</span>
              <span className="daily-plan-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (row.total / plan.min) * 100)}%` }} />
              </span>
              <span className="daily-plan-count">
                {row.total} / {plan.min}
              </span>
              <span className="daily-plan-detail">
                Опубліковано {row.published}, заплановано {row.scheduled},{' '}
                {row.status === 'below' ? `${STATUS_LABEL.below} ${row.missing}` : STATUS_LABEL[row.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
