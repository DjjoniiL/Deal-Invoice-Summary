const appVersion = "layout-20260812-5";
const defaultSettings = {
  includeNegativeStages: false,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
  autoRecalcMode: "onOpen",
  autoRecalcWindowDays: 21,
};
const workerPollIntervalMs = 5000;
const workerStatusThrottleMs = 60000;
const workerLockTtlMs = 12000;
const backgroundPlacementCode = "PAGE_BACKGROUND_WORKER";
const workerStatusOption = "dealInvoiceSummaryWorkerStatus";
const workerSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let activeDealId = 0;
let activeUri = "";
let lastDealSnapshot = null;
let monitorTimer = null;
let monitorBusy = false;
let lastStatusWriteAt = 0;
let placementInterfaceDiagnostics = null;

console.info(`Deal Invoice Summary worker ${appVersion}`);

function callMethod(method, params = {}) {
  return new Promise((resolve, reject) => {
    BX24.callMethod(method, params, (result) => {
      if (result.error()) reject(new Error(result.error_description() || result.error()));
      else resolve(result.data());
    });
  });
}

function money(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function sameMoneyValue(left, right) {
  return money(left) === money(right);
}

function statusSemantic(stageId) {
  const suffix = String(stageId || "").split(":").pop();
  if (suffix === "P" || suffix === "WON") return "S";
  if (suffix === "D" || suffix === "LOSE" || suffix === "LOST") return "F";
  return "";
}

function invoiceStageId(invoice) {
  return String(invoice.stageId || invoice.STAGE_ID || invoice.stage_id || "").trim();
}

function invoiceAmount(invoice) {
  return invoice.opportunity ?? invoice.OPPORTUNITY ?? invoice.amount ?? invoice.PRICE ?? 0;
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

  const dealAmount = money(deal.OPPORTUNITY ?? deal.opportunity);
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

function parseSettingsPayload(payload) {
  if (!payload) return {};
  if (typeof payload === "string") return JSON.parse(payload);
  if (typeof payload === "object") {
    const nested = payload.dealInvoiceSummarySettings;
    if (typeof nested === "string") return JSON.parse(nested);
    return payload;
  }
  return {};
}

async function loadSettings() {
  try {
    const stored = await callMethod("app.option.get", { option: "dealInvoiceSummarySettings" });
    return { ...defaultSettings, ...parseSettingsPayload(stored) };
  } catch {
    try {
      return { ...defaultSettings, ...parseSettingsPayload(localStorage.getItem("dealInvoiceSummarySettings")) };
    } catch {
      return { ...defaultSettings };
    }
  }
}

async function saveWorkerStatus(status, { throttle = false } = {}) {
  const now = Date.now();
  if (throttle && now - lastStatusWriteAt < workerStatusThrottleMs) return;
  lastStatusWriteAt = now;
  const payload = {
    appVersion,
    workerSessionId,
    dealId: activeDealId || null,
    uri: activeUri,
    at: new Date().toISOString(),
    ...status,
  };
  const text = JSON.stringify(payload);
  localStorage.setItem(workerStatusOption, text);
  try {
    await callMethod("app.option.set", { options: { [workerStatusOption]: text } });
  } catch {
    // localStorage is enough for in-browser diagnostics when app.option is unavailable.
  }
}

function dealChangeSnapshot(deal) {
  return {
    amount: money(deal.OPPORTUNITY ?? deal.opportunity),
    stageId: String(deal.STAGE_ID || deal.stageId || "").trim(),
  };
}

function sameDealChangeSnapshot(left, right) {
  return Boolean(left && right && sameMoneyValue(left.amount, right.amount) && left.stageId === right.stageId);
}

function buildChangedDealFields(deal, summary, settings) {
  const fields = {};
  for (const [key, value] of Object.entries({
    issuedField: summary.issued,
    paidField: summary.paid,
    unpaidField: summary.unpaid,
    remainingField: summary.remaining,
  })) {
    const field = String(settings[key] || "").trim().toUpperCase();
    if (field && !sameMoneyValue(deal[field], value)) fields[field] = value;
  }
  return fields;
}

async function getInvoices(dealId) {
  const response = await callMethod("crm.item.list", {
    entityTypeId: 31,
    filter: { parentId2: Number(dealId) },
    select: ["id", "opportunity", "stageId", "parentId2"],
  });
  return response.items || response.result?.items || [];
}

function normalizePlacementInterfaceList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return item.event || item.name || item.id || item.code || "";
    return "";
  }).filter(Boolean))];
}

function getPlacementInterface() {
  return new Promise((resolve) => {
    if (!window.BX24?.placement?.getInterface) {
      resolve(null);
      return;
    }
    window.BX24.placement.getInterface((result) => resolve(result || null));
  });
}

function reloadBitrixWindow() {
  return new Promise((resolve) => {
    if (!window.BX24?.reloadWindow) {
      resolve({ ok: false, skipped: true, reason: "reloadWindow unavailable" });
      return;
    }
    try {
      window.BX24.reloadWindow(() => resolve({ ok: true, command: "reloadWindow" }));
    } catch (error) {
      resolve({ ok: false, command: "reloadWindow", error: error.message });
    }
  });
}

