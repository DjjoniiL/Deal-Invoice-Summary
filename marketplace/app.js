const defaultSettings = {
  includeNegativeStages: false,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
};

const moneyFormat = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const form = document.querySelector("#settings");
const settingsStatus = document.querySelector("#settingsStatus");
const dealForm = document.querySelector("#dealForm");
const dealStatus = document.querySelector("#dealStatus");
const dealTitle = document.querySelector("#dealTitle");
const invoiceList = document.querySelector("#invoiceList");
const totalNodes = {
  issued: document.querySelector("#issued"),
  paid: document.querySelector("#paid"),
  unpaid: document.querySelector("#unpaid"),
  remaining: document.querySelector("#remaining"),
};
let currentReport = null;

function callMethod(method, params = {}) {
  return new Promise((resolve, reject) => {
    BX24.callMethod(method, params, (result) => {
      if (result.error()) reject(new Error(result.error_description() || result.error()));
      else resolve(result.data());
    });
  });
}

async function callList(method, params = {}, key = null) {
  const rows = [];
  let start = 0;
  do {
    const response = await callMethod(method, { ...params, start });
    const data = key ? response[key] : response;
    rows.push(...(Array.isArray(data) ? data : []));
    start = response.next ?? 0;
  } while (start);
  return rows;
}

