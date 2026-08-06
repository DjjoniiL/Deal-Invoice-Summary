import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import {
  buildDealReport,
  createApp,
  csvCell,
  dealFieldToBitrixName,
  fieldOptions,
  invoiceCalculationGroup,
  invoiceStageName,
  mergeDealSummarySection,
  normalizeDealId,
  parseBitrixForm,
  pushEventDefinitions,
  reportDate,
  toCsv,
} from "./server.js";

test("normalizes deal ids from Bitrix placement values", () => {
  assert.equal(normalizeDealId("DEAL_42"), 42);
  assert.equal(normalizeDealId("  15  "), 15);
  assert.equal(normalizeDealId(""), 0);
});

test("builds selectable deal field options", () => {
  const options = fieldOptions({
    ufCrmText: { label: "Text", type: "string" },
    ufCrmReadonly: { label: "Readonly", type: "number", readonly: true },
    ufCrmUnsupported: { label: "Unsupported", type: "date" },
    ufCrmMoney: { label: "Money", type: "money" },
  });

  assert.deepEqual(options, [
    { id: "ufCrmMoney", label: "Money", type: "money" },
    { id: "ufCrmText", label: "Text", type: "string" },
  ]);
});

test("formats invoice stage and calculation group for reports", () => {
  const statuses = [{ statusId: "DT31_6:P", semantics: "S", name: "Оплачен" }];
  const invoice = { stageId: "DT31_6:P" };

  assert.equal(invoiceStageName(invoice, statuses), "Оплачен");
  assert.equal(invoiceCalculationGroup(invoice, statuses, false), "Оплаченный");
  assert.equal(invoiceCalculationGroup({ stageId: "DT31_6:D" }, [], false), "Пропущен");
  assert.equal(invoiceCalculationGroup({ stageId: "DT31_6:D" }, [], true), "Неоплаченный");
});

test("parses nested Bitrix24 event form payloads", () => {
  const payload = parseBitrixForm(
    "event=ONCRMDEALUPDATE&data[FIELDS][ID]=2&auth[application_token]=token&auth[domain]=example.bitrix24.ru",
  );

  assert.deepEqual(payload, {
    event: "ONCRMDEALUPDATE",
    data: { FIELDS: { ID: "2" } },
    auth: { application_token: "token", domain: "example.bitrix24.ru" },
  });
});

test("documents push event definitions for continuous mode", () => {
  assert.deepEqual(
    pushEventDefinitions.map((item) => item.event),
    ["ONCRMDEALUPDATE", "ONCRMDYNAMICITEMADD", "ONCRMDYNAMICITEMUPDATE", "ONCRMDYNAMICITEMDELETE"],
  );
  assert.ok(pushEventDefinitions.slice(1).every((item) => item.entityTypeId === 31));
});

test("builds deal card field names and merges summary section", () => {
  assert.equal(dealFieldToBitrixName("ufCrmInvSumIssued"), "UF_CRM_INV_SUM_ISSUED");
  assert.equal(dealFieldToBitrixName("ufCrm_1785930142"), "UF_CRM_1785930142");

  const layout = [
    {
      name: "main",
      title: "О сделке",
      type: "section",
      elements: [{ name: "TITLE", optionFlags: "0" }, { name: "UF_CRM_INV_SUM_PAID", optionFlags: "0" }],
    },
    {
      name: "deal_invoice_summary",
      title: "Old",
      type: "section",
      elements: [{ name: "UF_CRM_OLD", optionFlags: "0" }],
    },
  ];

  assert.deepEqual(mergeDealSummarySection(layout, ["UF_CRM_INV_SUM_PAID", "UF_CRM_INV_SUM_REMAINING"]), [
    {
      name: "main",
      title: "О сделке",
      type: "section",
      elements: [{ name: "TITLE", optionFlags: "0" }],
    },
    {
      name: "deal_invoice_summary",
      title: "Расчёт оплаты счетов",
      type: "section",
      elements: [
        { name: "UF_CRM_INV_SUM_PAID", optionFlags: 0 },
        { name: "UF_CRM_INV_SUM_REMAINING", optionFlags: 0 },
      ],
    },
  ]);
});

test("escapes CSV cells and builds Excel-friendly deal report", () => {
  assert.equal(csvCell('ООО "Тест"; строка'), '"ООО ""Тест""; строка"');
  assert.equal(toCsv([["a", "b"], ["c", "d"]]), "a;b\r\nc;d");
  assert.equal(reportDate("2026-07-27T00:00:00.000Z"), "27.07.2026");

  const csv = buildDealReport({
    dealId: 2,
    dealTitle: "Тестовая сделка",
    summary: {
      dealAmount: 7400,
      issued: 8400,
      paid: 7400,
      unpaid: 1000,
      remaining: 0,
      invoiceCount: 3,
      countedInvoiceCount: 2,
      skippedNegative: 1,
    },
    invoices: [
      {
        id: 2,
        accountNumber: "2",
        title: "Счёт № 2",
        stageName: "Оплачен",
        issuedAt: "2026-07-27T00:00:00.000Z",
        assignedName: "Ковальчук Иван",
        amount: 7400,
        calculationGroup: "Оплаченный",
      },
    ],
  });

  assert.match(csv, /Отчет по оплате счетов сделки|Отчёт по оплате счетов сделки/);
  assert.match(csv, /#2 Тестовая сделка/);
  assert.match(csv, /2;2;Счёт № 2;Оплачен;27\.07\.2026;Ковальчук Иван;7400;Оплаченный/);
});

test("serves health JSON, left menu page, and deal tab HTML", async () => {
  const server = createApp();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await health.json(), { ok: true });

    const menu = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(menu.status, 200);
    assert.match(await menu.text(), /Сопоставление полей сделки/);

    const tab = await fetch(`http://127.0.0.1:${port}/deal-tab`);
    assert.equal(tab.status, 200);
    assert.match(await tab.text(), /Расчёт оплаты счетов/);

    const menuCss = await fetch(`http://127.0.0.1:${port}/menu.css`);
    assert.equal(menuCss.status, 200);
    assert.match(await menuCss.text(), /\.menu-hero/);
  } finally {
    server.close();
  }
});
