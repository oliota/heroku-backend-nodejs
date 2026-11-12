import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";

test("STOP freezes persisted drafts immediately and rejects later writes", async () => {
  const h = harness();
  let room = await h.playing();
  room = await h.roomCall(room, "rooms:answers", "u2", { answers: ["Ciano", "", ""], final: false, sequence: 1 });
  room = await h.roomCall(room, "rooms:stop", "u1", { answers: ["Cinza", "", ""], sequence: 0 });
  assert.equal(room.status, "review");
  assert.deepEqual(room.answers.u1, ["Cinza", "", ""]);
  assert.deepEqual(room.answers.u2, ["Ciano", "", ""]);
  await assert.rejects(() => h.roomCall(room, "rooms:answers", "u2", { answers: ["Cao", "", ""], sequence: 2, final: false }), (e) => e.code === "INVALID_STATE");
});

test("no dispute: players confirm each category without voting", async () => {
  const h = harness();
  let r = await h.playing();
  r = await h.roomCall(r, "rooms:stop", "u1", { answers: ["Cinza", "Corsa", "Caqui"], sequence: 0 });
  for (let i = 0; i < 3; i++) {
    r = await h.roomCall(r, "review:complete", "u1");
    assert.equal(r.status, "review");
    r = await h.roomCall(r, "review:complete", "u2");
  }
  assert.equal(r.status, "results");
  assert.equal(r.players.u1.score, 30);
  assert.equal(r.players.u2.score, 0);
});

test("changing a suggested score opens a dispute that needs unanimous voting", async () => {
  const h = harness();
  let r = await h.playing();
  r = await h.roomCall(r, "rooms:stop", "u1", { answers: ["Cinza", "Corsa", "Caqui"], sequence: 0 });
  r = await h.roomCall(r, "review:complete", "u1");
  assert.equal(r.review.done.u1, true);
  r = await h.roomCall(r, "review:votes", "u2", { votes: { "u1:0": { v: 5, e: 0 } } });
  assert.deepEqual(r.review.done, {});
  await assert.rejects(() => h.roomCall(r, "review:complete", "u1"), (e) => e.code === "REVIEW_PENDING");
  r = await h.roomCall(r, "review:votes", "u1", { votes: { "u1:0": { v: 5, e: 0 } } });
  assert.equal(r.review.approved["u1:0"], 5);
  r = await h.roomCall(r, "review:complete", "u1");
  r = await h.roomCall(r, "review:complete", "u2");
  assert.equal(r.review.category, 1);
});

test("leader majority decision advances immediately and records scores", async () => {
  const h = harness();
  let r = await h.playing();
  r = await h.roomCall(r, "rooms:stop", "u1", { answers: ["Cinza", "Corsa", "Caqui"], sequence: 0 });
  r = await h.roomCall(r, "review:votes", "u2", { votes: { "u1:0": { v: 5, e: 0 } } });
  r = await h.roomCall(r, "review:force", "u1", { mode: "majority" });
  assert.equal(r.review.approved["u1:0"], 5);
  assert.equal(r.review.category, 1);
  assert.equal(r.review.decisions.length, 1);
  assert.equal(r.review.decisions[0].mode, "majority");
});

test("leader vote breaks tied majority and explicit decision", async () => {
  const h = harness();
  let r = await h.playing();
  r = await h.roomCall(r, "rooms:stop", "u1", { answers: ["Cinza", "Corsa", "Caqui"], sequence: 0 });
  r = await h.roomCall(r, "review:votes", "u2", { votes: { "u1:0": { v: 5, e: 0 } } });
  r = await h.roomCall(r, "review:votes", "u1", { votes: { "u1:0": { v: 0, e: 0 } } });
  r = await h.roomCall(r, "review:force", "u1", { mode: "majority" });
  assert.equal(r.review.approved["u1:0"], 0);
});
