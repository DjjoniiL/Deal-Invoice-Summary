import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

// Правило проекта: при добавлении новой сложной функции Marketplace runtime
// добавлять сюда отдельный тест с понятным описанием проверяемого поведения.
// Название test(...) должно объяснять функциональный блок и пользовательский риск.

const runtimeVersion = "layout-20260826-2";
const appVersionPattern = /Deal Invoice Summary v\.36 Marketplace B24/;
const runtimeFiles = [
  "install.html",
  "install.js",
  "install.css",
  "index.html",
  "app.js",
  "style.css",
  "settings.html",
  "settings.js",
  "worker.html",
  "worker.js",
  "worker-error.html",
];
const textFiles = Object.fromEntries(await Promise.all(
  runtimeFiles.map(async (fileName) => [fileName, await readFile(new URL(`./${fileName}`, import.meta.url), "utf8")]),
));
const marketplaceFiles = await readdir(new URL(".", import.meta.url));

function assertAllMatch(source, patterns, context) {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${context}: expected ${pattern}`);
  }
}

function assertAllDoNotMatch(source, patterns, context) {
  for (const pattern of patterns) {
    assert.doesNotMatch(source, pattern, `${context}: forbidden ${pattern}`);
  }
}

test("archive manifest: содержит только статические runtime-файлы и тесты вне архива", () => {
  for (const fileName of runtimeFiles) assert.ok(marketplaceFiles.includes(fileName), `${fileName} must exist`);
  assert.ok(marketplaceFiles.includes("marketplace.test.js"));
  assert.ok(marketplaceFiles.includes("marketplace-runtime.test.js"));
  const nonRuntimeFiles = marketplaceFiles.filter((fileName) => !runtimeFiles.includes(fileName));
  assert.deepEqual(nonRuntimeFiles.sort(), ["marketplace-runtime.test.js", "marketplace.test.js"]);
});

test("archive hygiene: runtime-файлы не содержат backend URL, API keys, OAuth secrets, node_modules или документацию", () => {
  const forbidden = [
    /vibe_api_[A-Za-z0-9_]+/,
    /VIBE_API_KEY/,
    /client_secret/i,
    /oauth.*secret/i,
    /node_modules/,
    /README\.md/,
    /PROJECT_SPECIFICATION\.md/,
    /NEXT_SESSION\.md/,
    /MARKETPLACE_MIGRATION_PLAN\.md/,
    /marketplace\.test\.js/,
    /marketplace-runtime\.test\.js/,
    /src\/server\.js/,
    /\/api\/recalculate/,
    /\/api\/automation/,
  ];
  for (const fileName of runtimeFiles) assertAllDoNotMatch(textFiles[fileName], forbidden, fileName);
});

test("versioning: runtime/cache marker синхронизирован во всех entry-файлах", () => {
  assertAllMatch(textFiles["index.html"], [new RegExp(`style\\.css\\?v=${runtimeVersion}`), new RegExp(`app\\.js\\?v=${runtimeVersion}`), appVersionPattern], "index.html");
  assertAllMatch(textFiles["settings.html"], [new RegExp(`style\\.css\\?v=${runtimeVersion}`), new RegExp(`settings\\.js\\?v=${runtimeVersion}`), appVersionPattern], "settings.html");
  assertAllMatch(textFiles["worker.html"], [new RegExp(`worker\\.js\\?v=${runtimeVersion}`)], "worker.html");
  assertAllMatch(textFiles["app.js"], [new RegExp(`runtimeVersion = "${runtimeVersion}"`), appVersionPattern], "app.js");
  assertAllMatch(textFiles["settings.js"], [new RegExp(`runtimeVersion = "${runtimeVersion}"`), appVersionPattern], "settings.js");
  assertAllMatch(textFiles["worker.js"], [new RegExp(`runtimeVersion = "${runtimeVersion}"`), appVersionPattern], "worker.js");
  assertAllMatch(textFiles["install.js"], [new RegExp(`RUNTIME_VERSION = "${runtimeVersion}"`), appVersionPattern], "install.js");
});

test("install.html: экран установки подключает только Bitrix24 SDK, install.css и install.js", () => {
  assertAllMatch(textFiles["install.html"], [
    /<link rel="stylesheet" href="install\.css">/,
    /<script src="\/\/api\.bitrix24\.com\/api\/v1\/"><\/script>/,
    /<script src="install\.js"><\/script>/,
    /id="status"/,
    /id="installButton"/,
    /id="log" hidden/,
  ], "install.html");
  assertAllDoNotMatch(textFiles["install.html"], [/app\.js/, /settings\.js/, /worker\.js/, /loader_9_no7zeu\.js/], "install.html");
});

test("install.js: installer завершает установку только после BX24.init и пользовательской кнопки", () => {
  assertAllMatch(textFiles["install.js"], [
    /if \(!window\.BX24\)/,
    /BX24\.init\(\(\) => \{/,
    /installButton\.addEventListener\("click"/,
    /installButton\.disabled = true/,
    /BX24\.installFinish\(\)/,
    /installFinish выполнен успешно/,
  ], "install.js");
});

test("install.js: installer очищает старые LEFT_MENU runtime-привязки и не создаёт новый LEFT_MENU", () => {
  assertAllMatch(textFiles["install.js"], [
    /unbindPlacementAll\("LEFT_MENU", 10\)/,
    /left-menu-cleanup/,
    /основной пункт создаётся настройкой версии Marketplace/,
    /skippedBind: true/,
  ], "install.js");
  assertAllDoNotMatch(textFiles["install.js"], [/PLACEMENT:\s*"LEFT_MENU"/, /bindPlacement\("LEFT_MENU"/], "install.js");
});

test("install.js: installer регистрирует PAGE_BACKGROUND_WORKER с errorHandlerUrl и обработкой лимита placement", () => {
  assertAllMatch(textFiles["install.js"], [
    /PAGE_BACKGROUND_WORKER/,
    /worker\.html/,
    /worker-error\.html/,
    /errorHandlerUrl/,
    /isPlacementMaxCountError/,
    /ERROR_PLACEMENT_MAX_COUNT/,
    /Placement max count/,
    /await unbindPlacementAll\(placement\)/,
  ], "install.js");
});

test("install.js: installer создаёт стандартные поля и сохраняет дефолтное сопоставление", () => {
  assertAllMatch(textFiles["install.js"], [
    /STANDARD_FIELDS = \[/,
    /INV_SUM_ISSUED/,
    /INV_SUM_PAID/,
    /INV_SUM_UNPAID/,
    /INV_SUM_REMAINING/,
    /crm\.deal\.userfield\.list/,
    /crm\.deal\.userfield\.add/,
    /crm\.deal\.userfield\.update/,
    /dealInvoiceSummarySettings: JSON\.stringify\(DEFAULT_SETTINGS\)/,
    /\[DEFAULT_SETUP_VERSION_OPTION\]: RUNTIME_VERSION/,
  ], "install.js");
});

test("install.js: installer добавляет раздел карточки сделки во все доступные воронки", () => {
  assertAllMatch(textFiles["install.js"], [
    /crm\.category\.list/,
    /\[\{ id: 0, name: "Основная" \}, \.\.\.categories\]/,
    /configureDealCardSection/,
    /crm\.deal\.details\.configuration\.get/,
    /crm\.deal\.details\.configuration\.set/,
    /crm\.item\.details\.configuration\.get/,
    /crm\.item\.details\.configuration\.set/,
    /extras = \{ dealCategoryId: category\.id \}/,
    /createdFromDefaultLayout/,
    /isEmptyCardLayoutError/,
  ], "install.js");
});

test("install.js: installer ведёт накопительный журнал с паузами для ручной диагностики", () => {
  assertAllMatch(textFiles["install.js"], [
    /INSTALL_STEP_DELAY_MS = 2500/,
    /toLocaleString\("ru-RU"/,
    /logNode\.textContent \+=/,
    /logNode\.hidden = false/,
    /logNode\.scrollTop = logNode\.scrollHeight/,
    /await wait\(INSTALL_STEP_DELAY_MS\)/,
  ], "install.js");
});

test("index.html: основной экран содержит утверждённые рабочие блоки без лендинга", () => {
  assertAllMatch(textFiles["index.html"], [
    /class="shell menu-shell"/,
    /Расчёт оплаты счетов/,
    /notice-panel/,
    /Сопоставление полей сделки/,
    /Массовый пересчёт сделок/,
    /Ручная проверка/,
    /marketplace-report/,
    /invoiceList/,
    /Журнал логирования/,
  ], "index.html");
});

test("index.html: блок сопоставления содержит четыре поля, checkbox отрицательных стадий и переход в настройки", () => {
  assertAllMatch(textFiles["index.html"], [
    /name="issuedField"/,
    /name="paidField"/,
    /name="unpaidField"/,
    /name="remainingField"/,
    /name="includeNegativeStages"/,
    /Создать автоматически/,
    /Сохранить сопоставление/,
    /id="openAppSettings"/,
    /Настройки приложения/,
  ], "index.html");
});

test("index.html: массовый расчёт имеет период 1/3/6 мес, подтверждение, прогресс, статистику и ручное скачивание CSV", () => {
  assertAllMatch(textFiles["index.html"], [
    /id="autoRecalcWindowDays"/,
    /<option value="30" selected>1 мес<\/option>/,
    /<option value="90">3 мес<\/option>/,
    /<option value="180">6 мес<\/option>/,
    /id="windowConfirmModal"/,
    /id="automationProgress"/,
    /id="automationElapsed"/,
    /id="windowStatsButton"/,
    /id="windowReportModal"/,
    /id="downloadWindowReport"/,
  ], "index.html");
});

test("index.html: статистика сделок использует canvas-диаграмму и кликабельные бизнес-группы", () => {
  assertAllMatch(textFiles["index.html"], [
    /id="windowStatsChart" class="donut-chart" width="704" height="704"/,
    /Завершено сделок/,
    /Сделок ожидают доплаты/,
    /Сделок без счетов/,
    /id="statsPaidAmount"/,
    /id="statsUnpaidAmount"/,
    /id="statsEmptyAmount"/,
    /id="invoiceAnalyticsTitle"/,
  ], "index.html");
  assertAllDoNotMatch(textFiles["index.html"], [/legend-error/, /statsErrorPercent/], "index.html");
});

test("index.html: страница не грузит виджет открытой линии напрямую, чтобы не ломать главный экран", () => {
  assertAllDoNotMatch(textFiles["index.html"], [/loader_9_no7zeu\.js/, /cdn-ru\.bitrix24\.ru\/b31051\/crm\/site_button/], "index.html");
  assertAllMatch(textFiles["index.html"], [/notice-action/, /Обратиться/], "index.html");
});

test("settings.html: страница настроек содержит выбор воронки, периода, checkbox счетов периода и справку", () => {
  assertAllMatch(textFiles["settings.html"], [
    /id="calculationCategoryId"/,
    /Все воронки/,
    /id="autoRecalcWindowDaysSetting"/,
    /id="includeInvoiceWindowDeals"/,
    /сделки прошлых периодов/,
    /id="windowPeriodHelp"/,
    /id="periodHelpModal"/,
    /дата создания сделки/,
    /дате выставления счёта/,
  ], "settings.html");
});

test("settings.html: только страница настроек подключает виджет открытой линии", () => {
  assertAllMatch(textFiles["settings.html"], [
    /loader_9_no7zeu\.js/,
    /cdn-ru\.bitrix24\.ru\/b31051\/crm\/site_button/,
  ], "settings.html");
});

test("settings.js: настройки пользователя сохраняются локально без app.option.set для пользовательского выбора", () => {
  assertAllMatch(textFiles["settings.js"], [
    /dealInvoiceSummaryUserCalculationSettings/,
    /localStorage\.getItem\(userCalculationSettingsOption\)/,
    /localStorage\.setItem\(userCalculationSettingsOption, payload\)/,
    /calculationCategoryId: settings\.calculationCategoryId/,
    /autoRecalcWindowDays: normalizeWindowDays/,
    /includeInvoiceWindowDeals/,
    /Настройки сохранены для этого пользователя/,
  ], "settings.js");
  assertAllDoNotMatch(textFiles["settings.js"], [/dealInvoiceSummarySettings: payload/], "settings.js");
});

test("settings.js: список воронок читается из app.option cache и обновляется через crm.category.list", () => {
  assertAllMatch(textFiles["settings.js"], [
    /dealInvoiceSummaryDealCategories/,
    /app\.option\.get/,
    /crm\.category\.list/,
    /entityTypeId: 2/,
    /\[\{ id: 0, name: "Основная" \}, \.\.\.categories\]/,
    /app\.option\.set/,
    /Employees can still use the fresh list/,
    /renderCategories/,
  ], "settings.js");
});

test("settings.js: автозапуск открытой линии использует API, DOM fallback, pointer/mouse события и повторные попытки", () => {
  assertAllMatch(textFiles["settings.js"], [
    /function tryOpenLineApi/,
    /B24Chat/,
    /SiteButton/,
    /Bitrix24WidgetObject/,
    /chatOpenDetected/,
    /function isOpenLineVisible/,
    /function markChatOpen/,
    /function watchOpenLineState/,
    /MutationObserver/,
    /function clickOpenLineTarget/,
    /scrollIntoView/,
    /PointerEvent/,
    /MouseEvent\("mousedown"/,
    /scheduleOpenLineRetry\(attempt \+ 1, 500\)/,
    /attempt < 60/,
    /window\.addEventListener\("load"/,
    /visibilitychange/,
  ], "settings.js");
});

test("app.js: REST wrapper и pagination не завязаны на backend", () => {
  assertAllMatch(textFiles["app.js"], [
    /function callMethod\(method, params = \{\}\)/,
    /BX24\.callMethod/,
    /result\.error\(\)/,
    /async function callList/,
    /start = response\.next/,
    /listRows/,
  ], "app.js");
  assertAllDoNotMatch(textFiles["app.js"], [/fetch\(/, /XMLHttpRequest/, /vibecode\.bitrix24\.tech/], "app.js");
});

test("app.js: настройки приложения читаются из app.option с localStorage fallback", () => {
  assertAllMatch(textFiles["app.js"], [
    /dealInvoiceSummarySettings/,
    /app\.option\.get/,
    /app\.option\.set/,
    /parseSettingsObject/,
    /return localStorage\.getItem\(option\)/,
    /localStorage\.setItem\("dealInvoiceSummarySettings"/,
    /defaultSettings/,
  ], "app.js");
});

test("app.js: права администрирования ограничивают создание полей и сохранение сопоставления", () => {
  assertAllMatch(textFiles["app.js"], [
    /function canManageCrmSettings/,
    /callMethod\("user\.admin"\)/,
    /window\.BX24\?\.isAdmin/,
    /function setMappingAccess/,
    /CRM admin rights required/,
    /Сопоставление доступно только администратору/,
    /Создание полей доступно только администратору/,
    /form\.addEventListener\("submit"/,
    /#ensureFields/,
  ], "app.js");
});

test("app.js: user.get используется только для ФИО, совместимого с user_brief", () => {
  assertAllMatch(textFiles["app.js"], [
    /callList\("user\.get"/,
    /function userDisplayName/,
    /LAST_NAME/,
    /SECOND_NAME/,
  ], "app.js");
  assertAllDoNotMatch(textFiles["app.js"], [/EMAIL/, /LOGIN/, /user\.userfield/], "app.js");
});

test("документация фиксирует user_brief как единственный пользовательский скоуп", async () => {
  const docs = (await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../PROJECT_SPECIFICATION.md", import.meta.url), "utf8"),
    readFile(new URL("../NEXT_SESSION.md", import.meta.url), "utf8"),
    readFile(new URL("../Next_PROMT.md", import.meta.url), "utf8"),
  ])).join("\n");
  assert.match(docs, /Пользователи \(минимальный\).*user_brief/);
  assert.doesNotMatch(docs, /должна запрашивать пользовательский скоуп `Пользователи \(базовый\).*user_basic/);
  assert.doesNotMatch(docs, /пользовательский скоуп указывать как `Пользователи \(базовый\).*user_basic/);
  assert.doesNotMatch(docs, /минимальный набор прав: CRM, Встраивание приложений, Базовый/);
  assert.match(docs, /отдельн(?:ый|ого).*basic.*не (?:выбирается|указывается)/i);
  assert.match(docs, /app\.option\.get\/app\.option\.set и user\.admin/);
});

test("app.js: создание стандартных полей использует человекочитаемые подписи и не показывает UF-коды как label", () => {
  assertAllMatch(textFiles["app.js"], [
    /defaultFieldLabels/,
    /Сумма выставленных счетов/,
    /Сумма оплаченных счетов/,
    /Сумма неоплаченных счетов/,
    /Остаток оплаты сделки/,
    /LANG_EDIT_FORM_LABEL/,
    /function localizedLabel/,
    /function firstHumanLabel/,
    /function isSymbolicFieldLabel/,
    /function uniqueHumanLabel/,
    /Поле сделки \$\{index \+ 1\}/,
  ], "app.js");
});

test("app.js: карточка сделки обновляется по всем воронкам и умеет создавать безопасный layout fallback", () => {
  assertAllMatch(textFiles["app.js"], [
    /dealSummarySectionName/,
    /dealSummarySectionTitle/,
    /function defaultDealCardLayout/,
    /function mergeDealSummarySection/,
    /function configureDealCardSection/,
    /crm\.deal\.details\.configuration\.get/,
    /crm\.deal\.details\.configuration\.set/,
    /crm\.item\.details\.configuration\.get/,
    /crm\.item\.details\.configuration\.set/,
    /isEmptyCardLayoutError/,
    /createdFromDefaultLayout/,
    /updatedCategories/,
  ], "app.js");
});

test("app.js: расчёт сделки учитывает суммы, оплаченные/неоплаченные стадии и пустые поля как требующие записи нуля", () => {
  assertAllMatch(textFiles["app.js"], [
    /function money/,
    /function statusSemantic/,
    /suffix === "P"/,
    /suffix === "D"/,
    /function summarize/,
    /issued \+= amount/,
    /paid \+= amount/,
    /unpaid \+= amount/,
    /remaining: money\(dealAmount - paid\)/,
    /function isBlankCrmValue/,
    /isBlankCrmValue\(deal\[field\]\) \|\| !sameMoneyValue\(deal\[field\], value\)/,
  ], "app.js");
});

test("app.js: ручной пересчёт принимает ID или ссылку, обновляет поля и refresh карточки без лишних записей", () => {
  assertAllMatch(textFiles["app.js"], [
    /function dealIdFromText/,
    /\/crm\\\/deal\\\/details/,
    /dealForm\.addEventListener\("submit"/,
    /await recalculate\(dealId, true/,
    /function buildChangedDealFields/,
    /Object\.keys\(fields\)\.length/,
    /skippedUpdate = true/,
    /function refreshDealCard/,
    /BX24\.placement\.call\("reloadData"/,
    /reloadData unavailable/,
  ], "app.js");
});

test("app.js: вкладка открытой сделки запускает onOpen расчёт и мониторит сохранённые изменения", () => {
  assertAllMatch(textFiles["app.js"], [
    /function dealIdFromContext/,
    /PLACEMENT_OPTIONS/,
    /const writeOnOpen = automationMode\.value === "onOpen"/,
    /await recalculate\(contextDealId, writeOnOpen, \{ refreshCard: writeOnOpen \}\)/,
    /startContextDealMonitor\(contextDealId, result\.deal\)/,
    /function checkContextDealChanges/,
    /contextDealMonitorIntervalMs = 5000/,
    /setInterval\(checkContextDealChanges, contextDealMonitorIntervalMs\)/,
    /window\.addEventListener\("focus", checkContextDealChanges\)/,
    /document\.addEventListener\("visibilitychange", checkContextDealChanges\)/,
    /BX24\.placement\.bindEvent/,
  ], "app.js");
});

test("app.js: загрузка счетов выбирает smart invoices, стадии и ответственных", () => {
  assertAllMatch(textFiles["app.js"], [
    /crm\.item\.list/,
    /entityTypeId: 31/,
    /parentId2: Number\(dealId\)/,
    /loadInvoiceStages\(invoices\.map\(invoiceStageId\)\)/,
    /crm\.item\.stage\.list/,
    /crm\.status\.list/,
    /crm\.status\.entity\.types/,
    /SMART_INVOICE_STAGE_/,
    /DYNAMIC_31_STAGE_/,
    /loadUsers\(invoices\.map\(invoiceAssignedById\)\)/,
    /user\.get/,
  ], "app.js");
});

test("app.js: таблица счетов и CSV сохраняют финальный порядок колонок и формат дат", () => {
  assertAllMatch(textFiles["app.js"], [
    /invoice-header/,
    /<span>Счёт<\/span>/,
    /<span>Срок оплаты<\/span>/,
    /<span>Ответственный<\/span>/,
    /<span>Сумма<\/span>/,
    /<span>Стадия<\/span>/,
    /<span>Дата выставления<\/span>/,
    /row\.append\(title, datePay, assignee, amount, stage, dateIssued\)/,
    /function formatDateOnly/,
    /\$\{isoDate\[3\]\}\.\$\{isoDate\[2\]\}\.\$\{isoDate\[1\]\}/,
    /deal-\$\{currentReport\.dealId\}-invoice-summary\.csv/,
  ], "app.js");
});

test("app.js: массовый расчёт ищет сделки по DATE_CREATE/BEGINDATE и дополнительно по счетам периода", () => {
  assertAllMatch(textFiles["app.js"], [
    /function getRecentDeals/,
    /for \(const fieldName of \["DATE_CREATE", "BEGINDATE"\]\)/,
    /\[`>=\$\{fieldName\}`\]: since/,
    /function getRecentInvoiceDealIds/,
    /function emptyRecentInvoiceWindow/,
    /currentSettings\.includeInvoiceWindowDeals \? getRecentInvoiceDealIds\(days\) : emptyRecentInvoiceWindow\(days\)/,
    /function filterDealIdsByCategory/,
    /filter: \{ ID: ids, CATEGORY_ID: selectedCategory \}/,
    /recent\.dealIds = \[\.\.\.new Set/,
  ], "app.js");
});

test("app.js: массовый расчёт подтверждается, показывает прогресс, время обработки и сохраняет последний запуск", () => {
  assertAllMatch(textFiles["app.js"], [
    /function showWindowConfirmModal/,
    /estimateCalculationSeconds/,
    /const secondsPerDeal = 10/,
    /function setAutomationProgress/,
    /function startAutomationElapsed/,
    /function finishAutomationElapsed/,
    /function saveAutomationLastRun/,
    /function restoreAutomationLastRun/,
    /dealInvoiceSummaryAutomationLastRun/,
    /localStorage\.setItem\(automationLastRunOption, value\)/,
    /restoreAutomationLastRun\(\)/,
  ], "app.js");
});

test("app.js: массовый CSV содержит тип воронки, стадию сделки и скачивается только по кнопке", () => {
  assertAllMatch(textFiles["app.js"], [
    /function downloadWindowReport/,
    /Тип воронки/,
    /Стадия сделки/,
    /dealCategoryName\(item\.deal\)/,
    /dealStageName\(item\.deal\)/,
    /deal-invoice-window-\$\{source\.days\}-days\.csv/,
    /downloadWindowReportButton\.addEventListener\("click"/,
  ], "app.js");
  assertAllDoNotMatch(textFiles["app.js"], [/CSV-отчёт сформирован автоматически/], "app.js");
});

test("app.js: статистика периода группирует сделки по семантике, рисует donut chart и открывает список по ID/STAGE_ID/semantic", () => {
  assertAllMatch(textFiles["app.js"], [
    /function buildWindowSummary/,
    /const dealSemantic = dealSemanticFromResult\(item\)/,
    /if \(!invoiceCount\) group = "empty"/,
    /acc\.dealIds\[group\]\.push\(Number\(item\.dealId\)\)/,
    /acc\.stageIds\[group\]\.push\(stageId\)/,
    /function renderDealStatusChart/,
    /function drawDealStatusChart/,
    /windowStatsChart\.getContext\("2d"\)/,
    /function dealListPathForStatsSlice/,
    /FILTER\[ID\]/,
    /FILTER\[STAGE_ID\]/,
    /FILTER\[STAGE_SEMANTIC_ID\]/,
    /BX24\.openPath\(path\)/,
  ], "app.js");
});

test("app.js: режимы серверной версии остаются только заявкой без backend-запуска", () => {
  assertAllMatch(textFiles["app.js"], [
    /const serverOnlyModes = \["continuous", "twiceDaily"\]/,
    /function showServerSupportModal/,
    /function requestServerSupportAction/,
    /serverSupportModeDetails/,
    /dealInvoiceSummaryServerSupport/,
    /openSupportSettingsChat/,
    /marketplaceFileUrl\(settingsPageFileName, \{ openChat: "1" \}\)/,
  ], "app.js");
  assertAllDoNotMatch(textFiles["app.js"], [/setInterval\(.*twiceDaily/, /setInterval\(.*continuous/, /Beget/i], "app.js");
});

test("worker.html: background worker entrypoint минимален и грузит только SDK и worker.js", () => {
  assertAllMatch(textFiles["worker.html"], [
    /Deal Invoice Summary Background Worker/,
    /api\.bitrix24\.com\/api\/v1/,
    new RegExp(`worker\\.js\\?v=${runtimeVersion}`),
  ], "worker.html");
  assertAllDoNotMatch(textFiles["worker.html"], [/style\.css/, /app\.js/, /settings\.js/, /loader_9_no7zeu\.js/], "worker.html");
});

test("worker-error.html: error handler безопасно возвращает OK без логики и секретов", () => {
  assertAllMatch(textFiles["worker-error.html"], [/OK/, /Deal Invoice Summary Background Worker Status/], "worker-error.html");
  assertAllDoNotMatch(textFiles["worker-error.html"], [/script/i, /vibe_api_/, /BX24\.callMethod/], "worker-error.html");
});

test("worker.js: worker определяет контекст сделки из placement.info, query и URI", () => {
  assertAllMatch(textFiles["worker.js"], [
    /PAGE_BACKGROUND_WORKER/,
    /currentPlacementContext/,
    /BX24\?\.placement\?\.info/,
    /PLACEMENT_OPTIONS/,
    /placement_options/,
    /options\.URI \|\| options\.uri \|\| document\.referrer/,
    /function refreshActiveContext/,
    /function dealIdFromUri/,
    /\/crm\\\/deal\\\/details/,
    /\/crm\\\/deal\\\/show/,
  ], "worker.js");
});

test("worker.js: worker пересчитывает открытую сделку по сохранённым OPPORTUNITY/STAGE_ID", () => {
  assertAllMatch(textFiles["worker.js"], [
    /workerPollIntervalMs = 5000/,
    /function checkDeal/,
    /crm\.deal\.get/,
    /dealChangeSnapshot/,
    /OPPORTUNITY \?\? deal\.opportunity/,
    /STAGE_ID \|\| deal\.stageId/,
    /sameDealChangeSnapshot/,
    /background-open-recalculate/,
    /background-deal-change-recalculate/,
    /crm\.item\.list/,
    /crm\.deal\.update/,
  ], "worker.js");
});

test("worker.js: worker мониторит CRM-список/канбан по DATE_MODIFY без внешних событий", () => {
  assertAllMatch(textFiles["worker.js"], [
    /function isDealWorkspaceUri/,
    /function isDealKanbanUri/,
    /refreshActiveContext/,
    /function rememberLastSeenDeal/,
    /function lastSeenDeal/,
    /function checkLikelyClosedDealOnKanban/,
    /dealInvoiceSummaryLastSeenDeal/,
    /kanbanRecheckCooldownMs = 15000/,
    /function checkRecentDealChanges/,
    /getRecentlyModifiedDeals/,
    /crm\.deal\.list/,
    /crm\.deal\.get/,
    /DATE_MODIFY/,
    /listMonitorLimit = 25/,
    /background-deal-list-start/,
    /background-deal-list-baseline/,
    /background-kanban-return-recalculate/,
    /background-deal-list-change-recalculate/,
    /kanbanReturn/,
    /changedDeals\.slice\(0, 5\)/,
  ], "worker.js");
});

test("worker.js: worker использует lock и throttle диагностики, чтобы не устроить гонку записей", () => {
  assertAllMatch(textFiles["worker.js"], [
    /workerSessionId/,
    /workerLockTtlMs = 12000/,
    /function workerLockKey/,
    /function claimDealLock/,
    /dealInvoiceSummaryWorkerLock/,
    /workerStatusThrottleMs = 60000/,
    /lastStatusWriteAt/,
    /saveWorkerStatus/,
    /localStorage\.setItem\(workerStatusOption, text\)/,
    /app\.option\.set/,
  ], "worker.js");
});

test("worker.js: worker использует только мягкий reloadData без полного reloadWindow fallback", () => {
  assertAllMatch(textFiles["worker.js"], [
    /function getPlacementInterface/,
    /BX24\.placement\.getInterface/,
    /normalizePlacementInterfaceList/,
    /commands\.includes\("reloadData"\)/,
    /BX24\.placement\.call\("reloadData"/,
    /reason: "reloadData unavailable"/,
    /reason: "placement.call unavailable"/,
  ], "worker.js");
  assert.doesNotMatch(textFiles["worker.js"], /BX24\.reloadWindow/);
  assert.doesNotMatch(textFiles["worker.js"], /function reloadBitrixWindow/);
});

test("worker.js: worker уважает выбранную воронку и пишет нули в пустые расчётные поля", () => {
  assertAllMatch(textFiles["worker.js"], [
    /calculationCategoryId/,
    /function settingsCategoryId/,
    /function dealMatchesCalculationCategory/,
    /skippedCategory: true/,
    /function isBlankCrmValue/,
    /isBlankCrmValue\(deal\[field\]\) \|\| !sameMoneyValue\(deal\[field\], value\)/,
    /issuedField: summary\.issued/,
    /paidField: summary\.paid/,
    /unpaidField: summary\.unpaid/,
    /remainingField: summary\.remaining/,
  ], "worker.js");
});

test("style.css: основной layout сохраняет компактную двухколоночную рабочую панель", () => {
  assertAllMatch(textFiles["style.css"], [
    /\.menu-shell\s*{[\s\S]*width:\s*min\(1240px,\s*calc\(100% - 32px\)\)/,
    /\.setup-grid\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.1fr\) minmax\(0,\s*\.9fr\)/,
    /\.setup-grid\s*{[\s\S]*align-items:\s*start/,
    /@media \(max-width:\s*1120px\)[\s\S]*\.setup-grid\s*{[\s\S]*grid-template-columns:\s*1fr/,
    /\.panel\s*{[\s\S]*border-radius:\s*8px/,
  ], "style.css");
});

test("style.css: блок массового расчёта не выезжает в узком iframe", () => {
  assertAllMatch(textFiles["style.css"], [
    /\.automation-title-row\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(88px,\s*max-content\) 38px/,
    /\.automation-title-row h2\s*{[\s\S]*overflow-wrap:\s*anywhere/,
    /\.automation-panel button\s*{[\s\S]*max-width:\s*100%/,
    /\.automation-panel button\s*{[\s\S]*white-space:\s*normal/,
    /\.automation-list strong\s*{[\s\S]*overflow-wrap:\s*anywhere/,
    /#automationTracked\s*{[\s\S]*justify-self:\s*start/,
  ], "style.css");
});

test("style.css: настройки имеют устойчивую сетку действий и встроенную кнопку справки", () => {
  assertAllMatch(textFiles["style.css"], [
    /\.settings-panel \.form-actions\s*{[\s\S]*grid-template-columns:\s*minmax\(210px,\s*max-content\) minmax\(220px,\s*1fr\)/,
    /\.settings-panel #settingsStatus\s*{[\s\S]*grid-column:\s*1 \/ -1/,
    /\.setting-inline-control\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 34px/,
    /\.help-button\s*{[\s\S]*width:\s*34px/,
    /\.settings-help-modal p/,
  ], "style.css");
});

test("style.css: модальные окна ограничены viewport, а статистика увеличена без внутреннего скролла", () => {
  assertAllMatch(textFiles["style.css"], [
    /\.modal-backdrop\s*{[\s\S]*padding:\s*clamp\(10px,\s*2vh,\s*20px\)/,
    /\.modal-panel\s*{[\s\S]*width:\s*min\(640px,\s*calc\(100vw - 24px\)\)/,
    /\.modal-panel\s*{[\s\S]*max-height:\s*calc\(100vh - 24px\)/,
    /\.modal-panel\s*{[\s\S]*overflow:\s*auto/,
    /\.stats-modal\s*{[\s\S]*width:\s*min\(920px,\s*calc\(100vw - 24px\)\)/,
    /\.stats-modal\s*{[\s\S]*overflow:\s*hidden/,
    /\.donut-chart\s*{[\s\S]*width:\s*min\(100%,\s*clamp\(220px,\s*28vw,\s*300px\)\)/,
  ], "style.css");
});

test("style.css: таблица счетов сохраняет 6 колонок и мобильный fallback в одну колонку", () => {
  assertAllMatch(textFiles["style.css"], [
    /\.invoice-header\s*{[\s\S]*grid-template-columns:\s*2fr 1fr 1fr 1fr 1fr 1fr/,
    /\.invoice-row\s*{[\s\S]*grid-template-columns:\s*2fr 1fr 1fr 1fr 1fr 1fr/,
    /@media \(max-width:\s*780px\)[\s\S]*\.invoice-header,[\s\S]*\.invoice-row\s*{[\s\S]*grid-template-columns:\s*1fr/,
  ], "style.css");
});

test("install.css: экран установки изолирован от основного style.css и содержит читаемый журнал", () => {
  assertAllMatch(textFiles["install.css"], [
    /install-shell/,
    /install-panel/,
    /pre\s*{[\s\S]*white-space:\s*pre-wrap/,
    /pre\s*{[\s\S]*background:\s*#eef3f8/,
  ], "install.css");
  assertAllDoNotMatch(textFiles["install.css"], [/\.setup-grid/, /\.automation-panel/, /\.stats-modal/], "install.css");
});
