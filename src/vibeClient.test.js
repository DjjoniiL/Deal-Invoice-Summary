import assert from "node:assert/strict";
import { test } from "node:test";
import { VibeClient, VibeError, toQuery } from "./vibeClient.js";

test("adds API key and serializes JSON requests", async () => {
  const calls = [];
  const client = new VibeClient({
    baseUrl: "https://example.test/",
    apiKey: "key-1",
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
    },
  });

  const response = await client.post("/v1/demo", { hello: "world" });

  assert.deepEqual(response, { success: true, data: { ok: true } });
  assert.equal(calls[0].url, "https://example.test/v1/demo");
  assert.equal(calls[0].request.headers["X-Api-Key"], "key-1");
  assert.equal(calls[0].request.body, JSON.stringify({ hello: "world" }));
});

test("fails fast when API key is missing", async () => {
  const client = new VibeClient({ apiKey: "" });
  await assert.rejects(() => client.get("/v1/me"), /VIBE_API_KEY is not configured/);
});

test("wraps platform and invalid JSON errors", async () => {
  const failing = new VibeClient({
    apiKey: "key-1",
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false, error: { code: "BAD_THING" } }), { status: 200 }),
  });

  await assert.rejects(() => failing.get("/v1/me"), (error) => {
    assert.ok(error instanceof VibeError);
    assert.equal(error.message, "BAD_THING");
    return true;
  });

  const invalid = new VibeClient({
    apiKey: "key-1",
    fetchImpl: async () => new Response("<!doctype html>", { status: 502 }),
  });

  await assert.rejects(() => invalid.get("/v1/me"), /Invalid JSON from VibeCode/);
});

test("builds query strings without empty values", () => {
  assert.equal(toQuery({ dealId: 2, empty: "", nil: null, q: "a b" }), "?dealId=2&q=a+b");
});
