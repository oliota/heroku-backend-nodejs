import { createHash, randomUUID } from "node:crypto";
import { ApiError, assert } from "./errors.js";
import { rules, code, settings, text, object, scoreAnswers } from "./rules.js";
import { billingIdentity } from "./stores.js";

export const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const now = () => Date.now();
const activeLicense = (e) =>
  !!(
    e?.golden_wheel &&
    e.verified === true &&
    !e.revoked &&
    !e.sandbox &&
    e.valid_until > now()
  );
const member = (room, uid) =>
  assert(Object.hasOwn(room.players, uid), 403, "NOT_ROOM_MEMBER");
const leader = (room, uid) => assert(room.host === uid, 403, "HOST_REQUIRED");
const state = (room, ...allowed) =>
  assert(allowed.includes(room.status), 409, "INVALID_STATE");
const itemKeys = (room) =>
  room.participants.flatMap((uid) =>
    room.categories.map((_, i) => `${uid}:${i}`),
  );
const categoryKeys = (room) =>
  room.participants.map((uid) => `${uid}:${room.review.category}`);
const suggestion = (room, key) => {
  const split = key.lastIndexOf(":");
  return Number(room.suggested[key.slice(0, split)]?.[Number(key.slice(split + 1))] ?? 0);
};
const resolved = (room, key) =>
  !room.review.disputed?.[key] || Object.hasOwn(room.review.approved, key);
const categoryResolved = (room) => categoryKeys(room).every((key) => resolved(room, key));
const lockCategory = (room) => {
  for (const key of categoryKeys(room))
    room.review.approved[key] ??= suggestion(room, key);
};
const allApproved = (room) =>
  itemKeys(room).every((k) => Object.hasOwn(room.review.approved, k));
const allDone = (room) =>
  room.participants.every((uid) => room.review.done[uid] === true);
const snapshot = (room) => structuredClone(room);

