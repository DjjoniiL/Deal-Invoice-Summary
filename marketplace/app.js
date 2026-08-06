const defaultSettings = {
  includeNegativeStages: false,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
};
const dealSummarySectionName = "deal_invoice_summary";
const dealSummarySectionTitle = "Расчёт оплаты счетов";

const moneyFormat = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const form = document.querySelector("#settings");
const portal = document.querySelector("#portal");
const mappingStatus = document.querySelector("#mappingStatus");
const dealForm = document.querySelector("#dealForm");
const dealIdInput = dealForm.elements.dealId;
const dealUrlInput = dealForm.elements.dealUrl;
const logToggle = document.querySelector("#logToggle");
const resultNode = document.querySelector("#result");
const reportNode = document.querySelector(".marketplace-report");
const dealTitle = document.querySelector("#dealTitle");
const invoiceList = document.querySelector("#invoiceList");
const totalNodes = {
  issued: document.querySelector("#issued"),
  paid: document.querySelector("#paid"),
  unpaid: document.querySelector("#unpaid"),
  remaining: document.querySelector("#remaining"),
};
let currentReport = null;
let portalHost = "";

function setLogVisible(visible) {
  resultNode.hidden = !visible;
  logToggle.setAttribute("aria-expanded", String(visible));
}

function write(value, { reveal = false } = {}) {
  resultNode.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (reveal) setLogVisible(true);
}

function setMappingStatus(text, tone = "neutral") {
  mappingStatus.textContent = text;
  mappingStatus.dataset.tone = tone;
}

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

function dealFieldToBitrixName(fieldId) {
  const text = String(fieldId || "").trim();
  return text ? text.toUpperCase() : "";
}

function configuredDealFieldNames(settings) {
  return [
    settings.issuedField,
    settings.paidField,
    settings.unpaidField,
    settings.remainingField,
  ].map(dealFieldToBitrixName).filter(Boolean);
}

function mergeDealSummarySection(layout, fieldNames) {
  if (!Array.isArray(layout)) return null;
  const uniqueFieldNames = [...new Set(fieldNames.filter(Boolean))];
  if (!uniqueFieldNames.length) return layout;

  const targetNames = new Set(uniqueFieldNames);
  const cleanedSections = layout
    .filter((section) => section?.name !== dealSummarySectionName)
    .map((section) => ({
      ...section,
      elements: (section.elements || []).filter((element) => !targetNames.has(String(element.name || "").toUpperCase())),
    }));

  cleanedSections.push({
    name: dealSummarySectionName,
    title: dealSummarySectionTitle,
    type: "section",
    elements: uniqueFieldNames.map((name) => ({ name, optionFlags: 0 })),
  });

  return cleanedSections;
}

async function configureDealCardSection(settings) {
  const fieldNames = configuredDealFieldNames(settings);
  if (fieldNames.length < 4) return { ok: false, skipped: true, reason: "Field mapping is incomplete" };

  const response = await callMethod("crm.item.details.configuration.get", { entityTypeId: 2, scope: "C" });
  const current = response?.data || response;
  const data = mergeDealSummarySection(current, fieldNames);
  if (!data) return { ok: false, skipped: true, reason: "Common deal card layout is not configured" };

  await callMethod("crm.item.details.configuration.set", { entityTypeId: 2, scope: "C", data });
  return { ok: true, sectionName: dealSummarySectionName, fieldNames };
}

function fieldLabel(field, userFieldLabels) {
  const id = String(field.FIELD_NAME || field.fieldName || "");
  return (
    userFieldLabels.get(id.toUpperCase()) ||
    field.title ||
    field.formLabel ||
    field.FORM_LABEL ||
    field.EDIT_FORM_LABEL ||
    field.LIST_COLUMN_LABEL ||
    id
  );
}

