const defaultSettings = {
  includeNegativeStages: false,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
  autoRecalcMode: "onOpen",
  autoRecalcWindowDays: 30,
  calculationCategoryId: "all",
};
const runtimeVersion = "layout-20260814-7";
const appVersion = "Deal Invoice Summary v.25 Marketplace B24";
const dealSummarySectionName = "deal_invoice_summary";
const dealSummarySectionTitle = "Расчёт оплаты счетов";
const defaultFieldLabels = new Map([
  ["UF_CRM_INV_SUM_ISSUED", "Сумма выставленных счетов"],
  ["UF_CRM_INV_SUM_PAID", "Сумма оплаченных счетов"],
  ["UF_CRM_INV_SUM_UNPAID", "Сумма неоплаченных счетов"],
  ["UF_CRM_INV_SUM_REMAINING", "Остаток оплаты сделки"],
]);
const defaultMappingKeys = ["issuedField", "paidField", "unpaidField", "remainingField"];
const settingsPageFileName = "settings.html";
const defaultSetupVersionOption = "dealInvoiceSummaryDefaultSetupVersion";
const userCalculationSettingsOption = "dealInvoiceSummaryUserCalculationSettings";

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
const openAppSettingsButton = document.querySelector("#openAppSettings");
const automationMode = document.querySelector("#automationMode");
const automationCategoryName = document.querySelector("#automationCategoryName");
const autoRecalcWindowDays = document.querySelector("#autoRecalcWindowDays");
const automationTracked = document.querySelector("#automationTracked");
const automationLastRun = document.querySelector("#automationLastRun");
const automationSchedule = document.querySelector("#automationSchedule");
const automationProgress = document.querySelector("#automationProgress");
const automationProgressText = document.querySelector("#automationProgressText");
const automationProgressValue = document.querySelector("#automationProgressValue");
const automationProgressBar = document.querySelector("#automationProgressBar");
const automationElapsed = document.querySelector("#automationElapsed");
const recentButton = document.querySelector("#recent");
const serverStatusButton = document.querySelector("#serverStatusButton");
const serverSupportModal = document.querySelector("#serverSupportModal");
const serverSupportIntro = document.querySelector("#serverSupportIntro");
const serverSupportDetails = document.querySelector("#serverSupportDetails");
const closeServerSupportModal = document.querySelector("#closeServerSupportModal");
const requestServerSupport = document.querySelector("#requestServerSupport");
const windowReportModal = document.querySelector("#windowReportModal");
const windowReportText = document.querySelector("#windowReportText");
const closeWindowReportModal = document.querySelector("#closeWindowReportModal");
const viewWindowStatsButton = document.querySelector("#viewWindowStats");
const downloadWindowReportButton = document.querySelector("#downloadWindowReport");
const windowConfirmModal = document.querySelector("#windowConfirmModal");
const windowConfirmText = document.querySelector("#windowConfirmText");
const cancelWindowCalculation = document.querySelector("#cancelWindowCalculation");
const confirmWindowCalculation = document.querySelector("#confirmWindowCalculation");
const windowStatsButton = document.querySelector("#windowStatsButton");
const windowStatsModal = document.querySelector("#windowStatsModal");
const closeWindowStatsModal = document.querySelector("#closeWindowStatsModal");
const windowStatsText = document.querySelector("#windowStatsText");
const windowStatsChart = document.querySelector("#windowStatsChart");
const invoiceAnalyticsTitle = document.querySelector("#invoiceAnalyticsTitle");
const windowSummary = document.querySelector("#windowSummary");
const windowSummaryNodes = {
  issued: document.querySelector("#windowIssued"),
  paid: document.querySelector("#windowPaid"),
  unpaid: document.querySelector("#windowUnpaid"),
  remaining: document.querySelector("#windowRemaining"),
};
const windowStatsNodes = {
  paidAmount: document.querySelector("#statsPaidAmount"),
  unpaidAmount: document.querySelector("#statsUnpaidAmount"),
  emptyAmount: document.querySelector("#statsEmptyAmount"),
  deals: document.querySelector("#statsDeals"),
  issued: document.querySelector("#statsIssued"),
  paid: document.querySelector("#statsPaid"),
  unpaid: document.querySelector("#statsUnpaid"),
  remaining: document.querySelector("#statsRemaining"),
};
const noticeAction = document.querySelector(".notice-action");
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
let stageDiagnostics = null;
let serverSupport = { connected: false };
let currentSettings = { ...defaultSettings };
let lastWindowReport = null;
let windowReportState = null;
let windowChartState = { slices: [], hoveredIndex: -1 };
let pendingWindowCalculation = null;
let automationElapsedTimer = null;
let automationElapsedStart = 0;
let currentContextDealId = null;
let contextDealSnapshot = null;
let contextDealMonitorTimer = null;
let contextDealRecalculateBusy = false;
let contextDealMonitorEventsBound = false;
let placementInterfaceDiagnostics = null;
let canManageMapping = false;
const serverOnlyModes = ["continuous", "twiceDaily"];
const contextDealMonitorIntervalMs = 5000;

console.info(`Deal Invoice Summary Marketplace ${appVersion}`);

function setLogVisible(visible) {
  resultNode.hidden = !visible;
  logToggle.setAttribute("aria-expanded", String(visible));
}

function write(value, { reveal = false } = {}) {
  resultNode.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (reveal && !resultNode.hidden) setLogVisible(true);
}

function setMappingStatus(text, tone = "neutral") {
  mappingStatus.textContent = text;
  mappingStatus.dataset.tone = tone;
}

const serverSupportModeDetails = {
  continuous: "Режим «Постоянный»: сервер просыпается каждый час с 8:30 до 20:30, работает по 15 мин, с двойным пересчётом каждые 7 мин.\nИтого 3 ч 15 мин/сутки, до 200 руб/мес за 30 рабочих дней.",
  twiceDaily: "Режим «Утром и вечером»: сервер включается в 09:45 и 18:45, работает по 15 мин, с двойным пересчётом каждые 7 мин.\nИтого 30 мин/сутки, до 145 руб/мес за 30 рабочих дней.",
  onChange: "Режим «При изменении сделки/счёта» работает в Marketplace через фоновый виджет Bitrix24 на открытых страницах портала: приложение отслеживает сохранённые изменения суммы или стадии открытой сделки и пересчитывает поля без внешнего backend.",
};

const automationModeView = {
  onOpen: {
    schedule: "при открытии карточки",
    interval: "без фонового запуска",
    wake: "не требуется",
  },
  onChange: {
    schedule: "при изменении сделки/счёта",
    interval: "каждые 5 секунд на открытой карточке",
    wake: "не требуется",
  },
  twiceDaily: {
    schedule: "в 9:45 утра И в 18:45 вечера",
    interval: "дважды после пробуждения, каждые 7 мин",
    wake: "2 раза в сутки",
  },
  continuous: {
    schedule: "Каждый час с 09:00 до 20:00",
    interval: "дважды после пробуждения, каждые 7 мин",
    wake: "каждый час",
  },
};

function renderAutomationModeDetails() {
  const details = automationModeView[automationMode.value] || automationModeView.onOpen;
  if (automationSchedule) automationSchedule.textContent = details.schedule;
  const automationInterval = document.querySelector("#automationInterval");
  const automationWake = document.querySelector("#automationWake");
  if (automationInterval) automationInterval.textContent = details.interval;
  if (automationWake) automationWake.textContent = details.wake;
}

