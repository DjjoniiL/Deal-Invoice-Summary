const statusNode = document.querySelector("#status");
const installButton = document.querySelector("#installButton");
const logNode = document.querySelector("#log");
const INSTALL_STEP_DELAY_MS = 2500;

const RUNTIME_VERSION = "layout-20260826-2";
const APP_VERSION = "Deal Invoice Summary v.36 Marketplace B24"; // синхронизировать с app.js
const DEFAULT_SETTINGS = {
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
const DEAL_SUMMARY_SECTION_NAME = "deal_invoice_summary";
const DEAL_SUMMARY_SECTION_TITLE = "Расчёт оплаты счетов";
const DEFAULT_SETUP_VERSION_OPTION = "dealInvoiceSummaryDefaultSetupVersion";
const STANDARD_FIELDS = [
  ["INV_SUM_ISSUED", "Сумма выставленных счетов"],
  ["INV_SUM_PAID", "Сумма оплаченных счетов"],
  ["INV_SUM_UNPAID", "Сумма неоплаченных счетов"],
  ["INV_SUM_REMAINING", "Остаток оплаты сделки"],
];

function appUrl(fileName = "index.html") {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/install\.html$/i, fileName);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function callMethod(method, params = {}) {
  return new Promise((resolve, reject) => {
    BX24.callMethod(method, params, (result) => {
      if (result.error()) {
        reject(new Error(result.error_description() || result.error()));
      } else {
        resolve(result.data());
      }
    });
  });
}

function writeLog(value) {
  logNode.hidden = false;
  const timestamp = new Date().toLocaleString("ru-RU", { hour12: false });
  const prefix = `[${timestamp}] `;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  logNode.textContent += `${logNode.textContent ? "\n\n" : ""}${prefix}${text}`;
  logNode.scrollTop = logNode.scrollHeight;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPlacementMaxCountError(error) {
  return /ERROR_PLACEMENT_MAX_COUNT|Placement max count/i.test(error?.message || "");
}

async function unbindPlacement(placement) {
  try {
    const result = await callMethod("placement.unbind", { PLACEMENT: placement });
    writeLog({ step: "placement-unbind", placement, ok: true, result, message: "Старая привязка placement снята перед повторной регистрацией" });
    return { ok: true, result };
  } catch (error) {
    writeLog({ step: "placement-unbind", placement, ok: false, error: error.message, message: "Старую привязку placement снять не удалось, продолжаю регистрацию" });
    return { ok: false, error: error.message };
  }
}

async function unbindPlacementAll(placement, maxAttempts = 5) {
  const removed = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await unbindPlacement(placement);
    removed.push(result);
    const count = Number(result?.result?.count || 0);
    if (!result.ok || count < 1) break;
  }
  return removed;
}

async function bindPlacement(placement, params, { refreshBeforeBind = false } = {}) {
  if (refreshBeforeBind) {
    await unbindPlacementAll(placement);
  }

  try {
    const result = await callMethod("placement.bind", { PLACEMENT: placement, ...params });
    return { ok: true, result, rebound: refreshBeforeBind };
  } catch (error) {
    if (!isPlacementMaxCountError(error)) {
      throw error;
    }

    const unbind = await unbindPlacementAll(placement);
    if (!unbind.some((item) => item.ok)) {
      return { ok: true, alreadyBound: true, error: error.message, unbind };
    }

    const result = await callMethod("placement.bind", { PLACEMENT: placement, ...params });
    return { ok: true, result, rebound: true, previousError: error.message };
  }
}

function normalizeFieldName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^UF_CRM_/i.test(text)) return text.toUpperCase();
  return `UF_CRM_${text.toUpperCase()}`;
}

function normalizeDealCategory(category) {
  const id = Number(category.id ?? category.ID);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: category.name || category.NAME || `Воронка #${id}`,
  };
}

async function loadDealCategories() {
  const response = await callMethod("crm.category.list", { entityTypeId: 2 });
  const categories = (response?.categories || response?.result?.categories || []).map(normalizeDealCategory).filter(Boolean);
  return [{ id: 0, name: "Основная" }, ...categories]
    .filter((category, index, list) => list.findIndex((item) => item.id === category.id) === index);
}

