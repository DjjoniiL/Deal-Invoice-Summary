const statusNode = document.querySelector("#status");
const installButton = document.querySelector("#installButton");
const logNode = document.querySelector("#log");

function writeLog(value) {
  logNode.hidden = false;
  logNode.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function finishInstall() {
  installButton.disabled = true;
  statusNode.textContent = "Завершаю установку...";
  writeLog({
    ok: true,
    note:
      "Marketplace install token does not bind placements. Configure the left-menu page and deal-card placement in the Bitrix24 developer console.",
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
    statusNode.textContent = "Можно завершить установку. Места встройки настраиваются в developer console.";
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
