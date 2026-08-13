const statusNode = document.querySelector("#status");
const installButton = document.querySelector("#installButton");
const logNode = document.querySelector("#log");
const INSTALL_STEP_DELAY_MS = 2500;

const RUNTIME_VERSION = "layout-20260813-4";
const APP_VERSION = "Deal Invoice Summary v.18 Marketplace B24"; // синхронизировать с app.js

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
  return categories.length ? categories : [{ id: 0, name: "Основная" }];
}

async function cacheDealCategories() {
  const categories = await loadDealCategories();
  await callMethod("app.option.set", { options: { dealInvoiceSummaryDealCategories: JSON.stringify(categories) } });
  return categories;
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

  // Шаг 1: регистрация левого меню
  statusNode.textContent = "Регистрирую пункт левого меню...";
  let leftMenu = null;
  try {
    leftMenu = await bindPlacement("LEFT_MENU", {
      HANDLER: handler,
      TITLE: "Расчёт оплаты счетов",
    }, {
      refreshBeforeBind: true,
    });
    writeLog({ step: "left-menu", ...leftMenu, message: leftMenu.rebound ? "Пункт левого меню обновлён и зарегистрирован" : "Пункт левого меню зарегистрирован" });
  } catch (error) {
    leftMenu = { ok: false, error: error.message };
    writeLog({ step: "left-menu", ok: false, error: error.message, message: "Ошибка регистрации левого меню" });
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
  try {
    dealCategories = await cacheDealCategories();
    writeLog({ step: "deal-categories", ok: true, count: dealCategories.length, categories: dealCategories, message: "Список воронок сохранён для настроек приложения" });
  } catch (error) {
    dealCategories = { ok: false, error: error.message };
    writeLog({ step: "deal-categories", ok: false, error: error.message, message: "Не удалось сохранить список воронок при установке" });
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
    note: "Deal-card placement настраивается через сохранение сопоставления в приложении, а не через install.",
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