function money(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function statusSemantic(stageId) {
  const suffix = String(stageId || "").split(":").pop();
  if (suffix === "P" || suffix === "WON") return "S";
  if (suffix === "D" || suffix === "LOSE" || suffix === "LOST") return "F";
  return "";
}

function summarize(deal, invoices, settings) {
  let issued = 0;
  let paid = 0;
  let unpaid = 0;
  let skippedNegative = 0;
  for (const invoice of invoices) {
    const amount = money(invoice.opportunity || invoice.OPPORTUNITY);
    const semantic = statusSemantic(invoice.stageId || invoice.STAGE_ID);
    if (semantic === "F" && !settings.includeNegativeStages) {
      skippedNegative += 1;
      continue;
    }
    issued += amount;
    if (semantic === "S") paid += amount;
    else unpaid += amount;
  }
  const dealAmount = money(deal.OPPORTUNITY || deal.opportunity);
  return {
    issued: money(issued),
    paid: money(paid),
    unpaid: money(unpaid),
    remaining: money(dealAmount - paid),
    invoiceCount: invoices.length,
    countedInvoiceCount: invoices.length - skippedNegative,
    skippedNegative,
  };
}

async function loadSettings() {
  try {
    const stored = await callMethod("app.option.get", { option: "dealInvoiceSummarySettings" });
    return { ...defaultSettings, ...(stored ? JSON.parse(stored) : {}) };
  } catch {
    const local = localStorage.getItem("dealInvoiceSummarySettings");
    return { ...defaultSettings, ...(local ? JSON.parse(local) : {}) };
  }
}

async function saveSettings(settings) {
  localStorage.setItem("dealInvoiceSummarySettings", JSON.stringify(settings));
  try {
    await callMethod("app.option.set", { options: { dealInvoiceSummarySettings: JSON.stringify(settings) } });
  } catch {
    // Local storage keeps the app usable if app.option is unavailable in a dev install.
  }
}

function normalizeFieldName(value) {
  return String(value || "").toUpperCase();
}

function renderFields(fields, settings) {
  const available = Object.entries(fields)
    .filter(([, field]) => ["double", "integer", "money", "string"].includes(field.type || field.TYPE))
    .map(([id, field]) => ({ id, label: field.title || field.formLabel || field.FORM_LABEL || id }));
  for (const select of form.querySelectorAll("select")) {
    select.replaceChildren(new Option("Не записывать", ""));
    for (const field of available) select.add(new Option(field.label, normalizeFieldName(field.id)));
    select.value = normalizeFieldName(settings[select.name]);
  }
}

async function ensureFields() {
  const wanted = [
    ["INV_SUM_ISSUED", "Сумма выставленных счетов"],
    ["INV_SUM_PAID", "Сумма оплаченных счетов"],
    ["INV_SUM_UNPAID", "Сумма неоплаченных счетов"],
    ["INV_SUM_REMAINING", "Остаток оплаты по счетам"],
  ];
  const existing = await callList("crm.deal.userfield.list");
  const names = new Set(existing.map((field) => field.FIELD_NAME));
  for (const [name, label] of wanted) {
    const fieldName = `UF_CRM_${name}`;
    if (names.has(fieldName)) continue;
    await callMethod("crm.deal.userfield.add", {
      fields: {
        FIELD_NAME: name,
        USER_TYPE_ID: "double",
        EDIT_FORM_LABEL: label,
        LIST_COLUMN_LABEL: label,
        EDIT_IN_LIST: "N",
      },
    });
  }
  await saveSettings(defaultSettings);
}

async function getInvoices(dealId) {
  const response = await callMethod("crm.item.list", {
    entityTypeId: 31,
    filter: { parentId2: Number(dealId) },
    select: ["id", "title", "opportunity", "stageId", "accountNumber", "begindate"],
  });
  return response.items || response.result?.items || [];
}

function dealIdFromContext() {
  const params = new URLSearchParams(window.location.search);
  const optionsText = params.get("PLACEMENT_OPTIONS") || params.get("placement_options") || "{}";
  try {
    const options = JSON.parse(optionsText);
    return Number(options.ID || options.id || 0);
  } catch {
    return 0;
  }
}

async function recalculate(dealId, write = true) {
  const settings = await loadSettings();
  const [deal, invoices] = await Promise.all([
    callMethod("crm.deal.get", { id: Number(dealId) }),
    getInvoices(dealId),
  ]);
  const summary = summarize(deal, invoices, settings);
  if (write) {
    const fields = {};
    for (const [key, value] of Object.entries({
      issuedField: summary.issued,
      paidField: summary.paid,
      unpaidField: summary.unpaid,
      remainingField: summary.remaining,
    })) {
      if (settings[key]) fields[settings[key]] = value;
    }
    await callMethod("crm.deal.update", { id: Number(dealId), fields });
  }
  return { deal, invoices, summary };
}

function renderResult(dealId, result) {
  dealTitle.textContent = `Сделка #${dealId}: ${result.deal.TITLE || "без названия"}`;
  for (const [key, node] of Object.entries(totalNodes)) node.textContent = moneyFormat.format(result.summary[key]);
  invoiceList.replaceChildren();
  for (const invoice of result.invoices) {
    const row = document.createElement("div");
    row.className = "invoice-row";
    const title = document.createElement("a");
    title.href = `/crm/type/31/details/${invoice.id}/`;
    title.textContent = invoice.accountNumber ? `Счёт № ${invoice.accountNumber}` : invoice.title || `Счёт #${invoice.id}`;
    const stage = document.createElement("span");
    stage.textContent = invoice.stageId || "Без стадии";
    const amount = document.createElement("strong");
    amount.textContent = moneyFormat.format(invoice.opportunity || 0);
    row.append(title, stage, amount);
    invoiceList.append(row);
  }
  if (!result.invoices.length) invoiceList.textContent = "По сделке пока нет счетов.";
  currentReport = { dealId, ...result };
}

function downloadReport() {
  if (!currentReport) return;
  const rows = [
    ["Сделка", `#${currentReport.dealId} ${currentReport.deal.TITLE || ""}`],
    ["Выставлено", currentReport.summary.issued],
    ["Оплачено", currentReport.summary.paid],
    ["Не оплачено", currentReport.summary.unpaid],
    ["Остаток", currentReport.summary.remaining],
    [],
    ["ID счета", "Название", "Стадия", "Сумма"],
    ...currentReport.invoices.map((invoice) => [invoice.id, invoice.title, invoice.stageId, invoice.opportunity]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  link.download = `deal-${currentReport.dealId}-invoice-summary.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initApp() {
  const settings = await loadSettings();
  const fields = await callMethod("crm.deal.fields");
  renderFields(fields, settings);
  form.includeNegativeStages.checked = Boolean(settings.includeNegativeStages);
  settingsStatus.textContent = "Сопоставление готово.";
  const contextDealId = dealIdFromContext();
  if (contextDealId) {
    dealForm.elements.dealId.value = contextDealId;
    const result = await recalculate(contextDealId, false);
    renderResult(contextDealId, result);
    dealStatus.textContent = "Расчёт готов.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = Object.fromEntries(new FormData(form));
  settings.includeNegativeStages = form.includeNegativeStages.checked;
  await saveSettings(settings);
  settingsStatus.textContent = "Сопоставление сохранено.";
});

dealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const dealId = Number(new FormData(dealForm).get("dealId"));
  if (!dealId) return;
  dealStatus.textContent = "Пересчитываю...";
  const result = await recalculate(dealId, true);
  renderResult(dealId, result);
  dealStatus.textContent = "Поля сделки обновлены.";
});

document.querySelector("#ensureFields").addEventListener("click", async () => {
  settingsStatus.textContent = "Создаю поля...";
  await ensureFields();
  await initApp();
});

document.querySelector("#refresh").addEventListener("click", initApp);
document.querySelector("#downloadReport").addEventListener("click", downloadReport);

if (window.BX24) BX24.init(() => initApp().catch((error) => { dealStatus.textContent = error.message; }));
else dealStatus.textContent = "Откройте приложение внутри Bitrix24.";
