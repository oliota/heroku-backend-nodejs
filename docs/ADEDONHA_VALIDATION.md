# Local validation

Validation uses Node.js v24.19.0. No production deploy or external Firebase/store/ad validation was performed.

- `npm install`: completed; lockfile updated.
- `npm test`: **32 tests passed, 0 failed, 0 skipped** in the final run. Includes automatic cross-platform license refresh, refund persistence, purchase idempotency and fail-closed store outages.
- `npm run format`: completed with Prettier.
- `npm run lint` and `npm run build`: JavaScript syntax checks completed; this project needs no compilation.
- `npm start`: actual process started on port 3002 using the existing Express server.
- HTTP smoke checks: GET `/api/v1/adedonha/health`, `/rules`, `/categories?locale=pt`, `/letters?locale=pt` all returned 200. Health correctly reported Firebase unavailable and `database_checked:false`.
- Existing expenses: HTTP CRUD tested. Existing schedule/GitHub: validation routes checked without contacting external services.
- `npm audit`: last report contains 10 transitive advisories (4 high, 6 moderate, 0 critical), concerning the Firebase client gRPC dependency and Firestore API glob/rimraf chains. Compatible audit fixes were applied; Firebase was upgraded with compat entrypoints preserving old controller APIs. Further changes require targeted compatibility testing; no forced downgrade was applied.

Service/HTTP tests use explicit test-only transaction, identity, store and reward mocks. Official Godot normalization/scoring fixtures are executed. Real Firebase Auth/Firestore transactions/listeners, deployed rules/indexes, store purchases/refunds and rewarded ads have **not** been tested. Candidate security rules still require emulator validation and coordinated native migration.
