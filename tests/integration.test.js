import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { app } from "../index.js";
import { createAdedonhaRouter, endpoints } from "../adedonha/routes.js";
import { rateLimit } from "../adedonha/middleware.js";
import { harness } from "./helpers.js";

async function listen(t, application) {
  const server = application.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}
test("real application starts without Adedonha credentials; all public contracts respond", async (t) => {
  const base = await listen(t, app);
  for (const path of [
    "health",
    "config",
    "rules",
    "categories?locale=pt",
    "letters?locale=pt",
    "locales",
  ]) {
    const response = await fetch(`${base}/api/v1/adedonha/${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.json()).data);
  }
  let response = await fetch(`${base}/api/v1/adedonha/me`);
  assert.equal(response.status, 401);
  if (!process.env.ADEDONHA_FIREBASE_PRIVATE_KEY) {
    response = await fetch(`${base}/api/v1/adedonha/me`, {
      headers: { Authorization: "Bearer not-a-token" },
    });
    assert.equal(response.status, 503);
  }
  response = await fetch(`${base}/api/v1/adedonha/categories?locale=unknown`);
  assert.equal(response.status, 400);
});
test("legacy expense CRUD and validation routes remain available", async (t) => {
  const base = await listen(t, app);
  const response = await fetch(`${base}/api/v1/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "test", amount: 12.5 }),
  });
  assert.equal(response.status, 201);
  const expense = await response.json();
  assert.equal(
    (await fetch(`${base}/api/v1/expenses/${expense.id}`)).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/v1/expenses/${expense.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "updated", amount: 15 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/v1/expenses/${expense.id}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal((await fetch(`${base}/api/v1/expenses`)).status, 200);
  assert.equal(
    (await fetch(`${base}/api/v1/schedule/versions?month=invalid`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/v1/schedule/day?when=invalid`)).status,
    400,
  );
  assert.equal((await fetch(`${base}/api/v1/summary-svg`)).status, 400);
});
const fakeAuth = {
  verifyIdToken: async (token) => {
    if (token === "network") {
      const e = new Error("private error");
      e.code = "auth/network-request-failed";
      throw e;
    }
    if (token === "invalid") throw new Error("private token");
    return {
      uid: token,
      firebase: {
        sign_in_provider: token === "anonymous" ? "anonymous" : "google.com",
      },
    };
  },
};
test("REST authentication, CORS, JSON validation and network failures are sanitized", async (t) => {
  const h = harness();
  const application = express();
  application.use(
    "/api/v1/adedonha",
    createAdedonhaRouter({
      getService: () => h.service,
      getAuth: () => fakeAuth,
      health: () => "mock",
    }),
  );
  const base = `${await listen(t, application)}/api/v1/adedonha`;
  for (const [token, status, code] of [
    ["invalid", 401, "INVALID_TOKEN"],
    ["anonymous", 403, "GOOGLE_LOGIN_REQUIRED"],
    ["network", 503, "BACKEND_UNAVAILABLE"],
  ]) {
    const r = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, status);
    assert.equal((await r.json()).error.code, code);
  }
  let r = await fetch(`${base}/me`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://oliota.com",
      "Access-Control-Request-Headers": "Authorization,Idempotency-Key",
    },
  });
  assert.equal(r.status, 204);
  assert.match(
    r.headers.get("access-control-allow-headers"),
    /Idempotency-Key/,
  );
  r = await fetch(`${base}/health`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  r = await fetch(`${base}/me/sync`, {
    method: "POST",
    headers: {
      Authorization: "Bearer u1",
      "Content-Type": "application/json",
      "Idempotency-Key": "rest_test_123",
    },
    body: "{bad",
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "INVALID_PAYLOAD");
});
test("every requested protected endpoint is registered and reaches authentication", async (t) => {
  const application = express();
  application.use("/api/v1/adedonha", createAdedonhaRouter());
  const base = await listen(t, application);
  assert.equal(endpoints.length, 43);
  for (const [method, path] of endpoints) {
    const url = path
      .replace(":code", "ABCDE")
      .replace(":category", "0")
      .replace(":id", "123");
    const response = await fetch(`${base}/api/v1/adedonha${url}`, {
      method: method.toUpperCase(),
    });
    assert.equal(response.status, 401, `${method} ${url}`);
  }
});
test("REST room lifecycle and idempotency exercise real service with test transaction repository", async (t) => {
  const h = harness();
  const application = express();
  application.use(
    "/api/v1/adedonha",
    createAdedonhaRouter({
      getService: () => h.service,
      getAuth: () => fakeAuth,
    }),
  );
  const base = `${await listen(t, application)}/api/v1/adedonha`;
  let count = 0;
  const request = async (path, method = "GET", body, key) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: "Bearer u1",
        "Content-Type": "application/json",
        "Idempotency-Key": key || `rest_operation_${++count}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, ...(await r.json()) };
  };
  assert.equal(
    (await request("/me/sync", "POST", { name: "Ana" })).status,
    200,
  );
  let r = await request(
    "/rooms",
    "POST",
    { settings: { lang: "pt" } },
    "rest_create_room",
  );
  assert.equal(r.status, 201);
  const room = r.data;
  assert.deepEqual(
    (
      await request(
        "/rooms",
        "POST",
        { settings: { lang: "pt" } },
        "rest_create_room",
      )
    ).data,
    room,
  );
  r = await request(`/rooms/${room.code}/start`, "POST", {
    version: room.version,
  });
  assert.equal(r.data.status, "letter_selection");
  const state = r.data;
  r = await request(`/rooms/${room.code}/letters/confirm`, "POST", {
    version: state.version,
    game_id: state.game_id,
    round_id: state.round_id,
    letter: state.selected_letter,
  });
  assert.equal(r.data.status, "playing");
  assert.equal(r.data.letter, state.selected_letter);
});
test("rate limiting returns retry-after", async (t) => {
  const application = express();
  application.use(
    "/api/v1/adedonha",
    createAdedonhaRouter({ limiter: rateLimit({ max: 1 }) }),
  );
  const base = await listen(t, application);
  assert.equal((await fetch(`${base}/api/v1/adedonha/health`)).status, 200);
  const r = await fetch(`${base}/api/v1/adedonha/health`);
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("retry-after"));
});
