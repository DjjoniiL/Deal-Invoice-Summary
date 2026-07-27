const PAID_SEMANTICS = new Set(["S", "SUCCESS"]);
const NEGATIVE_SEMANTICS = new Set(["F", "FAILURE"]);

export function money(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function statusSemantic(stageId, statuses = []) {
  const id = String(stageId ?? "");
  const found = statuses.find((status) => String(status.statusId ?? status.STATUS_ID) === id);
  if (found?.semantics || found?.SEMANTICS) return String(found.semantics ?? found.SEMANTICS).toUpperCase();

  const suffix = id.includes(":") ? id.split(":").pop() : id;
  if (suffix === "P" || suffix === "WON") return "S";
  if (suffix === "D" || suffix === "LOSE" || suffix === "LOST") return "F";
  return "";
}

export function summarizeInvoices(deal, invoices, options = {}) {
  const includeNegativeStages = Boolean(options.includeNegativeStages);
  const statuses = options.statuses ?? [];

  let issued = 0;
  let paid = 0;
  let unpaid = 0;
  let skippedNegative = 0;

  for (const invoice of invoices) {
    const amount = money(invoice.opportunity ?? invoice.amount ?? invoice.PRICE ?? 0);
    const semantic = statusSemantic(invoice.stageId ?? invoice.statusId, statuses);
    const isNegative = NEGATIVE_SEMANTICS.has(semantic);

    if (isNegative && !includeNegativeStages) {
      skippedNegative += 1;
      continue;
    }

    issued += amount;
    if (PAID_SEMANTICS.has(semantic)) {
      paid += amount;
    } else {
      unpaid += amount;
    }
  }

  const dealAmount = money(deal.amount ?? deal.opportunity ?? 0);
  return {
    issued: money(issued),
    paid: money(paid),
    unpaid: money(unpaid),
    remaining: money(dealAmount - paid),
    dealAmount,
    invoiceCount: invoices.length,
    countedInvoiceCount: invoices.length - skippedNegative,
    skippedNegative,
  };
}

export function buildDealPatch(summary, settings) {
  const patch = {};
  const mapping = {
    issuedField: summary.issued,
    paidField: summary.paid,
    unpaidField: summary.unpaid,
    remainingField: summary.remaining,
  };

  for (const [settingKey, value] of Object.entries(mapping)) {
    const field = settings[settingKey];
    if (field) patch[field] = value;
  }

  return patch;
}
