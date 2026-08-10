const defaultSettings = {
  includeNegativeStages: false,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
};
const appVersion = "layout-20260807-7";
const dealSummarySectionName = "deal_invoice_summary";
const dealSummarySectionTitle = "Расчёт оплаты счетов";
const defaultFieldLabels = new Map([
  ["UF_CRM_INV_SUM_ISSUED", "Сумма выставленных счетов"],
  ["UF_CRM_INV_SUM_PAID", "Сумма оплаченных счетов"],
  ["UF_CRM_INV_SUM_UNPAID", "Сумма неоплаченных счетов"],
  ["UF_CRM_INV_SUM_REMAINING", "Остаток оплаты по счетам"],
]);

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
let stageMap = new Map();
let userMap = new Map();

console.info(`Deal Invoice Summary Marketplace ${appVersion}`);

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
    rows.push(...listRows(response, key));
    start = response.next ?? 0;
  } while (start);
  return rows;
}

function listRows(response, key = null) {
  const data = key
    ? response?.[key] ?? response?.result?.[key]
    : response;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return Object.values(data).filter((item) => item && typeof item === "object");
  return [];
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
    const amount = money(invoiceAmount(invoice));
    const semantic = statusSemantic(invoiceStageId(invoice));
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
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^UF_CRM_/i.test(text)) return text.toUpperCase();
  if (/^ufCrm_/i.test(text)) return `UF_CRM_${text.slice(6).toUpperCase()}`;
  if (/^ufCrm[A-Z0-9]/.test(text)) {
    return `UF_CRM_${text
      .slice(5)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toUpperCase()}`;
  }
  return text.toUpperCase();
}

function dealFieldToBitrixName(fieldId) {
  const text = String(fieldId || "").trim();
  return normalizeFieldName(text);
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
  const sections = Array.isArray(layout) && layout.length ? layout : defaultDealCardLayout();
  const uniqueFieldNames = [...new Set(fieldNames.filter(Boolean))];
  if (!uniqueFieldNames.length) return sections;

  const targetNames = new Set(uniqueFieldNames);
  const cleanedSections = sections
    .filter((section) => section?.name !== dealSummarySectionName)
    .map((section) => ({
      ...section,
      elements: (section.elements || []).filter((element) => !targetNames.has(String(element.name || "").toUpperCase())),
    }));

  cleanedSections.push({
    name: dealSummarySectionName,
    title: dealSummarySectionTitle,
    type: "section",
    elements: uniqueFieldNames.map((name) => ({ name, optionFlags: 1 })),
  });

  return cleanedSections;
}

function defaultDealCardLayout() {
  return [
    {
      name: "main",
      title: "О сделке",
      type: "section",
      elements: [
        { name: "TITLE", optionFlags: 1 },
        { name: "OPPORTUNITY_WITH_CURRENCY", optionFlags: 0 },
        { name: "STAGE_ID", optionFlags: 0 },
        { name: "CLOSEDATE", optionFlags: 0 },
        { name: "CLIENT", optionFlags: 0 },
      ],
    },
    {
      name: "additional",
      title: "Дополнительно",
      type: "section",
      elements: [
        { name: "TYPE_ID", optionFlags: 0 },
        { name: "SOURCE_ID", optionFlags: 0 },
        { name: "OPENED", optionFlags: 0 },
        { name: "ASSIGNED_BY_ID", optionFlags: 0 },
        { name: "COMMENTS", optionFlags: 0 },
      ],
    },
    {
      name: "products",
      title: "Товары",
      type: "section",
      elements: [{ name: "PRODUCT_ROW_SUMMARY", optionFlags: 0 }],
    },
  ];
}

