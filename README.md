# Deal Invoice Summary

Первая MVP-версия приложения для Bitrix24/VibeCode. Приложение добавляет во вкладку карточки сделки отчёт `Расчёт оплаты счетов`: считает суммы счетов, привязанных к сделке, показывает структуру оплаты и при необходимости записывает итоги в пользовательские поля сделки.

## Веб-окружение

- Портал тестирования: `https://vibecode01.bitrix24.ru`
- Сервер VibeCode: `c576798a-ec5f-4491-b6a2-b28e74fc445f`
- URL приложения: `https://app-2657fd62db74.vibecode.bitrix24.tech`
- Основная вкладка сделки: `https://app-2657fd62db74.vibecode.bitrix24.tech/deal-tab`
- Служебная страница настроек: `https://app-2657fd62db74.vibecode.bitrix24.tech/`
- Порт приложения внутри сервера: `3000`
- Рантайм: `node20`

Старый сервер `e95ca529-f434-4432-bbb8-a7e0e8f85837` не используется для этого приложения.

## Функциональность MVP

- Вкладка `Расчёт оплаты счетов` в карточке сделки Bitrix24.
- Автоматическое определение ID сделки из query-параметров и placement options.
- Получение сделки и связанных счетов через VibeCode REST proxy.
- Расчёт:
  - выставлено по счетам;
  - оплачено;
  - не оплачено;
  - остаток оплаты по сумме сделки;
  - всего счетов;
  - счетов в расчёте;
  - пропущенных счетов в отрицательных стадиях.
- Исключение отрицательных стадий счетов из расчёта по умолчанию.
- Кнопка пересчёта, которая записывает итоги в поля сделки.
- Кликабельные счета в таблице: карточка счета открывается во внутреннем окне Bitrix24 через `BX24.openPath`.
- Таблица счетов показывает номер, стадию, дату выставления, ответственного и сумму.
- Кнопка `Скачать отчёт` выгружает Excel-friendly CSV с BOM и разделителем `;`.
- Служебная страница позволяет создать стандартные поля и настроить маппинг.

## Пользовательские поля сделки

Приложение использует стандартный набор полей:

- `ufCrmInvSumIssued` — сумма выставленных счетов.
- `ufCrmInvSumPaid` — сумма оплаченных счетов.
- `ufCrmInvSumUnpaid` — сумма неоплаченных счетов.
- `ufCrmInvSumRemaining` — остаток оплаты по счетам.

Настройки хранятся в `data/settings.json`. В production эти значения попадают в архив деплоя и используются сервером приложения.

## Архитектура

Проект сделан без внешних npm-зависимостей, чтобы приложение оставалось лёгким и экономным по ресурсам.

- `src/server.js` — нативный Node.js HTTP-сервер, статические файлы и API.
- `src/vibeClient.js` — REST-клиент VibeCode с `X-Api-Key`, JSON-парсингом и retry на сетевых ошибках.
- `src/summary.js` — чистая логика расчёта счетов.
- `public/deal-tab.html` и `public/deal-tab.js` — интерфейс вкладки сделки.
- `public/index.html` и `public/app.js` — служебная страница настроек.
- `public/styles.css` — общий стиль приложения.
- `deal-invoice-summary-icon.svg` — SVG-иконка приложения.

API приложения:

- `GET /api/health` — healthcheck.
- `GET /api/bootstrap` — настройки, доступные поля сделки и сведения о портале.
- `POST /api/settings` — сохранение маппинга полей.
- `POST /api/fields/ensure` — создание стандартных пользовательских полей.
- `GET /api/deal-summary?dealId=ID` — расчёт без записи в сделку.
- `POST /api/recalculate/deal` — расчёт и запись итогов в поля сделки.
- `GET /api/deal-report?dealId=ID` — скачивание CSV-отчёта.
- `POST /api/recalculate/recent` — пересчёт сделок со счетами за последние 30 дней.

## Принцип расчёта

Счета выбираются по `parentId2 = dealId`. Сумма счета берётся из `opportunity`.

Стадии классифицируются так:

- оплаченные: семантика `S`/`SUCCESS` или stage suffix `P`;
- отрицательные: семантика `F`/`FAILURE` или stage suffix `D`;
- остальные считаются неоплаченными.

По умолчанию отрицательные стадии пропускаются. Если включить `includeNegativeStages`, отрицательные счета попадут в неоплаченные.

Остаток считается как:

```text
remaining = dealAmount - paid
```

## Локальный запуск

```powershell
$env:VIBE_API_KEY="vibe_api_..."
$env:VIBE_API_BASE_URL="https://vibecode.bitrix24.tech"
npm start
```

По умолчанию сервер слушает `PORT=3000`.

## Тесты

Команды:

```powershell
npm run lint
npm test
```

Покрытие MVP:

- `src/summary.test.js` — расчёт итогов, исключение отрицательных стадий, формирование patch для полей сделки.
- `src/server.test.js` — нормализация ID сделки, список доступных полей, названия стадий, группы расчёта, CSV-отчёт, healthcheck и отдача вкладки.
- `src/vibeClient.test.js` — заголовок API-ключа, JSON body, отсутствие ключа, ошибки платформы, невалидный JSON, query string.
- `public/deal-tab.test.js` — наличие ключевых блоков вкладки, кнопки отчёта, кликабельных счетов через Bitrix24 slider, защита от HTML вместо JSON, CSS-компоновка.
- `public/app.test.js` — элементы страницы настроек и защита API-клиента от не-JSON ответов.

Текущий полный прогон: `18` тестов, все проходят.

## Деплой

Деплой выполняется через VibeCode Deploy API на сервер:

```text
POST /v1/infra/servers/c576798a-ec5f-4491-b6a2-b28e74fc445f/deploy
```

Тело деплоя использует:

- `runtime: node20`
- `install: cd /opt/app && npm install --omit=dev`
- `start: cd /opt/app && node src/server.js`
- `port: 3000`
- `displayName: Deal Invoice Summary`
- `description: CRM deal tab that summarizes linked invoice payments and exports a management report.`
- `changelog` для каждого обновления

В production env обязательны:

- `NODE_ENV=production`
- `VIBE_API_BASE_URL=https://vibecode.bitrix24.tech`
- `VIBE_API_KEY=<ключ VibeCode>`

## Статус MVP v1

MVP v1 готов для тестовой эксплуатации на портале `vibecode01.bitrix24.ru`. Основной сценарий проверен на сделке `2`: три счёта, один оплаченный, один новый, один отрицательный; итоговые суммы считаются корректно.