export class AdedonhaService {
  constructor(repository, { purchases, rewards } = {}) {
    this.repo = repository;
    this.purchases = purchases;
    this.rewards = rewards;
  }
  async execute(action, user, input, context = {}) {
    const uid = user.uid;
    assert(
      typeof uid === "string" && /^[^/\u0000-\u001f]{1,128}$/.test(uid),
      401,
      "INVALID_TOKEN",
    );
    const mutation = !action.startsWith("get:");
    if (mutation)
      assert(
        typeof context.key === "string" &&
          /^[A-Za-z0-9_-]{8,100}$/.test(context.key),
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
      );
    let verified;
    if (mutation) {
      const old = await this.repo.transaction((tx) =>
        tx.get(`adedonha_operations/${hash(`${uid}:${context.key}`)}`),
      );
      if (old) {
        assert(
          old.fingerprint ===
            hash({ action, input, code: context.code, id: context.id }),
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        return old.response;
      }
    }
    // Refresh expiring licenses using server-only receipts, including when used from Web.
    if (
      [
        "get:premium",
        "get:entitlements",
        "rooms:create",
        "rooms:join",
      ].includes(action) &&
      this.purchases
    ) {
      const license = await this.repo.transaction((tx) =>
        tx.get(`entitlements/${uid}`),
      );
      if (
        license?.verified &&
        !license.sandbox &&
        !license.revoked &&
        license.valid_until <= now()
      ) {
        const receipt = await this.repo.transaction((tx) =>
          tx.get(`adedonha_private_licenses/${uid}`),
        );
        if (receipt) {
          let refreshed;
          try {
            refreshed = await this.purchases.verify(receipt, uid);
          } catch (error) {
            if (error.code !== "INVALID_PURCHASE") throw error;
            refreshed = {
              verified: true,
              uid,
              purchase_id: license.purchase_id,
              revoked: true,
            };
          }
          assert(
            refreshed?.verified &&
              refreshed.uid === uid &&
              refreshed.purchase_id === license.purchase_id,
            403,
            "INVALID_PURCHASE",
          );
          await this.repo.transaction(async (tx) => {
            const current = await tx.get(`entitlements/${uid}`);
            if (current?.purchase_id === license.purchase_id)
              tx.set(`entitlements/${uid}`, {
                ...current,
                golden_wheel: !refreshed.revoked,
                revoked: !!refreshed.revoked,
                valid_until: now() + 3600000,
                updated_at: now(),
              });
          });
        }
      }
    }
    // External verification must not run inside a retryable Firestore transaction.
    if (["premium:verify", "premium:restore"].includes(action)) {
      object(input, ["platform", "purchase_token", "transaction_id"]);
      assert(
        ["android", "ios"].includes(input.platform),
        400,
        "INVALID_PLATFORM",
      );
      if (input.platform === "android") text(input.purchase_token, 4096);
      else text(input.transaction_id, 256);
      assert(this.purchases, 503, "STORE_UNAVAILABLE");
      verified = await this.purchases.verify(input, uid);
    }
    if (action === "tickets:redeem" && input.source !== "free") {
      assert(this.rewards, 503, "ADS_UNAVAILABLE", "Use the free alternative");
      const intent = await this.repo.transaction((tx) =>
        tx.get(`ticket_intents/${text(input.intent_id, 100)}`),
      );
      assert(
        intent &&
          intent.uid === uid &&
          !intent.redeemed &&
          intent.expires_at > now(),
        409,
        "INVALID_INTENT",
      );
      verified = await this.rewards.verify(input, { uid, intent });
      assert(
        verified?.verified === true &&
          verified.uid === uid &&
          verified.room_id === intent.room_id &&
          verified.intent_id === input.intent_id &&
          verified.event_id,
        403,
        "INVALID_REWARD",
      );
    }
    return this.repo.transaction(async (tx) => {
      const operationPath = `adedonha_operations/${hash(`${uid}:${context.key}`)}`;
      const fingerprint = hash({
        action,
        input,
        code: context.code,
        id: context.id,
      });
      if (mutation) {
        const old = await tx.get(operationPath);
        if (old) {
          assert(old.fingerprint === fingerprint, 409, "IDEMPOTENCY_CONFLICT");
          return old.response;
        }
        const bucketPath = `adedonha_limits/${hash(uid)}`;
        const bucket = await tx.get(bucketPath);
        const start = Math.floor(now() / 60000);
        const count = bucket?.start === start ? bucket.count + 1 : 1;
        assert(count <= 120, 429, "RATE_LIMITED");
        tx.set(bucketPath, { start, count });
      }
      const result = await this.dispatch(
        tx,
        action,
        user,
        input,
        context,
        verified,
      );
      if (mutation)
        tx.set(operationPath, {
          uid,
          fingerprint,
          response: result,
          created_at: now(),
        });
      return result;
    });
  }

  async dispatch(tx, action, user, input, ctx, verified) {
    const uid = user.uid;
    const profilePath = `users/${uid}`;
    const entitlement = async () =>
      (await tx.get(`entitlements/${uid}`)) ?? { golden_wheel: false };
    if (action === "get:me")
      return (await tx.get(profilePath)) ?? { uid, synced: false };
    if (action === "me:sync") {
      object(input, ["name", "color"]);
      const old = await tx.get(profilePath);
      let friendCode = old?.friend_code;
      if (!friendCode) {
        for (let i = 0; i < 12; i++) {
          const candidate = code(6);
          if (!(await tx.get(`friend_codes/${candidate}`))) {
            friendCode = candidate;
            break;
          }
        }
        assert(friendCode, 503, "CODE_ALLOCATION_FAILED");
        tx.set(`friend_codes/${friendCode}`, { uid });
      }
      const guest = user.firebase?.sign_in_provider === "anonymous";
      const name = guest
        ? input.name ?? old?.name
        : user.firebase?.sign_in_provider === "google.com"
          ? user.email ?? old?.name ?? user.name ?? "Player"
          : input.name ?? old?.name ?? user.name ?? "Player";
      if (guest) {
        assert(typeof name === "string" && name.trim().length > 0, 400, "NICKNAME_REQUIRED");
        assert(Array.from(name.trim()).length >= 2 && Array.from(name.trim()).length <= 24, 400, "INVALID_NICKNAME");
      }
      const validatedName = text(name, guest ? 24 : 254);
      const color = input.color ?? old?.color ?? "#2EC4B6";
      assert(/^#[0-9A-Fa-f]{6}$/.test(color), 400, "INVALID_COLOR");
      const profile = {
        uid,
        name: validatedName,
        color,
        friend_code: friendCode,
        games: old?.games ?? 0,
        wins: old?.wins ?? 0,
        best: old?.best ?? 0,
        created_at: old?.created_at ?? now(),
        updated_at: now(),
      };
      tx.set(profilePath, profile);
      return profile;
    }
    if (action === "get:stats") {
      const p = await tx.get(profilePath);
      return { games: p?.games ?? 0, wins: p?.wins ?? 0, best: p?.best ?? 0 };
    }
    if (action === "get:history")
      return this.page(tx, `users/${uid}/history`, input);
    if (["get:entitlements", "get:premium"].includes(action)) {
      const e = await entitlement();
      return {
        golden_wheel: activeLicense(e),
        revoked: !!e.revoked,
        verified_until: e.valid_until ?? null,
        billing_identity: billingIdentity(uid),
        benefits: activeLicense(e)
          ? [
              "wheel_customization",
              "online_without_tickets",
              "unlimited_rooms",
              "room_ad_free",
            ]
          : [],
      };
    }
    if (action.startsWith("premium:")) {
      assert(
        verified?.verified === true &&
          verified.product === "golden_wheel" &&
          verified.purchase_id &&
          verified.uid === uid,
        403,
        "INVALID_PURCHASE",
      );
      const receiptPath = `adedonha_purchases/${hash(`${input.platform}:${verified.purchase_id}`)}`;
      const receipt = await tx.get(receiptPath);
      assert(!receipt || receipt.uid === uid, 409, "PURCHASE_ALREADY_LINKED");
      tx.set(receiptPath, {
        uid,
        platform: input.platform,
        purchase_id: verified.purchase_id,
        updated_at: now(),
      });
      const e = {
        golden_wheel: !verified.revoked,
        verified: true,
        revoked: !!verified.revoked,
        platform: input.platform,
        product: "golden_wheel",
        purchase_id: verified.purchase_id,
        valid_until: now() + 3600000,
        updated_at: now(),
      };
      tx.set(`entitlements/${uid}`, e);
      tx.set(`adedonha_private_licenses/${uid}`, input);
      return {
        golden_wheel: activeLicense(e),
        revoked: e.revoked,
        verified_until: e.valid_until,
      };
    }
    if (action.startsWith("get:friends") || action.startsWith("friends:"))
      return this.friends(tx, action, uid, input, ctx);
    if (action.startsWith("get:tickets") || action.startsWith("tickets:"))
      return this.tickets(tx, action, uid, input, ctx, verified);
    if (action === "rooms:create") {
      object(input, ["settings"]);
      const profile = await tx.get(profilePath);
      assert(profile, 409, "PROFILE_REQUIRED");
      let roomCode;
      for (let i = 0; i < 12; i++) {
        const candidate = code(5);
        if (!(await tx.get(`rooms/${candidate}`))) {
          roomCode = candidate;
          break;
        }
      }
      assert(roomCode, 503, "CODE_ALLOCATION_FAILED");
      const e = await entitlement();
      const room = {
        schema: 2,
        api_authority: 1,
        code: roomCode,
        room_id: randomUUID(),
        game_id: randomUUID(),
        version: 1,
        host: uid,
        owner: uid,
        status: "lobby",
        ...settings(input.settings),
        round: 0,
        round_id: "",
        letter: "",
        selected_letter: "",
        spinner_uid: uid,
        used: [],
        players: {
          [uid]: {
            name: profile.name,
            color: profile.color,
            score: 0,
            present: true,
            last_seen: now(),
          },
        },
        participants: [],
        answers: {},
        suggested: {},
        review: {},
        results: {},
        premium: {
          ad_free: activeLicense(e),
          activated_by: activeLicense(e) ? uid : "",
          owner_entered: true,
        },
        created_at: now(),
        updated_at: now(),
      };
      tx.set(`rooms/${roomCode}`, room);
      await this.admit(tx, room, uid, e);
      return snapshot(room);
    }
    assert(
      ctx.code &&
        new RegExp(`^[${rules.online.code_alphabet}]{5}$`).test(ctx.code),
      400,
      "INVALID_ROOM_CODE",
    );
    const path = `rooms/${ctx.code}`;
    const room = await tx.get(path);
    assert(room, 404, "ROOM_NOT_FOUND");
    assert(
      room.api_authority === 1,
      409,
      "ROOM_MIGRATION_REQUIRED",
      "This room uses the legacy client-authoritative protocol",
    );
    let updateVersion = true;
    if (action === "rooms:join") {
      object(input, ["version"]);
      state(room, "lobby", "letter_selection", "playing", "review", "results");
      if (Object.hasOwn(room.players, uid)) {
        room.players[uid].present = true;
        room.players[uid].last_seen = now();
      } else {
        if (input.version !== undefined) this.version(room, input);
        state(room, "lobby");
        assert(Object.keys(room.players).length < 10, 409, "ROOM_FULL");
        const p = await tx.get(profilePath);
        assert(p, 409, "PROFILE_REQUIRED");
        await this.admit(tx, room, uid, await entitlement());
        room.players[uid] = {
          name: p.name,
          color: p.color,
          score: 0,
          present: true,
          last_seen: now(),
        };
      }
    } else {
      member(room, uid);
      if (action === "get:room" || action === "get:game") {
        await this.beginReview(tx, room);
        if (room._changed) {
          delete room._changed;
          room.version++;
          room.updated_at = now();
          tx.set(path, room);
        }
        return snapshot(room);
      }
      if (action === "get:answers") {
        const draft = await tx.get(`rooms/${room.code}/players/${uid}`);
        return draft?.round_id === room.round_id
          ? { round_id: draft.round_id, sequence: draft.sequence, answers: draft.answers, final: draft.final }
          : { round_id: room.round_id, sequence: -1, answers: room.categories.map(() => ""), final: false };
      }
      if (action === "get:players")
        return {
          players: room.players,
          version: room.version,
          presence_timeout_ms: 60000,
        };
      if (action === "get:results")
        return {
          game_id: room.game_id,
          round_id: room.round_id,
          version: room.version,
          results: room.results,
          players: room.players,
          status: room.status,
        };
      if (action === "get:review") {
        await this.beginReview(tx, room);
        if (room._changed) {
          delete room._changed;
          room.version++;
          room.updated_at = now();
          tx.set(path, room);
        }
        state(room, "review", "results");
        if (ctx.id !== undefined)
          assert(
            /^\d+$/.test(ctx.id) && Number(ctx.id) < room.categories.length,
            400,
            "INVALID_CATEGORY",
          );
        return {
          round_id: room.round_id,
          version: room.version,
          letter: room.letter,
          categories: room.categories,
          answers: room.answers,
          suggested: room.suggested,
          review: room.review,
          category:
            ctx.id === undefined ? room.review.category : Number(ctx.id),
        };
      }
      if (action === "rooms:heartbeat") {
        object(input, []);
        state(
          room,
          "lobby",
          "letter_selection",
          "playing",
          "review",
          "results",
        );
        updateVersion = room.players[uid].present !== true;
        room.players[uid].present = true;
        room.players[uid].last_seen = now();
      } else {
        if (action === "rooms:answers")
          assert(Number.isSafeInteger(input.version), 400, "INVALID_VERSION");
        else this.version(room, input);
        if (
          [
            "rooms:settings",
            "rooms:start",
            "rooms:rounds",
            "rooms:close",
            "review:reopen",
            "review:force",
            "review:next",
          ].includes(action)
        )
          leader(room, uid);
        if (action === "rooms:settings") {
          object(input, ["version", "settings"]);
          state(room, "lobby");
          Object.assign(room, settings(input.settings, room));
        } else if (action === "rooms:close") {
          object(input, ["version"]);
          room.status = "closed";
          room.premium.ad_free = false;
        } else if (action === "rooms:leave") {
          object(input, ["version"]);
          room.players[uid].present = false;
          if (room.status === "lobby") delete room.players[uid];
          if (room.host === uid) {
            const next = Object.keys(room.players).find(
              (id) => id !== uid && room.players[id].present,
            );
            if (next) room.host = next;
          }
          if (room.spinner_uid === uid && room.status === "letter_selection") {
            room.spinner_uid = room.host;
            room.selected_letter = "";
          }
          if (!Object.keys(room.players).length) {
            room.status = "closed";
            room.premium.ad_free = false;
          }
        } else if (action === "rooms:start" || action === "rooms:rounds") {
          object(input, ["version"]);
          state(room, action === "rooms:start" ? "lobby" : "results");
          if (room.round >= room.rounds) {
            await this.finish(tx, room);
          } else {
            room.participants = Object.keys(room.players);
            assert(room.participants.length > 0, 409, "NO_PLAYERS");
            room.round++;
            room.round_id = `r${room.round}-${randomUUID()}`;
            room.letter = "";
            room.selected_letter = "";
            room.spinner_uid = room.players[room.spinner_uid]?.present
              ? room.spinner_uid : room.host;
            room.answers = {};
            room.suggested = {};
            room.review = {};
            room.results = {};
            room.stop_by = "";
            room.stop_at = null;
            room.status = "letter_selection";
            let pool = Array.from(room.letters).filter(
              (c) => !room.used.includes(c),
            );
            if (!pool.length) {
              room.used = [];
              pool = Array.from(room.letters);
            }
            room.selected_letter = "";
          }
        } else {
          assert(
            input.round_id === room.round_id && input.game_id === room.game_id,
            409,
            "STALE_ROUND",
          );
          if (action === "rooms:delegate") {
            object(input, ["version", "round_id", "game_id", "spinner_uid"]);
            state(room, "letter_selection");
            assert(uid === room.host || uid === (room.spinner_uid || room.host), 403, "SPINNER_REQUIRED");
            assert(typeof input.spinner_uid === "string" &&
              room.participants.includes(input.spinner_uid) &&
              room.players[input.spinner_uid]?.present, 400, "INVALID_SPINNER");
            room.spinner_uid = input.spinner_uid;
            room.selected_letter = "";
          } else if (action === "rooms:select") {
            assert(uid === (room.spinner_uid || room.host), 403, "SPINNER_REQUIRED");
            object(input, ["version", "round_id", "game_id", "letter"]);
            state(room, "letter_selection");
            assert(
              typeof input.letter === "string" &&
                Array.from(input.letter).length === 1 &&
                room.letters.includes(input.letter) &&
                !room.used.includes(input.letter),
              400,
              "INVALID_LETTER",
            );
            room.selected_letter = input.letter;
          } else if (action === "rooms:confirm") {
            assert(uid === (room.spinner_uid || room.host), 403, "SPINNER_REQUIRED");
            object(input, ["version", "round_id", "game_id", "letter"]);
            state(room, "letter_selection");
            assert(
              input.letter === room.selected_letter &&
                room.letters.includes(input.letter) &&
                !room.used.includes(input.letter),
              409,
              "LETTER_MISMATCH",
            );
            room.letter = input.letter;
            room.used.push(room.letter);
            room.status = "playing";
            room.started_at = now();
            room.deadline = room.timer ? now() + room.timer * 1000 : null;
          } else if (action === "rooms:answers") {
            object(input, [
              "version",
              "round_id",
              "game_id",
              "answers",
              "final",
              "sequence",
            ]);
            state(room, "playing");
            assert(room.participants.includes(uid), 403, "NOT_PARTICIPANT");
            if (room.deadline && now() >= room.deadline && !room.stop_at) {
              room.stop_at = room.deadline;
              room.stop_by = "timer";
            }
            assert(!room.stop_at, 409, "ANSWERS_FROZEN");
            assert(
              Array.isArray(input.answers) &&
                input.answers.length === room.categories.length &&
                typeof input.final === "boolean" &&
                Number.isSafeInteger(input.sequence) &&
                input.sequence >= 0,
              400,
              "INVALID_ANSWERS",
            );
            const answerPath = `rooms/${room.code}/players/${uid}`;
            const old = await tx.get(answerPath);
            assert(
              !old ||
                old.round_id !== room.round_id ||
                input.sequence > old.sequence,
              409,
              "STALE_ANSWERS",
            );
            assert(
              !old || old.round_id !== room.round_id || !old.final,
              409,
              "ANSWERS_FINAL",
            );
            tx.set(answerPath, {
              round: room.round,
              round_id: room.round_id,
              answers: input.answers.map((a) => text(a, 40, false)),
              final: input.final,
              sequence: input.sequence,
              submitted_at: now(),
            });
            await this.beginReview(tx, room);
            if (room.status === "playing") return snapshot(room);
          } else if (action === "rooms:stop") {
            object(input, ["version", "round_id", "game_id", "answers", "sequence"]);
            state(room, "playing");
            if (input.answers !== undefined) {
              assert(
                Array.isArray(input.answers) &&
                  input.answers.length === room.categories.length &&
                  Number.isSafeInteger(input.sequence) && input.sequence >= 0,
                400,
                "INVALID_ANSWERS",
              );
              const answerPath = `rooms/${room.code}/players/${uid}`;
              const old = await tx.get(answerPath);
              assert(
                !old || old.round_id !== room.round_id ||
                  input.sequence > old.sequence ||
                  (input.sequence === old.sequence && !old.final &&
                    JSON.stringify(old.answers) === JSON.stringify(input.answers)),
                409,
                "STALE_ANSWERS",
              );
              tx.set(answerPath, {
                round: room.round,
                round_id: room.round_id,
                answers: input.answers.map((a) => text(a, 40, false)),
                final: true,
                sequence: input.sequence,
                submitted_at: now(),
              });
            }
            room.stop_by = uid;
            room.stop_at = now();
            await this.beginReview(tx, room);
          } else if (action.startsWith("review:")) {
            await this.beginReview(tx, room);
            state(room, "review");
            await this.review(tx, room, action, uid, input);
          } else throw new ApiError(404, "NOT_FOUND");
        }
      }
    }
    delete room._changed;
    if (updateVersion) room.version++;
    room.updated_at = now();
    tx.set(path, room);
    return snapshot(room);
  }

  version(room, input) {
    assert(
      Number.isSafeInteger(input.version) && input.version === room.version,
      409,
      "STALE_VERSION",
    );
  }
  async admit(tx, room, uid, license) {
    const path = `tickets/${uid}/rooms/${room.code}`;
    const old = await tx.get(path);
    if (old?.verified && old.room_id === room.room_id) return;
    if (activeLicense(license) || room.premium.ad_free || !this.rewards) {
      tx.set(path, {
        id: `${uid}:${room.code}`,
        uid,
        room_code: room.code,
        room_id: room.room_id,
        verified: true,
        source: activeLicense(license)
          ? "golden_wheel"
          : room.premium.ad_free
            ? "room_ad_free"
            : "free",
        created_at: now(),
      });
    } else throw new ApiError(402, "TICKET_REQUIRED");
  }
  async beginReview(tx, room) {
    if (room.status !== "playing") return;
    if (!room.stop_at && room.deadline && now() >= room.deadline) {
      room.stop_at = room.deadline;
      room.stop_by = "timer";
      room._changed = true;
    }
    if (!room.stop_at) return;
    const docs = await Promise.all(
      room.participants.map((id) => tx.get(`rooms/${room.code}/players/${id}`)),
    );
    assert(
      room.letter && room.used.includes(room.letter),
      409,
      "LETTER_NOT_CONFIRMED",
    );
    room.answers = Object.fromEntries(
      room.participants.map((id, i) => [
        id,
        docs[i]?.round_id === room.round_id
          ? docs[i].answers
          : Array(room.categories.length).fill(""),
      ]),
    );
    room.suggested = scoreAnswers(
      room.letter,
      room.answers,
      room.categories,
      room.lang,
    );
    room.review = {
      category: 0,
      approved: {},
      disputed: {},
      epochs: {},
      votes: {},
      done: {},
      forced: false,
      forced_categories: [],
      decisions: [],
    };
    room.status = "review";
    room._changed = true;
  }
  async review(tx, room, action, uid, input) {
    const fields = ["version", "round_id", "game_id"];
    room.review.disputed ??= {};
    room.review.decisions ??= [];
    if (action === "review:votes") {
      object(input, [...fields, "votes"]);
      assert(room.participants.includes(uid), 403, "NOT_PARTICIPANT");
      assert(
        input.votes && typeof input.votes === "object" &&
          !Array.isArray(input.votes) &&
          Object.keys(input.votes).length > 0 &&
          Object.keys(input.votes).length <= 120,
        400,
        "INVALID_VOTES",
      );
      let newDispute = false;
      for (const [key, vote] of Object.entries(input.votes)) {
        assert(categoryKeys(room).includes(key), 400, "INVALID_ITEM");
        assert(!Object.hasOwn(room.review.approved, key), 409, "ITEM_LOCKED");
        object(vote, ["v", "e"]);
        assert(
          [0, 5, 10].includes(vote.v) &&
            vote.e === (room.review.epochs[key] ?? 0),
          409,
          "INVALID_VOTE",
        );
        if (vote.v !== suggestion(room, key) && !room.review.disputed[key]) {
          room.review.disputed[key] = true;
          newDispute = true;
        }
        if (room.review.disputed[key]) {
          room.review.votes[uid] ??= {};
          room.review.votes[uid][key] = vote;
        }
      }
      if (newDispute) room.review.done = {};
      else room.review.done[uid] = false;
      for (const key of categoryKeys(room)) {
        if (!room.review.disputed[key]) continue;
        const votes = room.participants.map((id) => room.review.votes[id]?.[key]);
        if (
          votes.every((v) => v && v.e === (room.review.epochs[key] ?? 0)) &&
          votes.every((v) => v.v === votes[0].v)
        ) room.review.approved[key] = votes[0].v;
      }
    } else if (action === "review:reopen") {
      object(input, [...fields, "key"]);
      assert(itemKeys(room).includes(input.key), 400, "INVALID_ITEM");
      assert(Object.hasOwn(room.review.approved, input.key), 409, "ITEM_NOT_APPROVED");
      delete room.review.approved[input.key];
      room.review.disputed[input.key] = true;
      room.review.epochs[input.key] = (room.review.epochs[input.key] ?? 0) + 1;
      room.review.category = Math.min(
        room.review.category,
        Number(input.key.slice(input.key.lastIndexOf(":") + 1)),
      );
      room.review.done = {};
    } else if (action === "review:complete") {
      object(input, fields);
      assert(categoryResolved(room), 409, "REVIEW_PENDING");
      room.review.done[uid] = true;
      if (allDone(room)) {
        lockCategory(room);
        if (room.review.category < room.categories.length - 1) {
          room.review.category++;
          room.review.done = {};
        }
      }
    } else if (action === "review:unlock") {
      object(input, fields);
      room.review.done[uid] = false;
    } else if (action === "review:force" || action === "review:next") {
      object(input, [...fields, "mode", "scores"]);
      if (action === "review:force") {
        const mode = input.mode ?? "leader";
        assert(["leader", "majority"].includes(mode), 400, "INVALID_DECISION_MODE");
        const scores = input.scores ?? {};
        assert(typeof scores === "object" && !Array.isArray(scores), 400, "INVALID_VOTES");
        assert(Object.keys(scores).every((key) => categoryKeys(room).includes(key) && [0, 5, 10].includes(scores[key])), 400, "INVALID_VOTE");
        const decisions = {};
        for (const key of categoryKeys(room)) {
          if (Object.hasOwn(room.review.approved, key)) {
            decisions[key] = room.review.approved[key];
            continue;
          }
          if (!room.review.disputed[key]) {
            decisions[key] = suggestion(room, key);
            room.review.approved[key] = decisions[key];
            continue;
          }
          const votes = room.participants.map((id) => room.review.votes[id]?.[key])
            .filter((v) => v?.e === (room.review.epochs[key] ?? 0));
          const leaderVote = room.review.votes[uid]?.[key];
          const hostValue = scores[key] ?? (leaderVote?.e === (room.review.epochs[key] ?? 0) ? leaderVote.v : undefined);
          if (mode === "leader") {
            assert(hostValue !== undefined, 409, "HOST_VOTE_MISSING");
            decisions[key] = hostValue;
          } else {
            assert(votes.length > 0, 409, "REVIEW_PENDING");
            const counts = [0, 5, 10].map((value) => ({ value, count: votes.filter((v) => v.v === value).length }));
            const maximum = Math.max(...counts.map((c) => c.count));
            const tied = counts.filter((c) => c.count === maximum).map((c) => c.value);
            assert(tied.length === 1 || (hostValue !== undefined && tied.includes(hostValue)), 409, "HOST_VOTE_MISSING");
            decisions[key] = tied.length === 1 ? tied[0] : hostValue;
          }
          room.review.approved[key] = decisions[key];
        }
        lockCategory(room);
        room.review.forced = true;
        room.review.forced_categories.push(room.review.category);
        room.review.decisions.push({
          category: room.review.category,
          mode,
          by: uid,
          scores: decisions,
          at: now(),
        });
        if (room.review.category < room.categories.length - 1) {
          room.review.category++;
          room.review.done = {};
        } else {
          room.review.done = Object.fromEntries(room.participants.map((id) => [id, true]));
        }
      } else {
        assert(categoryResolved(room) && allDone(room), 409, "REVIEW_PENDING");
        lockCategory(room);
        if (room.review.category < room.categories.length - 1) {
          room.review.category++;
          room.review.done = {};
        }
      }
    } else throw new ApiError(404, "NOT_FOUND");
    if (allApproved(room) && allDone(room)) {
      room.results = Object.fromEntries(
        room.participants.map((id) => [
          id,
          room.categories.map((_, i) => room.review.approved[`${id}:${i}`]),
        ]),
      );
      for (const id of room.participants)
        room.players[id].score += room.results[id].reduce((a, b) => a + b, 0);
      room.status = "results";
      tx.set(`rooms/${room.code}/rounds/${room.round_id}`, {
        game_id: room.game_id,
        round_id: room.round_id,
        letter: room.letter,
        used: room.used,
        categories: room.categories,
        participants: room.participants,
        answers: room.answers,
        review: room.review,
        results: room.results,
        consolidated_at: now(),
      });
    }
  }
  async finish(tx, room) {
    room.status = "finished";
    room.premium.ad_free = false;
    const best = Math.max(...Object.values(room.players).map((p) => p.score));
    for (const [id, player] of Object.entries(room.players)) {
      const profile = await tx.get(`users/${id}`);
      if (profile)
        tx.set(`users/${id}`, {
          ...profile,
          games: (profile.games || 0) + 1,
          wins: (profile.wins || 0) + Number(player.score === best),
          best: Math.max(profile.best || 0, player.score),
          updated_at: now(),
        });
      tx.set(`users/${id}/history/${room.game_id}`, {
        game_id: room.game_id,
        room_code: room.code,
        score: player.score,
        won: player.score === best,
        rounds: room.round,
        finished_at: now(),
      });
    }
    tx.set(`adedonha_games/${room.game_id}`, {
      room_code: room.code,
      participants: Object.keys(room.players),
      scores: Object.fromEntries(
        Object.entries(room.players).map(([id, p]) => [id, p.score]),
      ),
      finished_at: now(),
    });
  }
  async page(tx, path, input, filters = []) {
    const limit = input.limit === undefined ? 30 : Number(input.limit);
    assert(
      Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      400,
      "INVALID_LIMIT",
    );
    const after = input.after === undefined ? "" : text(input.after, 256);
    assert(!after.includes("/"), 400, "INVALID_CURSOR");
    const rows = await tx.list(path, filters, limit + 1, after);
    return {
      items: rows.slice(0, limit),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async friends(tx, action, uid, input, ctx) {
    if (action === "get:friends")
      return this.page(tx, `users/${uid}/friends`, input);
    if (action === "get:friends:requests" || action === "get:friends:count") {
      if (action === "get:friends:count")
        return {
          count: (await tx.get(`adedonha_friend_counters/${uid}`))?.count ?? 0,
        };
      return this.page(tx, `users/${uid}/friend_requests`, input);
    }
    const counter = async (id, delta) => {
      const path = `adedonha_friend_counters/${id}`;
      const c = await tx.get(path);
      tx.set(path, {
        count: Math.max(0, (c?.count ?? 0) + delta),
        updated_at: now(),
      });
    };
    if (action === "friends:request") {
      object(input, ["friend_code"]);
      assert(
        typeof input.friend_code === "string" &&
          /^[A-HJ-NP-Z2-9]{6}$/.test(input.friend_code),
        400,
        "INVALID_FRIEND_CODE",
      );
      const target = await tx.get(`friend_codes/${input.friend_code}`);
      assert(target, 404, "FRIEND_CODE_NOT_FOUND");
      assert(target.uid !== uid, 400, "SELF_FRIENDSHIP");
      assert(
        !(await tx.get(`users/${uid}/friends/${target.uid}`)),
        409,
        "ALREADY_FRIENDS",
      );
      const id = hash([uid, target.uid].sort().join(":"));
      const old = await tx.get(`friend_requests/${id}`);
      assert(!old || old.status !== "pending", 409, "REQUEST_PENDING");
      const profile = await tx.get(`users/${uid}`);
      assert(profile, 409, "PROFILE_REQUIRED");
      const request = {
        id,
        from: uid,
        to: target.uid,
        from_name: profile.name,
        status: "pending",
        created_at: now(),
      };
      tx.set(`friend_requests/${id}`, request);
      tx.set(`users/${target.uid}/friend_requests/${id}`, request);
      await counter(target.uid, 1);
      return request;
    }
    object(input, []);
    if (action === "friends:delete") {
      const target = text(ctx.id, 128);
      assert(!target.includes("/") && target !== uid, 400, "INVALID_USER");
      tx.delete(`users/${uid}/friends/${target}`);
      tx.delete(`users/${target}/friends/${uid}`);
      return { removed: true, uid: target };
    }
    assert(/^[a-f0-9]{64}$/.test(ctx.id), 400, "INVALID_REQUEST_ID");
    const request = await tx.get(`friend_requests/${ctx.id}`);
    assert(request, 404, "REQUEST_NOT_FOUND");
    assert(request.to === uid, 403, "REQUEST_RECIPIENT_REQUIRED");
    assert(request.status === "pending", 409, "REQUEST_RESOLVED");
    request.status = action === "friends:accept" ? "accepted" : "rejected";
    request.updated_at = now();
    if (action === "friends:accept") {
      const a = await tx.get(`users/${request.from}`);
      const b = await tx.get(`users/${uid}`);
      assert(a && b, 409, "PROFILE_REQUIRED");
      tx.set(`users/${uid}/friends/${request.from}`, {
        uid: request.from,
        name: a.name,
        color: a.color,
        since: now(),
      });
      tx.set(`users/${request.from}/friends/${uid}`, {
        uid,
        name: b.name,
        color: b.color,
        since: now(),
      });
    }
    tx.set(`friend_requests/${ctx.id}`, request);
    tx.delete(`users/${uid}/friend_requests/${ctx.id}`);
    await counter(uid, -1);
    return request;
  }
  async tickets(tx, action, uid, input, ctx, verified) {
    if (action === "get:tickets:id") {
      const id = text(ctx.id, 5);
      assert(
        new RegExp(`^[${rules.online.code_alphabet}]{5}$`).test(id),
        400,
        "INVALID_ROOM_CODE",
      );
      const ticket = await tx.get(`tickets/${uid}/rooms/${id}`);
      assert(ticket, 404, "TICKET_NOT_FOUND");
      return ticket;
    }
    object(
      input,
      action === "tickets:redeem"
        ? ["intent_id", "source", "proof"]
        : ["room_code"],
    );
    let intent;
    if (action === "tickets:redeem") {
      assert(
        typeof input.intent_id === "string" &&
          /^[a-f0-9-]{36}$/.test(input.intent_id),
        400,
        "INVALID_INTENT",
      );
      intent = await tx.get(`ticket_intents/${input.intent_id}`);
      assert(
        intent?.uid === uid && intent.expires_at > now() && !intent.redeemed,
        409,
        "INVALID_INTENT",
      );
    }
    const roomCode = intent?.room_code ?? input.room_code;
    assert(
      typeof roomCode === "string" &&
        new RegExp(`^[${rules.online.code_alphabet}]{5}$`).test(roomCode),
      400,
      "INVALID_ROOM_CODE",
    );
    const room = await tx.get(`rooms/${roomCode}`);
    assert(room, 404, "ROOM_NOT_FOUND");
    assert(room.api_authority === 1, 409, "ROOM_MIGRATION_REQUIRED");
    state(room, "lobby", "letter_selection", "playing", "review", "results");
    const ticketPath = `tickets/${uid}/rooms/${roomCode}`;
    const ticket = await tx.get(ticketPath);
    if (action === "get:tickets:status")
      return {
        room_code: roomCode,
        ticket: ticket?.room_id === room.room_id ? ticket : null,
        ad_available: !!this.rewards,
        free_available: !this.rewards,
        room_ad_free: room.premium.ad_free,
      };
    if (action === "tickets:intent") {
      const id = randomUUID();
      const result = {
        id,
        uid,
        room_code: roomCode,
        room_id: room.room_id,
        expires_at: now() + 600000,
        redeemed: false,
        provider: this.rewards?.name ?? null,
        free_available: !this.rewards,
      };
      tx.set(`ticket_intents/${id}`, result);
      return result;
    }
    assert(intent.room_id === room.room_id, 409, "STALE_ROOM");
    assert(
      input.source === "free" ? !this.rewards : verified?.verified === true,
      403,
      "INVALID_REWARD",
    );
    if (verified?.event_id) {
      const path = `adedonha_reward_events/${hash(verified.event_id)}`;
      assert(!(await tx.get(path)), 409, "REWARD_ALREADY_USED");
      tx.set(path, { uid, room_id: room.room_id, created_at: now() });
    }
    const result =
      ticket?.room_id === room.room_id && ticket.verified
        ? ticket
        : {
            id: `${uid}:${roomCode}`,
            uid,
            room_code: roomCode,
            room_id: room.room_id,
            source: input.source === "free" ? "free" : "rewarded_ad",
            verified: true,
            created_at: now(),
          };
    tx.set(ticketPath, result);
    tx.set(`ticket_intents/${input.intent_id}`, { ...intent, redeemed: true });
    return result;
  }
}