async function configureDealCardSection(settings) {
  const fieldNames = configuredDealFieldNames(settings);
  if (fieldNames.length < 4) return { ok: false, skipped: true, reason: "Field mapping is incomplete" };

  const attempts = [];
  const categories = await dealCategories();
  const methods = [
    { get: "crm.item.details.configuration.get", set: "crm.item.details.configuration.set", baseParams: { entityTypeId: 2 } },
    { get: "crm.deal.details.configuration.get", set: "crm.deal.details.configuration.set", baseParams: {} },
  ];

  for (const category of categories) {
    for (const method of methods) {
      const extras = { dealCategoryId: category.id };
      let current = null;
      let createdFromDefaultLayout = false;

      try {
        const response = await callMethod(method.get, { ...method.baseParams, scope: "C", extras });
        current = response?.data || response;
      } catch (error) {
        if (isEmptyCardLayoutError(error)) {
          createdFromDefaultLayout = true;
        } else {
          attempts.push({ method: method.get, scope: "C", categoryId: category.id, categoryName: category.name, ok: false, error: error.message });
          continue;
        }
      }

      try {
        const data = mergeDealSummarySection(current, fieldNames);
        await callMethod(method.set, { ...method.baseParams, scope: "C", extras, data });
        attempts.push({
          method: method.set,
          scope: "C",
          categoryId: category.id,
          categoryName: category.name,
          ok: true,
          createdFromDefaultLayout,
        });
        break;
      } catch (error) {
        attempts.push({ method: method.set, scope: "C", categoryId: category.id, categoryName: category.name, ok: false, createdFromDefaultLayout, error: error.message });
      }
    }
  }

  const updatedCategories = attempts.filter((attempt) => attempt.ok);
  if (updatedCategories.length) {
    return {
      ok: updatedCategories.length === categories.length,
      partial: updatedCategories.length !== categories.length,
      sectionName: dealSummarySectionName,
      fieldNames,
      updatedCategories,
      attempts,
      note: "Deal card layouts are funnel-specific; the app updates every accessible deal funnel.",
    };
  }

  return { ok: false, attempts, error: "Could not update deal card layout for any accessible deal funnel" };
}

function isEmptyCardLayoutError(error) {
  return /card layout is empty/i.test(error?.message || "");
}

async function dealCategories() {
  try {
    const response = await callMethod("crm.category.list", { entityTypeId: 2 });
    const categories = response?.categories || response?.result?.categories || [];
    const normalized = categories
      .map((category) => ({
        id: Number(category.id ?? category.ID),
        name: category.name || category.NAME || `Воронка #${category.id ?? category.ID}`,
      }))
      .filter((category) => Number.isFinite(category.id));
    return normalized.length ? normalized : [{ id: 0, name: "Основная" }];
  } catch (error) {
    return [{ id: 0, name: `Основная (${error.message})` }];
  }
}

async function loadInvoiceStages() {
  try {
    const stages = await callList("crm.item.stage.list", { entityTypeId: 31 }, "stages");
    stageMap = new Map(
      stages
        .map((stage) => [stageCode(stage), stageTitle(stage)])
        .filter(([code, title]) => code && title),
    );
  } catch (error) {
    // Если не удалось загрузить стадии, останутся коды.
    stageMap = new Map();
    console.warn("Не удалось загрузить стадии счетов:", error.message);
  }
}

async function loadUsers(userIds = []) {
  try {
    const ids = [...new Set(userIds.map((id) => Number(id)).filter(Boolean))];
    const params = ids.length ? { filter: { ID: ids } } : {};
    const users = await callList("user.get", params);
    userMap = new Map(
      users
        .map((user) => [String(user.ID || user.id), userDisplayName(user)])
        .filter(([id, name]) => id && name),
    );
  } catch (error) {
    // Если не удалось загрузить пользователей, останутся ID.
    userMap = new Map();
    console.warn("Не удалось загрузить пользователей:", error.message);
  }
}

function stageCode(stage) {
  return String(stage?.id || stage?.ID || stage?.statusId || stage?.STATUS_ID || "").trim();
}

function stageTitle(stage) {
  return String(stage?.name || stage?.NAME || stage?.title || stage?.TITLE || "").trim();
}

function userDisplayName(user) {
  return [
    user.LAST_NAME || user.lastName,
    user.NAME || user.name,
    user.SECOND_NAME || user.secondName,
  ].filter(Boolean).join(" ") || user.EMAIL || user.email || user.LOGIN || user.login || "";
}

