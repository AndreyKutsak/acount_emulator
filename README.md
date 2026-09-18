# Treds — Full Stack App (React + Node/Express + MongoDB)

## Структура

- `backend/` — Express API + MongoDB (Mongoose)
- `frontend/` — React (Vite)

## Запуск backend

```
cd backend
npm install
copy .env.example .env
npm run dev
```

Потрібен запущений MongoDB (`MONGO_URI` в `.env`, за замовчуванням `mongodb://127.0.0.1:27017/treds`).
Обов'язково задайте `CREDENTIALS_SECRET` у `.env` — цим ключем шифруються паролі акаунтів соцмереж перед збереженням у базі.

## Запуск frontend

```
cd frontend
npm install
npm run dev
```

Frontend буде на `http://localhost:5173`, запити `/api/*` проксуються на backend (`http://localhost:5000`).

## API

### Статистика (дашборд)

- `GET /api/stats` — зведена статистика для сторінки «Огляд»: кількість акаунтів/постів/коментарів/VPN, розбивка за статусами та платформами, сумарні метрики, останні пости і стан планувальника.

### Планувальник (фонова автоматизація)

- `POST /api/scheduler/run` — запустити повний цикл вручну (публікація запланованих постів + збір метрик + збір коментарів) і одразу отримати результат.
- `GET /api/scheduler/status` — стан планувальника (`enabled`, інтервал, час останнього циклу, підсумок останнього циклу).

Планувальник працює у фоновому режимі (за замовчуванням увімкнено, інтервал `SCHEDULER_INTERVAL_MS`, за замовчуванням 60 с):

- публікує пости, у яких настав `scheduledAt` і є акаунти зі станом «очікує»;
- періодично знімає метрики з опублікованих постів (для яких є `postUrl`);
- сканує пости Threads-акаунтів на нові коментарі.

Після кожної дії акаунт отримує випадкове «вікно відпочинку» (`humanize.js`), тому повторні автоматизовані дії не йдуть підряд — це захист від детекту автоматизації. Вимкнути автоматику можна `SCHEDULER_ENABLED=false`.

### Items

- `GET /api/health` — перевірка стану
- `GET /api/items` — список
- `POST /api/items` — створити `{ name, description }`
- `GET /api/items/:id` — отримати
- `PUT /api/items/:id` — оновити
- `DELETE /api/items/:id` — видалити

### VPN сервери

- `GET /api/vpn-servers` — список
- `POST /api/vpn-servers` — створити `{ name, host, port, protocol, location, notes }`
- `GET /api/vpn-servers/:id` — отримати
- `PUT /api/vpn-servers/:id` — оновити
- `DELETE /api/vpn-servers/:id` — видалити (разом із сесіями)
- `POST /api/vpn-servers/:id/check` — TCP-перевірка доступності host:port, оновлює `status` і `lastCheckedAt`
- `POST /api/vpn-servers/check-all` — перевірити всі сервери одразу

### Сесії підключення

- `GET /api/vpn-servers/:serverId/sessions` — сесії для сервера
- `POST /api/vpn-servers/:serverId/sessions` — створити сесію `{ label, clientIp, notes }`
- `GET /api/vpn-sessions` — усі сесії (з даними сервера)
- `PUT /api/vpn-sessions/:id/close` — закрити сесію
- `DELETE /api/vpn-sessions/:id` — видалити сесію

Примітка: перевірка статусу — це TCP-пінг host:port (реальна перевірка доступності порту), а не повне встановлення VPN-тунелю. Сесії наразі — це облікові записи підключень (хто/коли підключався), без фактичного піднімання тунелю — під це можна підключити конкретний VPN-клієнт пізніше.

### Акаунти соцмереж

- `GET /api/social-accounts` — список (пароль ніколи не повертається у відкритому вигляді)
- `POST /api/social-accounts` — створити `{ platform, displayName, username, password, vpnServer, notes }`
- `GET/PUT/DELETE /api/social-accounts/:id`
- `POST /api/social-accounts/:id/reveal-password` — розшифрувати й отримати пароль одноразово

Пароль зберігається зашифрованим (AES-256-GCM, ключ — `CREDENTIALS_SECRET`). Акаунт опційно прив'язується до вже створеного VPN-сервера (`vpnServer`).

### Пости

- `GET /api/posts` — список, кожен елемент має `overallStatus` (`draft` / `active` / `published_partial` / `published_all`) і агреговані `metrics` (views/likes/comments)
- `POST /api/posts` — створити `{ text, images: [url...], scheduledAt, accountIds: [id...] }` — один пост публікується одразу на кількох акаунтах
- `GET/PUT/DELETE /api/posts/:id`
- `PUT /api/posts/:id/accounts/:accountId` — оновити стан публікації на конкретному акаунті: `{ status, publishedAt, views, likes, comments }`

