const form = document.querySelector("#settings");
const result = document.querySelector("#result");
const portal = document.querySelector("#portal");
const mappingStatus = document.querySelector("#mappingStatus");
const dealForm = document.querySelector("#dealForm");
const dealIdInput = dealForm.elements.dealId;
const dealUrlInput = dealForm.elements.dealUrl;
const logToggle = document.querySelector("#logToggle");
const automationMode = document.querySelector("#automationMode");
const automationInterval = document.querySelector("#automationInterval");
const automationWake = document.querySelector("#automationWake");
const automationTracked = document.querySelector("#automationTracked");
const automationLastRun = document.querySelector("#automationLastRun");
const autoRecalcWindowDays = document.querySelector("#autoRecalcWindowDays");
const automationProgress = document.querySelector("#automationProgress");
const automationProgressText = document.querySelector("#automationProgressText");
const automationProgressValue = document.querySelector("#automationProgressValue");
const automationProgressBar = document.querySelector("#automationProgressBar");

const recalculationStatusMinMs = 1500;
let portalHost = "";

function setLogVisible(visible) {
  result.hidden = !visible;
  logToggle.setAttribute("aria-expanded", String(visible));
}

function write(value, { reveal = false } = {}) {
  result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (reveal) setLogVisible(true);
}

function setMappingStatus(text, tone = "neutral") {
  mappingStatus.textContent = text;
  mappingStatus.dataset.tone = tone;
}

function cardStatusText(dealCard) {
  if (!dealCard) return "";
  if (dealCard.ok) return " Раздел в карточке сделки обновлён.";
  if (dealCard.skipped) return " Раздел карточки не обновлён: нет явной общей раскладки.";
  return " Раздел карточки не обновлён.";
}

function minutes(ms) {
  return Math.round(ms / 60000);
}

function days(value) {
  return Number(value || 21);
}

function formatLastRun(run) {
  if (!run) return "Пока не запускался";
  const status = run.ok ? "успешно" : "ошибка";
  const time = run.finishedAt ? new Date(run.finishedAt).toLocaleTimeString("ru-RU") : "";
  return `${status}${time ? ` · ${time}` : ""}`;
}

function setAutomationProgress(text, percent, { visible = true, tone = "active" } = {}) {
  automationProgress.hidden = !visible;
  automationProgress.dataset.tone = tone;
  automationProgressText.textContent = text;
  automationProgressValue.textContent = `${percent}%`;
  automationProgressBar.style.width = `${percent}%`;
}

function renderAutomation(automation = {}) {
  automationMode.value = automation.mode || "twiceDaily";
  const pushNote = automation.pushEvents?.active ? ", push-события активны" : "";
  automationInterval.textContent = automation.enabled
    ? `каждые ${minutes(automation.intervalMs)} мин., окно ${days(automation.recentDays)} сут.${pushNote}`
    : "не запущен";
  automationWake.textContent = (automation.wakeSchedule || [])
    .map((schedule) => schedule.cronExpr === "44 9 * * *" ? "09:44" : schedule.cronExpr === "44 18 * * *" ? "18:44" : schedule.label)
    .filter(Boolean)
    .join(" и ") || "не настроено";
  automationTracked.textContent = String(automation.trackedDealCount ?? automation.trackedDealIds?.length ?? 0);
  automationLastRun.textContent = formatLastRun(automation.lastRun);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withMinimumDelay(promise, minMs) {
  const startedAt = Date.now();
  const outcome = await promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  const waitMs = minMs - (Date.now() - startedAt);
  if (waitMs > 0) await delay(waitMs);
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

async function api(path, options = {}, attempt = 1) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const contentType = response.headers.get("Content-Type") || "unknown content";
    if ([502, 503, 504].includes(response.status) && attempt < 2) {
      await delay(1200);
      return api(path, options, attempt + 1);
    }
    throw new Error(
      `VibeCode вернул HTML вместо JSON (${response.status}, ${contentType}). Повторите запрос через несколько секунд.`,
    );
  }
  if (!response.ok) throw new Error(payload.error || "Ошибка запроса");
  return payload;
}

function fillSelect(select, fields, value) {
  select.replaceChildren(new Option("Не записывать", ""));
  for (const field of fields) {
    select.add(new Option(`${field.label} (${field.type})`, field.id));
  }
  select.value = value || "";
}

