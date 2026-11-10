# Adedonha / STOP — backend integration contract v1

The same API serves Android, iOS and the future equivalent pages `https://oliota.com/adedonha` and `https://oliota.com/stop`. This document is the contract for implementation. No frontend or Godot files were changed.

## Base URLs and prerequisites

- Local: `http://localhost:3002/api/v1/adedonha` (or `PORT`).
- Production after a manual deploy: `https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com/api/v1/adedonha`. This change has not been deployed.
- Firebase project: **adedonha-stop**, Firestore `(default)`. Existing expenses/schedule/GitHub services keep their existing configuration.
- API version: 1, room `schema: 2`, `api_authority: 1`. State strings are lowercase for the Godot shared schema: `lobby`, `letter_selection`, `playing`, `review`, `results`, `finished`, `closed` (the conceptual LOBBY → LETTER_SELECTION → PLAYING → REVIEW → RESULTS → FINISHED state machine).

**Native migration prerequisite:** the inspected Godot app writes directly to Firestore and uses client-authoritative schema-2 rooms. The new API does not trust those writes or import sandbox entitlements. All platforms must send mutations through this API and use the candidate server-only Firestore rules. Legacy rooms return `409 ROOM_MIGRATION_REQUIRED`; complete them using the existing version, then create a new API room. Same-project identity and read fields are compatible, but unmodified legacy native clients cannot securely participate in API-authoritative matches. Do not deploy the candidate rules before coordinating that client migration. No rules have been deployed by this implementation.

## Authentication and HTTP conventions

Sign in with Google through Firebase Authentication for `adedonha-stop`. Send a Firebase **ID token**, not a Google OAuth access token:

```http
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
Idempotency-Key: <unique-per-operation-8-to-100-letters-digits-underscore-or-hyphen>
```

Only the six public routes below omit authentication. All mutations require `Idempotency-Key`, including heartbeats. Generate a fresh random key per intended action; retry an uncertain request with the **same key and identical body/path**. Completed operations return the original response, even if later state advanced. Different bodies/actions/rooms under the same UID/key return `409 IDEMPOTENCY_CONFLICT`. Keys are scoped to the authenticated UID, never client-provided identity. Store keys until the outcome is known. Pending transactions may be retried after network errors. Do not retry with a new key just because a response was lost.

Firebase tokens are verified with revocation checks; only `firebase.sign_in_provider == google.com` can play. Expired/revoked/malformed tokens return 401; refresh the ID token once, then prompt login if still unauthorized. UID, host, owner, points, premium and license fields are never accepted as client authority. Unknown JSON fields are rejected. JSON payload limit is 32 KiB; strings use Unicode character counts. No cookies are needed.

Success envelope (room creation returns 201, other operations 200):

```json
{ "data": { "version": 7, "status": "playing" } }
```

Error envelope:

```json
{ "error": { "code": "STALE_VERSION", "message": "STALE_VERSION" } }
```

Empty action bodies mean `{}`. Query parameters are strings. Timestamps in API-owned records are Unix milliseconds. Optional nullable fields use `null`. Lists return `{items: [...], next_cursor: "lastDocumentId" | null}` in `data`; use `?limit=30&after=<next_cursor>` (1–100). Ordering is ascending document ID, not chronological. Cache keyed by UID and document ID; reload the first page after mutations. History has `finished_at` for client sorting.

## Public endpoints

