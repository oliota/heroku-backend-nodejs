import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "./helpers.js";
import {
  rules,
  normalize,
  scoreAnswers,
  settings,
  locale,
} from "../adedonha/rules.js";
import { billingIdentity, purchases } from "../adedonha/stores.js";
import { FirestoreRepository } from "../adedonha/firebase.js";

const rejects = (fn, code) =>
  assert.rejects(fn, (error) => error.code === code);
const fixtures = JSON.parse(
  readFileSync(new URL("./godot-contract-fixtures.json", import.meta.url)),
);

test("official Godot normalization and scoring fixtures", () => {
  for (const f of fixtures.normalize)
    assert.equal(normalize(f.input), f.expected);
  for (const f of fixtures.scoring)
    assert.deepEqual(
      scoreAnswers(
        f.letter,
        f.answers,
        ["a", "b", "c"].slice(0, Object.values(f.expected)[0].length),
        f.lang,
      ),
      f.expected,
    );
});
test("all ten exact locale lists and boundaries", () => {
  assert.equal(Object.keys(rules.languages).length, 10);
  assert.equal(locale("pt_PT"), "pt_pt");
  for (const [lang, value] of Object.entries(rules.languages)) {
    assert.ok(value.default_categories.length >= 3);
    assert.equal(settings({ lang }).letters, value.letters);
  }
  assert.throws(() => settings({ categories: ["A", "A", "B"] }));
  assert.throws(() => settings({ rounds: 2 }));
  assert.throws(() => scoreAnswers("", {}, [], "pt"));
});
test("profile accepts display fields and rejects forged privileges", async () => {
  const h = harness();
  const p = await h.sync("u1");
  assert.equal(p.friend_code.length, 6);
  assert.equal((await h.sync("u1")).friend_code, p.friend_code);
  await rejects(
    () => h.call("me:sync", "u1", { premium: true }),
    "UNKNOWN_FIELD",
  );
  await rejects(
    () => h.call("rooms:create", "u1", { owner: "u2" }),
    "UNKNOWN_FIELD",
  );
});
test("room membership, host-only settings and optimistic concurrency", async () => {
  const h = harness();
  const r = await h.setup();
  await rejects(
    () => h.call("get:room", "stranger", {}, { code: r.code }),
    "NOT_ROOM_MEMBER",
  );
  await rejects(
    () => h.call("rooms:start", "u2", { version: r.version }, { code: r.code }),
    "HOST_REQUIRED",
  );
  await rejects(
    () => h.call("rooms:start", "u1", { version: 0 }, { code: r.code }),
    "STALE_VERSION",
  );
  const results = await Promise.allSettled([
    h.call("rooms:start", "u1", { version: r.version }, { code: r.code }),
    h.call("rooms:start", "u1", { version: r.version }, { code: r.code }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("new guest joins using room code only without an inaccessible version", async () => {
  const h = harness();
  const r = await h.setup();
  await h.sync("guest-no-version");
  const joined = await h.call("rooms:join", "guest-no-version", {}, { code: r.code });
  assert.equal(joined.players["guest-no-version"].present, true);
  assert.equal(joined.version, r.version + 1);
});

test("ten player limit is atomic and reconnect does not duplicate players", async () => {
  const h = harness();
  const ids = Array.from({ length: 10 }, (_, i) => `u${i + 1}`);
  let r = await h.setup(ids);
  await h.sync("overflow");
  await rejects(
    () =>
      h.call(
        "rooms:join",
        "overflow",
        { version: r.version },
        { code: r.code },
      ),
    "ROOM_FULL",
  );
  r = await h.call(
    "rooms:start",
    "u1",
    { version: r.version },
    { code: r.code },
  );
  r = await h.call("rooms:join", "u2", {}, { code: r.code });
  assert.equal(Object.keys(r.players).length, 10);
  assert.equal(r.players.u2.present, true);
});
test("host departure transfers leadership and keeps room benefit", async () => {
  const h = harness();
  await h.sync("u1");
  await h.sync("u2");
  h.repo.data.set("entitlements/u1", {
    verified: true,
    golden_wheel: true,
    valid_until: Date.now() + 60000,
  });
  let r = await h.call("rooms:create", "u1", {});
  r = await h.call(
    "rooms:join",
    "u2",
    { version: r.version },
    { code: r.code },
  );
  r = await h.call(
    "rooms:leave",
    "u1",
    { version: r.version },
    { code: r.code },
  );
  assert.equal(r.host, "u2");
  assert.equal(r.status, "lobby");
  assert.equal(r.premium.ad_free, true);
  r = await h.call(
    "rooms:close",
    "u2",
    { version: r.version },
    { code: r.code },
  );
  assert.equal(r.premium.ad_free, false);
});
test("idempotency replays exact result and rejects key reuse for another request", async () => {
  const h = harness();
  await h.sync("u1");
  const a = await h.call("rooms:create", "u1", {}, { key: "same_key_123" });
  const b = await h.call("rooms:create", "u1", {}, { key: "same_key_123" });
  assert.deepEqual(a, b);
  await rejects(
    () =>
      h.call(
        "rooms:create",
        "u1",
        { settings: { lang: "pt" } },
        { key: "same_key_123" },
      ),
    "IDEMPOTENCY_CONFLICT",
  );
  await rejects(
    () => h.call("me:sync", "u1", {}, { key: undefined }),
    "IDEMPOTENCY_KEY_REQUIRED",
  );
});
test("confirmed letter persists and stale round messages cannot write", async () => {
  const h = harness();
  let r = await h.playing();
  assert.equal(r.letter, "C");
  assert.equal(r.used[0], "C");
  await rejects(
    () =>
      h.roomCall(r, "rooms:answers", "u1", {
        round_id: "old",
        answers: ["", "", ""],
        final: true,
        sequence: 1,
      }),
    "STALE_ROUND",
  );
  await rejects(
    () =>
      h.roomCall(r, "rooms:answers", "u1", {
        answers: ["x".repeat(41), "", ""],
        final: true,
        sequence: 1,
      }),
    "INVALID_TEXT",
  );
  await rejects(
    () => h.roomCall(r, "rooms:confirm", "u1", { letter: "B" }),
    "INVALID_STATE",
  );
});
test("final responses cannot be overwritten and sequence prevents delayed drafts", async () => {
  const h = harness();
  let r = await h.playing();
  r = await h.roomCall(r, "rooms:answers", "u1", {
    answers: ["Cinza", "", ""],
    final: false,
    sequence: 3,
  });
  await rejects(
    () =>
      h.roomCall(r, "rooms:answers", "u1", {
        answers: ["", "", ""],
        final: false,
        sequence: 2,
      }),
    "STALE_ANSWERS",
  );
  r = await h.roomCall(r, "rooms:answers", "u1", {
    answers: ["Cinza", "", ""],
    final: true,
    sequence: 4,
  });
  await rejects(
    () =>
      h.roomCall(r, "rooms:answers", "u1", {
        answers: ["", "", ""],
        final: false,
        sequence: 5,
      }),
    "ANSWERS_FINAL",
  );
});
test("STOP freezes the latest saved drafts and transitions to review immediately", async () => {
  const h = harness();
  let r = await h.playing();
  r = await h.roomCall(r, "rooms:answers", "u2", {
    answers: ["Ciano", "", ""], final: false, sequence: 1,
  });
  r = await h.roomCall(r, "rooms:stop", "u1", {
    answers: ["Cinza", "", ""], sequence: 0,
  });
  assert.equal(r.status, "review");
  assert.deepEqual(r.answers.u1, ["Cinza", "", ""]);
  assert.deepEqual(r.answers.u2, ["Ciano", "", ""]);
  await rejects(() => h.roomCall(r, "rooms:answers", "u2", {
    answers: ["Cinza", "", ""], final: false, sequence: 2,
  }), "INVALID_STATE");
});
test("STOP ignores stale previous round documents", async () => {
  const h = harness();
  let r = await h.playing();
  h.repo.data.set(`rooms/${r.code}/players/u2`, {
    round_id: "stale", answers: ["Wrong", "Wrong", "Wrong"], final: true,
  });
  r = await h.roomCall(r, "rooms:stop", "u1", {
    answers: ["Cinza", "", ""], sequence: 0,
  });
  assert.equal(r.status, "review");
  assert.deepEqual(r.answers.u2, ["", "", ""]);
  assert.equal(r.answers.u1[0], "Cinza");
});
test("deviating from a suggestion requires unanimity only for the disputed answer", async () => {
  const h = harness();
  let r = await h.review();
  r = await h.roomCall(r, "review:complete", "u1");
  assert.equal(r.review.done.u1, true);
  r = await h.roomCall(r, "review:votes", "u2", {
    votes: { "u1:0": { v: 10, e: 0 } },
  });
  assert.equal(r.review.disputed["u1:0"], true);
  assert.deepEqual(r.review.done, {});
  await rejects(() => h.roomCall(r, "review:complete", "u1"), "REVIEW_PENDING");
  r = await h.roomCall(r, "review:votes", "u1", {
    votes: { "u1:0": { v: 10, e: 0 } },
  });
  assert.equal(r.review.approved["u1:0"], 10);
  r = await h.roomCall(r, "review:complete", "u1");
  r = await h.roomCall(r, "review:complete", "u2");
  assert.equal(r.review.category, 1);
  assert.equal(r.review.approved["u2:0"], r.suggested.u2[0]);
});
test("host reopen increments epoch, clears confirmations and rejects stale votes", async () => {
  const h = harness();
  let r = await h.approve(await h.review());
  r = await h.roomCall(r, "review:complete", "u1");
  await rejects(
    () => h.roomCall(r, "review:reopen", "u2", { key: "u1:0" }),
    "HOST_REQUIRED",
  );
  r = await h.roomCall(r, "review:reopen", "u1", { key: "u1:0" });
  assert.equal(r.review.epochs["u1:0"], 1);
  assert.deepEqual(r.review.done, {});
  await rejects(
    () =>
      h.roomCall(r, "review:votes", "u2", {
        votes: { "u1:0": { v: 10, e: 0 } },
      }),
    "INVALID_VOTE",
  );
});
test("leader decides disputed scores, preserves suggestions and advances", async () => {
  const h = harness();
  let r = await h.review();
  r = await h.roomCall(r, "review:votes", "u2", {
    votes: { "u1:0": { v: 10, e: 0 } },
  });
  await rejects(() => h.roomCall(r, "review:force", "u1", { mode: "leader" }), "HOST_VOTE_MISSING");
  r = await h.roomCall(r, "review:votes", "u1", {
    votes: { "u1:0": { v: 0, e: 0 } },
  });
  await rejects(() => h.roomCall(r, "review:force", "u2", { mode: "leader" }), "HOST_REQUIRED");
  r = await h.roomCall(r, "review:force", "u1", { mode: "leader" });
  assert.equal(r.review.approved["u1:0"], 0);
  assert.equal(r.review.approved["u2:0"], r.suggested.u2[0]);
  assert.equal(r.review.category, 1);
  assert.equal(r.review.decisions[0].mode, "leader");
  assert.equal(r.players.u1.score, 0);
});
test("collective finish, unlock, atomic score consolidation and history", async () => {
  const h = harness();
  let r = await h.approve(await h.review());
  assert.equal(r.status, "review");
  assert.equal(r.players.u1.score, 0);
  r = await h.roomCall(r, "review:complete", "u1");
  r = await h.roomCall(r, "review:unlock", "u1");
  assert.equal(r.review.done.u1, false);
  r = await h.roomCall(r, "review:complete", "u2");
  assert.equal(r.status, "review");
  r = await h.roomCall(r, "review:complete", "u1");
  assert.equal(r.status, "results");
  assert.equal(r.players.u1.score, 25);
  assert.equal(r.players.u2.score, 15);
  assert.ok(h.repo.data.has(`rooms/${r.code}/rounds/${r.round_id}`));
  await rejects(() => h.roomCall(r, "review:complete"), "INVALID_STATE");
  r = await h.call(
    "rooms:rounds",
    "u1",
    { version: r.version },
    { code: r.code },
  );
  assert.equal(r.status, "finished");
  assert.deepEqual(await h.call("get:stats"), { games: 1, wins: 1, best: 25 });
  assert.equal((await h.call("get:history")).items.length, 1);
});
test("friend requests reject duplicates/self, enforce recipient, update both sides and badge", async () => {
  const h = harness();
  const a = await h.sync("u1");
  const b = await h.sync("u2");
  await rejects(
    () => h.call("friends:request", "u1", { friend_code: a.friend_code }),
    "SELF_FRIENDSHIP",
  );
  const req = await h.call("friends:request", "u1", {
    friend_code: b.friend_code,
  });
  await rejects(
    () => h.call("friends:request", "u2", { friend_code: a.friend_code }),
    "REQUEST_PENDING",
  );
  assert.equal((await h.call("get:friends:count", "u2")).count, 1);
  await rejects(
    () => h.call("friends:accept", "u1", {}, { id: req.id }),
    "REQUEST_RECIPIENT_REQUIRED",
  );
  await h.call("friends:accept", "u2", {}, { id: req.id });
  assert.equal((await h.call("get:friends:count", "u2")).count, 0);
  assert.equal((await h.call("get:friends", "u1")).items[0].uid, "u2");
  assert.equal((await h.call("get:friends", "u2")).items[0].uid, "u1");
  await h.call("friends:delete", "u1", {}, { id: "u2" });
  assert.equal((await h.call("get:friends", "u2")).items.length, 0);
});
test("rejected request resolves counter and allows later new request", async () => {
  const h = harness();
  await h.sync("u1");
  const b = await h.sync("u2");
  const req = await h.call("friends:request", "u1", {
    friend_code: b.friend_code,
  });
  await h.call("friends:reject", "u2", {}, { id: req.id });
  assert.equal((await h.call("get:friends:count", "u2")).count, 0);
  assert.equal((await h.call("get:friends:requests", "u2")).items.length, 0);
  assert.equal(
    (await h.call("friends:request", "u1", { friend_code: b.friend_code }))
      .status,
    "pending",
  );
});
test("free tickets persist per room, intents cannot be replayed or stolen", async () => {
  const h = harness();
  const r = await h.setup();
  const status = await h.call("get:tickets:status", "u1", {
    room_code: r.code,
  });
  assert.equal(status.ticket.source, "free");
  assert.equal(status.ad_available, false);
  const intent = await h.call("tickets:intent", "u1", { room_code: r.code });
  await rejects(
    () =>
      h.call("tickets:redeem", "u2", { intent_id: intent.id, source: "free" }),
    "INVALID_INTENT",
  );
  const ticket = await h.call("tickets:redeem", "u1", {
    intent_id: intent.id,
    source: "free",
  });
  assert.equal(ticket.room_id, r.room_id);
  await rejects(
    () =>
      h.call("tickets:redeem", "u1", { intent_id: intent.id, source: "free" }),
    "INVALID_INTENT",
  );
  await rejects(
    () =>
      h.call("tickets:redeem", "u1", {
        intent_id: intent.id,
        source: "rewarded_ad",
        proof: "watched",
      }),
    "ADS_UNAVAILABLE",
  );
});
test("reward provider proof must bind UID, intent, room, unique event; clients cannot assert reward", async () => {
  const rewards = {
    name: "test-only",
    verify: async (input, { uid, intent }) => ({
      verified: true,
      uid,
      intent_id: input.intent_id,
      room_id: intent.room_id,
      event_id: input.proof,
    }),
  };
  const h = harness({ rewards });
  await h.sync("u1");
  // Premium owner activates sharing, so creating a room does not require an ad first.
  h.repo.data.set("entitlements/u1", {
    golden_wheel: true,
    verified: true,
    valid_until: Date.now() + 60000,
  });
  const r = await h.call("rooms:create", "u1", {});
  const intent = await h.call("tickets:intent", "u1", { room_code: r.code });
  await rejects(
    () =>
      h.call("tickets:redeem", "u1", { intent_id: intent.id, source: "free" }),
    "INVALID_REWARD",
  );
  const ticket = await h.call("tickets:redeem", "u1", {
    intent_id: intent.id,
    source: "rewarded_ad",
    proof: "event1",
  });
  assert.equal(ticket.verified, true);
  const next = await h.call("tickets:intent", "u1", { room_code: r.code });
  await rejects(
    () =>
      h.call("tickets:redeem", "u1", {
        intent_id: next.id,
        source: "rewarded_ad",
        proof: "event1",
      }),
    "REWARD_ALREADY_USED",
  );
});
test("purchase verification binds UID and purchase, supports restore and revocation", async () => {
  let revoked = false;
  const h = harness({
    purchases: {
      verify: async (input, uid) => ({
        uid,
        verified: true,
        product: "golden_wheel",
        purchase_id: "production-receipt",
        revoked,
      }),
    },
  });
  assert.equal(
    (
      await h.call("premium:verify", "u1", {
        platform: "android",
        purchase_token: "test-only",
      })
    ).golden_wheel,
    true,
  );
  assert.equal(
    (
      await h.call("premium:restore", "u1", {
        platform: "android",
        purchase_token: "test-only",
      })
    ).golden_wheel,
    true,
  );
  await rejects(
    () =>
      h.call("premium:verify", "u2", {
        platform: "android",
        purchase_token: "test-only",
      }),
    "PURCHASE_ALREADY_LINKED",
  );
  revoked = true;
  assert.equal(
    (
      await h.call("premium:restore", "u1", {
        platform: "android",
        purchase_token: "test-only",
      })
    ).revoked,
    true,
  );
  assert.equal((await h.call("get:premium")).golden_wheel, false);
});
test("sandbox and expired licenses never activate premium benefits", async () => {
  const h = harness();
  await h.sync("u1");
  for (const e of [
    {
      golden_wheel: true,
      verified: true,
      sandbox: true,
      valid_until: Date.now() + 99999,
    },
    { golden_wheel: true, verified: true, valid_until: Date.now() - 1 },
    { golden_wheel: true },
  ]) {
    h.repo.data.set("entitlements/u1", e);
    assert.equal((await h.call("get:premium")).golden_wheel, false);
    assert.equal(
      (await h.call("rooms:create", "u1", {})).premium.ad_free,
      false,
    );
  }
  await rejects(
    () => h.call("premium:verify", "u1", { premium: true }),
    "UNKNOWN_FIELD",
  );
  await rejects(
    () =>
      h.call("premium:verify", "u1", {
        platform: "ios",
        transaction_id: "123",
      }),
    "STORE_UNAVAILABLE",
  );
  await rejects(
    () =>
      purchases.verify({ platform: "android", purchase_token: "fake" }, "u1"),
    "STORE_UNAVAILABLE",
  );
  assert.match(billingIdentity("u1").apple_account_token, /^[a-f0-9-]{36}$/);
});
test("network transaction failures preserve state and propagate unavailable code", async () => {
  const h = harness();
  const r = await h.setup();
  const before = structuredClone(h.repo.data);
  h.repo.transaction = async () => {
    const error = new Error("network");
    error.code = 14;
    throw error;
  };
  await rejects(
    () => h.call("rooms:start", "u1", { version: r.version }, { code: r.code }),
    14,
  );
  assert.deepEqual(h.repo.data, before);
});
test("Firestore adapter buffers every write until reads end and passes retry attempts", async () => {
  const calls = [];
  const db = {
    doc: (path) => path,
    runTransaction: async (callback, options) => {
      assert.equal(options.maxAttempts, 5);
      return callback({
        get: async (ref) => {
          calls.push("read");
          return { data: () => ({ path: ref }) };
        },
        set: () => calls.push("write"),
        delete: () => calls.push("delete"),
      });
    },
  };
  const repo = new FirestoreRepository(db);
  await repo.transaction(async (tx) => {
    tx.set("a/b", { ok: true });
    await tx.get("c/d");
    assert.deepEqual(await tx.get("a/b"), { ok: true });
    tx.delete("e/f");
  });
  assert.deepEqual(calls, ["read", "write", "delete"]);
});
test("cross-platform status refreshes stored proof and persists refund without exposing receipt", async () => {
  let revoked = false;
  let calls = 0;
  const h = harness({
    purchases: {
      verify: async (input, uid) => {
        calls++;
        assert.equal(input.purchase_token, "private-proof");
        return {
          uid,
          verified: true,
          product: "golden_wheel",
          purchase_id: "linked-purchase",
          revoked,
        };
      },
    },
  });
  await h.call(
    "premium:verify",
    "u1",
    { platform: "android", purchase_token: "private-proof" },
    { key: "verify_purchase_123" },
  );
  await h.call(
    "premium:verify",
    "u1",
    { platform: "android", purchase_token: "private-proof" },
    { key: "verify_purchase_123" },
  );
  assert.equal(calls, 1);
  h.repo.data.get("entitlements/u1").valid_until = 0;
  let response = await h.call("get:premium");
  assert.equal(response.golden_wheel, true);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(response).includes("private-proof"), false);
  revoked = true;
  h.repo.data.get("entitlements/u1").valid_until = 0;
  response = await h.call("get:entitlements");
  assert.equal(response.golden_wheel, false);
  assert.equal(response.revoked, true);
});

test("expired store verification fails closed on network outage and never trusts cached premium", async () => {
  const h = harness({
    purchases: {
      verify: async () => {
        const e = new Error("unavailable");
        e.code = "STORE_UNAVAILABLE";
        throw e;
      },
    },
  });
  h.repo.data.set("entitlements/u1", {
    verified: true,
    golden_wheel: true,
    valid_until: 0,
    purchase_id: "old",
  });
  h.repo.data.set("adedonha_private_licenses/u1", {
    platform: "android",
    purchase_token: "secret",
  });
  await rejects(() => h.call("get:premium"), "STORE_UNAVAILABLE");
  assert.equal(h.repo.data.get("entitlements/u1").valid_until, 0);
});

test("legacy client rooms explicitly require migration", async () => {
  const h = harness();
  h.repo.data.set("rooms/ABCDE", { schema: 2, players: { u1: {} } });
  await rejects(
    () => h.call("get:room", "u1", {}, { code: "ABCDE" }),
    "ROOM_MIGRATION_REQUIRED",
  );
});
