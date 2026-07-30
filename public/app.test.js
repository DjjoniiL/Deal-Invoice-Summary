import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const js = await readFile(new URL("./app.js", import.meta.url), "utf8");

test("left menu page contains setup, CTA, and recalculation controls", () => {
  assert.match(html, /name="issuedField"/);
  assert.match(html, /name="paidField"/);
  assert.match(html, /name="unpaidField"/);
  assert.match(html, /name="remainingField"/);
  assert.match(html, /id="ensureFields"/);
  assert.match(html, /id="dealForm"/);
  assert.match(html, /id="recent"/);
  assert.match(html, /Сопоставление полей сделки/);
  assert.match(html, /Создать автоматически/);
  assert.match(html, /Нужна доработка этого приложения/);
  assert.match(html, /Пересчитать сделку/);
});

test("settings page API helper handles non-JSON responses", () => {
  assert.match(js, /response\.text\(\)/);
  assert.doesNotMatch(js, /response\.json\(\)/);
  assert.match(js, /Сервер вернул не JSON/);
});