async function cacheDealCategories() {
  const categories = await loadDealCategories();
  await callMethod("app.option.set", { options: { dealInvoiceSummaryDealCategories: JSON.stringify(categories) } });
  return categories;
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

function mergeDealSummarySection(layout, fieldNames) {
  const sections = Array.isArray(layout) && layout.length ? layout : defaultDealCardLayout();
  const targetNames = new Set(fieldNames);
  const cleanedSections = sections
    .filter((section) => section?.name !== DEAL_SUMMARY_SECTION_NAME)
    .map((section) => ({
      ...section,
      elements: (section.elements || []).filter((element) => !targetNames.has(String(element.name || "").toUpperCase())),
    }));

  cleanedSections.push({
    name: DEAL_SUMMARY_SECTION_NAME,
    title: DEAL_SUMMARY_SECTION_TITLE,
    type: "section",
    elements: fieldNames.map((name) => ({ name, optionFlags: 1 })),
  });
  return cleanedSections;
}

function isEmptyCardLayoutError(error) {
  return /card layout is empty/i.test(error?.message || "");
}

async function configureDealCardSection(categories) {
  const fieldNames = [
    DEFAULT_SETTINGS.issuedField,
    DEFAULT_SETTINGS.paidField,
    DEFAULT_SETTINGS.unpaidField,
    DEFAULT_SETTINGS.remainingField,
  ].map(normalizeFieldName);
  const methods = [
    { get: "crm.item.details.configuration.get", set: "crm.item.details.configuration.set", baseParams: { entityTypeId: 2 } },
    { get: "crm.deal.details.configuration.get", set: "crm.deal.details.configuration.set", baseParams: {} },
  ];
  const attempts = [];

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
        await callMethod(method.set, { ...method.baseParams, scope: "C", extras, data: mergeDealSummarySection(current, fieldNames) });
        attempts.push({ method: method.set, scope: "C", categoryId: category.id, categoryName: category.name, ok: true, createdFromDefaultLayout });
        break;
      } catch (error) {
        attempts.push({ method: method.set, scope: "C", categoryId: category.id, categoryName: category.name, ok: false, createdFromDefaultLayout, error: error.message });
      }
    }
  }

  const updatedCategories = attempts.filter((attempt) => attempt.ok);
  return {
    ok: updatedCategories.length === categories.length,
    partial: updatedCategories.length !== categories.length,
    updatedCategories,
    attempts,
    note: "Default field mapping is applied to every accessible deal funnel.",
  };
}

