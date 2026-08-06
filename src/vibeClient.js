export class VibeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "VibeError";
    this.details = details;
  }
}

export class VibeClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch }) {
    this.baseUrl = (baseUrl || "https://vibecode.bitrix24.tech").replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", body } = {}) {
    if (!this.apiKey) throw new VibeError("VIBE_API_KEY is not configured");

    const request = {
      method,
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };

    let response;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, request);
        break;
      } catch (error) {
        if (attempt === 3) {
          throw new VibeError("VibeCode network request failed", {
            cause: error.message,
            path,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }

    if (response.status === 204) return { success: true, data: null };

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new VibeError(`Invalid JSON from VibeCode (${response.status})`, { text });
    }

    if (!response.ok || payload.success === false) {
      const message = payload.error?.message || payload.error?.code || `VibeCode request failed (${response.status})`;
      throw new VibeError(message, { status: response.status, payload });
    }

    return payload;
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, { method: "POST", body });
  }

  put(path, body) {
    return this.request(path, { method: "PUT", body });
  }

  patch(path, body) {
    return this.request(path, { method: "PATCH", body });
  }
}

export function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
