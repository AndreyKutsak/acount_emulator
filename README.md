# Treds — Full Stack App (React + Node/Express + MongoDB)

## Структура

- `backend/` — Express API + MongoDB (Mongoose), фоновий планувальник, Telegram (MTProto) і браузерна автоматизація (Playwright)
- `frontend/` — React (Vite), односторінковий інтерфейс із вкладками
- `backend/ManyFaces/` — git-сабмодуль: окремий anti-detect браузер-менеджер (необов'язковий для роботи основного застосунку)

## Передумови

- **Node.js 18+** і npm (перевірка: `node -v`).
- **MongoDB** — локально або в хмарі. Локально має бути запущений `mongod`; адресу задає `MONGO_URI`.
- **Chromium для Playwright** — потрібен лише для браузерної автоматизації постингу/скрапінгу (вкладки «Пости», «Коментарі Threads», «Акаунти»). Ставиться командою `npx playwright install chromium` (див. нижче).
- **Telegram `api_id`/`api_hash`** — потрібні лише для вкладки «Telegram». Беруться на <https://my.telegram.org> → *API development tools*.

> Лише читати дашборд, вести список акаунтів/VPN і користуватися Telegram-функціями можна без Playwright. Chromium потрібен тільки для реального постингу й скрапінгу через браузер.

## Встановлення й запуск backend

```bash
# 1. Клонувати разом із сабмодулем (або, якщо вже клоновано:)
git submodule update --init --recursive   # лише якщо потрібен ManyFaces

cd backend

# 2. Залежності
npm install

# 3. Браузер для Playwright (лише якщо користуватиметесь автоматизацією)
npx playwright install chromium

# 4. Конфіг
copy .env.example .env        # Windows (PowerShell/cmd)
# cp .env.example .env        # macOS/Linux

# 5. (опційно) Наповнити бібліотеки Telegram-заготовок
node scripts/seed-comment-topics.js      # 16 тем + ~250 коментарів (uk/ru)
node scripts/seed-auto-reply-rules.js    # готові правила автовідповідей

# 6. Запуск
npm run dev     # режим розробки (nodemon, автоперезапуск)
# npm start      # звичайний запуск
```

Обов'язково в `.env`:

- `MONGO_URI` — адреса MongoDB (за замовчуванням `mongodb://127.0.0.1:27017/treds`); база має бути доступна, інакше сервер не стартує.
- `CREDENTIALS_SECRET` — довгий випадковий рядок. Цим ключем шифруються паролі соцмереж і Telegram-сесії перед збереженням у базі. **Зміна ключа після збереження акаунтів зробить збережені секрети нечитабельними.**
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` — якщо плануєте користуватися вкладкою «Telegram».

Решта змінних (`.env.example` докладно прокоментований): браузерний движок, headless-режим, residential-проксі, fingerprint-локаль/таймзона, інтервали фонового планувальника, автокоментування та автовідповідей.

Backend підніметься на `http://localhost:5000` (`GET /api/health` → `{ "status": "ok" }`). При старті автоматично запускаються: перевірка VPN-серверів, фоновий планувальник постів, Telegram-автокоментування і автовідповіді (кожне можна вимкнути в `.env`).

## Запуск frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend буде на `http://localhost:5173`, запити `/api/*` і `/uploads/*` проксуються на backend (`http://localhost:5000`) — тому backend має працювати паралельно. Продакшн-збірка: `npm run build` (у `frontend/dist`), перегляд збірки — `npm run preview`.

## Сценарії використання (через інтерфейс)

Інтерфейс — це вкладки у верхній частині сторінки. Застосунок не має власної авторизації, тому тримайте його за firewall / у локальній мережі.

**Огляд** — зведений дашборд: кількість акаунтів/постів/коментарів/VPN, розбивка за статусами, останні пости, стан планувальника.

**VPN сервери** — довідник серверів. Додайте сервер (`host`, `port`, `protocol`), кнопка перевірки робить TCP-пінг `host:port`. Сам тунель програма не піднімає — підключіть VPN-клієнт на машині backend окремо; записи сесій ведуться лише для обліку.

**Акаунти** (соцмережі) — додайте акаунт (`platform`, `username`, `password`, опційно прив'язка до VPN-сервера й закріплений User-Agent). Пароль зберігається зашифрованим і ніколи не повертається у відкритому вигляді (разова розшифровка — окремою кнопкою/ендпоінтом).

**Пости** — типовий потік:
1. Створіть пост: текст, зображення, час публікації (`scheduledAt`) і список акаунтів, на яких публікувати.
2. Публікація — або фоновим планувальником за часом, або вручну кнопкою (для Threads реалізовано реальний постинг через Playwright). Перший запуск краще робити з `PLAYWRIGHT_HEADLESS=false`, щоб бачити й проходити можливі перевірки.
3. Метрики (перегляди/лайки/коментарі) збираються з опублікованих постів автоматично або кнопкою оновлення.

**Коментарі Threads** — підтягування коментарів під опублікованими постами Threads і відповіді на них.

**Telegram** — працює від імені акаунта через MTProto (не Bot API):
1. Задайте `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` у `.env`.
2. Додайте Telegram-акаунт і увійдіть (за кодом, QR-кодом або рядком сесії) — майстер входу веде по кроках (код → email → пароль 2FA тощо).
3. Переглядайте чати/канали, читайте пости й коментарі, коментуйте вручну.
4. Налаштуйте **автокоментування** (беруться готові заготовки за темою поста, за розкладом) і **автовідповіді** на особисті повідомлення (класифікація за ключовими словами + готові відповіді).
5. **Ліміти активності** захищають акаунт від блокувань (квоти на годину/добу, прогрів нових акаунтів, реакція на `FLOOD_WAIT`/`PEER_FLOOD`).

**Items** — службова вкладка для тестових записів (демо CRUD).

> **Важливо.** Автоматизований постинг і масові дії в соцмережах/Telegram порушують правила платформ і можуть призвести до блокувань. Інструмент знижує ризик детекту, але не робить сесії невиявними — не запускайте часті/паралельні дії на одному акаунті. Докладніше — у розділах «Автоматизація» і «Stealth-hardening» нижче.

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

### Telegram

Працює через MTProto (бібліотека GramJS, пакет `telegram`) від імені самого акаунта — Bot API не вміє ні показати чати користувача, ні коментувати від його імені. Потрібні `api_id`/`api_hash` з https://my.telegram.org (`TELEGRAM_API_ID`/`TELEGRAM_API_HASH` у `.env` або власна пара на акаунт).

- `GET /api/telegram/accounts` — список (сесія, `api_hash` і хеш коду ніколи не повертаються)
- `POST /api/telegram/accounts` — створити `{ displayName, loginMethod: phone|qr|session, phone?, notes }`. Телефон потрібен лише для входу за кодом; для QR і сесії він підтягується з профілю після входу. `api_id`/`api_hash` вводити не треба: пара з `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` автоматично зберігається в акаунті (зашифровано)
- `DELETE /api/telegram/accounts/:id` — видалити (сесія завершується і на боці Telegram)

Вхід, шляхи відносно `/api/telegram` (кожен крок відповідає `{ next, account[, qr] }`, де `next`: `code` | `email_setup` | `email_code` | `password` | `recovery_code` | `qr` | `done`):
- `POST /accounts/:id/send-code` — код у застосунок Telegram, SMS, дзвінком, на пошту входу або на Fragment; у `account.login` видно, куди саме (`codeType`), чим можна надіслати повторно (`nextCodeType`) і через скільки секунд (`codeTimeout`)
- `POST /accounts/:id/resend-code` — надіслати наступним способом (напр. SMS або дзвінок)
- `POST /accounts/:id/sign-in` — `{ code }`
- `POST /accounts/:id/login-email` `{ email }` і `POST /accounts/:id/login-email/verify` `{ code }` — якщо Telegram вимагає прив'язати пошту для входу
- `POST /accounts/:id/password` — `{ password }`, двоетапна перевірка (SRP; пароль не зберігається). Підказка в `account.login.passwordHint`
- `POST /accounts/:id/password-recovery` і `POST /accounts/:id/password-recovery/confirm` `{ code }` — відновлення через пошту 2FA (Telegram вимикає двоетапну перевірку)
- `POST /accounts/:id/qr-login` — почати вхід за QR (`qr` — картинка data URL); `GET` того ж шляху — перевірити, чи відскановано
- `POST /accounts/:id/import-session` — `{ session }`: рядок сесії GramJS/Telethon або Pyrogram
- `POST /accounts/:id/cancel-login` — скасувати незавершений вхід

Один і той самий Telegram-акаунт не можна додати двічі: дубль відхиляється, а щойно створена сесія закривається.

- `POST /api/telegram/accounts/:id/logout` — завершити сесію
- `POST /api/telegram/accounts/:id/refresh` — оновити дані акаунта (`profile`: id, username, ім'я, телефон, bio, premium)
- `GET /api/telegram/accounts/:id/chats` — усі групи, супергрупи й канали акаунта, включно з архівом (`type`, `membersCount`, `hasLinkedChat`, `forum`, `unreadCount`, `lastMessageDate`, `archived`)
- `GET /api/telegram/accounts/:id/chats/:chatId` — деталі чату, зокрема `linkedChat` — чат обговорень (коментарів) каналу
- `GET /api/telegram/accounts/:id/chats/:chatId/posts?limit=20&offsetId=` — пости каналу або повідомлення групи, від нових до старих. Відповідь `{ items, nextOffsetId }`; щоб отримати старіші, передайте `nextOffsetId` як `offsetId` (`null` — історія закінчилась). Альбом згортається в один пост (`mediaCount`). Поля: `text`, `author`, `mediaType`, `views`, `reactions`, `threadKind` (`comments` — коментарі під постом каналу, `replies` — гілка відповідей у супергрупі, `null` — недоступно), `commentsCount`, `discussionChatId`, `url`
- `GET /api/telegram/accounts/:id/chats/:chatId/posts/:postId/comments?limit=30&offsetId=` — коментарі під постом каналу (з його чату обговорень) або відповіді в гілці повідомлення супергрупи. Відповідь `{ items, total, nextOffsetId }`; `replyToId` у коментаря означає відповідь на інший коментар. Для звичайних груп повертає `400` — у них немає гілок
- `POST /api/telegram/accounts/:id/chats/:chatId/posts/:postId/comments` — `{ text }`, коментар до поста каналу або відповідь на повідомлення супергрупи

`chatId` — id з переліку чатів (напр. `-1001234567890`) або `@username`. Сесія зберігається зашифрованою (`CREDENTIALS_SECRET`). Обмеження Telegram (`FLOOD_WAIT`, slow mode) повертаються як `429` з `retryAfter` у секундах — запит не повторюється автоматично.

#### Теми коментарів

Коментарі згруповано за темами (у заготовки поле `category` = назва теми). Тема поста визначається за ключовими словами: пост отримує тему, у якій знайдено найбільше слів, і коментар береться з неї. Якщо тему не визначено, використовуються коментарі універсальної теми. Пости, що збігаються з темою з позначкою `avoid` (загиблі й поранені, трагедії, фронт, мобілізація), не коментуються ніколи. Обстріли й дронові атаки без жертв мають окрему тему зі співчутливими коментарями. Один і той самий коментар не повторюється в чаті протягом 7 днів, поки є інші.

- `GET /api/telegram/topics` — теми з кількістю коментарів за мовами (`templateCounts`)
- `POST /api/telegram/topics` — `{ name, keywords: [...], description?, universal?, avoid?, order?, enabled? }`
- `PUT /api/telegram/topics/:topicId` — змінити; перейменування переносить і коментарі, і налаштування чатів
- `DELETE /api/telegram/topics/:topicId?withTemplates=true` — тему з коментарями видаляє лише разом із ними
- `POST /api/telegram/topics/classify` — `{ text, language }`: яку тему отримає пост і приклад коментаря

Готові 16 тем і 250 коментарів (українська й російська) завантажуються командою `node scripts/seed-comment-topics.js` (повторний запуск додає лише нові тексти). Налаштування чату в завданні: `language`, `topicMode: auto|fixed` (за змістом поста або лише обрані теми), `topics: [...]` (порожньо = всі), `fallbackUniversal`, `targeting.keywords` (коментувати лише пости з цими словами).

#### Автокоментування із заготовок

Коментарі беруться з бібліотеки готових текстів (без генерації). Мова завдання визначає, з яких заготовок брати текст. У заготовках працюють варіації: `{Супер|Класний} пост{!|, дякую!}` щоразу дає випадковий варіант.

- `GET /api/telegram/templates?language=&category=` — заготовки
- `GET /api/telegram/templates/languages` — мови з кількістю заготовок і категоріями
- `POST /api/telegram/templates` — `{ language, category?, text }` або `{ language, category?, texts: [...] }` (дублікати відкидаються)
- `PUT/DELETE /api/telegram/templates/:templateId` — `{ text?, language?, category?, enabled? }`
- `POST /api/telegram/templates/preview` — `{ text }`, кілька прикладів варіацій
- `GET/POST /api/telegram/accounts/:id/auto-comment` — завдання акаунта / створити `{ chatId, language, category?, mode, schedule, targeting, enabled }`. Чат має бути каналом із чатом обговорень або супергрупою; одне завдання на пару акаунт+чат
- `PUT/DELETE /api/telegram/auto-comment/:taskId` — змінити (розклад на сьогодні перебудовується) / видалити
- `POST /api/telegram/auto-comment/:taskId/run` — один коментар зараз, поза розкладом (не входить у денний ліміт)
- `POST /api/telegram/auto-comment/:taskId/replan` — перегенерувати сьогоднішні слоти
- `GET /api/telegram/auto-comment/:taskId/logs`, `GET /api/telegram/accounts/:id/auto-comment/logs` — журнал (надіслано / пропущено / помилка)
- `GET /api/telegram/auto-comment/status` — стан фонового циклу; `POST /api/telegram/accounts/:id/clear-flood-wait` — зняти паузу FLOOD_WAIT

Режими розкладу (`mode`):
- `slots` — щодня `commentsPerDay` коментарів у випадковий час між `activeFrom` і `activeTo` (часовий пояс `timezone`), не частіше ніж раз на `minIntervalMinutes`; у кожен слот коментується найновіший відповідний пост. Слот, прострочений більш ніж на 20 хв, пропускається
- `perPost` — кожен новий пост коментується через випадкові `delayMinMinutes`–`delayMaxMinutes` хв після публікації, у межах вікна і денного ліміту

Правила: один пост коментується акаунтом лише раз, власні пости пропускаються, `targeting.maxPostAgeHours` обмежує вік поста, `onlyNewPosts` бере лише пости після (повторного) увімкнення завдання. Між будь-якими двома автокоментарями одного акаунта пауза `TELEGRAM_AUTOCOMMENT_ACCOUNT_GAP_SEC`. FLOOD_WAIT ставить акаунт на паузу, а постійні помилки (заборона писати, бан, немає доступу) вимикають завдання з поясненням у `lastError`.

#### Автовідповіді в особистих повідомленнях

Акаунт з увімкненим автовідповідачем тримає постійне з'єднання і обробляє вхідні особисті повідомлення так: випадкова затримка (`readDelayMinSec`–`readDelayMaxSec`) → позначка «прочитано» і статус «онлайн» → пауза → «друкує...» стільки, скільки займає набір тексту (`typingCharsPerSec`, у межах `typingMinSec`–`typingMaxSec`) → класифікація за ключовими словами і готова відповідь категорії. Кілька повідомлень, надісланих до прочитання, отримують одну відповідь. Повідомлення, що прийшли, поки сервер був вимкнений, підхоплюються з непрочитаних чатів за останні `catchUpHours` годин.

- `GET/POST /api/telegram/auto-reply/rules` — правила `{ name, category, action: reply|ignore, keywords: [...], excludeKeywords: [...], matchType: contains|exact|regex, matchMode: any|all, replies: [...], priority, oncePerUser, isFallback, accounts: [id...], enabled }`. `accounts` порожній означає всі акаунти
- `PUT/DELETE /api/telegram/auto-reply/rules/:ruleId`
- `POST /api/telegram/auto-reply/test` — `{ text, accountId?, firstName? }` → `{ category, candidates, match }`: категорія повідомлення, усі категорії, що підійшли, і правило, яке відповість, з прикладом відповіді (нічого не надсилається)
- `GET/PUT /api/telegram/accounts/:id/auto-reply` — налаштування акаунта (`enabled`, затримки, швидкість набору, `cooldownMinutes`, `maxRepliesPerUserPerDay`, `replyToBots`, `onlyNonContacts`, `markReadWithoutMatch`, `catchUpHours`) і стан слухача
- `GET /api/telegram/accounts/:id/auto-reply/logs?status=&category=` — журнал: `replied`, `ignored`, `no_match`, `skipped`, `failed`, з категорією кожного повідомлення
- `GET /api/telegram/accounts/:id/auto-reply/stats?days=7` — скільки повідомлень якої категорії прийшло і що з ними сталося
- `GET /api/telegram/auto-reply/status` — стан усіх слухачів

Ключові слова: регістр не важливий, слово шукається цілим, `*` в кінці означає будь-яке закінчення (`цін*` → ціна, ціни, ціну). Перемагає правило з більшим `priority`, далі з більшою кількістю збігів. Якщо жодне не підійшло, спрацьовує правило з `isFallback`. У відповідях: `{name}` — ім'я співрозмовника, `{a|b}` — випадковий варіант, рядок `---` ділить відповідь на кілька повідомлень. Боти (за замовчуванням), видалені акаунти і службовий чат Telegram (коди входу) не обробляються. `cooldownMinutes` і денний ліміт захищають від зациклення з іншими автовідповідачами.

Класифікація: кожне правило відносить повідомлення до категорії (`category`, порожня означає назву правила). `excludeKeywords` виключають категорію (`не шукаю*` для «Пошук роботи»). `action: ignore` лише класифікує: чат читається, відповіді немає (спам, образи). Медіа надходять у правила як `[голосове]`, `[кружечок]`, `[відео]`, `[фотографія]`, `[стікер]`, `[файл]` (з підписом після мітки). Перед порівнянням текст нормалізується: `ё`→`е`, розтягнуті літери стискаються (`приииивіт`), латинські двійники в кириличних словах (`pабота`) замінюються. Готові категорії: `node scripts/seed-auto-reply-rules.js` (оновлює правила з тими самими назвами).

#### Ліміти активності (захист від блокувань)

Усе, що програма надсилає від імені акаунта (автовідповіді, автокоментарі, коментарі вручну) і кожен вступ у чат проходить через квоти акаунта (`services/telegramLimits.js`, лічильник `TelegramActivity`). Telegram не публікує лімітів для звичайних акаунтів, тому стандартні квоти обережні: повідомлень за годину/добу, різних людей і посилань в особистих за добу, повідомлень у чатах (усього, в одному чаті, з посиланнями), вступів за добу/тиждень, пауза між вступами, стеля 450 каналів (Telegram дозволяє 500). Після вступу в чат акаунт `freshChatQuietHours` годин туди не пише, а `freshChatDays` днів пише не більше `freshChatMessagesPerDay`. Перші `warmupDays` днів після додавання акаунта всі квоти зменшені до `warmupPercent`%. Відповіді Telegram: `FLOOD_WAIT_X` ставить на паузу акаунт, `SLOWMODE_WAIT_X` ставить на паузу чат, `PEER_FLOOD` (обмеження за спам) зупиняє надсилання на 24 год (стан варто перевірити в @SpamBot), `FROZEN_*` зупиняє все до ручного зняття.

- `GET/PUT /api/telegram/accounts/:id/limits` — квоти, стандартні значення, використано, стан (`floodWaitUntil`, `spamBlockedUntil`, `frozenAt`); `PUT { reset: true }` повертає стандартні
- `POST /api/telegram/accounts/:id/limits/clear` — `{ what: flood|spam|frozen }`, зняти паузу
- `POST /api/telegram/accounts/:id/join` — `{ chat: "@name" | "https://t.me/name" | "https://t.me/+invite" }` → `{ status: joined|requested|already, chat }`; понад квоту відповідає `429`

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
#   a c o u n t _ e m u l a t o r  
 #   a c o u n t _ e m u l a t o r  
 