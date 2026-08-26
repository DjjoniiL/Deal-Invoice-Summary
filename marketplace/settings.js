const runtimeVersion = "layout-20260826-2";
const appVersion = "Deal Invoice Summary v.36 Marketplace B24";
const defaultSettings = {
  includeNegativeStages: false,
  includeInvoiceWindowDeals: true,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
  autoRecalcMode: "onOpen",
  autoRecalcWindowDays: 30,
  calculationCategoryId: "all",
};
const userCalculationSettingsOption = "dealInvoiceSummaryUserCalculationSettings";

const categorySelect = document.querySelector("#calculationCategoryId");
const windowDaysSelect = document.querySelector("#autoRecalcWindowDaysSetting");
const includeInvoiceWindowDealsInput = document.querySelector("#includeInvoiceWindowDeals");
const statusNode = document.querySelector("#settingsStatus");
const portalNode = document.querySelector("#settingsPortal");
const backButton = document.querySelector("#backToApp");
const saveButton = document.querySelector("#saveAppSettings");
const refreshButton = document.querySelector("#refreshDealCategories");
const windowPeriodHelpButton = document.querySelector("#windowPeriodHelp");
const periodHelpModal = document.querySelector("#periodHelpModal");
const closePeriodHelpButton = document.querySelector("#closePeriodHelp");

function callMethod(method, params = {}) {
  return new Promise((resolve, reject) => {
    BX24.callMethod(method, params, (result) => {
      if (result.error()) reject(new Error(result.error_description() || result.error()));
      else resolve(result.data());
    });
  });
}

function marketplaceFileUrl(fileName) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/[^/]*$/i, fileName);
  url.search = `?v=${runtimeVersion}`;
  url.hash = "";
  return url.toString();
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

function normalizeCategory(category) {
  const id = Number(category.id ?? category.ID);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: category.name || category.NAME || `Воронка #${id}`,
  };
}

async function loadDealCategories({ refresh = false } = {}) {
  if (!refresh) {
    try {
      const stored = await callMethod("app.option.get", { option: "dealInvoiceSummaryDealCategories" });
      const categories = parseJsonOption(stored, []);
      if (Array.isArray(categories) && categories.length) return categories.map(normalizeCategory).filter(Boolean);
    } catch {
      // Runtime REST refresh below keeps the settings page usable.
    }
  }

  const response = await callMethod("crm.category.list", { entityTypeId: 2 });
  const categories = (response?.categories || response?.result?.categories || []).map(normalizeCategory).filter(Boolean);
  const normalized = [{ id: 0, name: "Основная" }, ...categories]
    .filter((category, index, list) => list.findIndex((item) => item.id === category.id) === index);
  try {
    await callMethod("app.option.set", { options: { dealInvoiceSummaryDealCategories: JSON.stringify(normalized) } });
  } catch {
    // Employees can still use the fresh list in this browser session without app.option write rights.
  }
  return normalized;
}

async function loadSettings() {
  const userSettings = parseJsonOption(localStorage.getItem(userCalculationSettingsOption), {});
  try {
    const stored = await callMethod("app.option.get", { option: "dealInvoiceSummarySettings" });
    return { ...defaultSettings, ...parseJsonOption(stored, {}), ...userSettings };
  } catch {
    return { ...defaultSettings, ...userSettings };
  }
}

async function saveSettings(settings) {
  const payload = JSON.stringify({
    calculationCategoryId: settings.calculationCategoryId,
    autoRecalcWindowDays: normalizeWindowDays(settings.autoRecalcWindowDays),
    includeInvoiceWindowDeals: Boolean(settings.includeInvoiceWindowDeals ?? defaultSettings.includeInvoiceWindowDeals),
  });
  localStorage.setItem(userCalculationSettingsOption, payload);
}

function renderCategories(categories, selected) {
  categorySelect.replaceChildren(new Option("Все воронки", "all"));
  for (const category of categories) {
    categorySelect.append(new Option(category.name, String(category.id)));
  }
  categorySelect.value = selected === undefined || selected === null || selected === "" ? "all" : String(selected);
}

function normalizeWindowDays(value) {
  const allowed = [30, 90, 180];
  const days = Number(value);
  return allowed.includes(days) ? days : 30;
}

function showPeriodHelp() {
  periodHelpModal.hidden = false;
}

function hidePeriodHelp() {
  periodHelpModal.hidden = true;
}

let chatOpenDetected = false;
let chatOpenObserver = null;
let chatRetryTimer = 0;

function isVisibleNode(node) {
  return Boolean(node && (node.offsetParent !== null || node.getClientRects().length));
}

function markChatOpen() {
  chatOpenDetected = true;
  if (chatRetryTimer) window.clearTimeout(chatRetryTimer);
  chatRetryTimer = 0;
  chatOpenObserver?.disconnect();
  chatOpenObserver = null;
}

function isOpenLineVisible() {
  const selectors = [
    ".b24-widget-button-popup-show",
    ".b24-widget-button-popup:not([style*='display: none'])",
    ".bx-livechat-wrapper",
    ".bx-livechat-body",
    "iframe[src*='livechat']",
    "iframe[src*='openline']",
    "iframe[src*='online']",
  ];
  return selectors.some((selector) => [...document.querySelectorAll(selector)].some(isVisibleNode));
}

