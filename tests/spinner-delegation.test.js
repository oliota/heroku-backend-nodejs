import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";

test("the current spinner can pass the turn and the next round preserves their choice", async () => {
  const h = harness();
  let room = await h.setup(["u1", "u2"], { rounds: 3 });
  room = await h.call("rooms:start", "u1", { version: room.version }, { code: room.code });
  assert.equal(room.spinner_uid, "u1");
  assert.equal(room.selected_letter, "");
  room = await h.roomCall(room, "rooms:delegate", "u1", { spinner_uid: "u2" });
  assert.equal(room.spinner_uid, "u2");
  await assert.rejects(() => h.roomCall(room, "rooms:select", "u1", { letter: "C" }), (e) => e.code === "SPINNER_REQUIRED");
  room = await h.roomCall(room, "rooms:select", "u2", { letter: "C" });
  room = await h.roomCall(room, "rooms:confirm", "u2", { letter: "C" });
  assert.equal(room.status, "playing");
  assert.equal(room.spinner_uid, "u2");
  room = await h.roomCall(room, "rooms:stop", "u1", { answers: ["Cinza", "Corsa", "Caqui"], sequence: 0 });
  for (let i = 0; i < room.categories.length; i++) {
    room = await h.roomCall(room, "review:complete", "u1");
    room = await h.roomCall(room, "review:complete", "u2");
  }
  assert.equal(room.status, "results");
  room = await h.call("rooms:rounds", "u1", { version: room.version }, { code: room.code });
  assert.equal(room.spinner_uid, "u2");
  assert.equal(room.selected_letter, "");
});

test("saving drafts does not change room version or discard newer participant answers", async () => {
  const h = harness();
  let room = await h.playing();
  const version = room.version;
  room = await h.roomCall(room, "rooms:answers", "u1", { answers: ["Cinza", "", ""], sequence: 1, final: false });
  assert.equal(room.version, version);
  room = await h.roomCall(room, "rooms:answers", "u2", { answers: ["Ciano", "", ""], sequence: 1, final: false });
  assert.equal(room.version, version);
  assert.deepEqual((await h.call("get:answers", "u1", {}, { code: room.code })).answers, ["Cinza", "", ""]);
});

test("a room rejects handing the wheel to an unknown user", async () => {
  const h = harness();
  let room = await h.setup();
  room = await h.call("rooms:start", "u1", { version: room.version }, { code: room.code });
  await assert.rejects(() => h.roomCall(room, "rooms:delegate", "u1", { spinner_uid: "u3" }), (e) => e.code === "INVALID_SPINNER");
});

test("heartbeats refresh presence without invalidating room mutations", async () => {
  const h = harness();
  let room = await h.playing();
  const version = room.version;
  room = await h.call("rooms:heartbeat", "u2", {}, { code: room.code });
  assert.equal(room.version, version);
  room = await h.roomCall(room, "rooms:answers", "u1", {
    answers: ["Cinza", "", ""], sequence: 1, final: false,
  });
  assert.equal(room.version, version);
  const sameRoom = await h.call("get:game", "u1", {}, { code: room.code });
  assert.equal(sameRoom.version, version);
});