function showServerSupportModal(mode = automationMode.value) {
  if (serverSupport.connected) return;
  serverSupportIntro.textContent = "Автоматический пересчёт требует аренды сервера на платформе VibeCode. Если Вам это необходимо, напишите нам через кнопку «Обратиться».";
  serverSupportDetails.textContent = serverSupportModeDetails[mode] || "";
  serverSupportModal.hidden = false;
}

function hideServerSupportModal() {
  serverSupportModal.hidden = true;
  if (!serverSupport.connected && serverOnlyModes.includes(automationMode.value)) {
    automationMode.value = "onOpen";
    renderAutomationModeDetails();
  }
}

function requestServerSupportAction() {
  hideServerSupportModal();
  openOpenLine();
  write({
    appVersion,
    ok: true,
    operation: "server-support-request",
    message: "Заявка на серверную версию: открываем линию поддержки.",
  }, { reveal: true });
}

function openOpenLine() {
  const selectors = [
    ".b24-widget-button-openline_livechat",
    ".b24-widget-button-social-item",
    ".b24-widget-button-inner-container",
    ".b24-widget-button-wrapper",
  ];
  const target = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  if (target) {
    target.click();
    return;
  }
  window.location.href = marketplaceFileUrl(settingsPageFileName, { openChat: "1" });
}

function marketplaceFileUrl(fileName, extraParams = {}) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/[^/]*$/i, fileName);
  url.search = "";
  url.searchParams.set("v", runtimeVersion);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  url.hash = "";
  return url.toString();
}

function showWindowReportModal(report) {
  lastWindowReport = report;
  windowReportText.textContent = `Отчёт за период ${windowPeriodLabel(report.days)} сформирован. Сделок в отчёте: ${report.dealCount}.`;
  windowReportModal.hidden = false;
}

function hideWindowReportModal() {
  windowReportModal.hidden = true;
}

function formatProcessingTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes <= 0) return `${restSeconds} сек`;
  return `${minutes} мин ${restSeconds} сек`;
}

function estimateCalculationSeconds(dealCount) {
  const count = Number(dealCount) || 0;
  if (count <= 0) return 0;
  const secondsPerDeal = 15;
  return Math.max(30, Math.ceil((count * secondsPerDeal) / 30) * 30);
}

function showWindowConfirmModal(preflight) {
  pendingWindowCalculation = preflight;
  const dealCount = preflight.recent.dealIds.length;
  const estimate = formatProcessingTime(estimateCalculationSeconds(dealCount));
  windowConfirmText.textContent = `В расчётный период попало сделок: ${dealCount}. Предварительная оценка времени расчёта: ${estimate}. Запускаем расчёт?`;
  windowConfirmModal.hidden = false;
}

function hideWindowConfirmModal() {
  windowConfirmModal.hidden = true;
  pendingWindowCalculation = null;
}

function setAutomationProgress(text, percent, { visible = true, tone = "active" } = {}) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  automationProgress.hidden = !visible;
  automationProgress.dataset.tone = tone;
  automationProgress.dataset.progress = safePercent >= 75 ? "high" : safePercent >= 35 ? "mid" : "low";
  automationProgressText.textContent = text;
  automationProgressValue.textContent = `${safePercent}%`;
  automationProgressBar.style.width = `${safePercent}%`;
}

function updateAutomationElapsed() {
  if (!automationElapsedStart) return;
  const elapsedSeconds = Math.floor((Date.now() - automationElapsedStart) / 5000) * 5;
  automationElapsed.textContent = `Время обработки: ${formatProcessingTime(elapsedSeconds)}.`;
}

function startAutomationElapsed() {
  stopAutomationElapsed();
  automationElapsedStart = Date.now();
  automationElapsed.hidden = false;
  updateAutomationElapsed();
  automationElapsedTimer = window.setInterval(updateAutomationElapsed, 1000);
}

function stopAutomationElapsed({ hide = true } = {}) {
  if (automationElapsedTimer) window.clearInterval(automationElapsedTimer);
  automationElapsedTimer = null;
  if (hide) automationElapsed.hidden = true;
}

function finishAutomationElapsed() {
  if (!automationElapsedStart) return 0;
  const elapsedSeconds = Math.round((Date.now() - automationElapsedStart) / 1000);
  stopAutomationElapsed();
  automationElapsedStart = 0;
  return elapsedSeconds;
}

function buildWindowSummary(report) {
  const results = report?.results || [];
  const includedResults = results.filter((item) => !item.skippedCategory);
  const okResults = includedResults.filter((item) => item.ok);
  const totals = okResults.reduce((acc, item) => {
    acc.issued += money(item.summary?.issued);
    acc.paid += money(item.summary?.paid);
    acc.unpaid += money(item.summary?.unpaid);
    acc.remaining += money(item.summary?.remaining);
    return acc;
  }, { issued: 0, paid: 0, unpaid: 0, remaining: 0 });

  const status = includedResults.reduce((acc, item) => {
    if (!item.ok) {
      acc.error += 1;
      return acc;
    }
    const invoiceCount = Number(item.summary?.invoiceCount || 0);
    const dealSemantic = dealSemanticFromResult(item);
    let group = dealSemantic === "S" ? "paid" : "unpaid";
    if (!invoiceCount) group = "empty";
    acc.counts[group] += 1;
    acc.amounts[group] += windowStatusAmount(item, group);
    return acc;
  }, {
    counts: { paid: 0, unpaid: 0, empty: 0, error: 0 },
    amounts: { paid: 0, unpaid: 0, empty: 0 },
  });

  const dealCount = Number(report?.dealCount ?? includedResults.length) || includedResults.length;
  return {
    ...totals,
    dealCount,
    status,
  };
}

function chartPointerPosition(event) {
  const rect = windowStatsChart.getBoundingClientRect();
  const scaleX = windowStatsChart.width / rect.width;
  const scaleY = windowStatsChart.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function hitTestChartSlice(point) {
  const cx = windowStatsChart.width / 2;
  const cy = windowStatsChart.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < windowChartState.innerRadius || distance > windowChartState.outerRadius) return -1;
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;
  return windowChartState.slices.findIndex((slice) => angle >= slice.start && angle <= slice.end);
}

function drawDealStatusChart(hoveredIndex = -1) {
  const ctx = windowStatsChart.getContext("2d");
  const width = windowStatsChart.width;
  const height = windowStatsChart.height;
  const cx = width / 2;
  const cy = height / 2;
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "butt";
  if (!windowChartState.slices.length) {
    ctx.beginPath();
    ctx.arc(cx, cy, windowChartState.radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#d0d5dd";
    ctx.lineWidth = windowChartState.strokeWidth;
    ctx.stroke();
    ctx.fillStyle = "#172033";
    ctx.font = "700 46px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("0", cx, cy);
    return;
  }
  for (const [index, slice] of windowChartState.slices.entries()) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, windowChartState.radius, slice.start - Math.PI / 2, slice.end - Math.PI / 2);
    ctx.strokeStyle = slice.color;
    ctx.lineWidth = index === hoveredIndex ? windowChartState.strokeWidth + 10 : windowChartState.strokeWidth;
    ctx.stroke();
    ctx.restore();
  }
  const hovered = windowChartState.slices[hoveredIndex];
  if (hovered) {
    const mid = (hovered.start + hovered.end) / 2 - Math.PI / 2;
    const labelRadius = (windowChartState.innerRadius + windowChartState.outerRadius) / 2;
    ctx.fillStyle = "#fff";
    ctx.font = "800 54px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(23, 32, 51, .45)";
    ctx.shadowBlur = 10;
    ctx.fillText(String(hovered.value), cx + Math.cos(mid) * labelRadius, cy + Math.sin(mid) * labelRadius);
  }
}

