const statusNode = document.querySelector("#status");
const installButton = document.querySelector("#installButton");
const logNode = document.querySelector("#log");
const INSTALL_STEP_DELAY_MS = 4000;

// Можно добавить версию, если хотите
const APP_VERSION = "layout-20260810-13"; // синхронизировать с app.js

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

async function finishInstall() {
  installButton.disabled = true;
  statusNode.textContent = "Начинаю установку...";
  writeLog({ step: "init", version: APP_VERSION, message: "Установка запущена" });

  const handler = appUrl("index.html");
  writeLog({ step: "prepare", handler, message: "URL обработчика сформирован" });

  // Шаг 1: регистрация левого меню
  statusNode.textContent = "Регистрирую пункт левого меню...";
  let leftMenu = null;
  try {
    const result = await callMethod("placement.bind", {
      PLACEMENT: "LEFT_MENU",
      HANDLER: handler,
      TITLE: "Расчёт оплаты счетов",
    });
    leftMenu = { ok: true, result };
    writeLog({ step: "left-menu", ok: true, result, message: "Пункт левого меню зарегистрирован" });
  } catch (error) {
    leftMenu = { ok: false, error: error.message };
    writeLog({ step: "left-menu", ok: false, error: error.message, message: "Ошибка регистрации левого меню" });
    await wait(INSTALL_STEP_DELAY_MS);
    // Не прерываем установку – продолжим
  }

  // Шаг 2: завершение установки
  statusNode.textContent = "Завершаю установку...";
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
