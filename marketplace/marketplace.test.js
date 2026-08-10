import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const installHtml = await readFile(new URL("./install.html", import.meta.url), "utf8");
const installJs = await readFile(new URL("./install.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("./index.html", import.meta.url), "utf8");
const appJs = await readFile(new URL("./app.js", import.meta.url), "utf8");
const styleCss = await readFile(new URL("./style.css", import.meta.url), "utf8");
const marketplaceFiles = await readdir(new URL(".", import.meta.url));
const expectedMarketplaceFiles = ["app.js", "index.html", "install.css", "install.html", "install.js", "marketplace.test.js", "style.css"];

test("marketplace archive has static Bitrix24 entry files", () => {
  assert.match(installHtml, /install\.css/);
  assert.match(installHtml, /install\.js/);
  assert.match(indexHtml, /style\.css/);
  assert.match(indexHtml, /app\.js/);
  assert.match(indexHtml, /app\.js\?v=layout-20260810-14/);
  assert.match(indexHtml, /style\.css\?v=layout-20260810-14/);
  assert.match(installHtml, /api\.bitrix24\.com\/api\/v1/);
  assert.match(indexHtml, /api\.bitrix24\.com\/api\/v1/);
});

test("marketplace runtime package stays serverless", () => {
  assert.deepEqual([...marketplaceFiles].sort(), expectedMarketplaceFiles);
  const runtimeFiles = marketplaceFiles.filter((file) => file !== "marketplace.test.js");
  assert.deepEqual(runtimeFiles.sort(), ["app.js", "index.html", "install.css", "install.html", "install.js", "style.css"]);
});

test("marketplace installer binds only the left menu and completes install", () => {
  assert.match(installJs, /placement\.bind/);
  assert.match(installJs, /LEFT_MENU/);
  assert.doesNotMatch(installJs, /CRM_DEAL_DETAIL_TAB/);
  assert.match(installJs, /BX24\.installFinish/);
  assert.match(installJs, /INSTALL_STEP_DELAY_MS = 4000/);
  assert.match(installJs, /logNode\.textContent \+=/);
  assert.match(installJs, /await wait\(INSTALL_STEP_DELAY_MS\)/);
});

test("marketplace app uses Bitrix24 REST directly without VibeCode backend", () => {
  assert.match(appJs, /crm\.deal\.get/);
  assert.match(appJs, /crm\.item\.list/);
  assert.match(appJs, /crm\.deal\.update/);
  assert.match(appJs, /crm\.deal\.userfield\.add/);
  assert.match(appJs, /crm\.deal\.userfield\.update/);
  assert.match(appJs, /crm\.deal\.details\.configuration\.get/);
  assert.match(appJs, /crm\.deal\.details\.configuration\.set/);
  assert.match(appJs, /crm\.item\.details\.configuration\.get/);
  assert.match(appJs, /crm\.item\.details\.configuration\.set/);
  assert.match(appJs, /crm\.category\.list/);
  assert.match(appJs, /dealCategoryId/);
  assert.match(appJs, /updatedCategories/);
  assert.match(appJs, /isEmptyCardLayoutError/);
  assert.match(appJs, /createdFromDefaultLayout/);
  assert.match(appJs, /deal_invoice_summary/);
  assert.match(appJs, /function defaultDealCardLayout/);
  assert.match(appJs, /defaultFieldLabels/);
  assert.match(appJs, /if \(defaultLabel\) return defaultLabel/);
  assert.match(appJs, /layout-20260810-14/);
  assert.match(appJs, /operation: "manual-recalculate"/);
  assert.match(appJs, /operation: "ensure-fields"/);
  assert.match(appJs, /operation: "save-mapping"/);
  assert.match(appJs, /\^ufCrm\[A-Z0-9\]/);
  assert.match(appJs, /Сумма выставленных счетов/);
  assert.doesNotMatch(appJs, /vibecode\.bitrix24\.tech/);
  assert.doesNotMatch(appJs, /\/api\/recalculate/);
});

test("marketplace report resolves invoice stages and assigned users", () => {
  assert.match(appJs, /crm\.item\.stage\.list/);
  assert.match(appJs, /crm\.status\.list/);
  assert.match(appJs, /stageLookup: stageDiagnostics/);
  assert.match(appJs, /STATUS_ID: stageId/);
  assert.match(appJs, /callList\("crm\.item\.stage\.list", \{ entityTypeId: 31 \}, "stages"\)/);
  assert.match(appJs, /SMART_INVOICE_STAGE_/);
  assert.match(appJs, /DYNAMIC_31_STAGE_/);
  assert.match(appJs, /__stagePrefix/);
  assert.match(appJs, /crm\.status\.entity\.types/);
  assert.match(appJs, /\?:DYNAMIC_31_STAGE\|SMART_INVOICE_STAGE/);
  assert.match(appJs, /stage\?\.statusId \|\| stage\?\.STATUS_ID \|\| stage\?\.id \|\| stage\?\.ID/);
  assert.match(appJs, /if \(statusId\.includes\(":"\)\) return statusId/);
  assert.match(appJs, /DT31_\$\{match\[1\]\}:\$\{statusId\}/);
  assert.match(appJs, /function statusStageCode/);
  assert.match(appJs, /function invoiceStageName/);
  assert.match(appJs, /function invoiceAssignedName/);
  assert.match(appJs, /String\(user\.ID \|\| user\.id\)/);
  assert.match(appJs, /loadUsers\(invoices\.map\(invoiceAssignedById\)\)/);
  assert.match(appJs, /invoiceStageName\(invoice\)/);
  assert.match(appJs, /invoiceAssignedName\(invoice\)/);
});

test("marketplace report formats invoice dates without time", () => {
  assert.match(appJs, /function formatDateOnly/);
  assert.match(appJs, /return `\$\{isoDate\[3\]\}\.\$\{isoDate\[2\]\}\.\$\{isoDate\[1\]\}`/);
  assert.match(appJs, /invoiceIssuedAt\(invoice\)/);
  assert.match(appJs, /invoiceDeadline\(invoice\)/);
});

test("marketplace automation panel keeps disabled server controls contained", () => {
  assert.match(indexHtml, /<option value="manual" selected>Ручной<\/option>/);
  assert.match(indexHtml, /Утром и вечером/);
  assert.match(indexHtml, /Постоянный/);
  assert.match(indexHtml, /Нужна серверная поддержка/);
  assert.match(indexHtml, /id="automationSchedule"/);
  assert.match(indexHtml, /<option value="21" selected>21 сутки<\/option>/);
  assert.match(appJs, /autoRecalcWindowDays:\s*21/);
  assert.match(appJs, /schedule:\s*"в 9:45 утра И в 18:45 вечера"/);
  assert.match(appJs, /сервер включается в 09:45 и 18:45/);
  assert.match(appJs, /Каждый час с 09:00 до 20:00/);
  assert.match(appJs, /сервер просыпается каждый час с 8:30 до 20:30/);
  assert.match(appJs, /каждые 7 мин\.\\nИтого 3 ч 15 мин\/сутки/);
  assert.match(appJs, /Итого 3 ч 15 мин\/сутки, до 200 руб\/мес за 30 рабочих дней/);
  assert.match(appJs, /Итого 30 мин\/сутки, до 145 руб\/мес за 30 рабочих дней/);
  assert.match(indexHtml, /Заявка на серверную версию/);
  assert.match(indexHtml, /windowReportModal/);
  assert.match(indexHtml, /downloadWindowReport/);
  assert.match(indexHtml, /loader_9_no7zeu\.js/);
  assert.match(indexHtml, /class="server-only"/);
  assert.match(indexHtml, /42 суток/);
  assert.match(indexHtml, /Автопересчёт доступен с сервером/);
  assert.match(indexHtml, /Сделать пересчёт всех сделок/);
  assert.match(indexHtml, /id="automationProgress" class="automation-progress" hidden/);
  assert.match(appJs, /marketplace-window-recalculate/);
  assert.match(appJs, /function recalculateDealsInWindow/);
  assert.match(appJs, /function downloadWindowReport/);
  assert.match(appJs, /function showWindowReportModal/);
  assert.match(appJs, /function loadServerSupport/);
  assert.match(appJs, /function openOpenLine/);
  assert.match(appJs, /dealInvoiceSummaryServerSupport/);
  assert.match(appJs, /if \(serverSupport\.connected\) return/);
  assert.match(appJs, /\["continuous", "twiceDaily"\]\.includes\(automationMode\.value\)/);
  assert.match(appJs, /settings\.autoRecalcMode \|\| "manual"/);
  assert.match(appJs, /automationMode\.value = "manual"/);
  assert.match(appJs, /function renderAutomationModeDetails/);
  assert.match(appJs, /Отчёт сформирован и готов к скачиванию/);
  assert.doesNotMatch(appJs, /CSV-отчёт сформирован автоматически/);
  assert.match(appJs, /deal-invoice-window-\$\{source\.days\}-days\.csv/);
  assert.match(appJs, />=\$\{fieldName\}/);
  assert.match(styleCss, /\.setup-grid\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.15fr\) minmax\(360px,\s*\.85fr\)/);
  assert.match(styleCss, /\.automation-panel button\s*{[\s\S]*width:\s*100%/);
  assert.match(styleCss, /\.automation-panel button\s*{[\s\S]*white-space:\s*normal/);
  assert.match(styleCss, /\.automation-list strong\s*{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styleCss, /\.automation-progress-track/);
  assert.match(styleCss, /\.modal-backdrop/);
  assert.match(styleCss, /\.modal-panel\s*{[\s\S]*width:\s*min\(640px,\s*100%\)/);
  assert.match(styleCss, /#serverSupportDetails\s*{[\s\S]*margin-top:\s*16px/);
  assert.match(styleCss, /#serverSupportDetails\s*{[\s\S]*white-space:\s*pre-line/);
  assert.doesNotMatch(styleCss, /Georgia/);
});
