// Довідка в GUI: як додати Threads-акаунт і авторизувати його через Android-емулятор,
// щоб потім постити через ManyFaces/оркестратор. Чисто інформаційна сторінка, без API-запитів.

function Step({ n, title, children }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--accent2, #2563eb)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {n}
        </span>
        <strong>{title}</strong>
      </div>
      <div style={{ paddingLeft: 36, fontSize: 14, lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
}

function Code({ children }) {
  return (
    <code
      style={{
        background: "rgba(127,127,127,.15)",
        padding: "2px 6px",
        borderRadius: 5,
        fontSize: 13,
      }}
    >
      {children}
    </code>
  );
}

export default function HelpPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Інструкція</h2>
          <p className="page-subtitle">
            Як додати Threads-акаунт, авторизувати його через Android і
            почати постити
          </p>
        </div>
      </div>

      <h3 style={{ marginTop: 4 }}>Шлях A — Android-емулятор (рекомендовано)</h3>
      <p className="muted" style={{ marginBottom: 16 }}>
        Threads живе всередині реального застосунку на емуляторі — найстійкіше
        до блокувань/детекції.
      </p>

      <Step n={1} title="Створити Android-профіль">
        Вкладка <strong>«Огляд»</strong> → блок керування емулятором
        (ManyFaces) → створити профіль з типом <Code>Android</Code>. Кожен
        профіль — окремий AVD з власним відбитком пристрою.
      </Step>

      <Step n={2} title="Запустити профіль">
        Натиснути <strong>«Запустити»</strong> у списку профілів. Перший
        запуск — декілька хвилин (холодний бут AVD), наступні — швидше
        (quickboot-снапшот).
      </Step>

      <Step n={3} title="Встановити застосунок Threads">
        Відкрити вкладку <strong>«Android емулятор»</strong> — там жива
        картинка екрана й поле «Встановити APK». Вкажіть шлях до{" "}
        <Code>.apk</Code> (не <Code>.xapk</Code>/<Code>.apks</Code> напряму —
        якщо файл розбитий на кілька APK під архітектуру, беріть версію під{" "}
        <Code>x86_64</Code>, бо наші AVD — x86_64; ARM-only збірка на них не
        встановиться: помилка <Code>INSTALL_FAILED_NO_MATCHING_ABIS</Code>).
      </Step>

      <Step n={4} title="Залогінитись у Threads вручну">
        Прямо в тому самому екрані (клік = тап по пристрою) відкрийте Threads
        і увійдіть під потрібним Instagram/Threads-акаунтом. Це робиться один
        раз — сесія зберігається всередині профілю емулятора.
      </Step>

      <Step n={5} title="Прив'язати акаунт у системі">
        Вкладка <strong>«Акаунти»</strong> → додати акаунт, платформа{" "}
        <Code>threads</Code>, і вказати, якому Android-профілю/серіалу він
        відповідає. Так оркестратор знає, через який пристрій постити саме
        для цього акаунта.
      </Step>

      <Step n={6} title="Постити">
        Створюйте пости на вкладці <strong>«Пости»</strong> — вибираєте
        акаунт(и), і система сама піднімає потрібний Android-профіль,
        відкриває Threads і публікує. Якщо профіль уже запущений — просто
        перевикористає його.
      </Step>

      <h3 style={{ marginTop: 28 }}>Шлях B — без Android (швидше, менш стійке)</h3>
      <div className="card" style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.55 }}>
        На вкладці <strong>«Акаунти»</strong> додайте акаунт платформи{" "}
        <Code>threads</Code> з логіном/паролем або готовими cookies, без
        прив'язки до Android-профілю. Постинг тоді йде через
        браузер/TLS-клієнт напряму, без емулятора. Швидше піднімається, але
        легше детектується як автоматизація.
      </div>

      <h3 style={{ marginTop: 28 }}>Якщо щось не працює</h3>
      <div className="card" style={{ fontSize: 14, lineHeight: 1.6 }}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>«Запустити» видає помилку</strong> — найчастіше залишився
            «завислий» емулятор з минулого разу. Запустіть{" "}
            <Code>stop-all.bat</Code> у корені проєкту — він гарантовано
            гасить усі наші процеси (backend/frontend/bridge/AVD), потім
            запустіть усе знову і повторіть.
          </li>
          <li>
            <strong>Встановлення APK падає з <Code>NO_MATCHING_ABIS</Code></strong>{" "}
            — APK не підходить під архітектуру емулятора (x86_64). Потрібен
            APK/XAPK саме під x86_64, або AVD з ARM-трансляцією.
          </li>
          <li>
            <strong>«Огляд» показує помилку / порожній</strong> — не
            запущений backend (порт 5000). Перевірте, що відкрите вікно з{" "}
            <Code>node src/server.js</Code>, або запустіть{" "}
            <Code>start-all.bat</Code>.
          </li>
        </ul>
      </div>
    </div>
  );
}