| Method | Path                    | Response data                                                                                                                               |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`               | `{status:"ok",firebase:"configured"                                                                                                         | "unavailable",database_checked:false,api_version:1}` |
| GET    | `/config`               | Versions, Firebase project ID, rules URL, state names, limits, grace time, ad/free-ticket availability, premium product, purchase platforms |
| GET    | `/rules`                | Full `data/adedonhaRules.json`, copied from Godot's official shared rules                                                                   |
| GET    | `/categories?locale=pt` | `{locale,categories,suggested_categories,min,max,max_length}`                                                                               |
| GET    | `/letters?locale=pt`    | `{locale,letters,alphabet,checks_initial}`; letters/alphabet are strings                                                                    |
| GET    | `/locales`              | `{locales:[...]}`                                                                                                                           |

Default locale: `en`. Supported: `en`, `pt`, `pt_pt`, `es`, `fr`, `de`, `it`, `ru`, `el`, `zh`. `pt_PT` aliases `pt_pt`; `pt_BR` aliases `pt`. Unsupported values return `INVALID_LOCALE`; no guessed lists. Consume the full exact strings from these routes, including Cyrillic, Greek, Chinese and accented characters. Category count is 3–12, category length 24, answer length 40, room limit 10. Timers: `0,60,90,120,180` seconds; rounds: `1,3,5,7,10`. Room/friend codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, lengths 5/6. Room codes are case sensitive.

`/health` reports configuration presence, not live Firebase readiness. Public routes work without credentials. A protected request without a token gets 401; with a token but missing Firebase configuration gets `503 BACKEND_UNAVAILABLE`.

## User endpoints

| Method | Path               | Body/query                        | Response data                                                 |
| ------ | ------------------ | --------------------------------- | ------------------------------------------------------------- |
| GET    | `/me`              | —                                 | Profile, or `{uid,synced:false}`                              |
| POST   | `/me/sync`         | `{name?:string,color?:"#RRGGBB"}` | Profile                                                       |
| GET    | `/me/stats`        | —                                 | `{games,wins,best}`                                           |
| GET    | `/me/history`      | `limit?,after?`                   | Page of `{id,game_id,room_code,score,won,rounds,finished_at}` |
| GET    | `/me/entitlements` | —                                 | Same as premium status                                        |

Profile: `{uid,name,color,friend_code,games,wins,best,created_at,updated_at}`. Name limit 40. Sync generates a stable unique friend code server-side. Statistics update atomically when the leader advances after the final results; tied highest scorers each receive a win. Closing an unfinished room does not award completed-game stats. Users' emails, OAuth credentials and store receipts are never included in friend/room responses.

## Rooms and synchronization versions

Room mutations require `version` equal to the latest snapshot unless stated otherwise. Every successful room change increments it, including presence and drafts. On `STALE_VERSION`, fetch `/rooms/:code/game`, re-evaluate the intended action and issue a new request/key; use the original key only for retrying the original request. Serialize local writes and debounce drafts to avoid unnecessary conflicts.

`R` below means the returned **full room document**. `V` is `{version:<integer>}`. `Q` is `{version,game_id,round_id}` with values from the latest room. IDs are opaque server-generated strings. Any request bearing an old game/round ID returns `STALE_ROUND`. Never derive the letter from wheel coordinates or animation.

| Method | Path                           | Body                                                              | Permission / result                                                                                               |
| ------ | ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| POST   | `/rooms`                       | `{settings?:{lang?,categories?,letters?,rounds?,timer?}}`         | Synced user; creates and joins; 201 R                                                                             |
| GET    | `/rooms/:code`                 | —                                                                 | Member; R                                                                                                         |
| POST   | `/rooms/:code/join`            | `{version?:integer}`                                              | New user: lobby and current version required. Existing member: reconnect at any active state, version optional. R |
| POST   | `/rooms/:code/leave`           | V                                                                 | Member; R                                                                                                         |
| POST   | `/rooms/:code/start`           | V                                                                 | Leader, lobby → letter_selection; R                                                                               |
| PATCH  | `/rooms/:code/settings`        | `{version,settings:{lang?,categories?,letters?,rounds?,timer?}}`  | Leader, lobby; R                                                                                                  |
| POST   | `/rooms/:code/close`           | V                                                                 | Leader; closed and disables shared benefit; R                                                                     |
| GET    | `/rooms/:code/players`         | —                                                                 | Member; `{players,version,presence_timeout_ms:60000}`                                                             |
| POST   | `/rooms/:code/heartbeat`       | `{}`                                                              | Member; R; no version/game/round fields                                                                           |
| GET    | `/rooms/:code/game`            | —                                                                 | Member; R; may atomically advance an expired timer/grace to review                                                |
| POST   | `/rooms/:code/rounds`          | V                                                                 | Leader, results → next letter_selection or finished; R                                                            |
| POST   | `/rooms/:code/letters/select`  | `{...Q,letter:"C"}`                                               | Leader, letter_selection; R                                                                                       |
| POST   | `/rooms/:code/letters/confirm` | `{...Q,letter:"C"}`                                               | Leader; must equal selected_letter; starts playing; R                                                             |
| PUT    | `/rooms/:code/answers`         | `{...Q,answers:["Cinza","Corsa","Caqui"],final:false,sequence:1}` | Participant, playing; R                                                                                           |
| POST   | `/rooms/:code/stop`            | Q                                                                 | Any participant, playing; R                                                                                       |
| GET    | `/rooms/:code/results`         | —                                                                 | Member; `{game_id,round_id,version,results,players,status}`                                                       |

Create example:

```json
{
  "settings": {
    "lang": "pt",
    "categories": ["COR", "CARRO", "FRUTA"],
    "letters": "ABC",
    "rounds": 3,
    "timer": 90
  }
}
```

Full room fields:

```json
{
  "schema": 2,
  "api_authority": 1,
  "code": "K7QX2",
  "room_id": "uuid",
  "game_id": "uuid",
  "version": 4,
  "host": "uidA",
  "owner": "uidA",
  "status": "playing",
  "lang": "pt",
  "round": 1,
  "round_id": "r1-uuid",
  "rounds": 3,
  "timer": 90,
  "categories": ["COR", "CARRO", "FRUTA"],
  "letters": "ABC",
  "selected_letter": "C",
  "letter": "C",
  "used": ["C"],
  "players": {
    "uidA": {
      "name": "Ana",
      "color": "#2EC4B6",
      "score": 0,
      "present": true,
      "last_seen": 1790000000000
    }
  },
  "participants": ["uidA"],
  "answers": {},
  "suggested": {},
  "review": {},
  "results": {},
  "premium": { "ad_free": false, "activated_by": "", "owner_entered": true },
  "stop_by": "",
  "stop_at": null,
  "started_at": 1790000000000,
  "deadline": 1790000090000,
  "created_at": 1790000000000,
  "updated_at": 1790000000000
}
```

Creation includes owner entry, so a verified Golden Wheel owner activates the persisted shared benefit immediately. `owner` is immutable original creator; `host` is current leader. Leaving in lobby removes membership; during a game it retains answers, scoring identity and review eligibility and sets `present:false`. If a present participant remains, leadership transfers when the host explicitly leaves. Losing the network does not remove anyone, delete a room or automatically change its leader. A sole host can reconnect. Empty lobby closes. Closed/finished rooms cannot be joined or reused; create a new room/game. One-player games are permitted.

Send heartbeat approximately every 25 seconds while foregrounded, and mark UI presence stale if `Date.now()-last_seen>60000`, regardless of persisted `present:true`. Reconnect through `/join` and reload `/game`; this does not consume another ticket or duplicate membership. New players cannot join after lobby. The participants list is frozen for each round; disconnects do not silently exclude voters.

Answers must exactly match the category array length. `sequence` is an increasing nonnegative integer per player/round; final submissions are immutable. Drafts live in private player documents, never in the room during playing. `STOP` persists `stop_by/stop_at`; the room remains playing during an 8-second final-submit grace. It enters review when all finals arrive or grace expires. The latest current-round draft is preserved; stale previous-round documents are ignored. A player with no current-round submission has empty strings. Posts after the deadline/grace do not erase drafts.

Timer/grace advancement is transactional and demand-driven: after STOP, poll `/game` roughly every second until review, even when also listening to Firestore. Snapshot listeners alone do not execute server transitions. `timer:0` has no deadline. Confirmed letters persist for the whole round; scoring requires a confirmed letter, never a wheel index. Normalized plausible unique answers suggest 10, repeated answers 5, invalid answers 0; Chinese only requires nonempty normalized text. Suggestions do not change scores.

## Review and voting

All review mutations use Q. Category identifiers are **zero-based indices**, not localized names. Every participant votes on each item, including empty answers and their own. The API intentionally requires explicit votes for empty answers too; legacy Godot auto-approval of blanks is not used because this API requires unanimity from every enabled participant.

| Method | Path                            | Body                                | Permission / response                                   |
| ------ | ------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| GET    | `/rooms/:code/review`           | —                                   | Member; review view                                     |
| GET    | `/rooms/:code/review/:category` | —                                   | Member; review view with requested category index       |
| PUT    | `/rooms/:code/review/votes`     | `{...Q,votes:{"uidA:0":{v:5,e:0}}}` | Participant; R                                          |
| POST   | `/rooms/:code/review/complete`  | Q                                   | Participant; confirms done after all items approved; R  |
| POST   | `/rooms/:code/review/unlock`    | Q                                   | Participant; withdraws own done flag while in review; R |
| POST   | `/rooms/:code/review/reopen`    | `{...Q,key:"uidA:0"}`               | Leader, approved item only; R                           |
| POST   | `/rooms/:code/review/force`     | Q                                   | Leader; force current category, then advance; R         |
| POST   | `/rooms/:code/review/next`      | Q                                   | Leader; current category must be fully approved; R      |

Review view: `{round_id,version,letter,categories,answers,suggested,review,category}`. `answers` maps each UID to its ordered string array. Review map:

```json
{
  "category": 0,
  "approved": { "uidA:0": 5 },
  "epochs": { "uidA:0": 0 },
  "votes": { "uidA": { "uidA:0": { "v": 5, "e": 0 } } },
  "done": { "uidA": false },
  "forced": false,
  "forced_categories": []
}
```

Item keys are `<uid>:<categoryIndex>`. Only `v:0|5|10` is valid; `e` must equal that item's epoch (missing epoch means 0). An item locks only after **all participants** submit the same value at its current epoch. Differences and missing votes remain pending. Votes cannot modify locked items. Vote only on `review.category`; suggestions may prefill the UI but the user must submit them through the API. Voting only changes the caller's votes and resets their done flag.

Reopening removes the approved value, increments its epoch, invalidates old votes and clears everyone's done flags; the active category returns to that item's category if earlier. Only the leader can do this. Normal next-category advancement requires every word approved. Force preserves approved scores and assigns the leader's current-epoch vote to each pending word. Missing leader votes cause `HOST_VOTE_MISSING` and roll back the **entire** operation. No vote is inferred or invented. Force advances a category but does not waive collective done confirmations.

The collective review ends only when every item in every category is approved and every participant has confirmed done. The last confirmation atomically records the immutable round snapshot, increments accumulated scores once, and changes status to results. While still in review, a participant can unlock their confirmation. After consolidation the round is immutable. `/rounds` advances results to another round or finished; shared ad-free permission ends on finished/closed.

## Friends

| Method | Path                           | Body/query               | Response data                                          |
| ------ | ------------------------------ | ------------------------ | ------------------------------------------------------ |
| GET    | `/friends`                     | `limit?,after?`          | Page of `{id,uid,name,color,since}`                    |
| GET    | `/friends/requests`            | `limit?,after?`          | Page of incoming pending request records               |
| GET    | `/friends/requests/count`      | —                        | `{count:<integer>}` for badge                          |
| POST   | `/friends/requests`            | `{friend_code:"ABC234"}` | Request record                                         |
| POST   | `/friends/requests/:id/accept` | `{}`                     | Resolved request; creates both friend edges atomically |
| POST   | `/friends/requests/:id/reject` | `{}`                     | Resolved request                                       |
| DELETE | `/friends/:uid`                | `{}`                     | `{removed:true,uid}`; removes both edges atomically    |

Request record: `{id,from,to,from_name,status,created_at,updated_at?}`. IDs are opaque SHA-256 strings. Self-friendship and a pending request in either direction are rejected. Only the recipient resolves requests. Rejecting/accepting decrements the persisted counter and removes the pending inbox entry. The red badge displays `count>0`. Subscribe to `users/{uid}/friend_requests` for inbox changes, then refetch count; refresh friend list after accept/remove. Names in friendships are snapshots from acceptance, not private profile lookups. No emails are exposed. Client cache must be scoped by UID and cleared on logout.

## Tickets and provider boundary

Offline remains free. In this deployment **no ad provider is configured**: real server-issued free tickets are available, and create/join automatically issue a free ticket. No client `watched:true` or simulated reward is accepted.

| Method | Path              | Body/query                         | Response data                                                            |
| ------ | ----------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/tickets/status` | `?room_code=K7QX2`                 | `{room_code,ticket,ad_available,free_available,room_ad_free}`            |
| POST   | `/tickets/intent` | `{room_code:"K7QX2"}`              | `{id,uid,room_code,room_id,expires_at,redeemed,provider,free_available}` |
| POST   | `/tickets/redeem` | `{intent_id:"uuid",source:"free"}` | Ticket                                                                   |
| GET    | `/tickets/:id`    | `id` is room code                  | Own ticket only                                                          |

