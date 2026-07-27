# Следующая сессия

## Текущее состояние

Проект доведён до MVP v1. Основная версия приложения работает на новом VibeCode сервере:

- Server ID: `c576798a-ec5f-4491-b6a2-b28e74fc445f`
- URL: `https://app-2657fd62db74.vibecode.bitrix24.tech`
- Вкладка сделки: `/deal-tab`
- Служебная страница: `/`
- Runtime: `node20`
- Start command: `cd /opt/app && node src/server.js`
- Internal port: `3000`

Не использовать старый сервер:

- `e95ca529-f434-4432-bbb8-a7e0e8f85837`
- `https://app-5670766a17c1.vibecode.bitrix24.tech`

На старом сервере находится другое приложение пользователя.

## Что уже реализовано

- Вкладка `Расчёт оплаты счетов` в карточке сделки Bitrix24.
- Расчёт выставленных, оплаченных, неоплаченных счетов и остатка оплаты.
- Запись итогов в пользовательские поля сделки по кнопке пересчёта.
- Таблица счетов с датой выставления и ответственным.
- Кликабельные счета через внутренний Bitrix24 slider.
- CSV-отчёт для Excel по кнопке `Скачать отчёт`.
- Современный светлый интерфейс с градиентным фоном.
- Увеличенная рабочая область с дополнительными боковыми отступами.
- Защита фронта от ошибки `Unexpected token '<'`, если сервер вернул HTML вместо JSON.

## Важные настройки

Файл `data/settings.json`:

```json
{
  "includeNegativeStages": false,
  "issuedField": "ufCrmInvSumIssued",
  "paidField": "ufCrmInvSumPaid",
  "unpaidField": "ufCrmInvSumUnpaid",
  "remainingField": "ufCrmInvSumRemaining"
}
```

В production env обязательно передавать:

- `NODE_ENV=production`
- `VIBE_API_BASE_URL=https://vibecode.bitrix24.tech`
- `VIBE_API_KEY=<актуальный VibeCode API key>`

Без `VIBE_API_KEY` backend API вернёт ошибку `VIBE_API_KEY is not configured`.

## Команды проверки

```powershell
npm run lint
npm test
```

Ожидаемый результат:

- lint проходит без ошибок;
- `npm test` показывает 18 успешных тестов.

## Что проверено на портале

Тестовая сделка: `ID 2`, название `Тестовая сделка`.

На момент MVP:

- выставлено: `8400`;
- оплачено: `7400`;
- не оплачено: `1000`;
- остаток: `0`;
- всего счетов: `3`;
- в расчёте: `2`;
- пропущено отрицательных: `1`.

## Деплой

Деплой через:

```text
POST /v1/infra/servers/c576798a-ec5f-4491-b6a2-b28e74fc445f/deploy?stream=false
```

Обязательно указывать:

- `displayName: Deal Invoice Summary`
- `description: CRM deal tab that summarizes linked invoice payments and exports a management report.`
- `changelog` при обновлении

Последняя развернутая версия: `v16`.

## Git

Перед пушем:

```powershell
git status --short
npm run lint
npm test
```

После изменений:

```powershell
git add .
git commit -m "Release MVP v1"
git push
```

## Ближайшие улучшения

- Добавить автопересчёт по событиям изменения счетов.
- Подумать над настоящим `.xlsx`, если CSV окажется неудобным для руководства.
- Ограничить служебную страницу настроек по роли пользователя.
- Подготовить Marketplace-описание, скриншоты и политику доступа.
- Проверить установку на втором тестовом портале перед публикацией.
