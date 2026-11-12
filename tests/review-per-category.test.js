import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";

test("each category accepts suggestions by default and still needs each player confirmation", async () => {
  const h = harness();
  let room = await h.review();
  for (let category = 0; category < room.categories.length; category++) {
    room = await h.roomCall(room, "review:complete", "u1");
    assert.equal(room.status, "review");
    assert.equal(room.review.category, category);
    assert.equal(room.review.done.u1, true);
    room = await h.roomCall(room, "review:complete", "u2");
    if (category < room.categories.length - 1) {
      assert.equal(room.review.category, category + 1);
      assert.deepEqual(room.review.done, {});
    }
  }
  assert.equal(room.status, "results");
  assert.equal(room.players.u1.score, 25);
  assert.equal(room.players.u2.score, 15);
});

test("own saved drafts are accessible through authenticated API", async () => {
  const h = harness();
  let room = await h.playing();
  room = await h.roomCall(room, "rooms:answers", "u1", {
    answers: ["Cinza", "Corsa", "Caqui"], final: false, sequence: 3,
  });
  const own = await h.call("get:answers", "u1", {}, { code: room.code });
  const other = await h.call("get:answers", "u2", {}, { code: room.code });
  assert.equal(own.sequence, 3);
  assert.equal(own.answers[0], "Cinza");
  assert.deepEqual(other.answers, ["", "", ""]);
});
