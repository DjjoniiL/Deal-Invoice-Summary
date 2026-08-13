const runtimeVersion = "layout-20260813-3";
const appVersion = "Deal Invoice Summary v.17 Marketplace B24";
const defaultSettings = {
  includeNegativeStages: false,
  issuedField: "UF_CRM_INV_SUM_ISSUED",
  paidField: "UF_CRM_INV_SUM_PAID",
  unpaidField: "UF_CRM_INV_SUM_UNPAID",
  remainingField: "UF_CRM_INV_SUM_REMAINING",
  autoRecalcMode: "onOpen",
  autoRecalcWindowDays: 21,
  calculationCategoryId: "all",
};

const categorySelect = document.querySelector("#calculationCategoryId");
const windowDaysSelect = document.querySelector("#autoRecalcWindowDaysSetting");
const statusNode = document.querySelector("#settingsStatus");
const portalNode = document.querySelector("#settingsPortal");
const backButton = document.querySelector("#backToApp");
const saveButton = document.querySelector("#saveAppSettings");
const refreshButton = document.querySelector("#refreshDealCategories");

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
  if (!value) return fallback;
  if (typeof value === "string") return JSON.parse(value);
  return value;
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
  const normalized = categories.length ? categories : [{ id: 0, name: "Основная" }];
  await callMethod("app.option.set", { options: { dealInvoiceSummaryDealCategories: JSON.stringify(normalized) } });
  return normalized;
}

async function loadSettings() {
  try {
    const stored = await callMethod("app.option.get", { option: "dealInvoiceSummarySettings" });
    return { ...defaultSettings, ...parseJsonOption(stored, {}) };
  } catch {
    const local = localStorage.getItem("dealInvoiceSummarySettings");
    return { ...defaultSettings, ...parseJsonOption(local, {}) };
  }
}

async function saveSettings(settings) {
  const payload = JSON.stringify(settings);
  localStorage.setItem("dealInvoiceSummarySettings", payload);
  await callMethod("app.option.set", { options: { dealInvoiceSummarySettings: payload } });
}

function renderCategories(categories, selected) {
  categorySelect.replaceChildren(new Option("Все воронки", "all"));
  for (const category of categories) {
    categorySelect.append(new Option(category.name, String(category.id)));
  }
  categorySelect.value = selected === undefined || selected === null || selected === "" ? "all" : String(selected);
}

function normalizeWindowDays(value) {
  const allowed = [42, 28, 21, 14, 7, 2];
  const days = Number(value);
  return allowed.includes(days) ? days : 21;
}

async function initSettings({ refresh = false } = {}) {
  statusNode.textContent = refresh ? "Обновляю список воронок..." : "Загружаю настройки...";
  const [settings, categories] = await Promise.all([
    loadSettings(),
    loadDealCategories({ refresh }),
  ]);
  renderCategories(categories, settings.calculationCategoryId);
  windowDaysSelect.value = String(normalizeWindowDays(settings.autoRecalcWindowDays));
  statusNode.textContent = "Настройки загружены.";
}

async function saveAppSettings() {
  saveButton.disabled = true;
  statusNode.textContent = "Сохраняю настройки...";
  try {
    const settings = await loadSettings();
    settings.calculationCategoryId = categorySelect.value;
    settings.autoRecalcWindowDays = normalizeWindowDays(windowDaysSelect.value);
    await saveSettings(settings);
    statusNode.textContent = "Настройки сохранены.";
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

init();