function renderDealStatusChart(summary) {
  const statuses = [
    { key: "paid", label: "Завершено сделок", value: summary.status.counts.paid, color: "#23b47e" },
    { key: "unpaid", label: "Сделок ожидают доплаты", value: summary.status.counts.unpaid, color: "#2b7de9" },
    { key: "empty", label: "Сделок без счетов", value: summary.status.counts.empty, color: "#d0d5dd" },
  ];
  const total = statuses.reduce((sum, item) => sum + item.value, 0);
  const radius = 252;
  const strokeWidth = 112;
  windowChartState = {
    radius,
    strokeWidth,
    innerRadius: radius - strokeWidth / 2,
    outerRadius: radius + strokeWidth / 2,
    hoveredIndex: -1,
    slices: [],
  };
  let start = 0;
  if (total) {
    windowChartState.slices = statuses.filter((item) => item.value > 0).map((item) => {
      const end = start + (item.value / total) * Math.PI * 2;
      const slice = { ...item, start, end };
      start = end;
      return slice;
    });
  }
  drawDealStatusChart(-1);
}

function updateChartHover(event) {
  if (!windowChartState.slices.length) return;
  const hoveredIndex = hitTestChartSlice(chartPointerPosition(event));
  if (hoveredIndex === windowChartState.hoveredIndex) return;
  windowChartState.hoveredIndex = hoveredIndex;
  drawDealStatusChart(hoveredIndex);
}

function clearChartHover() {
  if (windowChartState.hoveredIndex === -1) return;
  windowChartState.hoveredIndex = -1;
  drawDealStatusChart(-1);
}

function renderWindowSummary(report) {
  windowReportState = {
    days: normalizeWindowDays(report.days),
    categoryId: settingsCategoryId(report.settings),
    report,
  };
  lastWindowReport = report;
  const summary = buildWindowSummary(report);
  for (const [key, node] of Object.entries(windowSummaryNodes)) {
    if (node) node.textContent = moneyFormat.format(summary[key]);
  }
  windowSummary.hidden = false;
  windowStatsButton.disabled = false;
  return summary;
}

function resetWindowSummary() {
  windowReportState = null;
  lastWindowReport = null;
  windowSummary.hidden = true;
  windowStatsButton.disabled = true;
  setAutomationProgress("", 0, { visible: false });
}

function restoreWindowSummaryForPeriod(days) {
  const selectedCategoryId = settingsCategoryId(currentSettings);
  if (!windowReportState || windowReportState.days !== normalizeWindowDays(days) || windowReportState.categoryId !== selectedCategoryId) {
    resetWindowSummary();
    return;
  }
  renderWindowSummary(windowReportState.report);
}

function renderWindowStats(report) {
  const summary = buildWindowSummary(report);
  renderDealStatusChart(summary);
  windowStatsText.textContent = `Период: ${windowPeriodLabel(report.days)}.`;
  invoiceAnalyticsTitle.textContent = `Аналитика счетов за период ${windowPeriodLabel(report.days)}`;
  windowStatsNodes.paidAmount.textContent = moneyFormat.format(summary.status.amounts.paid);
  windowStatsNodes.unpaidAmount.textContent = moneyFormat.format(summary.status.amounts.unpaid);
  windowStatsNodes.emptyAmount.textContent = moneyFormat.format(summary.status.amounts.empty);
  windowStatsNodes.deals.textContent = String(summary.dealCount);
  windowStatsNodes.issued.textContent = moneyFormat.format(summary.issued);
  windowStatsNodes.paid.textContent = moneyFormat.format(summary.paid);
  windowStatsNodes.unpaid.textContent = moneyFormat.format(summary.unpaid);
  windowStatsNodes.remaining.textContent = moneyFormat.format(summary.remaining);
}

function showWindowStatsModal() {
  if (!lastWindowReport) return;
  renderWindowStats(lastWindowReport);
  windowStatsModal.hidden = false;
}

function hideWindowStatsModal() {
  windowStatsModal.hidden = true;
}

function formatLastRun(value) {
  if (!value) return "Пока не запускался";
  return new Date(value).toLocaleString("ru-RU", { hour12: false });
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
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.items)) return data.items;
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

function dealStageSemantic(stageId) {
  const suffix = String(stageId || "").split(":").pop().toUpperCase();
  if (suffix === "WON") return "S";
  if (suffix === "LOSE" || suffix === "LOST" || suffix === "D") return "F";
  return "P";
}

function dealSemanticFromResult(item) {
  const semantic = String(
    item.deal?.STAGE_SEMANTIC_ID
      || item.deal?.stageSemanticId
      || item.deal?.SEMANTIC_ID
      || item.deal?.semanticId
      || "",
  ).trim().toUpperCase();
  if (semantic === "S" || semantic === "SUCCESS") return "S";
  if (semantic === "F" || semantic === "FAILURE") return "F";
  return dealStageSemantic(item.deal?.STAGE_ID || item.deal?.stageId || "");
}

function windowStatusAmount(item, group) {
  const dealAmount = money(item.summary?.dealAmount);
  if (dealAmount) return dealAmount;
  const directDealAmount = money(item.deal?.OPPORTUNITY ?? item.deal?.opportunity);
  if (directDealAmount) return directDealAmount;
  if (group === "paid") return money(item.summary?.paid || item.summary?.issued);
  if (group === "unpaid") return money(item.summary?.remaining || item.summary?.unpaid || item.summary?.issued);
  return money(item.summary?.issued);
}