Ticket: `{id:"uid:CODE",uid,room_code,room_id,verified:true,source,created_at}`. Sources: `free`, `golden_wheel`, `room_ad_free`, `rewarded_ad`. One UID/room entitlement persists across reconnects, is bound to immutable `room_id` and cannot move to another room. Intents expire after 10 minutes and redeem once, transactionally. Reusing the same completed idempotency key returns the original success without re-consuming anything. Tickets for finished rooms remain historical records and grant no future access.

The provider-independent service accepts an injected trusted reward verifier with `name` and `verify(input,{uid,intent})`. Only a verified result bound to `uid`, `room_id`, `intent_id` and globally unique `event_id` can issue a rewarded ticket; events are consumed atomically across rooms. Client body for a future provider is `{intent_id,source:"rewarded_ad",proof:<provider-specific-proof>}`. No such verifier or callback is enabled by environment variables in this release. It requires an actual provider implementation, signed server verification, policy eligibility and integration tests before activation; `/config` currently truthfully reports ads unavailable. Native AdMob and web providers can use different adapters. A client ad claim returns `503 ADS_UNAVAILABLE`; offer the free route. Do not show a fake ad.

## Golden Wheel purchase and restore

| Method | Path               | Body                                                                                               | Response data                                                     |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/premium/status`  | —                                                                                                  | `{golden_wheel,revoked,verified_until,billing_identity,benefits}` |
| POST   | `/premium/verify`  | Android `{platform:"android",purchase_token:"..."}` or iOS `{platform:"ios",transaction_id:"..."}` | `{golden_wheel,revoked,verified_until}`                           |
| POST   | `/premium/restore` | Same proof shape as verify                                                                         | Same as verify; rechecks store                                    |

This is a permanent non-consumable product, not a subscription. It grants wheel customization, ticket-free online play, unlimited room creation, ad-free room entry and room-scoped guest access. Current free fallback has no arbitrary room-creation quota for other players either.

Before native purchase, obtain `/me/entitlements`: `billing_identity.google_account_id` is the required Google Play `obfuscatedAccountId`; `billing_identity.apple_account_token` is the required StoreKit `appAccountToken` UUID. Both are derived by the backend from the authenticated UID. Purchases without matching store-signed account binding are rejected, preventing receipt theft. Configure the real product ID on the backend; do not send product names or `premium:true` as proof.

Google adapter authenticates to Android Publisher with its dedicated service account, queries the configured package/product/token, validates purchased/canceled state and account binding, rejects consumed/test/rewarded products, and acknowledges a production purchase before granting. Apple adapter uses Apple's official App Store Server library, production API and Apple-root signature verification, checking bundle/product/non-consumable type/account token and revocation. No sandbox license can grant production benefits.

Proofs are stored only in backend-private Firestore documents; responses, rooms and listeners never include them. A purchase ID can bind to only one UID even after revocation. Entitlements are revalidated after at most one hour when status/create/join is accessed, using the stored proof; this works on Web without resubmitting the native receipt. A store outage returns unavailable and does not trust an expired verification. `restore` also revalidates and persists revocation. Refunded/canceled/revoked purchases remove individual benefits on revalidation; the purchase binding is retained. There are no store webhook endpoints in this release: revocation latency is bounded by the one-hour refresh interval plus next access. A verified free-room grant already activated for guests persists until that room ends, including after owner departure/disconnection.

Web recognizes the same UID's native purchase; a separate web checkout is not implemented. Actual billing plugins, Google Play Console/API permissions, App Store Connect keys/root certificates, product IDs and production store tests are external prerequisites. When absent, verify/restore returns `503 STORE_UNAVAILABLE`; no fake entitlement is created.

## Firestore documents and real-time reads

| Path                               | Purpose / access after candidate rules                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `rooms/{code}`                     | Authoritative public-to-members room snapshot; single-document `onSnapshot`, no room listing |
| `rooms/{code}/players/{uid}`       | Private current-round drafts/finals; own read, API writes                                    |
| `rooms/{code}/rounds/{round_id}`   | Immutable answers/review/results archive; member read                                        |
| `users/{uid}`                      | Own profile, code and aggregate stats                                                        |
| `users/{uid}/history/{game_id}`    | Completed-game history                                                                       |
| `users/{uid}/friends/{friendUid}`  | Bidirectional accepted edges                                                                 |
| `users/{uid}/friend_requests/{id}` | Incoming pending request inbox                                                               |
| `friend_requests/{id}`             | Pair request state; sender/recipient single-read                                             |
| `friend_codes/{code}`              | Backend-only unique code lookup                                                              |
| `entitlements/{uid}`               | Own verified status; API writes                                                              |
| `tickets/{uid}/rooms/{code}`       | Own room ticket                                                                              |
| `ticket_intents/{uuid}`            | Backend-only reward/free intent binding                                                      |
| `adedonha_games/{game_id}`         | Backend-owned completed-game summary                                                         |
| `adedonha_operations/{hash}`       | Backend-only persistent request fingerprint/result                                           |
| `adedonha_limits/{hash}`           | Transactional per-UID mutation rate bucket                                                   |
| `adedonha_friend_counters/{uid}`   | Backend badge counter                                                                        |
| `adedonha_purchases/{hash}`        | Permanent unique store purchase → UID binding                                                |
| `adedonha_private_licenses/{uid}`  | Backend-only native proof for cross-platform refresh                                         |
| `adedonha_reward_events/{hash}`    | Backend-only consumed reward event                                                           |

Reads use the same Firebase user token and project. All game/profile/friend/ticket/premium writes must go through REST. Listen to the room only **after joining**; stranger reads are denied. Firestore changes are events: room `version` increases for presence, state, answers freezing, votes, approvals and results. Deduplicate by version, and match `game_id/round_id` before applying UI changes. A draft write also increments room version, without exposing its content. The final review appears atomically in the room.

For reconnection: refresh auth → `/join` with a fresh key → `/game` → replace local state → attach listener → resume increasing answer sequence from the own player doc if still playing. Do not overwrite server answers with an old local draft. Cancel old subscriptions on logout/room change. Ignore older snapshots and use `/game` on listener errors or recovery. Poll `/game` during timer/STOP grace, because Firestore listeners alone do not advance timed state. No parallel WebSocket server is used.

Firebase rules/index candidates are in `firebase/`. They were prepared after inspecting the Godot rules, preserve native auth exchange, feedback and invites, and **have not been applied**. Existing permissive room or sandbox write clauses must be removed during coordinated migration; adding a restrictive overlapping rule cannot override an existing allow. Rules/emulator/live Firebase integration validation remains required before production.

## Errors, limits and operational behavior

| HTTP | Codes / frontend action                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `INVALID_PAYLOAD`, `UNKNOWN_FIELD`, `INVALID_TEXT`, `INVALID_LOCALE`, `INVALID_CATEGORIES`, `DUPLICATE_CATEGORY`, `INVALID_LETTERS`, `INVALID_SETTINGS`, `INVALID_ROOM_CODE`, `INVALID_FRIEND_CODE`, `INVALID_REQUEST_ID`, `INVALID_USER`, `INVALID_LIMIT`, `INVALID_CURSOR`, `INVALID_CATEGORY`, `INVALID_ITEM`, `INVALID_ANSWERS`, `INVALID_PLATFORM`, `IDEMPOTENCY_KEY_REQUIRED`, `SELF_FRIENDSHIP`; correct input                                  |
| 401  | `AUTH_REQUIRED`, `INVALID_TOKEN`; refresh/login                                                                                                                                                                                                                                                                                                                                                                                                        |
| 402  | `TICKET_REQUIRED`; obtain a ticket (future configured provider)                                                                                                                                                                                                                                                                                                                                                                                        |
| 403  | `GOOGLE_LOGIN_REQUIRED`, `NOT_ROOM_MEMBER`, `NOT_PARTICIPANT`, `HOST_REQUIRED`, `REQUEST_RECIPIENT_REQUIRED`, `ORIGIN_NOT_ALLOWED`, `INVALID_PURCHASE`, `PURCHASE_ACCOUNT_MISMATCH`, `INVALID_REWARD`; show permission/verification failure                                                                                                                                                                                                            |
| 404  | `NOT_FOUND`, `ROOM_NOT_FOUND`, `REQUEST_NOT_FOUND`, `FRIEND_CODE_NOT_FOUND`, `TICKET_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                        |
| 409  | `STALE_VERSION`, `STALE_ROUND`, `STALE_ANSWERS`, `STALE_ROOM`, `IDEMPOTENCY_CONFLICT`; refresh state/reconcile                                                                                                                                                                                                                                                                                                                                         |
| 409  | `INVALID_STATE`, `ROOM_MIGRATION_REQUIRED`, `ROOM_FULL`, `PROFILE_REQUIRED`, `NO_PLAYERS`, `LETTER_NOT_CONFIRMED`, `LETTER_MISMATCH`, `ANSWERS_FINAL`, `ANSWERS_FROZEN`, `INVALID_VOTE`, `ITEM_LOCKED`, `ITEM_NOT_APPROVED`, `REVIEW_PENDING`, `HOST_VOTE_MISSING`, `ALREADY_FRIENDS`, `REQUEST_PENDING`, `REQUEST_RESOLVED`, `INVALID_INTENT`, `REWARD_ALREADY_USED`, `PURCHASE_ALREADY_LINKED`, `PURCHASE_PENDING`; explain state or required action |
| 413  | `PAYLOAD_TOO_LARGE`; reduce JSON body                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 429  | `RATE_LIMITED`; respect Retry-After where present                                                                                                                                                                                                                                                                                                                                                                                                      |
| 500  | `INTERNAL_ERROR`; sanitized, retry original idempotency key for uncertain writes                                                                                                                                                                                                                                                                                                                                                                       |
| 503  | `BACKEND_UNAVAILABLE`, `FIREBASE_PROJECT_MISMATCH`, `STORE_UNAVAILABLE`, `ADS_UNAVAILABLE`, `CODE_ALLOCATION_FAILED`; integration unavailable, retry with backoff or show free alternative                                                                                                                                                                                                                                                             |

Public/read traffic: 300 requests/IP/minute per process, bounded in-memory buckets. Mutations additionally enforce 120 accepted operations/UID/minute transactionally in Firestore across dynos. On Heroku the IP limiter uses the socket peer (proxy) conservatively; the app does not blindly trust `X-Forwarded-For`. Configure a trusted ingress/rate limiter for high-volume production traffic rather than accepting arbitrary proxy headers. CORS allowlist is `ADEDONHA_CORS_ORIGINS`; native requests without Origin still authenticate normally. Existing API CORS remains unchanged.

Transactions serialize contested seats, friendships/counters, ticket/event consumption, purchase ownership and score consolidation. Network failures return sanitized errors; no successful transaction is inferred from a client claim. No external integration was tested live in this workspace. Automated tests exercise real service/HTTP code with an explicit in-memory transactional test repository, mock identity and mock store/reward adapters, plus official Godot rule fixtures.

## Official implementation references

- [Firebase Admin setup and independent apps](https://firebase.google.com/docs/admin/setup)
- [Firebase ID-token validation](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore listeners](https://firebase.google.com/docs/firestore/query-data/listen)
- [Firestore security rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Google Play product verification](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products)
- [Apple App Store Server library](https://github.com/apple/app-store-server-library-node)