Загальний статус поста рахується автоматично: `active` — ще ніде не опубліковано, `published_partial` — опубліковано на частині акаунтів, `published_all` — на всіх заданих акаунтах.

### Автоматизація (Playwright)

Дозволяє відкривати керовану браузерну сесію для конкретного акаунту (з автологіном за збереженими обліковими даними) і забирати дані зі сторінок (перегляди/лайки/коментарі тощо).

**Важливо про VPN:** Playwright вміє проксувати трафік браузера тільки через HTTP(S)/SOCKS5-проксі, а не через OpenVPN/WireGuard/IPSec-тунель — той працює на рівні ОС. Тому інтеграція тут не піднімає VPN сама: перед стартом сесії потрібно самостійно підключити відповідний VPN-клієнт на машині, де виконується backend. Ендпоінт `POST /api/automation/sessions` лише створює запис `VpnSession` для обліку (який VPN-сервер мав бути активним під час сесії) — так само, як уже працює `POST /api/vpn-servers/:id/sessions`.

- `GET /api/automation/sessions` — список активних браузерних сесій (в пам'яті процесу)
- `POST /api/automation/sessions` — відкрити сесію `{ accountId, label?, loginUrl?, skipLogin? }`. Якщо в акаунта вказано `vpnServer`, автоматично створюється `VpnSession` для обліку. За замовчуванням виконується автологін паролем, розшифрованим із БД; `skipLogin: true` — відкрити сесію без логіну.
- `DELETE /api/automation/sessions/:sessionId` — закрити браузер і відповідну `VpnSession`
- `POST /api/automation/sessions/:sessionId/navigate` — перейти на `{ url }`
- `POST /api/automation/sessions/:sessionId/extract` — зняти довільні дані за CSS-селекторами `{ selectors: { key: "css selector" } }`
- `POST /api/automation/sessions/:sessionId/scrape-post` — відкрити `{ postId, url, selectors? }`, витягнути метрики (перегляди/лайки/коментарі) для платформи акаунта цієї сесії і записати їх у `Post.accounts` (те саме, що робить `PUT /api/posts/:id/accounts/:accountId`)
- `POST /api/automation/sessions/:sessionId/publish-post` — `{ postId, text?, imageUrls? }`. Реально публікує пост у compose UI платформи акаунта цієї сесії (зараз реалізовано тільки для `threads`; `text`/`imageUrls` за замовчуванням беруться з самого `Post`). При успіху позначає запис в `Post.accounts` як `published`. Ендпоінт клікає по живому UI сайту — найбільш чутливий до змін розмітки; помилка повертається як `502` з описом, на якому кроці саме зупинилось (немає кнопки "Post", не знайдено поле вводу тощо).

- `POST /api/automation/accounts/:accountId/check-auth` — одноразово відкриває браузер, пробує залогінитись і одразу закриває сесію; записує результат у `SocialAccount.authStatus` (`unknown`/`authorized`/`failed`/`blocked` — `blocked` означає, що форма логіну приймається, але сесія не створюється, тобто платформа, найімовірніше, тимчасово притримує автоматизовані сесії цього акаунту) + `authCheckedAt`/`authError`.
- `POST /api/automation/publish` — `{ postId, accountId, text?, imageUrls? }`. Логін + публікація + закриття сесії одним викликом (те, що стоїть за кнопкою "Опублікувати" в UI). Для Threads після публікації додатково заходить на профіль акаунта і забирає URL щойно опублікованого поста (`Post.accounts[].postUrl`) — без нього неможливо пізніше знімати метрики.
- `GET /api/automation/user-agent-presets` — кілька готових рядків User-Agent (Chrome/Windows, Chrome/macOS, Safari/iPhone, Chrome/Android) для підказки в UI; можна вводити й довільний.
- `GET /api/automation/health` — стан інфраструктури автоматизації: вибраний браузерний движок (`BROWSER_ENGINE`), headless-режим, доступність residential-проксі та TLS-імпpersonation.
- Кожен `SocialAccount` має поле `userAgent` — закріплений User-Agent для цього акаунта. Порожнє значення = стандартний Chrome/Windows рядок (щоб не світився `HeadlessChrome` у деяких збірках). Змінюється через звичайний `PUT /api/social-accounts/:id { userAgent }` і одразу застосовується для всіх наступних автоматизованих сесій цього акаунта.
- Будь-який ендпоінт, що створює сесію (`/sessions`, `/publish`, `/refresh-metrics`, `/accounts/:id/check-auth`), приймає опційний `userAgent` у тілі запиту — він перекриває закріплений за акаунтом User-Agent **одноразово**, тільки для цього викliку (динамічна зміна без збереження).
- `POST /api/automation/refresh-metrics` — `{ postId, accountId }`. Логіниться, відкриває збережений `postUrl` цього поста і знімає перегляди/лайки/коментарі (для Threads — лайки й коментарі через `aria-label` іконок реакцій; перегляди Threads публічно не показує). Працює лише для постів, опублікованих через `/publish` (бо тільки там є `postUrl`) — якщо пост позначено опублікованим вручну, ендпоінт поверне 400.

**Ризик реального постингу:** автоматизований логін і постинг через Playwright порушує правила використання Meta/TikTok/X/Google для відповідних продуктів — ці платформи активно детектують автоматизацію (captcha, запит підтвердження через телефон, тимчасові блокування). Рекомендовано: `PLAYWRIGHT_HEADLESS=false` під час перших спроб, щоб побачити й самостійно пройти будь-яку перевірку, і не запускати масові/паралельні сесії на одному акаунті.

**Маскування (stealth):** сесії намагаються виглядати людськими — використовується реальний встановлений Chrome (якщо знайдено) замість брендованого Playwright-Chromium, прибираються найочевидніші маркери автоматизації (`navigator.webdriver`, порожні `navigator.plugins`, відсутній `window.chrome`) через init-скрипт, а viewport/locale/timezone підганяються під закріплений User-Agent (`backend/src/services/stealth.js`, `stealthInit.js`). Поведінкове маскування (випадкові затримки, «вікна відпочинку») — у `humanize.js`. Це прибирає найпростіші «сліди», але **не робить сесії невиявними**: fingerprint, Client Hints, поведінка та темпи дій все одно можуть викрити автоматизацію — тому масові/часті дії на одному акаунті лишаються ризикованими незалежно від маскування.

### Stealth-hardening (додатково)

- **Fingerprint-профілі** (`backend/src/services/profileManager.js`): фіксовані консистентні профілі `windows_chrome`, `macos_safari`, `iphone_13`, `android_samsung_s23` (UA, viewport, screen, DPR, locale, timezone, platform, hardwareConcurrency). Поле `SocialAccount.profileId` — один акаунт = один профіль назавжди (за замовчуванням `windows_chrome`).
- **Персистентні профілі**: для кожного акаунта створюється `userDataDir` (`PROFILES_DIR`, за замовчуванням `./profiles/{accountId}`) — зберігаються cookies/localStorage/історія між сесіями.
- **Residential проксі** (`backend/src/services/proxyManager.js`): HTTP/SOCKS5 проксі зі sticky-сесіями (`PROXY_*` у `.env`). Sticky-сесія тримає один egress IP для акаунта протягом `PROXY_STICKY_DURATION_MIN` хвилин (конвенція `username-session-<id>` для Oxylabs/BrightData). Без налаштування — fallback на пряме/VPN-з'єднання з попередженням у логах.
- **Людська поведінка** (`humanize.js` + `ghost-cursor`): криволінійний рух миші до елемента перед кліком, посимвольне введення з варіативними затримками, випадковий скрол.
- **TLS-імпpersonation** (`backend/src/services/tlsClient.js`): опційна обгортка над `impersonated-fetch` для прямих HTTP-запитів (`TLS_IMPERSONATE`). Встановлюється окремо (`npm i impersonated-fetch`); без неї — звичайний `fetch`.
- **Движок браузера** (`backend/src/services/automation/browser.js`): `BROWSER_ENGINE=playwright` (за замовчуванням) або `patchright` (потрібно встановити). CloakBrowser не включено — він потребує окремої ліцензії.

Перевірка: `GET /api/automation/health`.

Селектори логіну/скрапінгу для Instagram/Facebook/TikTok/Twitter/YouTube — це лише стартові значення (`backend/src/services/loginStrategies.js`, `backend/src/services/scrapeStrategies.js`); розмітка цих сайтів часто змінюється і може вимагати коригування, а самі сайти можуть активно протидіяти автоматизації (капчі, 2FA, блокування за підозрілу активність) — це обмеження самих платформ, не Playwright.

Налаштування: `PLAYWRIGHT_HEADLESS` (true/false) і `PLAYWRIGHT_TIMEOUT_MS` у `.env`. При першому встановленні залежностей потрібно також `npx playwright install chromium`.