async function refreshDealCard() {
  if (!window.BX24?.placement?.call) {
    return reloadBitrixWindow();
  }
  try {
    const info = await getPlacementInterface();
    const commands = normalizePlacementInterfaceList(info?.command);
    const events = normalizePlacementInterfaceList(info?.event);
    placementInterfaceDiagnostics = { commands, events };
    if (!commands.includes("reloadData")) {
      const fallback = await reloadBitrixWindow();
      return {
        ...fallback,
        fallbackFrom: "reloadData unavailable",
        placementInterface: placementInterfaceDiagnostics,
      };
    }
    return await new Promise((resolve) => {
      window.BX24.placement.call("reloadData", {}, (result) => resolve({
        ok: true,
        command: "reloadData",
        result,
        placementInterface: placementInterfaceDiagnostics,
      }));
    });
  } catch (error) {
    const fallback = await reloadBitrixWindow();
    return { ...fallback, fallbackFrom: "reloadData error", error: error.message, placementInterface: placementInterfaceDiagnostics };
  }
}

async function recalculateDeal(dealId, deal, reason) {
  const settings = await loadSettings();
  const invoices = await getInvoices(dealId);
  const summary = summarize(deal, invoices, settings);
  const fields = buildChangedDealFields(deal, summary, settings);
  let updatedFields = {};
  let skippedUpdate = false;
  let cardRefresh = null;

  if (Object.keys(fields).length) {
    await callMethod("crm.deal.update", { id: Number(dealId), fields });
    updatedFields = fields;
    cardRefresh = await refreshDealCard();
  } else {
    skippedUpdate = true;
  }

  await saveWorkerStatus({
    ok: true,
    operation: reason,
    summary,
    updatedFields,
    skippedUpdate,
    cardRefresh,
    snapshot: dealChangeSnapshot(deal),
  });

  return { summary, updatedFields, skippedUpdate, cardRefresh };
}

function workerLockKey(dealId) {
  return `dealInvoiceSummaryWorkerLock:${dealId}`;
}

function claimDealLock(dealId) {
  const key = workerLockKey(dealId);
  const now = Date.now();
  try {
    const current = JSON.parse(localStorage.getItem(key) || "null");
    if (current && current.owner !== workerSessionId && Number(current.expiresAt || 0) > now) return false;
    localStorage.setItem(key, JSON.stringify({ owner: workerSessionId, expiresAt: now + workerLockTtlMs }));
    return true;
  } catch {
    return true;
  }
}

async function checkDeal(reason = "worker-poll") {
  if (!activeDealId || monitorBusy || !claimDealLock(activeDealId)) return;
  monitorBusy = true;
  try {
    const deal = await callMethod("crm.deal.get", { id: Number(activeDealId) });
    const nextSnapshot = dealChangeSnapshot(deal);
    const firstRun = !lastDealSnapshot;
    const changed = !sameDealChangeSnapshot(lastDealSnapshot, nextSnapshot);
    lastDealSnapshot = nextSnapshot;

    if (firstRun) {
      await recalculateDeal(activeDealId, deal, "background-open-recalculate");
      return;
    }

    if (changed) {
      await recalculateDeal(activeDealId, deal, "background-deal-change-recalculate");
    } else {
      await saveWorkerStatus({ ok: true, operation: reason, skipped: true, snapshot: nextSnapshot }, { throttle: true });
    }
  } catch (error) {
    await saveWorkerStatus({ ok: false, operation: reason, error: error.message });
  } finally {
    monitorBusy = false;
  }
}

function parsePlacementOptionsText(value) {
  try {
    return JSON.parse(value || "{}") || {};
  } catch {
    return {};
  }
}

function placementOptionsFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return parsePlacementOptionsText(params.get("PLACEMENT_OPTIONS") || params.get("placement_options") || "{}");
}

function currentPlacementContext() {
  let info = null;
  try {
    info = window.BX24?.placement?.info?.() || null;
  } catch {
    info = null;
  }
  const options = info?.options || placementOptionsFromQuery();
  return {
    placement: info?.placement || "",
    options,
    uri: options.URI || options.uri || document.referrer || "",
  };
}

function dealIdFromUri(uri) {
  const text = decodeURIComponent(String(uri || ""));
  const match = text.match(/\/crm\/deal\/details\/(\d+)(?:\/|\?|#|$)/i)
    || text.match(/\/crm\/deal\/show\/(\d+)(?:\/|\?|#|$)/i);
  return match ? Number(match[1]) : 0;
}

function startWorker() {
  const context = currentPlacementContext();
  activeUri = context.uri;
  activeDealId = dealIdFromUri(activeUri);

  if (!activeDealId) {
    saveWorkerStatus({ ok: true, operation: "background-worker-idle", placement: context.placement }, { throttle: true });
    return;
  }

  saveWorkerStatus({
    ok: true,
    operation: "background-worker-start",
    expectedPlacement: backgroundPlacementCode,
    placement: context.placement,
    pollIntervalMs: workerPollIntervalMs,
  });

  window.setTimeout(() => checkDeal("worker-initial-check"), 1200);
  monitorTimer = window.setInterval(() => checkDeal("worker-poll"), workerPollIntervalMs);
}

function init() {
  if (!window.BX24) return;
  BX24.init(startWorker);
}

window.addEventListener("pagehide", () => {
  if (monitorTimer) window.clearInterval(monitorTimer);
});

init();