function invoiceStageId(invoice) {
  return String(invoice.stageId || invoice.STAGE_ID || invoice.stage_id || "").trim();
}

function invoiceStageName(invoice) {
  const id = invoiceStageId(invoice);
  return stageMap.get(id) || id || "Без стадии";
}

function invoiceAssignedById(invoice) {
  return String(invoice.assignedById || invoice.ASSIGNED_BY_ID || invoice.assigned_by_id || "").trim();
}

function invoiceAssignedName(invoice) {
  const id = invoiceAssignedById(invoice);
  return userMap.get(id) || (id ? `ID ${id}` : "");
}

function invoiceAmount(invoice) {
  return invoice.opportunity ?? invoice.OPPORTUNITY ?? invoice.amount ?? invoice.PRICE ?? 0;
}

function invoiceIssuedAt(invoice) {
  return invoice.begindate || invoice.BEGINDATE || invoice.beginDate || invoice.createdTime || invoice.CREATED_TIME || "";
}

function invoiceDeadline(invoice) {
  return invoice.closedate || invoice.CLOSEDATE || invoice.closeDate || "";
}

function fieldLabel(field, userFieldLabels) {
  const id = String(field.FIELD_NAME || field.fieldName || "");
  const normalizedId = normalizeFieldName(id);
  const defaultLabel = defaultFieldLabels.get(normalizedId);
  if (defaultLabel) return defaultLabel;

  const restLabel = field.title || field.formLabel || field.FORM_LABEL || field.EDIT_FORM_LABEL || field.LIST_COLUMN_LABEL;
  if (!restLabel || String(restLabel).toUpperCase() === normalizedId) {
    return userFieldLabels.get(normalizedId) || id;
  }
  return (
    userFieldLabels.get(normalizedId) ||
    restLabel ||
    id
  );
}

function renderFields(fields, userFields, settings) {
  const userFieldLabels = new Map(
    userFields
      .map((field) => [
        String(field.FIELD_NAME || "").toUpperCase(),
        field.EDIT_FORM_LABEL || field.LIST_COLUMN_LABEL || field.LIST_FILTER_LABEL || defaultFieldLabels.get(String(field.FIELD_NAME || "").toUpperCase()) || field.FIELD_NAME,
      ])
      .filter(([fieldName]) => fieldName),
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
    const createFields = {
        FIELD_NAME: name,
        USER_TYPE_ID: "double",
        EDIT_FORM_LABEL: label,
        LIST_COLUMN_LABEL: label,
        LIST_FILTER_LABEL: label,
        ERROR_MESSAGE: "",
        HELP_MESSAGE: "",
        EDIT_IN_LIST: "N",
        SHOW_IN_CARD: "Y",
    };
    const updateFields = {
      EDIT_FORM_LABEL: label,
      LIST_COLUMN_LABEL: label,
      LIST_FILTER_LABEL: label,
      ERROR_MESSAGE: "",
      HELP_MESSAGE: "",
      EDIT_IN_LIST: "N",
      SHOW_IN_CARD: "Y",
    };
    const existingField = byName.get(fieldName);
    if (existingField?.ID) await callMethod("crm.deal.userfield.update", { id: existingField.ID, fields: updateFields });
    else await callMethod("crm.deal.userfield.add", { fields: createFields });
  }
  await saveSettings(defaultSettings);
  return configureDealCardSection(defaultSettings);
}