function renderFields(fields, userFields, settings) {
  const userFieldLabels = new Map(
    userFields.map((field) => [
      String(field.FIELD_NAME || "").toUpperCase(),
      field.EDIT_FORM_LABEL || field.LIST_COLUMN_LABEL || field.LIST_FILTER_LABEL || field.FIELD_NAME,
    ]),
  );
  const available = Object.entries(fields)
    .filter(([, field]) => ["double", "integer", "money", "string"].includes(field.type || field.TYPE || field.USER_TYPE_ID))
    .map(([id, field]) => ({
      id,
      type: field.type || field.TYPE || field.USER_TYPE_ID || "",
      label: fieldLabel({ ...field, FIELD_NAME: id }, userFieldLabels),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  for (const select of form.querySelectorAll("select")) {
    select.replaceChildren(new Option("Не записывать", ""));
    for (const field of available) select.add(new Option(`${field.label} (${field.type})`, normalizeFieldName(field.id)));
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
  const byName = new Map(existing.map((field) => [String(field.FIELD_NAME || "").toUpperCase(), field]));
  for (const [name, label] of wanted) {
    const fieldName = `UF_CRM_${name}`;
    const fields = {
        FIELD_NAME: name,
        USER_TYPE_ID: "double",
        EDIT_FORM_LABEL: label,
        LIST_COLUMN_LABEL: label,
        LIST_FILTER_LABEL: label,
        ERROR_MESSAGE: "",
        HELP_MESSAGE: "",
        EDIT_IN_LIST: "N",
    };
    const existingField = byName.get(fieldName);
    if (existingField?.ID) await callMethod("crm.deal.userfield.update", { id: existingField.ID, fields });
    else await callMethod("crm.deal.userfield.add", { fields });
  }
  await saveSettings(defaultSettings);
  await configureDealCardSection(defaultSettings);
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

function dealIdFromText(value) {
  const text = String(value || "").trim();
  const dealMatch = text.match(/\/crm\/deal\/details\/(\d+)\b/i);
  const idMatch = dealMatch || text.match(/\bdeal[_/-]?(\d+)\b/i) || text.match(/\b(\d+)\b/);
  return idMatch ? idMatch[1] : "";
}

function dealUrlFromId(dealId) {
  const id = dealIdFromText(dealId);
  return id && portalHost ? `https://${portalHost}/crm/deal/details/${id}/` : "";
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
  reportNode.hidden = false;
  dealTitle.textContent = `Сделка #${dealId}: ${result.deal.TITLE || "без названия"}`;
  for (const [key, node] of Object.entries(totalNodes)) node.textContent = moneyFormat.format(result.summary[key]);
  invoiceList.replaceChildren();
  for (const invoice of result.invoices) {
    const row = document.createElement("div");
    row.className = "invoice-row";
    const title = document.createElement("a");
    title.href = portalHost ? `https://${portalHost}/crm/type/31/details/${invoice.id}/` : `/crm/type/31/details/${invoice.id}/`;
    title.target = "_blank";
    title.rel = "noopener";
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
  write("Загружаю настройки...");
  setMappingStatus("Проверяю настройки...");
  portalHost = window.BX24?.getDomain?.() || "";
  portal.textContent = portalHost ? `${portalHost} · Bitrix24 Marketplace` : "Bitrix24 Marketplace";
  const settings = await loadSettings();
  const [fields, userFields] = await Promise.all([
    callMethod("crm.deal.fields"),
    callList("crm.deal.userfield.list"),
  ]);
  renderFields(fields, userFields, settings);
  form.includeNegativeStages.checked = Boolean(settings.includeNegativeStages);
  setMappingStatus("Сопоставление готово.", "success");
  write("Настройки загружены.");
  const contextDealId = dealIdFromContext();
  if (contextDealId) {
    dealIdInput.value = contextDealId;
    const url = dealUrlFromId(contextDealId);
    if (url) dealUrlInput.value = url;
    const result = await recalculate(contextDealId, false);
    renderResult(contextDealId, result);
    write("Расчёт готов.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = Object.fromEntries(new FormData(form));
  settings.includeNegativeStages = form.includeNegativeStages.checked;
  await saveSettings(settings);
  let card = null;
  try {
    card = await configureDealCardSection(settings);
  } catch (error) {
    card = { ok: false, error: error.message };
  }
  setMappingStatus("Сопоставление сохранено.", "success");
  write({ settings, dealCard: card });
});

dealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(dealForm);
  const dealId = Number(dealIdFromText(data.get("dealId")) || dealIdFromText(data.get("dealUrl")));
  if (!dealId) return;
  dealIdInput.value = dealId;
  const url = dealUrlFromId(dealId);
  if (url) dealUrlInput.value = url;
  write(`Пересчитываю сделку #${dealId}...`, { reveal: true });
  const result = await recalculate(dealId, true);
  renderResult(dealId, result);
  write({ ok: true, message: "Поля сделки обновлены.", summary: result.summary }, { reveal: true });
});

document.querySelector("#ensureFields").addEventListener("click", async () => {
  setMappingStatus("Создаю стандартные поля...");
  await ensureFields();
  await initApp();
});

document.querySelector("#refresh").addEventListener("click", initApp);
document.querySelector("#downloadReport").addEventListener("click", downloadReport);
logToggle.addEventListener("click", () => setLogVisible(resultNode.hidden));
dealUrlInput.addEventListener("input", () => {
  const dealId = dealIdFromText(dealUrlInput.value);
  if (dealId) dealIdInput.value = dealId;
});
dealIdInput.addEventListener("input", () => {
  const url = dealUrlFromId(dealIdInput.value);
  if (url) dealUrlInput.value = url;
});

if (window.BX24) {
  BX24.init(() => initApp().catch((error) => {
    setMappingStatus("Ошибка загрузки", "warning");
    write(error.message, { reveal: true });
  }));
} else {
  portal.textContent = "Откройте приложение внутри Bitrix24.";
  write("Откройте приложение внутри Bitrix24.", { reveal: true });
}
