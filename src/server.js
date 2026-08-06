import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDealPatch, statusSemantic, summarizeInvoices } from "./summary.js";
import { VibeClient, VibeError } from "./vibeClient.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const dataDir = process.env.DATA_DIR || join(root, "data");
const settingsPath = join(dataDir, "settings.json");
const watchlistPath = join(dataDir, "watchlist.json");
const invoiceEntityTypeId = 31;
const dealEntityTypeId = 2;
const dealSummarySectionName = "deal_invoice_summary";
const dealSummarySectionTitle = "Расчёт оплаты счетов";
const autoRecalcWindowDaysOptions = [42, 28, 21, 14, 7, 2];
const defaultAutoRecalcWindowDays = normalizeAutoRecalcWindowDays(
  process.env.AUTO_RECALC_RECENT_HOURS ? Number(process.env.AUTO_RECALC_RECENT_HOURS) / 24 : 21,
);
const autoRecalcIntervalMs = Math.max(60_000, Number(process.env.AUTO_RECALC_INTERVAL_MS || 420_000));
const autoRecalcEnabled = process.env.AUTO_RECALC_ENABLED !== "false";
const wakeSchedule = [
  { cronExpr: "44 9 * * *", timezone: "Europe/Moscow", label: "Morning wake 09:44 MSK" },
  { cronExpr: "44 18 * * *", timezone: "Europe/Moscow", label: "Evening wake 18:44 MSK" },
];
let autoRecalcTimer = null;
let autoRecalcRunning = false;
let lastAutoRecalc = null;

const client = new VibeClient({
  baseUrl: process.env.VIBE_API_BASE_URL,
  apiKey: process.env.VIBE_API_KEY,
});

const defaults = {
  includeNegativeStages: false,
  issuedField: "",
  paidField: "",
  unpaidField: "",
  remainingField: "",
  autoRecalcWindowDays: defaultAutoRecalcWindowDays,
};

function normalizeAutoRecalcWindowDays(value) {
  const days = Number(value);
  return autoRecalcWindowDaysOptions.includes(days) ? days : 21;
}

function normalizeSettings(settings = {}) {
  const clean = { ...defaults, ...settings };
  clean.includeNegativeStages = Boolean(clean.includeNegativeStages);
  clean.autoRecalcWindowDays = normalizeAutoRecalcWindowDays(clean.autoRecalcWindowDays);
  return clean;
}

async function readSettings() {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsPath, "utf8")));
  } catch {
    return { ...defaults };
  }
}

async function saveSettings(settings) {
  await mkdir(dataDir, { recursive: true });
  const clean = normalizeSettings(settings);
  await writeFile(settingsPath, JSON.stringify(clean, null, 2));
  return clean;
}

async function readWatchlist() {
  try {
    const payload = JSON.parse(await readFile(watchlistPath, "utf8"));
    return {
      dealIds: [...new Set((payload.dealIds || []).map(Number).filter(Boolean))],
      updatedAt: payload.updatedAt || null,
    };
  } catch {
    return { dealIds: [], updatedAt: null };
  }
}

