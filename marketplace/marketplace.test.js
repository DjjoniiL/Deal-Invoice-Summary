import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const installHtml = await readFile(new URL("./install.html", import.meta.url), "utf8");
const installJs = await readFile(new URL("./install.js", import.meta.url), "utf8");
const indexHtml = await readFile(new URL("./index.html", import.meta.url), "utf8");
const appJs = await readFile(new URL("./app.js", import.meta.url), "utf8");
const marketplaceFiles = await readdir(new URL(".", import.meta.url));
const expectedMarketplaceFiles = ["app.js", "index.html", "install.css", "install.html", "install.js", "marketplace.test.js", "style.css"];

test("marketplace archive has static Bitrix24 entry files", () => {
  assert.match(installHtml, /install\.css/);
  assert.match(installHtml, /install\.js/);
  assert.match(indexHtml, /style\.css/);
  assert.match(indexHtml, /app\.js/);
  assert.match(indexHtml, /app\.js\?v=labels-20260806-1/);
  assert.match(indexHtml, /style\.css\?v=labels-20260806-1/);
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
  assert.match(appJs, /deal_invoice_summary/);
  assert.match(appJs, /function defaultDealCardLayout/);
  assert.match(appJs, /defaultFieldLabels/);
  assert.match(appJs, /if \(defaultLabel\) return defaultLabel/);
  assert.match(appJs, /\^ufCrm\[A-Z0-9\]/);
  assert.match(appJs, /Сумма выставленных счетов/);
  assert.doesNotMatch(appJs, /vibecode\.bitrix24\.tech/);
  assert.doesNotMatch(appJs, /\/api\/recalculate/);
});