function dealCategoryId(deal) {
  const value = deal?.CATEGORY_ID ?? deal?.categoryId ?? deal?.category_id ?? 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function settingsCategoryId(settings) {
  const value = settings?.calculationCategoryId;
  if (value === undefined || value === null || value === "" || value === "all") return "all";
  const number = Number(value);
  return Number.isFinite(number) ? number : "all";
}

function dealMatchesCalculationCategory(deal, settings) {
  const selected = settingsCategoryId(settings);
  return selected === "all" || dealCategoryId(deal) === selected;
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

async function loadSettings() {
  return (await loadSettingsState()).settings;
}

async function loadSettingsState() {
  try {
    const stored = await callMethod("app.option.get", { option: "dealInvoiceSummarySettings" });
    const parsed = parseSettingsObject(stored);
    return { settings: { ...defaultSettings, ...parsed, ...loadUserCalculationSettings() }, hasStoredSettings: Boolean(stored) && Object.keys(parsed).length > 0 };
  } catch {
    return { settings: { ...defaultSettings, ...loadUserCalculationSettings() }, hasStoredSettings: false };
  }
}

async function readAppOption(option) {
  try {
    return await callMethod("app.option.get", { option });
  } catch {
    return localStorage.getItem(option);
  }
}

function parseServerSupport(value) {
  if (!value) return null;
  if (value === true || value === "true") return { connected: true };
  if (typeof value === "string") {
    try {
      return parseServerSupport(JSON.parse(value));
    } catch {
      return value.trim() ? { connected: true, value } : null;
    }
  }
  if (typeof value === "object") {
    const connected = Boolean(value.connected || value.enabled || value.serverId || value.serverUrl || value.url);
    return connected ? { connected: true, ...value } : null;
  }
  return null;
}

async function loadServerSupport() {
  const options = [
    "dealInvoiceSummaryServerSupport",
    "dealInvoiceSummaryServer",
    "dealInvoiceSummaryServerUrl",
    "dealInvoiceSummaryBackendUrl",
  ];
  for (const option of options) {
    const detected = parseServerSupport(await readAppOption(option));
    if (detected) return { option, ...detected };
  }
  return { connected: false };
}

function parseJsonOption(value, fallback) {
  try {
    if (!value) return fallback;
    if (typeof value === "string") return JSON.parse(value);
    return value;
  } catch {
    return fallback;
  }
}

function parseSettingsObject(value) {
  const parsed = parseJsonOption(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function loadCachedDealCategories() {
  try {
    const stored = await callMethod("app.option.get", { option: "dealInvoiceSummaryDealCategories" });
    const categories = parseJsonOption(stored, []);
    return Array.isArray(categories) ? categories : [];
  } catch {
    return [];
  }
}

async function renderCalculationCategory(settings) {
  const selected = settingsCategoryId(settings);
  if (selected === "all") {
    automationCategoryName.textContent = "Все воронки";
    return;
  }
  const categories = await loadCachedDealCategories();
  const match = categories.find((category) => Number(category.id ?? category.ID) === selected);
  automationCategoryName.textContent = match?.name || match?.NAME || `Воронка #${selected}`;
}

function renderServerSupport() {
  serverStatusButton.textContent = serverSupport.connected
    ? "Серверная поддержка подключена"
    : "Автопересчёт доступен с сервером";
  document.querySelectorAll(".server-only").forEach((node) => {
    node.hidden = !serverSupport.connected;
  });
}

function normalizeWindowDays(value) {
  const allowed = [30, 90, 180];
  const days = Number(value);
  return allowed.includes(days) ? days : 30;
}

function windowPeriodLabel(value) {
  const days = normalizeWindowDays(value);
  if (days === 180) return "6 мес";
  if (days === 90) return "3 мес";
  return "1 мес";
}

function parseUserCalculationSettings(value) {
  const parsed = parseSettingsObject(value);
  const settings = {};
  if (parsed.calculationCategoryId !== undefined) settings.calculationCategoryId = parsed.calculationCategoryId;
  if (parsed.autoRecalcWindowDays !== undefined) settings.autoRecalcWindowDays = normalizeWindowDays(parsed.autoRecalcWindowDays);
  return settings;
}

function loadUserCalculationSettings() {
  return parseUserCalculationSettings(localStorage.getItem(userCalculationSettingsOption));
}

async function saveUserCalculationSettings(settings) {
  const payload = {
    calculationCategoryId: settingsCategoryId(settings),
    autoRecalcWindowDays: normalizeWindowDays(settings.autoRecalcWindowDays),
  };
  localStorage.setItem(userCalculationSettingsOption, JSON.stringify(payload));
  currentSettings = { ...currentSettings, ...payload };
  await renderCalculationCategory(currentSettings);
}

async function saveSettings(settings) {
  localStorage.setItem("dealInvoiceSummarySettings", JSON.stringify(settings));
  try {
    await callMethod("app.option.set", { options: { dealInvoiceSummarySettings: JSON.stringify(settings) } });
  } catch {
    // Local storage keeps the app usable if app.option is unavailable in a dev install.
  }
}

async function saveDefaultSetupVersion() {
  try {
    await callMethod("app.option.set", { options: { [defaultSetupVersionOption]: runtimeVersion } });
  } catch {
    // Version marker is a convenience for upgrades; field setup itself remains the source of truth.
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
    const normalized = [{ id: 0, name: "Основная" }, ...categories
      .map((category) => ({
        id: Number(category.id ?? category.ID),
        name: category.name || category.NAME || `Воронка #${category.id ?? category.ID}`,
      }))
      .filter((category) => Number.isFinite(category.id))]
      .filter((category, index, list) => list.findIndex((item) => item.id === category.id) === index);
    return normalized.length ? normalized : [{ id: 0, name: "Основная" }];
  } catch (error) {
    return [{ id: 0, name: `Основная (${error.message})` }];
  }
}

async function loadInvoiceStages(stageIds = []) {
  const requested = [...new Set(stageIds.filter(Boolean))];
  const attempts = [];
  const stages = [];

  try {
    const itemStages = await callList("crm.item.stage.list", { entityTypeId: 31 }, "stages");
    attempts.push({ method: "crm.item.stage.list", ok: true, count: itemStages.length });
    stages.push(...itemStages);
  } catch (error) {
    attempts.push({ method: "crm.item.stage.list", ok: false, error: error.message });
  }

  stages.push(...await loadInvoiceStatusStages(requested, attempts));
  stages.push(...await loadInvoiceStatusStagesFromTypes(requested, attempts));
  stageMap = new Map(
    stages
      .flatMap((stage) => stageCodes(stage).map((code) => [code, stageTitle(stage)]))
      .filter(([code, title]) => code && title),
  );

  const unresolved = requested.filter((stageId) => !stageMap.has(stageId));
  stageDiagnostics = {
    requested,
    resolvedCount: stageMap.size,
    unresolved,
    attempts,
  };

  if (unresolved.length) {
    console.warn("Не удалось сопоставить стадии счетов:", unresolved.join(", "));
  }
}

async function loadInvoiceStatusStages(stageIds = [], attempts = []) {
  const entityRequests = [...new Map(
    stageIds
      .flatMap((stageId) => invoiceStageEntityIds(stageId).map((entityId) => [`${stagePrefix(stageId)}|${entityId}`, { prefix: stagePrefix(stageId), entityId }]))
      .filter(([, request]) => request.prefix && request.entityId),
  ).values()];
  const stages = [];
  for (const { prefix, entityId } of entityRequests) {
    try {
      const rows = await callList("crm.status.list", { order: { SORT: "ASC" }, filter: { ENTITY_ID: entityId } });
      attempts.push({ method: "crm.status.list", filter: { ENTITY_ID: entityId }, ok: true, count: rows.length });
      stages.push(...rows.map((row) => ({ ...row, __stagePrefix: prefix })));
    } catch (error) {
      attempts.push({ method: "crm.status.list", filter: { ENTITY_ID: entityId }, ok: false, error: error.message });
    }
  }

  for (const stageId of stageIds) {
    const prefix = stagePrefix(stageId);
    for (const entityId of invoiceStageEntityIds(stageId)) {
      try {
        const rows = await callList("crm.status.list", { filter: { ENTITY_ID: entityId, STATUS_ID: stageId } });
        attempts.push({ method: "crm.status.list", filter: { ENTITY_ID: entityId, STATUS_ID: stageId }, ok: true, count: rows.length });
        stages.push(...rows.map((row) => ({ ...row, __stagePrefix: prefix })));
      } catch (error) {
        attempts.push({ method: "crm.status.list", filter: { ENTITY_ID: entityId, STATUS_ID: stageId }, ok: false, error: error.message });
      }
    }
  }

  return stages;
}

async function loadInvoiceStatusStagesFromTypes(stageIds = [], attempts = []) {
  const requestedPrefixes = new Set(
    stageIds
      .map((stageId) => String(stageId || "").split(":")[0])
      .filter(Boolean),
  );
  if (!requestedPrefixes.size) return [];

  try {
    const types = await callList("crm.status.entity.types");
    const matchedTypes = types.filter((type) => {
      const prefix = String(type.PREFIX || type.prefix || "").trim();
      const entityTypeId = Number(type.ENTITY_TYPE_ID || type.entityTypeId || 0);
      return entityTypeId === 31 && requestedPrefixes.has(prefix);
    });
    attempts.push({
      method: "crm.status.entity.types",
      ok: true,
      count: types.length,
      matched: matchedTypes.map((type) => ({
        ID: type.ID || type.id,
        PREFIX: type.PREFIX || type.prefix,
        CATEGORY_ID: type.CATEGORY_ID || type.categoryId,
      })),
    });

    const stages = [];
    for (const type of matchedTypes) {
      const entityId = String(type.ID || type.id || "").trim();
      const prefix = String(type.PREFIX || type.prefix || "").trim();
      if (!entityId) continue;
      try {
        const rows = await callList("crm.status.list", { order: { SORT: "ASC" }, filter: { ENTITY_ID: entityId } });
        attempts.push({ method: "crm.status.list", source: "entity.types", filter: { ENTITY_ID: entityId }, ok: true, count: rows.length });
        stages.push(...rows.map((row) => ({ ...row, __stagePrefix: prefix })));
      } catch (error) {
        attempts.push({ method: "crm.status.list", source: "entity.types", filter: { ENTITY_ID: entityId }, ok: false, error: error.message });
      }
    }
    return stages;
  } catch (error) {
    attempts.push({ method: "crm.status.entity.types", ok: false, error: error.message });
    return [];
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
  return String(stage?.statusId || stage?.STATUS_ID || stage?.id || stage?.ID || "").trim();
}

function stageCodes(stage) {
  return [...new Set([stageCode(stage), statusStageCode(stage)].filter(Boolean))];
}

function statusStageCode(stage) {
  const entityId = String(stage?.entityId || stage?.ENTITY_ID || "").trim();
  const statusId = String(stage?.statusId || stage?.STATUS_ID || stage?.id || stage?.ID || "").trim();
  const prefix = String(stage?.__stagePrefix || "").trim();
  if (statusId.includes(":")) return statusId;
  if (prefix && statusId && !statusId.includes(":")) return `${prefix}:${statusId}`;
  const match = entityId.match(/^(?:DYNAMIC_31_STAGE|SMART_INVOICE_STAGE)_(\d+)$/i);
  return match && statusId && !statusId.includes(":") ? `DT31_${match[1]}:${statusId}` : "";
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

function stagePrefix(stageId) {
  const match = String(stageId || "").match(/^DT31_(\d+):/i);
  return match ? `DT31_${match[1]}` : "";
}

function invoiceStageEntityIds(stageId) {
  const match = String(stageId || "").match(/^DT31_(\d+):/i);
  return match
    ? [`SMART_INVOICE_STAGE_${match[1]}`, `DYNAMIC_31_STAGE_${match[1]}`, "SMART_INVOICE_STAGE", "DYNAMIC_31_STAGE"]
    : [];
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
  return formatDateOnly(invoice.begindate || invoice.BEGINDATE || invoice.beginDate || invoice.createdTime || invoice.CREATED_TIME);
}

function invoiceDeadline(invoice) {
  return formatDateOnly(invoice.closedate || invoice.CLOSEDATE || invoice.closeDate);
}

function formatDateOnly(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}.${isoDate[2]}.${isoDate[1]}`;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function localizedLabel(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(localizedLabel).find(Boolean) || "";
  if (typeof value === "object") {
    for (const key of ["ru", "RU", "en", "EN", "text", "TEXT", "value", "VALUE"]) {
      const label = localizedLabel(value[key]);
      if (label) return label;
    }
    return Object.values(value).map(localizedLabel).find(Boolean) || "";
  }
  return String(value).trim();
}

function isSymbolicFieldLabel(label, normalizedId) {
  const text = String(label || "").trim();
  if (!text) return true;
  const upper = text.toUpperCase();
  return upper === normalizedId || /^UF_CRM(_|$)/i.test(text) || /^UFCRM[A-Z0-9_]+$/i.test(text);
}

function readableFieldType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  const labels = {
    double: "число",
    integer: "целое число",
    money: "деньги",
    string: "строка",
  };
  return labels[normalized] || "поле";
}

function firstHumanLabel(field, normalizedId) {
  const directKeys = [
    "formLabel",
    "FORM_LABEL",
    "EDIT_FORM_LABEL",
    "editFormLabel",
    "LIST_COLUMN_LABEL",
    "listColumnLabel",
    "LIST_FILTER_LABEL",
    "listFilterLabel",
    "LANG_EDIT_FORM_LABEL",
    "LANG_LIST_COLUMN_LABEL",
    "LANG_LIST_FILTER_LABEL",
    "label",
    "LABEL",
    "name",
    "NAME",
    "title",
    "TITLE",
  ];
  for (const key of directKeys) {
    const label = localizedLabel(field?.[key]);
    if (!isSymbolicFieldLabel(label, normalizedId)) return label;
  }
  for (const [key, value] of Object.entries(field || {})) {
    if (!/(LABEL|TITLE|NAME)/i.test(key)) continue;
    const label = localizedLabel(value);
    if (!isSymbolicFieldLabel(label, normalizedId)) return label;
  }
  return "";
}

function fieldLabel(field, userFieldLabels) {
  const id = String(field.FIELD_NAME || field.fieldName || "");
  const normalizedId = normalizeFieldName(id);
  const defaultLabel = defaultFieldLabels.get(normalizedId);
  if (defaultLabel) return defaultLabel;

  const userLabel = userFieldLabels.get(normalizedId);
  if (userLabel) return userLabel;

  return firstHumanLabel(field, normalizedId);
}

function uniqueHumanLabel(label, fallback, usedLabels) {
  const base = String(label || fallback || "Поле сделки").trim();
  let text = base;
  let index = 2;
  while (usedLabels.has(text.toLocaleLowerCase("ru"))) {
    text = `${base} ${index}`;
    index += 1;
  }
  usedLabels.add(text.toLocaleLowerCase("ru"));
  return text;
}

function renderFields(fields, userFields, settings) {
  const userFieldLabels = new Map(
    userFields
      .map((field) => {
        const fieldName = normalizeFieldName(field.FIELD_NAME || field.fieldName || field.ID || field.id);
        const label = firstHumanLabel(field, fieldName);
        return [
          fieldName,
          label || defaultFieldLabels.get(fieldName) || "",
        ];
      })
      .filter(([fieldName]) => fieldName),
  );
  const usedLabels = new Set();
  const available = Object.entries(fields)
    .filter(([, field]) => ["double", "integer", "money", "string"].includes(field.type || field.TYPE || field.USER_TYPE_ID))
    .map(([id, field], index) => {
      const type = field.type || field.TYPE || field.USER_TYPE_ID || "";
      const normalizedId = normalizeFieldName(id);
      const label = fieldLabel({ ...field, FIELD_NAME: id }, userFieldLabels);
      return {
        id,
        type,
        label: uniqueHumanLabel(label, defaultFieldLabels.get(normalizedId) || `Поле сделки ${index + 1}`, usedLabels),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  for (const select of form.querySelectorAll("select")) {
    select.replaceChildren(new Option("Не записывать", ""));
    for (const field of available) select.add(new Option(`${field.label} (${readableFieldType(field.type)})`, normalizeFieldName(field.id)));
    select.value = normalizeFieldName(settings[select.name]);
  }
}

function standardFieldsExist(userFields) {
  const existing = new Set(userFields.map((field) => normalizeFieldName(field.FIELD_NAME || field.fieldName)));
  return defaultMappingKeys.every((key) => existing.has(defaultSettings[key]));
}

async function canManageCrmSettings() {
  try {
    return Boolean(await callMethod("user.admin"));
  } catch {
    return Boolean(window.BX24?.isAdmin?.());
  }
}

function setMappingAccess(allowed) {
  canManageMapping = allowed;
  form.querySelectorAll("select, input, button").forEach((node) => {
    node.disabled = !allowed;
  });
  if (openAppSettingsButton) openAppSettingsButton.disabled = false;
  form.dataset.access = allowed ? "admin" : "locked";
}

async function ensureDefaultSetupIfNeeded(settingsState, userFields) {
  if (!canManageMapping) return { settings: settingsState.settings, userFields, fields: null, card: null };
  const setupVersion = await readAppOption(defaultSetupVersionOption);
  if (setupVersion === runtimeVersion && settingsState.hasStoredSettings && standardFieldsExist(userFields)) {
    return { settings: settingsState.settings, userFields, fields: null, card: null };
  }
  const card = await ensureFields();
  const [settings, fields, refreshedUserFields] = await Promise.all([
    loadSettings(),
    callMethod("crm.deal.fields"),
    callList("crm.deal.userfield.list"),
  ]);
  return { settings, fields, userFields: refreshedUserFields, card };
}

async function ensureFields() {
  const wanted = [
    ["INV_SUM_ISSUED", "Сумма выставленных счетов"],
    ["INV_SUM_PAID", "Сумма оплаченных счетов"],
    ["INV_SUM_UNPAID", "Сумма неоплаченных счетов"],
    ["INV_SUM_REMAINING", "Остаток оплаты сделки"],
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
  const existingSettings = await loadSettings();
  const settings = {
    ...existingSettings,
    issuedField: defaultSettings.issuedField,
    paidField: defaultSettings.paidField,
    unpaidField: defaultSettings.unpaidField,
    remainingField: defaultSettings.remainingField,
    calculationCategoryId: "all",
  };
  await saveSettings(settings);
  const card = await configureDealCardSection(settings);
  await saveDefaultSetupVersion();
  return card;
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

async function getRecentInvoiceDealIds(days) {
  const since = new Date(Date.now() - normalizeWindowDays(days) * 24 * 60 * 60 * 1000).toISOString();
  const attempts = [];
  const invoices = [];
  for (const fieldName of ["createdTime", "begindate"]) {
    try {
      const rows = await callList("crm.item.list", {
        entityTypeId: 31,
        filter: { [`>=${fieldName}`]: since },
        select: ["id", "parentId2", fieldName],
      }, "items");
      attempts.push({ method: "crm.item.list", filter: `>=${fieldName}`, ok: true, count: rows.length });
      invoices.push(...rows);
      if (rows.length) break;
    } catch (error) {
      attempts.push({ method: "crm.item.list", filter: `>=${fieldName}`, ok: false, error: error.message });
    }
  }
  const dealIds = [...new Set(invoices.map((invoice) => Number(invoice.parentId2 || invoice.PARENT_ID_2)).filter(Boolean))];
  return { since, invoiceCount: invoices.length, dealIds, attempts };
}

async function getRecentDeals(days, settings) {
  const since = new Date(Date.now() - normalizeWindowDays(days) * 24 * 60 * 60 * 1000).toISOString();
  const attempts = [];
  const deals = [];
  const select = ["ID", "TITLE", "OPPORTUNITY", "STAGE_ID", "STAGE_SEMANTIC_ID", "SEMANTIC_ID", "CATEGORY_ID", "DATE_CREATE", "BEGINDATE"];
  const selectedCategory = settingsCategoryId(settings);
  const categoryFilter = selectedCategory === "all" ? {} : { CATEGORY_ID: selectedCategory };
  for (const fieldName of ["DATE_CREATE", "BEGINDATE"]) {
    try {
      const rows = await callList("crm.deal.list", {
        order: { [fieldName]: "DESC" },
        filter: { ...categoryFilter, [`>=${fieldName}`]: since },
        select,
      });
      attempts.push({ method: "crm.deal.list", filter: `>=${fieldName}`, ok: true, count: rows.length });
      deals.push(...rows);
    } catch (error) {
      attempts.push({ method: "crm.deal.list", filter: `>=${fieldName}`, ok: false, error: error.message });
    }
  }
  const byId = new Map(
    deals
      .map((deal) => [Number(deal.ID || deal.id), deal])
      .filter(([dealId]) => Number.isFinite(dealId) && dealId > 0),
  );
  const dealIds = [...byId.keys()];
  return { since, dealCount: dealIds.length, dealIds, deals: [...byId.values()], attempts };
}

async function recalculateDealsInWindow() {
  const days = normalizeWindowDays(autoRecalcWindowDays.value);
  const settings = await loadSettings();
  currentSettings = { ...settings, autoRecalcWindowDays: days };
  recentButton.disabled = true;
  setAutomationProgress("Ищу сделки в выбранном окне...", 10);
  try {
    const [recent, invoiceWindow] = await Promise.all([
      getRecentDeals(days, currentSettings),
      getRecentInvoiceDealIds(days),
    ]);
    recent.invoiceCount = invoiceWindow.invoiceCount;
    recent.invoiceDealIds = invoiceWindow.dealIds;
    recent.attempts = [...recent.attempts, ...invoiceWindow.attempts];
    automationTracked.textContent = String(recent.dealIds.length);
    showWindowConfirmModal({ days, settings: currentSettings, recent });
  } catch (error) {
    setAutomationProgress("Ошибка подготовки расчёта", 100, { tone: "warning" });
    write({ appVersion, ok: false, operation: "marketplace-window-preflight", error: error.message });
  } finally {
    recentButton.disabled = false;
  }
}

async function runWindowCalculation(preflight) {
  const { days, recent } = preflight;
  recentButton.disabled = true;
  startAutomationElapsed();
  try {
    if (!recent.dealIds.length) {
      const elapsedSeconds = finishAutomationElapsed();
      const elapsedText = formatProcessingTime(elapsedSeconds);
      setAutomationProgress(`Сделок для пересчёта не найдено. Время обработки ${elapsedText}.`, 100, { tone: "warning" });
      automationLastRun.textContent = formatLastRun(new Date().toISOString());
      const report = { appVersion, ok: true, operation: "marketplace-window-recalculate", days, settings: currentSettings, ...recent, dealCount: 0, results: [], processingTimeSeconds: elapsedSeconds };
      renderWindowSummary(report);
      write({ ...report, message: "Сделок за выбранный период нет. Отчёт сформирован и готов к скачиванию." });
      showWindowReportModal(report);
      return;
    }

    const results = [];
    for (let index = 0; index < recent.dealIds.length; index += 1) {
      const dealId = recent.dealIds[index];
      const percent = Math.round(((index + 1) / recent.dealIds.length) * 86) + 10;
      setAutomationProgress(`Пересчитываю сделку #${dealId}...`, Math.min(percent, 96));
      try {
        const result = await recalculate(dealId, true);
        results.push({
          dealId,
          ok: true,
          title: result.deal.TITLE || "",
          deal: result.deal,
          summary: result.summary,
          skippedCategory: Boolean(result.skippedCategory),
          stageLookup: stageDiagnostics,
        });
      } catch (error) {
        results.push({ dealId, ok: false, error: error.message });
      }
    }

    const ok = results.every((result) => result.ok);
    const elapsedSeconds = finishAutomationElapsed();
    const elapsedText = formatProcessingTime(elapsedSeconds);
    setAutomationProgress(ok ? `Пересчёт сделок завершён. Время обработки ${elapsedText}.` : `Пересчёт завершён с ошибками. Время обработки ${elapsedText}.`, 100, { tone: ok ? "success" : "warning" });
    automationLastRun.textContent = formatLastRun(new Date().toISOString());
    const includedDealCount = results.filter((result) => result.ok && !result.skippedCategory).length;
    automationTracked.textContent = String(includedDealCount);
    const report = { appVersion, ok, operation: "marketplace-window-recalculate", days, settings: currentSettings, ...recent, dealCount: includedDealCount, results, processingTimeSeconds: elapsedSeconds };
    renderWindowSummary(report);
    write({ ...report, message: "Пересчёт завершён. Отчёт сформирован и готов к скачиванию." });
    showWindowReportModal(report);
  } catch (error) {
    finishAutomationElapsed();
    setAutomationProgress("Ошибка пересчёта сделок", 100, { tone: "warning" });
    write({ appVersion, ok: false, operation: "marketplace-window-recalculate", error: error.message });
  } finally {
    recentButton.disabled = false;
  }
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

function renderDealTitle(dealId, deal, summary) {
  dealTitle.replaceChildren();
  dealTitle.append(`В сделке с ID ${dealId} `);
  const dealLink = document.createElement("a");
  dealLink.href = dealUrlFromId(dealId) || "#";
  dealLink.target = "_blank";
  dealLink.rel = "noopener";
  dealLink.textContent = deal.TITLE || "без названия";
  dealTitle.append(dealLink, ` закреплена сумма ${moneyFormat.format(summary.dealAmount || 0)}`);
}

function sameMoneyValue(left, right) {
  return money(left) === money(right);
}

function isBlankCrmValue(value) {
  return value === undefined || value === null || String(value).trim() === "";
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
    const field = settings[key];
    if (field && (isBlankCrmValue(deal[field]) || !sameMoneyValue(deal[field], value))) fields[field] = value;
  }
  return fields;
}

async function recalculateContextDeal(reason = "context-deal-recalculate") {
  if (!currentContextDealId || contextDealRecalculateBusy) return;
  contextDealRecalculateBusy = true;
  try {
    const result = await recalculate(currentContextDealId, true, { refreshCard: true });
    contextDealSnapshot = dealChangeSnapshot(result.deal);
    renderResult(currentContextDealId, result);
    write({
      appVersion,
      ok: true,
      operation: reason,
      message: result.skippedUpdate ? "Поля сделки уже актуальны." : "Поля сделки обновлены.",
      updatedFields: result.updatedFields,
      cardRefresh: result.cardRefresh,
      placementInterface: placementInterfaceDiagnostics,
    });
  } catch (error) {
    write({ appVersion, ok: false, operation: reason, error: error.message }, { reveal: true });
  } finally {
    contextDealRecalculateBusy = false;
  }
}

async function checkContextDealChanges() {
  if (!currentContextDealId || contextDealRecalculateBusy) return;
  try {
    const deal = await callMethod("crm.deal.get", { id: Number(currentContextDealId) });
    const nextSnapshot = dealChangeSnapshot(deal);
    if (!sameDealChangeSnapshot(contextDealSnapshot, nextSnapshot)) {
      contextDealSnapshot = nextSnapshot;
      await recalculateContextDeal("open-deal-change-recalculate");
    }
  } catch (error) {
    write({ appVersion, ok: false, operation: "open-deal-change-check", error: error.message }, { reveal: true });
  }
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

async function refreshDealCard() {
  if (!window.BX24?.placement?.call) return { ok: false, skipped: true, reason: "placement.call unavailable" };
  try {
    const info = await getPlacementInterface();
    const commands = normalizePlacementInterfaceList(info?.command);
    const events = normalizePlacementInterfaceList(info?.event);
    placementInterfaceDiagnostics = { commands, events };
    if (!commands.includes("reloadData")) {
      return { ok: false, skipped: true, reason: "reloadData unavailable", placementInterface: placementInterfaceDiagnostics };
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
    return { ok: false, command: "reloadData", error: error.message, placementInterface: placementInterfaceDiagnostics };
  }
}

async function bindContextPlacementEvents() {
  if (!window.BX24?.placement?.bindEvent) return;
  try {
    const info = await getPlacementInterface();
    const commands = normalizePlacementInterfaceList(info?.command);
    const events = normalizePlacementInterfaceList(info?.event);
    placementInterfaceDiagnostics = { commands, events };
    for (const eventName of events) {
      window.BX24.placement.bindEvent(eventName, () => {
        checkContextDealChanges();
      });
    }
  } catch (error) {
    placementInterfaceDiagnostics = { ok: false, error: error.message };
  }
}

function startContextDealMonitor(dealId, deal) {
  currentContextDealId = Number(dealId);
  contextDealSnapshot = dealChangeSnapshot(deal);
  if (contextDealMonitorTimer) clearInterval(contextDealMonitorTimer);
  contextDealMonitorTimer = setInterval(checkContextDealChanges, contextDealMonitorIntervalMs);
  if (!contextDealMonitorEventsBound) {
    window.addEventListener("focus", checkContextDealChanges);
    window.addEventListener("pageshow", checkContextDealChanges);
    document.addEventListener("visibilitychange", checkContextDealChanges);
    contextDealMonitorEventsBound = true;
    bindContextPlacementEvents();
  }
}

async function recalculate(dealId, write = true, { refreshCard = false } = {}) {
  const settings = await loadSettings();
  const [deal, invoices] = await Promise.all([
    callMethod("crm.deal.get", { id: Number(dealId) }),
    getInvoices(dealId),
  ]);
  await Promise.all([
    loadInvoiceStages(invoices.map(invoiceStageId)),
    loadUsers(invoices.map(invoiceAssignedById)),
  ]);
  const summary = summarize(deal, invoices, settings);
  if (!dealMatchesCalculationCategory(deal, settings)) {
    return {
      deal,
      invoices,
      summary,
      updatedFields: {},
      skippedUpdate: true,
      skippedCategory: true,
      categoryId: dealCategoryId(deal),
      selectedCategoryId: settingsCategoryId(settings),
      cardRefresh: null,
    };
  }
  let updatedFields = {};
  let skippedUpdate = false;
  let cardRefresh = null;
  if (write) {
    const fields = buildChangedDealFields(deal, summary, settings);
    if (Object.keys(fields).length) {
      await callMethod("crm.deal.update", { id: Number(dealId), fields });
      updatedFields = fields;
      if (refreshCard) cardRefresh = await refreshDealCard();
    } else {
      skippedUpdate = true;
    }
  }
  return { deal, invoices, summary, updatedFields, skippedUpdate, cardRefresh };
}

function renderResult(dealId, result) {
  reportNode.hidden = false;
  renderDealTitle(dealId, result.deal, result.summary);
  for (const [key, node] of Object.entries(totalNodes)) node.textContent = moneyFormat.format(result.summary[key]);
  invoiceList.replaceChildren();

  // Заголовки (можно добавить в HTML или создать прямо здесь)
  const headerRow = document.createElement("div");
  headerRow.className = "invoice-header";
  headerRow.innerHTML = `
    <span>Счёт</span>
    <span>Срок оплаты</span>
    <span>Ответственный</span>
    <span>Сумма</span>
    <span>Стадия</span>
    <span>Дата выставления</span>
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

    row.append(title, datePay, assignee, amount, stage, dateIssued);
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

function downloadWindowReport(report) {
  const source = report || lastWindowReport;
  if (!source) return;
  const rows = [
    ["Период", `последние ${source.days} суток`],
    ["С", formatDateOnly(source.since)],
    ["Сделок", source.dealCount],
    [],
    ["ID сделки", "Название", "Выставлено", "Оплачено", "Не оплачено", "Остаток", "Счетов", "В расчёте"],
    ...source.results.map((item) => [
      item.dealId,
      item.title || "",
      item.summary?.issued ?? "",
      item.summary?.paid ?? "",
      item.summary?.unpaid ?? "",
      item.summary?.remaining ?? "",
      item.summary?.invoiceCount ?? "",
      item.summary?.countedInvoiceCount ?? "",
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  link.download = `deal-invoice-window-${source.days}-days.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initApp() {
  write("Загружаю настройки...");
  setMappingStatus("Проверяю настройки...");
  portalHost = window.BX24?.getDomain?.() || "";
  portal.textContent = portalHost ? `${portalHost} · Bitrix24 Marketplace` : "Bitrix24 Marketplace";
  
  let settingsState = await loadSettingsState();
  canManageMapping = await canManageCrmSettings();
  setMappingAccess(canManageMapping);
  currentSettings = settingsState.settings;
  serverSupport = await loadServerSupport();
  renderServerSupport();
  await renderCalculationCategory(settingsState.settings);
  automationMode.value = "onChange";
  renderAutomationModeDetails();
  autoRecalcWindowDays.value = String(normalizeWindowDays(settingsState.settings.autoRecalcWindowDays));
  let [fields, initialUserFields] = await Promise.all([
    callMethod("crm.deal.fields"),
    callList("crm.deal.userfield.list"),
  ]);
  const defaultSetup = await ensureDefaultSetupIfNeeded(settingsState, initialUserFields);
  if (defaultSetup.fields) fields = defaultSetup.fields;
  settingsState = { settings: defaultSetup.settings, hasStoredSettings: true };
  currentSettings = defaultSetup.settings;
  renderFields(fields, defaultSetup.userFields, settingsState.settings);
  form.includeNegativeStages.checked = Boolean(settingsState.settings.includeNegativeStages);
  setMappingStatus(
    canManageMapping
      ? defaultSetup.card
        ? "Стандартные поля и сопоставление настроены для всех воронок."
        : "Сопоставление готово."
      : "Сопоставление доступно только администратору.",
    canManageMapping ? "success" : "warning",
  );
  write(defaultSetup.card ? { appVersion, operation: "default-setup", dealCard: defaultSetup.card } : "Настройки загружены.");
  restoreWindowSummaryForPeriod(autoRecalcWindowDays.value);

  const contextDealId = dealIdFromContext();
  if (contextDealId) {
    dealIdInput.value = contextDealId;
    const url = dealUrlFromId(contextDealId);
    if (url) dealUrlInput.value = url;
    const writeOnOpen = automationMode.value === "onOpen";
    const result = await recalculate(contextDealId, writeOnOpen, { refreshCard: writeOnOpen });
    renderResult(contextDealId, result);
    startContextDealMonitor(contextDealId, result.deal);
    write(writeOnOpen
      ? {
        appVersion,
        ok: true,
        operation: "open-deal-recalculate",
        message: result.skippedUpdate ? "Расчёт готов. Поля уже актуальны." : "Расчёт готов. Поля сделки обновлены.",
        updatedFields: result.updatedFields,
        cardRefresh: result.cardRefresh,
        placementInterface: placementInterfaceDiagnostics,
      }
      : "Расчёт готов.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canManageMapping) {
    setMappingStatus("Сопоставление доступно только администратору.", "warning");
    write({ appVersion, ok: false, operation: "save-mapping", error: "CRM admin rights required" }, { reveal: true });
    return;
  }
  try {
    const existingSettings = await loadSettings();
    const settings = { ...existingSettings, ...Object.fromEntries(new FormData(form)) };
    settings.includeNegativeStages = form.includeNegativeStages.checked;
    settings.autoRecalcMode = "onChange";
    await saveSettings(settings);
    currentSettings = settings;
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
    const result = await recalculate(dealId, true, { refreshCard: Number(dealId) === Number(currentContextDealId) });
    renderResult(dealId, result);
    write({
      appVersion,
      ok: true,
      message: result.skippedUpdate ? "Поля сделки уже актуальны." : "Поля сделки обновлены.",
      summary: result.summary,
      updatedFields: result.updatedFields,
      cardRefresh: result.cardRefresh,
      placementInterface: placementInterfaceDiagnostics,
      stageLookup: stageDiagnostics,
    }, { reveal: true });
  } catch (error) {
    write({ appVersion, ok: false, operation: "manual-recalculate", error: error.message }, { reveal: true });
  }
});

document.querySelector("#ensureFields").addEventListener("click", async () => {
  if (!canManageMapping) {
    setMappingStatus("Создание полей доступно только администратору.", "warning");
    write({ appVersion, ok: false, operation: "ensure-fields", error: "CRM admin rights required" }, { reveal: true });
    return;
  }
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
openAppSettingsButton.addEventListener("click", () => {
  window.location.href = marketplaceFileUrl(settingsPageFileName);
});
recentButton.addEventListener("click", recalculateDealsInWindow);
autoRecalcWindowDays.addEventListener("change", () => {
  currentSettings = { ...currentSettings, autoRecalcWindowDays: normalizeWindowDays(autoRecalcWindowDays.value) };
  resetWindowSummary();
  saveUserCalculationSettings(currentSettings).catch((error) => {
    write({ appVersion, ok: false, operation: "save-window-days", error: error.message });
  });
});
automationMode.addEventListener("change", () => {
  renderAutomationModeDetails();
  if (serverOnlyModes.includes(automationMode.value) && !serverSupport.connected) showServerSupportModal(automationMode.value);
});
closeServerSupportModal.addEventListener("click", hideServerSupportModal);
requestServerSupport.addEventListener("click", requestServerSupportAction);
serverSupportModal.addEventListener("click", (event) => {
  if (event.target === serverSupportModal) hideServerSupportModal();
});
closeWindowReportModal.addEventListener("click", hideWindowReportModal);
cancelWindowCalculation.addEventListener("click", hideWindowConfirmModal);
confirmWindowCalculation.addEventListener("click", () => {
  const preflight = pendingWindowCalculation;
  hideWindowConfirmModal();
  if (preflight) runWindowCalculation(preflight);
});
viewWindowStatsButton.addEventListener("click", () => {
  showWindowStatsModal();
});
downloadWindowReportButton.addEventListener("click", () => downloadWindowReport());
windowStatsButton.addEventListener("click", showWindowStatsModal);
windowStatsChart.addEventListener("mousemove", updateChartHover);
windowStatsChart.addEventListener("mouseleave", clearChartHover);
closeWindowStatsModal.addEventListener("click", hideWindowStatsModal);
windowReportModal.addEventListener("click", (event) => {
  if (event.target === windowReportModal) hideWindowReportModal();
});
windowConfirmModal.addEventListener("click", (event) => {
  if (event.target === windowConfirmModal) hideWindowConfirmModal();
});
windowStatsModal.addEventListener("click", (event) => {
  if (event.target === windowStatsModal) hideWindowStatsModal();
});
noticeAction.addEventListener("click", openOpenLine);
noticeAction.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openOpenLine();
  }
});
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