async function getInvoices(dealId) {
  const response = await callMethod("crm.item.list", {
    entityTypeId: 31,
    filter: { parentId2: Number(dealId) },
      select: [
     	"id",
      	"title",
      	"opportunity",
      	"stageId",
      	"accountNumber",
      	"begindate",          // дата выставления
      	"closedate",          // срок оплаты 
      	"assignedById",       // ответственный (ID пользователя)
    ],
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
  await Promise.all([
    loadInvoiceStages(),
    loadUsers(invoices.map(invoiceAssignedById)),
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

  // Заголовки (можно добавить в HTML или создать прямо здесь)
  const headerRow = document.createElement("div");
  headerRow.className = "invoice-header";
  headerRow.innerHTML = `
    <span>Счёт</span>
    <span>Стадия</span>
    <span>Сумма</span>
    <span>Дата выставления</span>
    <span>Срок оплаты</span>
    <span>Ответственный</span>
  `;
  invoiceList.append(headerRow);

  for (const invoice of result.invoices) {
    const row = document.createElement("div");
    row.className = "invoice-row";

    // Название счета
    const title = document.createElement("a");
    title.href = portalHost ? `https://${portalHost}/crm/type/31/details/${invoice.id}/` : `/crm/type/31/details/${invoice.id}/`;
    title.target = "_blank";
    title.rel = "noopener";
    title.textContent = invoice.accountNumber ? `Счёт № ${invoice.accountNumber}` : invoice.title || `Счёт #${invoice.id}`;
    
    // Стадия (читаемое название)
    const stage = document.createElement("span");
    stage.textContent = invoiceStageName(invoice);

    // Сумма
    const amount = document.createElement("strong");
    amount.textContent = moneyFormat.format(invoiceAmount(invoice));

    // Дата выставления
    const dateIssued = document.createElement("span");
    dateIssued.textContent = invoiceIssuedAt(invoice);

    // Срок оплаты
    const datePay = document.createElement("span");
    datePay.textContent = invoiceDeadline(invoice);

    // Ответственный
    const assignee = document.createElement("span");
    assignee.textContent = invoiceAssignedName(invoice);

    row.append(title, stage, amount, dateIssued, datePay, assignee);
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
    ["ID счета", "Название", "Стадия", "Сумма", "Дата выставления", "Срок оплаты", "Ответственный"],
    ...currentReport.invoices.map((invoice) => [
      invoice.id,
      invoice.title,
      invoiceStageName(invoice),
      invoiceAmount(invoice),
      invoiceIssuedAt(invoice),
      invoiceDeadline(invoice),
      invoiceAssignedName(invoice)
    ]),
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
  try {
    const settings = Object.fromEntries(new FormData(form));
    settings.includeNegativeStages = form.includeNegativeStages.checked;
    await saveSettings(settings);
    let card = null;
    card = await configureDealCardSection(settings);
    setMappingStatus(card?.ok ? "Сопоставление сохранено. Раздел карточки обновлён." : "Сопоставление сохранено. Проверьте журнал.", card?.ok ? "success" : "warning");
    write({ appVersion, settings, dealCard: card });
  } catch (error) {
    setMappingStatus("Ошибка сохранения. Проверьте журнал.", "warning");
    write({ appVersion, ok: false, operation: "save-mapping", error: error.message }, { reveal: true });
  }
});

dealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(dealForm);
    const dealId = Number(dealIdFromText(data.get("dealId")) || dealIdFromText(data.get("dealUrl")));
    if (!dealId) {
      write("Укажите ID сделки или ссылку на сделку.", { reveal: true });
      return;
    }
    dealIdInput.value = dealId;
    const url = dealUrlFromId(dealId);
    if (url) dealUrlInput.value = url;
    write(`Пересчитываю сделку #${dealId}...`, { reveal: true });
    const result = await recalculate(dealId, true);
    renderResult(dealId, result);
    write({ appVersion, ok: true, message: "Поля сделки обновлены.", summary: result.summary }, { reveal: true });
  } catch (error) {
    write({ appVersion, ok: false, operation: "manual-recalculate", error: error.message }, { reveal: true });
  }
});

document.querySelector("#ensureFields").addEventListener("click", async () => {
  try {
    setMappingStatus("Создаю стандартные поля...");
    const card = await ensureFields();
    write({ appVersion, standardFields: "created-or-updated", dealCard: card }, { reveal: !card?.ok });
    await initApp();
    setMappingStatus(card?.ok ? "Поля созданы. Раздел карточки обновлён." : "Поля созданы. Проверьте журнал.", card?.ok ? "success" : "warning");
  } catch (error) {
    setMappingStatus("Ошибка создания полей. Проверьте журнал.", "warning");
    write({ appVersion, ok: false, operation: "ensure-fields", error: error.message }, { reveal: true });
  }
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
