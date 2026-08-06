const statusNode = document.querySelector("#status");
const installButton = document.querySelector("#installButton");
const logNode = document.querySelector("#log");

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
      if (result.error()) reject(new Error(result.error_description() || result.error()));
      else resolve(result.data());
    });
  });
}

function writeLog(value) {
  logNode.hidden = false;
  logNode.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function finishInstall() {
  installButton.disabled = true;
  statusNode.textContent = "Регистрирую пункт левого меню...";
  const handler = appUrl("index.html");
  let leftMenu = null;
  try {
    leftMenu = await callMethod("placement.bind", {
      PLACEMENT: "LEFT_MENU",
      HANDLER: handler,
      TITLE: "Расчёт оплаты счетов",
    });
  } catch (error) {
    leftMenu = { ok: false, error: error.message };
  }

  statusNode.textContent = "Завершаю установку...";
  writeLog({
    ok: true,
    handler,
    leftMenu,
    note:
      "Deal-card placement should be configured in the Bitrix24 developer console. The installer only tries the left menu because deal-card placement may require higher privileges.",
  });
  BX24.installFinish();
}

function init() {
  if (!window.BX24) {
    statusNode.textContent = "Откройте установку внутри Bitrix24.";
    installButton.disabled = true;
    return;
  }
  BX24.init(() => {
    statusNode.textContent = "Можно завершить установку.";
    installButton.addEventListener("click", () => {
      finishInstall().catch((error) => {
        installButton.disabled = false;
        statusNode.textContent = "Ошибка установки";
        writeLog(error.message);
      });
    });
  });
}

init();
