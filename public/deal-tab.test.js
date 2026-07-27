import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const html = await readFile(new URL("./deal-tab.html", import.meta.url), "utf8");
const js = await readFile(new URL("./deal-tab.js", import.meta.url), "utf8");
const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");

test("deal tab exposes the MVP report layout", () => {
  assert.match(html, /id="coverageDonut"/);
  assert.match(html, /class="summary-column"/);
  assert.match(html, /Структура счетов/);
  assert.match(html, /id="downloadReport"/);
  assert.match(html, /Скачать отчёт/);
  assert.match(html, /id="invoiceList"/);
});

test("deal tab keeps invoices clickable inside Bitrix24", () => {
  assert.match(html, /api\.bitrix24\.com\/api\/v1/);
  assert.match(js, /document\.createElement\("a"\)/);
  assert.match(js, /titleNode\.href = invoiceUrl\(invoice\.id\)/);
  assert.match(js, /function openInvoice/);
  assert.match(js, /function portalOrigin/);
  assert.match(js, /BX24\.openPath/);
  assert.doesNotMatch(js, /preventDefault\(\)/);
  assert.match(js, /\/crm\/type\/31\/details\//);
});

test("frontend API helper reports non-JSON responses cleanly", () => {
  assert.match(js, /response\.text\(\)/);
  assert.doesNotMatch(js, /response\.json\(\)/);
  assert.match(js, /Сервер вернул не JSON/);
});

test("CSS keeps the approved compact wide layout", () => {
  assert.match(css, /\.tab-shell\s*{[\s\S]*max-width:\s*1480px/);
  assert.match(css, /padding:\s*8px 52px 10px/);
  assert.match(css, /\.payment-layout\s*{[\s\S]*grid-template-columns:\s*360px minmax\(0, 1fr\)/);
  assert.match(css, /\.donut\s*{[\s\S]*width:\s*132px/);
  assert.match(css, /\.composition-compact\s*{[\s\S]*min-height:\s*78px/);
});
