// Вкладка «Профілі»: вбудована сторінка ManyFaces (Python, :8000) для створення
// Android-профілів. Сам застосунок ManyFaces не змінюємо — тут лише показуємо його в iframe.

export default function ProfilesPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Профілі</h2>
          <p className="page-subtitle">
            Створення Android-профілів (окремих віртуальних телефонів)
          </p>
        </div>
      </div>

      <p style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
        Тут можна створити Android-профіль (окремий віртуальний телефон) — вкажи
        ім'я, тип пристрою, і натисни створити. Після створення профіль з'явиться
        у вкладці «Огляд», де його можна запустити.
      </p>

      <iframe
        src="http://localhost:8000"
        title="ManyFaces"
        style={{
          width: "100%",
          height: "calc(100vh - 180px)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "#fff",
        }}
      />

      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Якщо сторінка не завантажилась — переконайся, що запущено ManyFaces
        (http://localhost:8000).
      </p>
    </div>
  );
}
