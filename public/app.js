const form = document.querySelector("#settings");
const result = document.querySelector("#result");
const portal = document.querySelector("#portal");

function write(value) {
  result.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function api(path, options = {}) {
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
    throw new Error(`Сервер вернул не JSON (${response.status}, ${contentType})`);
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

async function load() {
  write("Загружаю настройки...");
  const data = await api("/api/bootstrap");
  portal.textContent = `${data.portal} · ${data.accessMode}`;
  for (const select of form.querySelectorAll("select")) {
    fillSelect(select, data.fields, data.settings[select.name]);
  }
  form.includeNegativeStages.checked = Boolean(data.settings.includeNegativeStages);
  write("Настройки загружены.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = Object.fromEntries(new FormData(form));
  settings.includeNegativeStages = form.includeNegativeStages.checked;
  write(await api("/api/settings", { method: "POST", body: JSON.stringify(settings) }));
});

document.querySelector("#ensureFields").addEventListener("click", async () => {
  write("Создаю недостающие поля...");
  write(await api("/api/fields/ensure", { method: "POST", body: "{}" }));
  await load();
});

document.querySelector("#dealForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const dealId = new FormData(event.currentTarget).get("dealId");
  write(await api("/api/recalculate/deal", { method: "POST", body: JSON.stringify({ dealId }) }));
});

document.querySelector("#recent").addEventListener("click", async () => {
  write("Запускаю пересчёт за 30 дней...");
  write(await api("/api/recalculate/recent", { method: "POST", body: JSON.stringify({ days: 30 }) }));
});

document.querySelector("#refresh").addEventListener("click", load);

load().catch((error) => write(error.message));
