// Інструкція для нетехнічного користувача: як налаштувати Threads через Android-профіль
// і як щодня публікувати пости. Чисто інформаційна сторінка, без API-запитів.

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
            Як налаштувати Threads один раз і далі публікувати пости
          </p>
        </div>
      </div>

      <h3 style={{ marginTop: 4 }}>РОЗДІЛ A — Перше налаштування (один раз)</h3>
      <p className="muted" style={{ marginBottom: 16 }}>
        Це робиться один раз для кожного акаунта. Далі система пам'ятає все сама.
      </p>

      <Step n={1} title="Створити Android-профіль">
        Відкрийте вкладку <strong>«Профілі»</strong>. Вкажіть ім'я профілю і тип
        пристрою, потім натисніть <strong>«Створити»</strong>. Профіль — це окремий
        віртуальний телефон з власним «відбитком» пристрою.
      </Step>

      <Step n={2} title="Запустити профіль">
        Перейдіть на вкладку <strong>«Огляд»</strong>, знайдіть свій профіль у списку
        і натисніть <strong>«Запустити»</strong>. Перший запуск триває кілька хвилин —
        це нормально, зачекайте. Наступні запуски будуть швидші.
      </Step>

      <Step n={3} title="Встановити застосунок Threads">
        Перейдіть на вкладку <strong>«Android»</strong>. Там ви побачите живий екран
        телефону і поле «Встановити APK». Вкажіть шлях до файлу Threads з розширенням{" "}
        <Code>.apk</Code>. Якщо файл має розширення <Code>.xapk</Code> або{" "}
        <Code>.apks</Code> — теж підійде, система сама його розпакує.
        <br />
        <br />
        <strong>Важливо:</strong> наші віртуальні телефони працюють на процесорі
        архітектури <Code>x86_64</Code>. Беріть версію Threads саме під цю архітектуру.
        Якщо взяти версію не під неї, встановлення впаде з помилкою{" "}
        <Code>INSTALL_FAILED_NO_MATCHING_ABIS</Code> (несумісна архітектура).
      </Step>

      <Step n={4} title="Увійти в Threads вручну">
        Прямо на тому самому екрані натискайте мишкою на картинку телефону — це
        як дотик пальцем до справжнього телефону. Відкрийте Threads і увійдіть у
        свій акаунт Instagram/Threads. Це треба зробити лише один раз: вхід
        зберігається всередині профілю.
      </Step>

      <Step n={5} title="Додати акаунт у системі">
        Перейдіть на вкладку <strong>«Акаунти»</strong> і натисніть додавання акаунта.
        Платформа — <Code>Threads</Code>. Введіть свій логін. У полі{" "}
        <strong>«Android-профіль (окремий телефон)»</strong> виберіть профіль, який
        створили на кроці 1. Його назва і технічний ID показані в дужках, наприклад:{" "}
        <Code>Мій профіль (abc123)</Code>. Так система знатиме, з якого телефону
        публікувати пости для цього акаунта.
      </Step>

      <h3 style={{ marginTop: 28 }}>РОЗДІЛ B — Щоденний постинг (кожного разу)</h3>

      <Step n={1} title="Створити пост">
        Перейдіть на вкладку <strong>«Пости»</strong> і натисніть створення нового поста.
        Напишіть текст і виберіть акаунт (або кілька акаунтів), від імені яких
        він буде опублікований.
      </Step>

      <Step n={2} title="Опублікувати">
        Натисніть <strong>«Опублікувати»</strong>.
      </Step>

      <Step n={3} title="Що відбувається далі">
        Система сама робить усе потрібне: вмикає потрібний віртуальний телефон,
        відкриває Threads, публікує пост і потім вимикає телефон. Вам нічого
        вручну запускати не треба.
      </Step>

      <h3 style={{ marginTop: 28 }}>Якщо щось пішло не так</h3>
      <div className="card" style={{ fontSize: 14, lineHeight: 1.6 }}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>Телефон (емулятор) не запускається або «завис»</strong> —
            запустіть файл <Code>stop-all.bat</Code> у головній папці проєкту. Він
            закриє всі запущені частини системи. Потім спробуйте ще раз.
          </li>
          <li>
            <strong>Threads не встановлюється, пише про «архітектуру» або{" "}
            <Code>ABI</Code></strong> (ABI — це тип процесора) — потрібен файл
            Threads під <Code>x86_64</Code>. Версія для ARM-процесорів тут не працює.
          </li>
          <li>
            <strong>Пише «не знайдено елемент на екрані»</strong> — це внутрішня
            технічна помилка автоматизації. Скопіюйте текст помилки і напишіть
            розробнику.
          </li>
        </ul>
      </div>
    </div>
  );
}