async function ensureDefaultFieldsAndMapping(categories) {
  const existing = await callMethod("crm.deal.userfield.list");
  const rows = Array.isArray(existing) ? existing : existing?.result || [];
  const byName = new Map(rows.map((field) => [String(field.FIELD_NAME || "").toUpperCase(), field]));
  for (const [name, label] of STANDARD_FIELDS) {
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
  const card = await configureDealCardSection(categories);
  await callMethod("app.option.set", {
    options: {
      dealInvoiceSummarySettings: JSON.stringify(DEFAULT_SETTINGS),
      [DEFAULT_SETUP_VERSION_OPTION]: RUNTIME_VERSION,
    },
  });
  return card;
}

async function finishInstall() {
  installButton.disabled = true;
  statusNode.textContent = "Начинаю установку...";
  writeLog({ step: "init", version: APP_VERSION, message: "Установка запущена" });

  const handler = appUrl("index.html");
  const backgroundHandler = appUrl("worker.html");
  const backgroundErrorHandler = appUrl("worker-error.html");
  writeLog({
    step: "prepare",
    handler,
    backgroundHandler,
    backgroundErrorHandler,
    message: "URL обработчиков сформированы",
  });

  // Шаг 1: очистка старых привязок левого меню.
  // Сам пункт левого меню для Marketplace задаётся в настройках версии приложения,
  // иначе Bitrix24 может показать два пункта меню.
  statusNode.textContent = "Очищаю старые привязки левого меню...";
  let leftMenu = null;
  try {
    const unbind = await unbindPlacementAll("LEFT_MENU", 10);
    leftMenu = { ok: true, unbind, skippedBind: true };
    writeLog({ step: "left-menu-cleanup", ...leftMenu, message: "Старые LEFT_MENU-привязки очищены; основной пункт создаётся настройкой версии Marketplace" });
  } catch (error) {
    leftMenu = { ok: false, error: error.message };
    writeLog({ step: "left-menu-cleanup", ok: false, error: error.message, message: "Не удалось очистить старые LEFT_MENU-привязки" });
    await wait(INSTALL_STEP_DELAY_MS);
    // Не прерываем установку – продолжим
  }

  // Шаг 2: регистрация фонового worker для открытых страниц Bitrix24
  statusNode.textContent = "Регистрирую фоновый монитор карточек сделок...";
  let backgroundWorker = null;
  try {
    backgroundWorker = await bindPlacement("PAGE_BACKGROUND_WORKER", {
      HANDLER: backgroundHandler,
      OPTIONS: {
        errorHandlerUrl: backgroundErrorHandler,
      },
    });
    writeLog({
      step: "background-worker",
      ...backgroundWorker,
      handler: backgroundHandler,
      message: backgroundWorker.alreadyBound
        ? "PAGE_BACKGROUND_WORKER уже зарегистрирован для приложения"
        : backgroundWorker.rebound
          ? "PAGE_BACKGROUND_WORKER обновлён и зарегистрирован"
          : "PAGE_BACKGROUND_WORKER зарегистрирован",
    });
  } catch (error) {
    const alreadyBound = isPlacementMaxCountError(error);
    backgroundWorker = {
      ok: alreadyBound,
      alreadyBound,
      error: error.message,
      handler: backgroundHandler,
    };
    writeLog({
      step: "background-worker",
      ok: alreadyBound,
      alreadyBound,
      error: error.message,
      message: alreadyBound
        ? "PAGE_BACKGROUND_WORKER уже зарегистрирован для приложения"
        : "Не удалось зарегистрировать PAGE_BACKGROUND_WORKER",
    });
    await wait(INSTALL_STEP_DELAY_MS);
  }

  // Шаг 3: завершение установки
  statusNode.textContent = "Завершаю установку...";
  statusNode.textContent = "Загружаю список воронок сделок...";
  let dealCategories = null;
  let defaultSetup = null;
  try {
    dealCategories = await cacheDealCategories();
    writeLog({ step: "deal-categories", ok: true, count: dealCategories.length, categories: dealCategories, message: "Список воронок сохранён для настроек приложения" });
  } catch (error) {
    dealCategories = { ok: false, error: error.message };
    writeLog({ step: "deal-categories", ok: false, error: error.message, message: "Не удалось сохранить список воронок при установке" });
  }

  statusNode.textContent = "Создаю стандартные поля и сопоставление...";
  try {
    const categories = Array.isArray(dealCategories) && dealCategories.length ? dealCategories : [{ id: 0, name: "Основная" }];
    defaultSetup = await ensureDefaultFieldsAndMapping(categories);
    writeLog({ step: "default-fields-and-mapping", ok: defaultSetup.ok, defaultSetup, message: "Стандартные поля и сопоставление сохранены для всех пользователей и всех доступных воронок" });
  } catch (error) {
    defaultSetup = { ok: false, error: error.message };
    writeLog({ step: "default-fields-and-mapping", ok: false, error: error.message, message: "Не удалось автоматически создать поля и сопоставление" });
    await wait(INSTALL_STEP_DELAY_MS);
  }

  writeLog({ step: "finish", message: "Вызываю BX24.installFinish()" });
  await wait(INSTALL_STEP_DELAY_MS);
  try {
    BX24.installFinish();
    writeLog({ step: "finish", ok: true, message: "installFinish выполнен успешно" });
    statusNode.textContent = "Установка завершена!";
  } catch (error) {
    writeLog({ step: "finish", ok: false, error: error.message, message: "Ошибка при завершении установки" });
    statusNode.textContent = "Ошибка завершения установки";
  }

  // Итоговый лог
  writeLog({
    ok: true,
    version: APP_VERSION,
    handler,
    leftMenu,
    backgroundWorker,
    dealCategories,
    defaultSetup,
    note: "Deal-card placement настраивается через сохранение сопоставления в приложении и установщик с дефолтным сопоставлением.",
  });
}

function init() {
  if (!window.BX24) {
    statusNode.textContent = "Откройте установку внутри Bitrix24.";
    installButton.disabled = true;
    writeLog({ step: "init", ok: false, message: "BX24 не найден, установка невозможна" });
    return;
  }

  statusNode.textContent = "Инициализация BX24...";
  BX24.init(() => {
    statusNode.textContent = "Можно завершить установку.";
    writeLog({ step: "init", ok: true, message: "BX24 инициализирован" });

    installButton.addEventListener("click", () => {
      finishInstall().catch((error) => {
        installButton.disabled = false;
        statusNode.textContent = "Ошибка установки";
        writeLog({ step: "error", error: error.message, message: "Критическая ошибка" });
      });
    });
  });
}

init();
