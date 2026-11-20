// Результат перевірки правил Threads під полем тексту: помилки блокують збереження,
// попередження — підказки, як зробити пост помітнішим.
export default function PostValidation({ validation }) {
  if (!validation) return null;
  const { errors = [], warnings = [], stats = {}, appliesTo = [] } = validation;

  if (!errors.length && !warnings.length) {
    return (
      <div className="post-validation post-validation-ok">
        ✓ Пост відповідає правилам Threads
        {stats.isJob ? ' і чеклісту вакансії' : ''}
      </div>
    );
  }

  return (
    <div className="post-validation">
      <div className="post-validation-head">
        Перевірка для Threads
        {appliesTo.length ? ` (${appliesTo.join(', ')})` : ''}
        {stats.isJob ? ' · вакансія' : ''}
      </div>
      <ul>
        {errors.map((item, i) => (
          <li key={`e-${item.code}-${i}`} className="post-validation-error">
            <strong>Помилка:</strong> {item.message}
          </li>
        ))}
        {warnings.map((item, i) => (
          <li key={`w-${item.code}-${i}`} className="post-validation-warning">
            <strong>Порада:</strong> {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