async function saveWatchlist(dealIds) {
  await mkdir(dataDir, { recursive: true });
  const clean = {
    dealIds: [...new Set(dealIds.map(Number).filter(Boolean))].sort((a, b) => a - b),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(watchlistPath, JSON.stringify(clean, null, 2));
  return clean;
}

async function trackDealId(dealId) {
  const normalizedDealId = normalizeDealId(dealId);
  if (!normalizedDealId) return readWatchlist();
  const watchlist = await readWatchlist();
  if (watchlist.dealIds.includes(normalizedDealId)) return watchlist;
  return saveWatchlist([...watchlist.dealIds, normalizedDealId]);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendCsv(res, filename, csv) {
  const safeName = filename.replace(/[^a-z0-9._-]/gi, "-");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeName}"`,
  });
  res.end(`\uFEFF${csv}`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function readText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function assignFormValue(target, key, value) {
  const parts = [...key.matchAll(/[^\][[]+/g)].map((match) => match[0]);
  if (!parts.length) return;

  let node = target;
  for (const part of parts.slice(0, -1)) {
    node[part] = node[part] && typeof node[part] === "object" ? node[part] : {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

export function parseBitrixForm(text) {
  const payload = {};
  for (const [key, value] of new URLSearchParams(text)) {
    assignFormValue(payload, key, value);
  }
  return payload;
}

function changedDealPatch(deal, patch) {
  return Object.fromEntries(
    Object.entries(patch).filter(([field, value]) => moneyEquivalent(deal[field]) !== moneyEquivalent(value)),
  );
}

function moneyEquivalent(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : value;
}

export function fieldOptions(fields) {
  return Object.entries(fields)
    .filter(([, field]) => !field.readonly && ["money", "number", "double", "integer", "string"].includes(field.type))
    .map(([id, field]) => ({ id, label: field.label || id, type: field.type }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

export function dealFieldToBitrixName(fieldId) {
  const text = String(fieldId || "").trim();
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

function configuredDealFieldNames(settings) {
  return [
    settings.issuedField,
    settings.paidField,
    settings.unpaidField,
    settings.remainingField,
  ]
    .map(dealFieldToBitrixName)
    .filter(Boolean);
}

export function mergeDealSummarySection(layout, fieldNames) {
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

export function normalizeDealId(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

async function getInvoiceStatuses() {
  const all = await client.get("/v1/statuses?limit=200");
  return (all.data || []).filter((status) => String(status.entityId || "").includes("INVOICE"));
}

async function getInvoicesForDeal(dealId) {
  const response = await client.post("/v1/invoices/search", {
    filter: { parentId2: Number(dealId) },
    limit: 200,
  });
  return response.data || [];
}

async function recentInvoiceDealIds(hours = autoRecalcRecentHours) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const invoiceResponse = await client.post("/v1/invoices/search", {
    filter: { createdTime: { $gte: since } },
    limit: 500,
  });
  const dealIds = [...new Set((invoiceResponse.data || []).map((invoice) => Number(invoice.parentId2)).filter(Boolean))];
  return { since, dealIds };
}

function userDisplayName(user) {
  return [user.lastName, user.name, user.secondName].filter(Boolean).join(" ") || user.email || `ID ${user.id}`;
}

async function getUsersMap(userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();

  const response = await client.post("/v1/users/search", {
    filter: { id: { $in: ids } },
    limit: Math.min(200, ids.length),
  });

  return new Map((response.data || []).map((user) => [Number(user.id), userDisplayName(user)]));
}

export function invoiceStageName(invoice, statuses) {
  const stageId = String(invoice.stageId ?? "");
  const found = statuses.find((status) => String(status.statusId ?? status.STATUS_ID) === stageId);
  return found?.name || found?.NAME || stageId || "Без стадии";
}

export function invoiceCalculationGroup(invoice, statuses, includeNegativeStages) {
  const semantic = statusSemantic(invoice.stageId, statuses);
  if (semantic === "S") return "Оплаченный";
  if (semantic === "F" && !includeNegativeStages) return "Пропущен";
  return "Неоплаченный";
}

export function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

export function reportDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU");
}

export function buildDealReport(data) {
  const rows = [
    ["Отчет по оплате счетов сделки"],
    ["Сделка", `#${data.dealId} ${data.dealTitle || ""}`.trim()],
    [],
    ["Итог", "Сумма"],
    ["Сумма сделки", data.summary.dealAmount],
    ["Выставлено счетов", data.summary.issued],
    ["Оплачено счетов", data.summary.paid],
    ["Не оплачено счетов", data.summary.unpaid],
    ["Остаток оплаты", data.summary.remaining],
    ["Всего счетов", data.summary.invoiceCount],
    ["В расчете", data.summary.countedInvoiceCount],
    ["Пропущено отрицательных стадий", data.summary.skippedNegative],
    [],
    ["ID счета", "Номер счета", "Название", "Стадия", "Дата выставления", "Ответственный", "Сумма", "Расчетная группа"],
  ];

  for (const invoice of data.invoices) {
    rows.push([
      invoice.id,
      invoice.accountNumber,
      invoice.title,
      invoice.stageName,
      reportDate(invoice.issuedAt),
      invoice.assignedName || (invoice.assignedById ? `ID ${invoice.assignedById}` : ""),
      invoice.amount,
      invoice.calculationGroup,
    ]);
  }

  return toCsv(rows);
}

async function calculateDeal(dealId, settings = null, statuses = null, write = false) {
  const normalizedDealId = normalizeDealId(dealId);
  if (!normalizedDealId) throw new Error("dealId is required");

  const activeSettings = settings || (await readSettings());
  const [dealResponse, invoices, invoiceStatuses] = await Promise.all([
    client.get(`/v1/deals/${encodeURIComponent(normalizedDealId)}`),
    getInvoicesForDeal(normalizedDealId),
    statuses ? Promise.resolve(statuses) : getInvoiceStatuses(),
  ]);

  const deal = dealResponse.data;
  const users = await getUsersMap(invoices.map((invoice) => invoice.assignedById));
  const summary = summarizeInvoices(deal, invoices, {
    includeNegativeStages: activeSettings.includeNegativeStages,
    statuses: invoiceStatuses,
  });

  const patch = buildDealPatch(summary, activeSettings);
  const changedPatch = changedDealPatch(deal, patch);
  if (write && Object.keys(changedPatch).length) {
    await client.patch(`/v1/deals/${encodeURIComponent(normalizedDealId)}`, changedPatch);
  }

  return {
    dealId: normalizedDealId,
    dealTitle: deal.title,
    summary,
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      title: invoice.title,
      amount: invoice.opportunity,
      stageId: invoice.stageId,
      stageName: invoiceStageName(invoice, invoiceStatuses),
      calculationGroup: invoiceCalculationGroup(invoice, invoiceStatuses, activeSettings.includeNegativeStages),
      accountNumber: invoice.accountNumber,
      issuedAt: invoice.begindate || invoice.createdTime || invoice.createdAt || null,
      assignedById: invoice.assignedById || null,
      assignedName: users.get(Number(invoice.assignedById)) || null,
    })),
    updatedFields: write ? changedPatch : {},
  };
}

async function recalculateDeal(dealId, settings = null, statuses = null) {
  const result = await calculateDeal(dealId, settings, statuses, true);
  await trackDealId(result.dealId);
  return result;
}

async function recalculateRecent(hours = defaultAutoRecalcWindowDays * 24) {
  const settings = await readSettings();
  const statuses = await getInvoiceStatuses();
  const { since, dealIds } = await recentInvoiceDealIds(hours);
  const results = [];
  for (const dealId of dealIds) {
    try {
      results.push(await recalculateDeal(dealId, settings, statuses));
    } catch (error) {
      results.push({ dealId, error: error.message });
    }
  }

  return { since, recentHours: hours, dealCount: dealIds.length, results };
}

async function recalculateWatchedAndRecent(hours) {
  const settings = await readSettings();
  const statuses = await getInvoiceStatuses();
  const watchlist = await readWatchlist();
  const windowHours = Number(hours) || settings.autoRecalcWindowDays * 24;
  const recent = await recentInvoiceDealIds(windowHours);
  const dealIds = [...new Set([...watchlist.dealIds, ...recent.dealIds])];
  const results = [];

  for (const dealId of dealIds) {
    try {
      results.push(await recalculateDeal(dealId, settings, statuses));
    } catch (error) {
      results.push({ dealId, error: error.message });
    }
  }

  return {
    since: recent.since,
    recentHours: windowHours,
    recentDays: settings.autoRecalcWindowDays,
    trackedDealCount: watchlist.dealIds.length,
    recentDealCount: recent.dealIds.length,
    dealCount: dealIds.length,
    results,
  };
}

async function runAutoRecalculation(trigger = "timer") {
  if (autoRecalcRunning) {
    return { ok: true, skipped: true, reason: "Auto recalculation already running", trigger };
  }

  autoRecalcRunning = true;
  const startedAt = new Date().toISOString();
  try {
    const result = await recalculateWatchedAndRecent();
    lastAutoRecalc = { ok: true, trigger, startedAt, finishedAt: new Date().toISOString(), ...result };
    return lastAutoRecalc;
  } catch (error) {
    lastAutoRecalc = { ok: false, trigger, startedAt, finishedAt: new Date().toISOString(), error: error.message };
    return lastAutoRecalc;
  } finally {
    autoRecalcRunning = false;
  }
}

function automationStatus(settings = defaults) {
  const recentDays = normalizeAutoRecalcWindowDays(settings.autoRecalcWindowDays);
  return {
    enabled: autoRecalcEnabled,
    intervalMs: autoRecalcIntervalMs,
    recentDays,
    recentHours: recentDays * 24,
    windowDayOptions: autoRecalcWindowDaysOptions,
    wakeSchedule,
    running: autoRecalcRunning,
    lastRun: lastAutoRecalc,
  };
}

function startAutoRecalculation() {
  if (!autoRecalcEnabled || autoRecalcTimer) return automationStatus();
  const initialTimer = setTimeout(() => {
    runAutoRecalculation("startup").catch((error) => {
      lastAutoRecalc = { ok: false, trigger: "startup", finishedAt: new Date().toISOString(), error: error.message };
    });
  }, 10_000);
  initialTimer.unref?.();
  autoRecalcTimer = setInterval(() => {
    runAutoRecalculation("timer").catch((error) => {
      lastAutoRecalc = { ok: false, trigger: "timer", finishedAt: new Date().toISOString(), error: error.message };
    });
  }, autoRecalcIntervalMs);
  autoRecalcTimer.unref?.();
  return automationStatus();
}

function isInvoiceEvent(event, fields) {
  const name = String(event || "").toUpperCase();
  const entityType = Number(fields.ENTITY_TYPE_ID || fields.entityTypeId || fields.entityTypeID || fields.entity_type_id);
  return entityType === invoiceEntityTypeId || name.includes("INVOICE");
}

function eventDealId(event, fields) {
  const name = String(event || "").toUpperCase();
  if (name.includes("DEAL")) return normalizeDealId(fields.ID || fields.id);
  return normalizeDealId(fields.PARENT_ID_2 || fields.parentId2 || fields.parent_id_2 || fields.DEAL_ID || fields.dealId);
}

async function eventInvoiceDealId(fields) {
  const direct = eventDealId("", fields);
  if (direct) return direct;

  const invoiceId = normalizeDealId(fields.ID || fields.id);
  if (!invoiceId) return 0;

  const response = await client.get(`/v1/invoices/${encodeURIComponent(invoiceId)}`);
  return normalizeDealId(response.data?.parentId2 || response.data?.PARENT_ID_2);
}

export async function handleBitrixEvent(payload) {
  const event = String(payload.event || "");
  const fields = payload.data?.FIELDS || payload.data?.fields || {};
  let dealId = eventDealId(event, fields);

  if (!dealId && isInvoiceEvent(event, fields)) {
    dealId = await eventInvoiceDealId(fields);
  }

  if (!dealId) {
    return { ok: true, skipped: true, reason: "No linked deal id", event };
  }

  const result = await recalculateDeal(dealId);
  return { ok: true, event, dealId, updatedFields: result.updatedFields };
}

async function ensureFields() {
  const wanted = [
    ["UF_CRM_INV_SUM_ISSUED", "Сумма выставленных счетов"],
    ["UF_CRM_INV_SUM_PAID", "Сумма оплаченных счетов"],
    ["UF_CRM_INV_SUM_UNPAID", "Сумма неоплаченных счетов"],
    ["UF_CRM_INV_SUM_REMAINING", "Остаток оплаты по счетам"],
  ];
  const current = await client.get("/v1/userfields/deals");
  const existing = new Set((current.data || []).map((field) => field.FIELD_NAME || field.fieldName));
  const created = [];

  for (const [fieldName, label] of wanted) {
    if (existing.has(fieldName)) continue;
    const response = await client.post("/v1/userfields/deals", { fieldName, userTypeId: "double", label });
    created.push(response.data || { fieldName, label });
  }

  const settings = await saveSettings({
    ...(await readSettings()),
    issuedField: "ufCrmInvSumIssued",
    paidField: "ufCrmInvSumPaid",
    unpaidField: "ufCrmInvSumUnpaid",
    remainingField: "ufCrmInvSumRemaining",
  });

  return { created, settings };
}

async function restrictDealFieldsInList(fieldNames) {
  const wanted = new Set(fieldNames.map((name) => name.toUpperCase()));
  if (!wanted.size) return [];

  const current = await client.get("/v1/userfields/deals");
  const fields = current.data || [];
  const results = [];

  for (const field of fields) {
    const fieldName = String(field.FIELD_NAME || field.fieldName || "").toUpperCase();
    const fieldId = Number(field.ID || field.id);
    if (!wanted.has(fieldName) || !fieldId) continue;

    try {
      await client.patch(`/v1/userfields/deals/${encodeURIComponent(fieldId)}`, { editInList: "N" });
      results.push({ fieldName, fieldId, editInList: "N", updated: true });
    } catch (error) {
      results.push({ fieldName, fieldId, editInList: "N", updated: false, error: error.message });
    }
  }

  return results;
}

async function ensureDealCardSection(settings) {
  const fieldNames = configuredDealFieldNames(settings);
  if (fieldNames.length < 4) {
    return {
      ok: false,
      skipped: true,
      reason: "Field mapping is incomplete",
      fieldNames,
    };
  }

  const current = await client.get(`/v1/crm/card-config/${dealEntityTypeId}?scope=C`);
  if (current.data === null) {
    return {
      ok: false,
      skipped: true,
      reason: "Common deal card layout is not explicitly configured; refusing to replace the default layout",
      fieldNames,
    };
  }

  const data = mergeDealSummarySection(current.data, fieldNames);
  await client.put(`/v1/crm/card-config/${dealEntityTypeId}`, { scope: "C", data });
  const fieldRestrictions = await restrictDealFieldsInList(fieldNames);

  return {
    ok: true,
    sectionName: dealSummarySectionName,
    sectionTitle: dealSummarySectionTitle,
    fieldNames,
    fieldRestrictions,
    editRestrictionNote:
      "VibeCode userfields API supports editInList only; card-level role-based readonly for non-admin users is not exposed by this API.",
  };
}

async function routeApi(req, res, pathname) {
  if (pathname === "/api/health") return sendJson(res, 200, { ok: true });

  if (pathname === "/api/bootstrap") {
    const [settings, fields, me, watchlist] = await Promise.all([
      readSettings(),
      client.get("/v1/deals/fields"),
      client.get("/v1/me"),
      readWatchlist(),
    ]);
    return sendJson(res, 200, {
      settings,
      fields: fieldOptions(fields.data.fields),
      portal: me.data.portal,
      accessMode: me.data.accessMode,
      automation: { ...automationStatus(settings), trackedDealCount: watchlist.dealIds.length },
    });
  }

  if (pathname === "/api/settings" && req.method === "POST") {
    const settings = await saveSettings(await readJson(req));
    let dealCard = null;
    try {
      dealCard = await ensureDealCardSection(settings);
    } catch (error) {
      dealCard = { ok: false, error: error.message };
    }
    return sendJson(res, 200, { settings, dealCard });
  }

  if (pathname === "/api/fields/ensure" && req.method === "POST") {
    const result = await ensureFields();
    try {
      result.dealCard = await ensureDealCardSection(result.settings);
    } catch (error) {
      result.dealCard = { ok: false, error: error.message };
    }
    return sendJson(res, 200, result);
  }

  if (pathname === "/api/recalculate/deal" && req.method === "POST") {
    const { dealId } = await readJson(req);
    if (!dealId) return sendJson(res, 400, { error: "dealId is required" });
    return sendJson(res, 200, await recalculateDeal(dealId));
  }

  if (pathname === "/api/deal-summary" && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const dealId = normalizeDealId(url.searchParams.get("dealId"));
    if (!dealId) return sendJson(res, 400, { error: "dealId is required" });
    return sendJson(res, 200, await calculateDeal(dealId));
  }

  if (pathname === "/api/deal-report" && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const dealId = normalizeDealId(url.searchParams.get("dealId"));
    if (!dealId) return sendJson(res, 400, { error: "dealId is required" });
    const data = await calculateDeal(dealId);
    return sendCsv(res, `deal-${dealId}-invoice-summary.csv`, buildDealReport(data));
  }

  if (pathname === "/api/recalculate/recent" && req.method === "POST") {
    const body = await readJson(req);
    const settings = await readSettings();
    const days = body.days ? normalizeAutoRecalcWindowDays(body.days) : settings.autoRecalcWindowDays;
    const hours = Number(body.hours) || days * 24;
    return sendJson(res, 200, await recalculateRecent(hours));
  }

  if (pathname === "/api/automation/status" && req.method === "GET") {
    const [settings, watchlist] = await Promise.all([readSettings(), readWatchlist()]);
    return sendJson(res, 200, { ...automationStatus(settings), trackedDealIds: watchlist.dealIds });
  }

  if (pathname === "/api/automation/run" && req.method === "POST") {
    await runAutoRecalculation("manual");
    const [settings, watchlist] = await Promise.all([readSettings(), readWatchlist()]);
    return sendJson(res, 200, { ...automationStatus(settings), trackedDealCount: watchlist.dealIds.length });
  }

  if (pathname === "/api/events/bitrix24" && req.method === "POST") {
    const payload = parseBitrixForm(await readText(req));
    const expectedToken = process.env.BITRIX_APPLICATION_TOKEN;
    const actualToken = payload.auth?.application_token;
    if (expectedToken && actualToken !== expectedToken) {
      return sendJson(res, 403, { ok: false, error: "Invalid application token" });
    }
    return sendJson(res, 200, await handleBitrixEvent(payload));
  }

  sendJson(res, 404, { error: "Not found" });
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname === "/deal-tab" ? "/deal-tab.html" : pathname;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: "Forbidden" });

  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  const stream = createReadStream(filePath);
  stream.on("error", () => sendJson(res, 404, { error: "Not found" }));
  res.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
  stream.pipe(res);
}

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) await routeApi(req, res, url.pathname);
      else serveStatic(res, url.pathname);
    } catch (error) {
      const status = error instanceof VibeError ? 502 : 500;
      sendJson(res, status, { error: error.message, details: error.details });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
    console.log(`Deal Invoice Summary is running on port ${process.env.PORT || 3000}`);
    startAutoRecalculation();
  });
}
