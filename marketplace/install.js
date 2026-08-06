const statusNode = document.querySelector("#status");
const installButton = document.querySelector("#installButton");
const logNode = document.querySelector("#log");

const placements = [
  {
    PLACEMENT: "CRM_DEAL_DETAIL_TAB",
    TITLE: "Расчёт оплаты счетов",
  },
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
  statusNode.textContent = "Регистрирую вкладку сделки...";
  const handler = appUrl("index.html");
  const results = [];

  for (const placement of placements) {
    try {
      results.push(await callMethod("placement.bind", { ...placement, HANDLER: handler }));
    } catch (error) {
      results.push({ placement: placement.PLACEMENT, error: error.message });
    }
  }

  statusNode.textContent = "Завершаю установку...";
  writeLog({ handler, placements: results });
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
