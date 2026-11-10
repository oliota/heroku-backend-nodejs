# Heroku Backend Node.js

One Node.js/Express application serves expenses, the existing Firebase-backed schedule, GitHub statistics SVGs and the Adedonha / STOP multiplayer API. All services retain the `/api/v1` prefix, dynamic port and Heroku Procfile.

## Setup

Use Node.js 24 LTS and npm. In this repository:

```sh
npm install
# Copy .env.example to .env and fill the integrations you use.
npm test
npm start
```

Local server: [http://localhost:3002](http://localhost:3002). `process.env.PORT` overrides 3002, including on Heroku. Use `npm run dev` for reload. No absolute developer paths or credential files are required by production code.

The server starts without Adedonha credentials. Public endpoints remain available:

- [Health](http://localhost:3002/api/v1/adedonha/health)
- [Rules](http://localhost:3002/api/v1/adedonha/rules)
- [Portuguese categories](http://localhost:3002/api/v1/adedonha/categories?locale=pt)
- [Portuguese letters](http://localhost:3002/api/v1/adedonha/letters?locale=pt)

Health reports configuration presence, not a successful live Firebase check. Protected calls require a Google Firebase ID token; unconfigured Firebase/store integrations return explicit 503 errors. No ad provider is enabled: actual server-issued free tickets support multiplayer.

## Configuration

See [.env.example](.env.example) for every variable. Keep secrets in .env or Heroku config vars, never in Git.

| Variables | Purpose |
| --- | --- |
| `PORT` | Dynamic HTTP port, default 3002 |
| `GITHUB_TOKEN` | Existing GitHub GraphQL summary |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, `FIREBASE_MEASUREMENT_ID` | Existing schedule Firebase client; retains oliota defaults |
| `ADEDONHA_FIREBASE_PROJECT_ID` | Must be adedonha-stop |
| `ADEDONHA_FIREBASE_CLIENT_EMAIL`, `ADEDONHA_FIREBASE_PRIVATE_KEY` | Independent named Admin app with Adedonha service account |
| `ADEDONHA_CORS_ORIGINS` | Exact comma-separated origins; defaults to https://oliota.com,http://localhost:3000,http://localhost:3002 |
| `ADEDONHA_PLAY_CLIENT_EMAIL`, `ADEDONHA_PLAY_PRIVATE_KEY`, `ADEDONHA_PLAY_PACKAGE_NAME`, `ADEDONHA_PLAY_PRODUCT_ID` | Production Google Play Developer API |
| `ADEDONHA_APPLE_PRIVATE_KEY`, `ADEDONHA_APPLE_KEY_ID`, `ADEDONHA_APPLE_ISSUER_ID`, `ADEDONHA_APPLE_BUNDLE_ID`, `ADEDONHA_APPLE_APP_ID`, `ADEDONHA_APPLE_PRODUCT_ID`, `ADEDONHA_APPLE_ROOT_CERTIFICATES_BASE64` | Production App Store API and Apple root signature verification |

PEM keys accept literal `\n` line separators. Apple roots are comma-separated base64 DER certificates obtained from Apple. Firebase Web API keys are public identifiers, not Admin credentials. The existing Firebase client uses its supported compat entrypoints to preserve the schedule controller API while allowing security updates; it stays separate from `adedonha-stop-admin`. Do not repoint the old FIREBASE_* variables to Adedonha.

## APIs

| Service | Routes |
| --- | --- |
| Expenses (in memory) | GET/POST/DELETE /api/v1/expenses; GET/PUT/DELETE /api/v1/expenses/:id |
| Existing Firebase schedule | /api/v1/schedule, day, codes, months, versions, version migration, imports, UI settings and bootstrap; exact methods in routes/scheduleRoutes.js |
| GitHub summary | GET /api/v1/summary-svg?user=oliota |
| Adedonha / STOP | 49 endpoints: 6 public and 43 authenticated profile, room, round, review, friend, ticket and premium routes |

The complete frontend contract, every endpoint/body/response, errors, examples, real-time structure and migration prerequisites are in [docs/ADEDONHA_FRONTEND_INTEGRATION.md](docs/ADEDONHA_FRONTEND_INTEGRATION.md).

The shared rules JSON was copied from the inspected Godot project: exact lists for ten locales, 3–12 categories, ten players, 5-character room and 6-character friend codes, 40-character answers and 10/5/0 scoring. Confirmed letters and IDs are server-owned. STOP has eight-second final-submit grace; latest drafts survive synchronization delay. Scores consolidate atomically only after unanimous word approval and collective confirmation. Leader force preserves approvals and uses explicit leader votes for pending items.

## Security and Firebase migration

Adedonha verifies Firebase ID tokens with revocation checks and requires Google identity. It uses room/host authorization, allowlisted payloads, transactions, persistent idempotency, version/round checks, per-UID mutation limits, per-process IP limits and scoped configurable CORS. Old routes retain their CORS behavior. Drafts are private until review; errors omit internal details. Client premium/ad assertions never grant entitlements.

The inspected Godot client currently writes directly to Firestore and permits sandbox licenses. It must migrate mutations to this API before securely sharing API-created rooms. Legacy rooms return ROOM_MIGRATION_REQUIRED. [Candidate Firebase rules/indexes](firebase/README.md) preserve native login exchange, feedback and invites. They have not been deployed. Validate with the emulator and coordinate native migration before publishing them. No Godot or frontend files were changed.

Permanent Golden Wheel purchases use production Google Play/App Store verification, store account binding, unique purchase ownership, restore and revocation checks. Private proofs enable cross-platform refresh by the same UID. Licenses refresh on access after an hour; no store webhook is implemented. Activated room benefits persist until that room finishes/closes. No rewarded-ad adapter is enabled; multiplayer uses the free alternative.

## Tests and Command Hub

```sh
npm test
npm run test:adedonha
npm run test:integration
npm run lint
npm run build
```

Tests use Node's test runner, official Godot normalization/scoring fixtures, a test-only serializable repository and explicit identity/store/reward mocks. HTTP tests start actual Express listeners and check startup, public/auth contracts and existing route validation. They cover concurrency, player limits, reconnects, stale/late answers, review unanimity/epochs/leader force, collective scoring, friends/counters, tickets, premium/ownership/revocation and network errors.

These tests do not claim live Firebase, actual Google login, ad delivery, store billing, deployed rules, legacy schedule database access or GitHub access were verified. Those require real external configuration. Run genuine Firebase multi-client transactions/listeners and emulator security-rule tests before release.

| Command | Behavior |
| --- | --- |
| npm install / npm run install:deps | Install dependencies; nonrecursive install lifecycle |
| npm start / npm run run | Run the same application |
| npm run dev | Nodemon reload |
| npm test | All tests |
| npm run test:adedonha | Domain/rules tests |
| npm run test:integration | Localhost HTTP tests |
| npm run build / npm run lint | Syntax-check all JavaScript; no compilation required |
| npm run format | Prettier for the new module/tests/scripts/contract/shared JSON |
| npm run debug | Node inspector |
| npm run help / npm run list | Command listing |
| npm run status | Runtime/configuration presence without secrets |
| npm run logs | Heroku log tail, requires CLI/login |

Existing `----`, `-----`, `------` script separators and Heroku helpers remain. Keep the lockfile committed; review npm audit after dependency updates. The last audit still reports 10 transitive advisories (4 high, 6 moderate); see [local validation results](docs/ADEDONHA_VALIDATION.md) for the tested scope and pending checks.

## Heroku and URLs

Procfile remains `web: node index.js`. Set the old and new service variables separately. Heroku supplies PORT; Node major is pinned to 24. Review current stack support before release. Historical helper `heroku:init` still specifies heroku-22; review that stack before provisioning.

Manual deployment helpers remain `npm run heroku:init`, `npm run heroku:push`, `npm run heroku:open`. No application, rules or indexes were deployed by this change.

- [Existing backend](https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com)
- [Existing production GitHub SVG](https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com/api/v1/summary-svg?user=oliota)
- [Adedonha health after manual deployment](https://heroku-backend-nodejs-fd16668acdd6.herokuapp.com/api/v1/adedonha/health)
- Planned frontend: [oliota.com/adedonha](https://oliota.com/adedonha), [oliota.com/stop](https://oliota.com/stop)

Before production: configure Firebase; migrate native mutations; validate and deploy rules/indexes; configure real store products, credentials and native billing plugins; run real multi-client/store/refund tests. Choose a verified policy-eligible ad provider only if desired; free access works while ads are unavailable. Production ingress should handle volume-aware distributed IP limits; this application does not trust arbitrary forwarding headers.

Official references: [Node.js](https://nodejs.org/en/docs), [Express](https://expressjs.com), [Firebase Admin](https://firebase.google.com/docs/admin/setup), [ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Google Play verification](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products), [Apple server library](https://github.com/apple/app-store-server-library-node), [Heroku Node support](https://devcenter.heroku.com/articles/nodejs-support).
