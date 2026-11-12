import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";

test("anonymous guest must supply a nickname and uses that name in the room", async () => {
  const h = harness();
  const guest = { uid: "guest1", firebase: { sign_in_provider: "anonymous" } };
  await assert.rejects(h.service.execute("me:sync", guest, {}, { key: "guest-missing" }), { code: "NICKNAME_REQUIRED" });
  const profile = await h.service.execute("me:sync", guest, { name: "Ana" }, { key: "guest-valid" });
  assert.equal(profile.name, "Ana");
  const host = await h.setup(["host"]);
  const room = await h.service.execute("rooms:join", guest, {}, { key: "guest-join", code: host.code });
  assert.equal(room.players.guest1.name, "Ana");
});

test("Google email always comes from the verified token, not request body", async () => {
  const h = harness();
  const user = { uid: "google1", email: "ana@example.com", firebase: { sign_in_provider: "google.com" } };
  const profile = await h.service.execute("me:sync", user, { name: "fake@example.com" }, { key: "google-sync" });
  assert.equal(profile.name, "ana@example.com");
  const room = await h.service.execute("rooms:create", user, { settings: { lang: "pt", categories: ["COR", "FRUTA", "CARRO"], letters: "ABC", rounds: 1, timer: 0 } }, { key: "google-room" });
  assert.equal(room.players.google1.name, "ana@example.com");
});

test("invalid guest names are rejected", async () => {
  const h = harness();
  const guest = { uid: "guest2", firebase: { sign_in_provider: "anonymous" } };
  for (const [i, name] of ["A", " ", "A".repeat(25)].entries())
    await assert.rejects(h.service.execute("me:sync", guest, { name }, { key: `invalid-${i}` }));
});
