# Розгортання Treds на новому ПК (Windows)

Покрокова інструкція: що встановити, як підняти всі частини системи й як перенести
дані зі старого ПК. Команди - для PowerShell, якщо не сказано інше.

## Що буде працювати на ПК

| Частина | Порт | Що робить | Як запускається |
| --- | --- | --- | --- |
| MongoDB | 27017 | база даних | служба Windows |
| Backend (Node.js) | 5000 | API, планувальник постів, автовідповіді, Telegram | `svc-backend.bat` |
| Frontend (Vite) | 5173 | інтерфейс CRM у браузері | `svc-frontend.bat` |
| ManyFaces | 8000 | керує Android-емуляторами («телефонами» акаунтів) | `svc-manyfaces.bat` |
| Android-міст (Python) | 8900 | натискає в Threads на телефоні: пости, статистика, особисті, коментарі | `svc-bridge.bat` |

Усе разом запускає `start-all.bat` (кожна частина у своєму вікні) або
`start-all-hidden.ps1` (без вікон, логи в `logs\`).

## 1. Вимоги до ПК

- Windows 10 або 11, 64-біт.
- **Апаратна віртуалізація** для Android-емулятора: увімкнена в BIOS (Intel VT-x / AMD-V)
  і компонент Windows **«Платформа гіпервізора Windows»** (Windows Hypervisor Platform):
  ```powershell
  Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All   # від адміністратора, потім перезавантаження
  ```
- Пам'ять: щонайменше 16 ГБ. Один телефон бере 2 ГБ; система вмикає телефони по одному
  й гасить попередній перед наступним.
- Диск: близько 10 ГБ на Android SDK і ще 4-5 ГБ на кожен телефон-профіль. Закладайте 30+ ГБ.

## 2. Встановити програми

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS          # Node.js 20+ (перевірка: node -v)
winget install MongoDB.Server             # ставиться як служба Windows, слухає 127.0.0.1:27017
winget install MongoDB.DatabaseTools      # mongodump / mongorestore - для перенесення бази
winget install astral-sh.uv               # менеджер Python
```

Після встановлення **закрийте й знову відкрийте PowerShell**, щоб підхопились нові команди.
Потім поставте Python 3.12:

```powershell
uv python install 3.12
```

## 3. Отримати код

```powershell
git clone --recurse-submodules https://github.com/AndreyKutsak/acount_emulator.git C:\treds
cd C:\treds
```

Шлях `C:\treds` не обов'язковий, але скрипти запуску й Планувальник завдань нижче
розраховані на нього. Якщо клонували без `--recurse-submodules`:
`git submodule update --init --recursive` (це підтягне ManyFaces).

## 4. Backend

```powershell
cd C:\treds\backend
npm install
copy .env.example .env
notepad .env
```

У `.env` обов'язково:

- `MONGO_URI=mongodb://127.0.0.1:27017/treds`
- `CREDENTIALS_SECRET` - довгий випадковий рядок. Ним шифруються паролі акаунтів і
  Telegram-сесії. **Якщо переносите базу зі старого ПК, скопіюйте сюди той самий ключ** -
  з іншим ключем збережені паролі не розшифруються. Новий ключ (лише для чистої установки):
  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` - якщо потрібна вкладка «Telegram»
  (беруться на <https://my.telegram.org>, розділ API development tools).
- Блок «Threads через Android-телефони»: на новому ПК залиште `ANDROID_THREADS_PUBLISH=false`,
  доки не перевірите все на кроці 9. Тоді планувальник заповнює пост, але не натискає
  «Опублікувати».

Решта змінних докладно прокоментована в `.env.example`, значення за замовчуванням робочі.

Необов'язково:

```powershell
npx playwright install chromium           # лише для публікації через сайт (без телефонів)
node scripts\seed-comment-topics.js       # бібліотека коментарів для Telegram
node scripts\seed-auto-reply-rules.js     # готові правила автовідповідей Telegram
```

## 5. Frontend

```powershell
cd C:\treds\frontend
npm install
```

## 6. Android-міст

Папка `automation\.venv` у репозиторії прив'язана до Python старого ПК і на новому не
запуститься. Створіть її заново:

```powershell
cd C:\treds\automation
Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
```

Міст шукає `adb` з Android SDK, який ставить ManyFaces (крок 7), за шляхом
`%USERPROFILE%\.antidetect\android\sdk\platform-tools\adb.exe` - це вже прописано в
`svc-bridge.bat` і `start-all.bat`.

## 7. ManyFaces (емулятори)

```powershell
cd C:\treds\backend\ManyFaces
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe run.py
```

Відкрийте <http://127.0.0.1:8000>, створіть профіль з рушієм **Android** і запустіть
**інсталятор в один клік** на екрані налаштування Android. Він завантажить Android SDK,
образ системи, scrcpy і, за потреби, Java (кілька гігабайт, 10-30 хвилин). Скрипти запуску
задають образ `system-images;android-29;google_apis;x86_64`, 2 ГБ пам'яті й 4 ядра
(`svc-manyfaces.bat`). Потім закрийте вікно `run.py` - далі ManyFaces запускатиметься
разом з усім.

## 8. Запуск

**Вручну, з вікнами** (зручно для першої перевірки): двічі клацнути `C:\treds\start-all.bat`.
Відкриються чотири вікна сервісів і за хвилину - <http://localhost:5173> та
<http://127.0.0.1:8900>.

**Автоматично при вході в Windows, без вікон** (як на робочому ПК): зареєструйте завдання
в Планувальнику (PowerShell від імені вашого користувача):

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\treds\start-all-hidden.ps1"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "Treds" -Action $action -Trigger $trigger -Description "Запуск Treds при вході"
```

Зупинити все: `C:\treds\stop-all.bat`. Логи кожної частини: `C:\treds\logs\`.

## 9. Налаштувати телефони й перевірити

1. Інтерфейс <http://localhost:5173>, вкладка **«📘 Інструкція»**, розділ «Перше налаштування»:
   для кожного акаунта створити або перенести профіль-телефон, встановити Threads
   (APK під `x86_64`), увійти в акаунт і прив'язати профіль до акаунта у вкладці «Акаунти».
2. Під час першого підключення до телефона міст сам встановить на нього службовий
   застосунок uiautomator2 і клавіатуру для введення тексту - це нормально.
3. Створіть тестовий пост із запланованим часом через 2-3 хвилини. При
   `ANDROID_THREADS_PUBLISH=false` у `logs\bridge.log` має з'явитися `dry run done`, а телефон
   покаже заповнений, але не опублікований пост.
4. Якщо все гаразд, поставте `ANDROID_THREADS_PUBLISH=true` у `backend\.env`. Backend сам
   перезапуститься (nodemon).

Контрольні адреси:

- <http://localhost:5000/api/health> → `{"status":"ok"}`
- <http://127.0.0.1:8900/health> → `{"ok":true,...}`
- <http://127.0.0.1:8000> → інтерфейс ManyFaces

## 10. Перенесення даних зі старого ПК

Спершу на **старому** ПК зупиніть усе (`stop-all.bat`), щоб файли не змінювались під час
копіювання.

| Що | Звідки (старий ПК) | Як перенести |
| --- | --- | --- |
| База (пости, акаунти, правила, журнали) | MongoDB `treds` | `mongodump --db treds --out D:\treds-backup` → на новому `mongorestore --db treds D:\treds-backup\treds` |
| Ключ шифрування і налаштування | `backend\.env` | скопіювати файл; `CREDENTIALS_SECRET` має бути той самий |
| Телефони з виконаним входом у Threads | `%USERPROFILE%\.antidetect\` (профілі ManyFaces і `android\avd`, 10+ ГБ) | скопіювати всю папку в `%USERPROFILE%\.antidetect\` нового ПК. Без цього доведеться створити телефони й увійти в Threads заново |
| Профілі маскування телефонів | `automation\device_profiles.json` (якщо є) | скопіювати файл |
| Фото постів | `backend\uploads\posts\` | скопіювати папку |
| Браузерні профілі (публікація через сайт) | `backend\profiles\` | скопіювати папку, якщо користуєтесь веб-публікацією |
| Завантажені APK і медіа | `backend\storage\` | необов'язково |

Якщо ім'я користувача Windows на новому ПК інше, шляхи всередині профілів ManyFaces можуть
вказувати на стару папку. Тоді простіше створити телефони заново й увійти в Threads.

## 11. Доступ з телефона

За замовчуванням інтерфейс відкривається лише на самому ПК (`localhost`). Пароля в
системі немає, тому **не відкривайте її для всієї Wi-Fi-мережі чи інтернету**. Для
доступу з телефона потрібен захищений канал (наприклад, приватна мережа на кшталт
Tailscale з входом лише ваших пристроїв); це налаштовується окремо.

## Типові проблеми

- **Backend не стартує, `MongooseServerSelectionError`** - не працює MongoDB. Перевірте
  службу: `Get-Service MongoDB`, запустіть `Start-Service MongoDB`.
- **Емулятор не запускається / чорний екран** - не увімкнена віртуалізація (крок 1) або
  бракує пам'яті. Закрийте зайві програми, перевірте Hypervisor Platform.
- **`INSTALL_FAILED_NO_MATCHING_ABIS` при встановленні Threads** - потрібен APK під `x86_64`.
- **Міст: `device emulator-5554 не підключений`** - телефон ще не запущений; запустіть
  профіль у вкладці «Огляд» або дочекайтесь, поки планувальник підніме його сам.
- **`python` / `uv` не знайдено** - перевідкрийте PowerShell після встановлення (крок 2).
- **Порт уже зайнятий** - скрипти не запускають другий екземпляр сервісу; якщо сервіс
  «завис», `stop-all.bat` і запуск знову.