function scheduleOpenLineRetry(attempt, delay) {
  if (chatOpenDetected || isOpenLineVisible()) {
    markChatOpen();
    return;
  }
  if (chatRetryTimer) window.clearTimeout(chatRetryTimer);
  chatRetryTimer = window.setTimeout(() => openOpenLineFromSettings(attempt), delay);
}

function clickOpenLineTarget(target) {
  if (!target) return false;
  target.scrollIntoView?.({ block: "center", inline: "center" });
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  if (window.PointerEvent) target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse" }));
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  if (window.PointerEvent) target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: "mouse" }));
  target.click();
  markChatOpen();
  return true;
}

function tryOpenLineApi() {
  const calls = [
    () => window.B24Chat?.open?.(),
    () => window.B24Chat?.instance?.open?.(),
    () => window.BX?.SiteButton?.open?.(),
    () => window.BX?.SiteButton?.Manager?.open?.(),
    () => window.Bitrix24WidgetObject?.open?.(),
  ];
  for (const call of calls) {
    try {
      if (call()) {
        markChatOpen();
        return true;
      }
    } catch {
      // Keep trying the next known widget API.
    }
  }
  return false;
}

function openOpenLineFromSettings(attempt = 0) {
  if (chatOpenDetected || isOpenLineVisible()) {
    markChatOpen();
    return;
  }
  const selectors = [
    ".b24-widget-button-openline_livechat",
    ".b24-widget-button-openline",
    ".b24-widget-button-social-item",
    ".b24-widget-button-social",
    ".b24-widget-button-inner-container",
    ".b24-widget-button-wrapper",
    ".b24-widget-button-position-bottom-right",
    ".b24-widget-button-popup",
    "[data-b24-crm-button-widget]",
    "[data-b24-widget-button]",
  ];
  if (tryOpenLineApi()) {
    return;
  }
  const target = selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
    .find(isVisibleNode);
  if (clickOpenLineTarget(target)) return;
  if (attempt < 60) scheduleOpenLineRetry(attempt + 1, 500);
}

function watchOpenLineState() {
  if (chatOpenObserver || chatOpenDetected) return;
  chatOpenObserver = new MutationObserver(() => {
    if (isOpenLineVisible()) markChatOpen();
  });
  chatOpenObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
}

function shouldOpenChat() {
  return new URLSearchParams(window.location.search).get("openChat") === "1";
}

async function initSettings({ refresh = false } = {}) {
  statusNode.textContent = refresh ? "Обновляю список воронок..." : "Загружаю настройки...";
  const [settings, categories] = await Promise.all([
    loadSettings(),
    loadDealCategories({ refresh }),
  ]);
  renderCategories(categories, settings.calculationCategoryId);
  windowDaysSelect.value = String(normalizeWindowDays(settings.autoRecalcWindowDays));
  includeInvoiceWindowDealsInput.checked = Boolean(settings.includeInvoiceWindowDeals ?? defaultSettings.includeInvoiceWindowDeals);
  statusNode.textContent = "Настройки загружены.";
}

async function saveAppSettings() {
  saveButton.disabled = true;
  statusNode.textContent = "Сохраняю настройки...";
  try {
    const settings = await loadSettings();
    settings.calculationCategoryId = categorySelect.value;
    settings.autoRecalcWindowDays = normalizeWindowDays(windowDaysSelect.value);
    settings.includeInvoiceWindowDeals = includeInvoiceWindowDealsInput.checked;
    await saveSettings(settings);
    statusNode.textContent = "Настройки сохранены для этого пользователя.";
  } catch (error) {
    statusNode.textContent = `Ошибка сохранения: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
}

function init() {
  if (!window.BX24) {
    statusNode.textContent = "Откройте настройки внутри Bitrix24.";
    saveButton.disabled = true;
    refreshButton.disabled = true;
    return;
  }
  BX24.init(() => {
    portalNode.textContent = `${BX24.getDomain?.() || ""} · ${appVersion}`;
    if (shouldOpenChat()) {
      watchOpenLineState();
      openOpenLineFromSettings();
      window.addEventListener("load", () => {
        if (!chatOpenDetected) openOpenLineFromSettings();
      }, { once: true });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !chatOpenDetected) openOpenLineFromSettings();
      });
    }
    initSettings().catch((error) => {
      statusNode.textContent = `Ошибка загрузки: ${error.message}`;
    });
  });
}

backButton.addEventListener("click", () => {
  window.location.href = marketplaceFileUrl("index.html");
});
saveButton.addEventListener("click", saveAppSettings);
refreshButton.addEventListener("click", () => initSettings({ refresh: true }).catch((error) => {
  statusNode.textContent = `Ошибка обновления: ${error.message}`;
}));
windowPeriodHelpButton.addEventListener("click", showPeriodHelp);
closePeriodHelpButton.addEventListener("click", hidePeriodHelp);
periodHelpModal.addEventListener("click", (event) => {
  if (event.target === periodHelpModal) hidePeriodHelp();
});

init();
