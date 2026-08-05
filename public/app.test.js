import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const js = await readFile(new URL("./app.js", import.meta.url), "utf8");
const menuCss = await readFile(new URL("./menu.css", import.meta.url), "utf8");

test("left menu page contains setup, CTA, and recalculation controls", () => {
  assert.match(html, /name="issuedField"/);
  assert.match(html, /name="paidField"/);
  assert.match(html, /name="unpaidField"/);
  assert.match(html, /name="remainingField"/);
  assert.match(html, /id="ensureFields"/);
  assert.match(html, /id="dealForm"/);
  assert.match(html, /id="recent"/);
  assert.match(html, /href="\/menu\.css"/);
  assert.match(html, /name="dealId"/);
  assert.match(html, /name="dealUrl"/);
  assert.match(html, /id="logToggle"/);
  assert.match(html, /id="result" hidden/);
  assert.match(html, /Сопоставление полей сделки/);
  assert.match(html, /поля типа строка или число/);
  assert.match(html, /Создать автоматически/);
  assert.match(html, /Нужна доработка этого приложения/);
  assert.match(html, /data-pending-openline-url="Bisness i 24"/);
  assert.match(html, /Пересчитать сделку/);
  assert.match(menuCss, /\.menu-hero/);
  assert.match(menuCss, /\.manual-form/);
});

test("settings page API helper handles non-JSON responses", () => {
  assert.match(js, /response\.text\(\)/);
  assert.doesNotMatch(js, /response\.json\(\)/);
  assert.match(js, /VibeCode вернул HTML вместо JSON/);
});

test("manual recalculation accepts deal links and keeps the log collapsible", () => {
  assert.match(js, /function dealIdFromText/);
  assert.ok(js.includes("/crm\\/deal\\/details\\/"));
  assert.ok(js.includes("https://${portalHost}/crm/deal/details/${id}/"));
  assert.match(js, /dealUrlInput\.addEventListener\("input"/);
  assert.match(js, /dealIdInput\.addEventListener\("input"/);
  assert.match(js, /logToggle\.addEventListener\("click"/);
  assert.match(js, /recalculationStatusMinMs = 1500/);
  assert.match(js, /withMinimumDelay/);
  assert.match(js, /Пересчитываю сделку #/);
  assert.match(js, /Ошибка пересчёта сделки/);
  assert.match(js, /api\("\/api\/recalculate\/deal"[\s\S]*recalculationStatusMinMs/);
});