function mappingIsComplete(settings) {
  return Boolean(settings.issuedField && settings.paidField && settings.unpaidField && settings.remainingField);
}

async function load() {
  write("Загружаю настройки...");
  setMappingStatus("Проверяю настройки...");
  const data = await api("/api/bootstrap");
  portalHost = data.portal || "";
  portal.textContent = `${data.portal} · ${data.accessMode}`;
  renderAutomation(data.automation);
  for (const select of form.querySelectorAll("select[data-field-select]")) {
    fillSelect(select, data.fields, data.settings[select.name]);
  }
  form.includeNegativeStages.checked = Boolean(data.settings.includeNegativeStages);
  autoRecalcWindowDays.value = String(data.settings.autoRecalcWindowDays || data.automation?.recentDays || 21);
  setMappingStatus(
    mappingIsComplete(data.settings) ? "Сопоставление готово" : "Выберите поля или создайте автоматически",
    mappingIsComplete(data.settings) ? "success" : "warning",
  );
  write("Настройки загружены.");
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

dealUrlInput.addEventListener("input", () => {
  const dealId = dealIdFromText(dealUrlInput.value);
  if (dealId) dealIdInput.value = dealId;
});

dealIdInput.addEventListener("input", () => {
  const url = dealUrlFromId(dealIdInput.value);
  if (url) dealUrlInput.value = url;
});

logToggle.addEventListener("click", () => {
  setLogVisible(result.hidden);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const settings = Object.fromEntries(new FormData(form));
    settings.includeNegativeStages = form.includeNegativeStages.checked;
    settings.autoRecalcMode = automationMode.value;
    settings.autoRecalcWindowDays = Number(settings.autoRecalcWindowDays);
    const response = await api("/api/settings", { method: "POST", body: JSON.stringify(settings) });
    setMappingStatus(
      `${mappingIsComplete(response.settings) ? "Сопоставление сохранено" : "Часть полей не выбрана"}${cardStatusText(response.dealCard)}`,
      mappingIsComplete(response.settings) ? "success" : "warning",
    );
    write(response);
  } catch (error) {
    setMappingStatus("Ошибка сохранения", "warning");
    write(`Ошибка сохранения сопоставления: ${error.message}`, { reveal: true });
  }
});

document.querySelector("#ensureFields").addEventListener("click", async () => {
  try {
    setMappingStatus("Создаю стандартные поля...");
    write("Создаю недостающие поля...");
    write(await api("/api/fields/ensure", { method: "POST", body: "{}" }), { reveal: true });
    await load();
  } catch (error) {
    setMappingStatus("Ошибка создания полей", "warning");
    write(`Ошибка создания полей: ${error.message}`, { reveal: true });
  }
});

dealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(event.currentTarget);
    const dealId = dealIdFromText(data.get("dealId")) || dealIdFromText(data.get("dealUrl"));
    if (!dealId) {
      write("Укажите ID сделки или ссылку на сделку.", { reveal: true });
      return;
    }
    dealIdInput.value = dealId;
    const url = dealUrlFromId(dealId);
    if (url) dealUrlInput.value = url;
    write(`Пересчитываю сделку #${dealId}...`, { reveal: true });
    write(
      await withMinimumDelay(
        api("/api/recalculate/deal", { method: "POST", body: JSON.stringify({ dealId }) }),
        recalculationStatusMinMs,
      ),
      { reveal: true },
    );
  } catch (error) {
    write(`Ошибка пересчёта сделки: ${error.message}`, { reveal: true });
  }
});

document.querySelector("#recent").addEventListener("click", async () => {
  try {
    setAutomationProgress("Запускаю автопересчёт...", 18);
    write("Запускаю автопересчёт...");
    await delay(250);
    setAutomationProgress("Собираю сделки и свежие счета...", 42);
    const response = await api("/api/automation/run", { method: "POST", body: "{}" });
    setAutomationProgress("Записываю итоги и обновляю статус...", 78);
    await delay(250);
    renderAutomation(response);
    setAutomationProgress("Автопересчёт завершён", 100, { tone: "success" });
    write(response);
  } catch (error) {
    setAutomationProgress("Ошибка автопересчёта", 100, { tone: "warning" });
    write(`Ошибка автопересчёта: ${error.message}`, { reveal: true });
  }
});

document.querySelector("#refresh").addEventListener("click", load);

load().catch((error) => {
  setMappingStatus("Ошибка загрузки", "warning");
  write(error.message);
});
