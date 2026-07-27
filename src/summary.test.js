import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDealPatch, summarizeInvoices } from "./summary.js";

const statuses = [
  { statusId: "DT31_6:P", semantics: "S" },
  { statusId: "DT31_6:D", semantics: "F" },
];

test("summarizes invoices and excludes negative stages by default", () => {
  const summary = summarizeInvoices(
    { amount: 1000 },
    [
      { opportunity: 300, stageId: "DT31_6:P" },
      { opportunity: 200, stageId: "DT31_6:N" },
      { opportunity: 50, stageId: "DT31_6:D" },
    ],
    { statuses },
  );

  assert.deepEqual(summary, {
    issued: 500,
    paid: 300,
    unpaid: 200,
    remaining: 700,
    dealAmount: 1000,
    invoiceCount: 3,
    countedInvoiceCount: 2,
    skippedNegative: 1,
  });
});

test("can include negative stages in unpaid totals", () => {
  const summary = summarizeInvoices(
    { amount: 1000 },
    [{ opportunity: 50, stageId: "DT31_6:D" }],
    { statuses, includeNegativeStages: true },
  );

  assert.equal(summary.issued, 50);
  assert.equal(summary.unpaid, 50);
});

test("builds patch only for configured fields", () => {
  assert.deepEqual(
    buildDealPatch(
      { issued: 10, paid: 7, unpaid: 3, remaining: 93 },
      { issuedField: "ufCrmIssued", paidField: "ufCrmPaid" },
    ),
    { ufCrmIssued: 10, ufCrmPaid: 7 },
  );
});
