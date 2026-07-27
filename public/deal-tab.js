const numberFormat = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const ids = ["issued", "paid", "unpaid", "remaining"];
const elements = Object.fromEntries(ids.map((id) => [id, document.querySelector(`#${id}`)]));
const dealTitle = document.querySelector("#dealTitle");
const statusNode = document.querySelector("#status");
const invoiceMeta = document.querySelector("#invoiceMeta");
const invoiceList = document.querySelector("#invoiceList");
const coverageText = document.querySelector("#coverageText");
const coverageDonut = document.querySelector("#coverageDonut");
const paymentState = document.querySelector("#paymentState");
const paidSegment = document.querySelector("#paidSegment");
const unpaidSegment = document.querySelector("#unpaidSegment");
const downloadReport = document.querySelector("#downloadReport");

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch {
      return {};
    }
  }
}

function deepFindDealId(value) {
  if (!value || typeof value !== "object") return 0;
  for (const [key, item] of Object.entries(value)) {
    if (/^(dealId|deal_id|entityId|entity_id|id|ID|ENTITY_ID)$/.test(key)) {
      const match = String(item).match(/\d+/);
      if (match) return Number(match[0]);
    }
  }
  for (const item of Object.values(value)) {
    const found = deepFindDealId(item);
    if (found) return found;
  }
  return 0;
}

function getDealId() {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["dealId", "deal_id", "id", "entityId", "ENTITY_ID"]) {
    const value = params.get(key);
    if (value) {
      const match = value.match(/\d+/);
      if (match) return Number(match[0]);
    }
  }

  for (const key of ["PLACEMENT_OPTIONS", "placement_options", "options"]) {
    const value = params.get(key);
    const found = value ? deepFindDealId(parseJson(value)) : 0;
    if (found) return found;
  }

  return 0;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const contentType = response.headers.get("Content-Type") || "unknown content";
    throw new Error(`Сервер вернул не JSON (${response.status}, ${contentType})`);
  }
  if (!response.ok) throw new Error(payload.error || "Ошибка запроса");
  return payload;
}

function setStatus(text, tone = "neutral") {
  statusNode.textContent = text;
  statusNode.dataset.tone = tone;
}

function stageLabel(stageId) {
  const text = String(stageId || "");
  if (text.endsWith(":P") || text === "P") return "Оплачен";
  if (text.endsWith(":D") || text === "D") return "Не оплачен";
  if (text.endsWith(":N") || text === "N") return "Новый";
  if (text.endsWith(":S") || text === "S") return "Отправлен";
  return text || "Без стадии";
}

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function invoicePath(invoiceId) {
  return `/crm/type/31/details/${encodeURIComponent(invoiceId)}/`;
}

function openInvoice(invoiceId) {
  const path = invoicePath(invoiceId);
  if (window.BX24?.init && window.BX24?.openPath) {
    window.BX24.init(() => window.BX24.openPath(path));
    return;
  }
  if (window.BX24?.openPath) {
    window.BX24.openPath(path);
    return;
  }
  window.open(path, "_blank", "noopener");
}

function formatDate(value) {
  if (!value) return "не указана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "не указана";
  return dateFormat.format(date);
}

function render(data) {
  const { summary } = data;
  dealTitle.textContent = `Сделка #${data.dealId}: ${data.dealTitle || "без названия"}`;
  for (const id of ids) elements[id].textContent = numberFormat.format(summary[id] || 0);

  const coverage = summary.dealAmount > 0 ? Math.min(100, Math.round((summary.paid / summary.dealAmount) * 100)) : 0;
  const paidShare = summary.issued > 0 ? Math.round((summary.paid / summary.issued) * 100) : 0;
  const unpaidShare = summary.issued > 0 ? Math.max(0, 100 - paidShare) : 0;

  coverageText.textContent = `${coverage}%`;
  coverageDonut.style.setProperty("--coverage", `${coverage}%`);
  paidSegment.style.width = `${paidShare}%`;
  unpaidSegment.style.width = `${unpaidShare}%`;
  paymentState.textContent = summary.remaining <= 0 ? "Сделка покрыта оплатой" : "Есть остаток к оплате";
  invoiceMeta.textContent = `Всего ${summary.invoiceCount}; в расчёте ${summary.countedInvoiceCount}; пропущено ${summary.skippedNegative}`;

  invoiceList.replaceChildren();
  for (const invoice of data.invoices || []) {
    const row = document.createElement("div");
    row.className = "invoice-row";

    const main = document.createElement("div");
    main.className = "invoice-main";
    const titleNode = document.createElement("button");
    const stageNode = document.createElement("span");
    titleNode.type = "button";
    titleNode.className = "invoice-link";
    titleNode.textContent = invoice.accountNumber ? `Счёт № ${invoice.accountNumber}` : invoice.title || `Счёт #${invoice.id}`;
    titleNode.addEventListener("click", () => openInvoice(invoice.id));
    stageNode.textContent = stageLabel(invoice.stageId);
    main.append(titleNode, stageNode);

    const dateNode = document.createElement("span");
    dateNode.className = "invoice-cell";
    dateNode.textContent = formatDate(invoice.issuedAt);
    dateNode.dataset.label = "Дата выставления";

    const assignedNode = document.createElement("span");
    assignedNode.className = "invoice-cell";
    assignedNode.textContent = invoice.assignedName || (invoice.assignedById ? `ID ${invoice.assignedById}` : "не указан");
    assignedNode.dataset.label = "Ответственный";

    const amountNode = document.createElement("strong");
    amountNode.className = "invoice-amount";
    amountNode.textContent = numberFormat.format(invoice.amount || 0);

    row.append(main, dateNode, assignedNode, amountNode);
    invoiceList.append(row);
  }
  if (!invoiceList.children.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "По сделке пока нет счетов.";
    invoiceList.append(empty);
  }
}

async function load(write = false) {
  const dealId = getDealId();
  if (!dealId) {
    dealTitle.textContent = "ID сделки не передан в контексте вкладки";
    setStatus("Нет ID сделки", "warning");
    return;
  }

  setStatus(write ? "Пересчитываю и записываю..." : "Считаю...");
  const data = write
    ? await api("/api/recalculate/deal", { method: "POST", body: JSON.stringify({ dealId }) })
    : await api(`/api/deal-summary?dealId=${encodeURIComponent(dealId)}`);
  render(data);
  setStatus(write ? "Поля сделки обновлены" : "Расчёт готов", "success");
}

document.querySelector("#recalculate").addEventListener("click", () => {
  load(true).catch((error) => setStatus(error.message, "warning"));
});

downloadReport.addEventListener("click", () => {
  const dealId = getDealId();
  if (!dealId) {
    setStatus("Нет ID сделки", "warning");
    return;
  }
  downloadUrl(`/api/deal-report?dealId=${encodeURIComponent(dealId)}`, `deal-${dealId}-invoice-summary.csv`);
});

load(false).catch((error) => setStatus(error.message, "warning"));
