import express from "express";
import { firebase, firebaseStatus, FirestoreRepository } from "./firebase.js";
import { AdedonhaService } from "./service.js";
import { purchases } from "./stores.js";
import { rules, locale, locales } from "./rules.js";
import { cors, authenticate, rateLimit } from "./middleware.js";
import { controller } from "./controller.js";
import { errorHandler, ApiError } from "./errors.js";

export const endpoints = [
  ["get", "/me", "get:me"],
  ["post", "/me/sync", "me:sync"],
  ["get", "/me/stats", "get:stats"],
  ["get", "/me/history", "get:history"],
  ["get", "/me/entitlements", "get:entitlements"],
  ["post", "/rooms", "rooms:create"],
  ["get", "/rooms/:code", "get:room"],
  ["post", "/rooms/:code/join", "rooms:join"],
  ["post", "/rooms/:code/leave", "rooms:leave"],
  ["post", "/rooms/:code/start", "rooms:start"],
  ["patch", "/rooms/:code/settings", "rooms:settings"],
  ["post", "/rooms/:code/close", "rooms:close"],
  ["get", "/rooms/:code/players", "get:players"],
  ["post", "/rooms/:code/heartbeat", "rooms:heartbeat"],
  ["get", "/rooms/:code/game", "get:game"],
  ["post", "/rooms/:code/rounds", "rooms:rounds"],
  ["post", "/rooms/:code/spinner", "rooms:delegate"],
  ["post", "/rooms/:code/letters/select", "rooms:select"],
  ["post", "/rooms/:code/letters/confirm", "rooms:confirm"],
  ["put", "/rooms/:code/answers", "rooms:answers"],
  ["get", "/rooms/:code/answers/me", "get:answers"],
  ["post", "/rooms/:code/stop", "rooms:stop"],
  ["get", "/rooms/:code/results", "get:results"],
  ["get", "/rooms/:code/review", "get:review"],
  ["get", "/rooms/:code/review/:category", "get:review"],
  ["put", "/rooms/:code/review/votes", "review:votes"],
  ["post", "/rooms/:code/review/complete", "review:complete"],
  ["post", "/rooms/:code/review/reopen", "review:reopen"],
  ["post", "/rooms/:code/review/unlock", "review:unlock"],
  ["post", "/rooms/:code/review/force", "review:force"],
  ["post", "/rooms/:code/review/next", "review:next"],
  ["get", "/friends", "get:friends"],
  ["get", "/friends/requests", "get:friends:requests"],
  ["get", "/friends/requests/count", "get:friends:count"],
  ["post", "/friends/requests", "friends:request"],
  ["post", "/friends/requests/:id/accept", "friends:accept"],
  ["post", "/friends/requests/:id/reject", "friends:reject"],
  ["delete", "/friends/:id", "friends:delete"],
  ["get", "/tickets/status", "get:tickets:status"],
  ["post", "/tickets/intent", "tickets:intent"],
  ["post", "/tickets/redeem", "tickets:redeem"],
  ["get", "/tickets/:id", "get:tickets:id"],
  ["get", "/premium/status", "get:premium"],
  ["post", "/premium/verify", "premium:verify"],
  ["post", "/premium/restore", "premium:restore"],
];
let service;
const defaultService = () =>
  (service ||= new AdedonhaService(new FirestoreRepository(firebase().db), {
    purchases,
  }));
export function createAdedonhaRouter({
  getService = defaultService,
  getAuth = () => firebase().auth,
  health = firebaseStatus,
  limiter = rateLimit(),
} = {}) {
  const router = express.Router();
  router.use(cors, limiter, express.json({ limit: "32kb" }));
  router.get("/health", (req, res) =>
    res.json({
      data: {
        status: "ok",
        firebase: health(),
        database_checked: false,
        api_version: 1,
      },
    }),
  );
  router.get("/config", (req, res) =>
    res.json({
      data: {
        api_version: 1,
        protocol_schema: 2,
        api_authority: 1,
        firebase_project_id: "adedonha-stop",
        realtime: "firestore",
        rules_url: "/api/v1/adedonha/rules",
        states: rules.online.statuses,
        max_players: 10,
        submit_grace_ms: rules.online.submit_grace_ms,
        free_tickets: true,
        ads_available: false,
        premium_product: "golden_wheel",
        purchase_platforms: ["android", "ios"],
        routes: ["/adedonha", "/stop"],
      },
    }),
  );
  router.get("/rules", (req, res) => res.json({ data: rules }));
  router.get("/locales", (req, res) => res.json({ data: { locales } }));
  for (const type of ["categories", "letters"])
    router.get(`/${type}`, (req, res, next) => {
      try {
        const lang = locale(req.query.locale);
        const r = rules.languages[lang];
        res.json({
          data:
            type === "categories"
              ? {
                  locale: lang,
                  categories: r.default_categories,
                  suggested_categories: r.suggested_categories,
                  ...rules.categories,
                }
              : {
                  locale: lang,
                  letters: r.letters,
                  alphabet: r.alphabet,
                  checks_initial: r.checks_initial,
                },
        });
      } catch (error) {
        next(error);
      }
    });
  router.use(authenticate(getAuth));
  for (const [method, path, action] of endpoints)
    router[method](path, controller(action, getService));
  router.use((req, res, next) => next(new ApiError(404, "NOT_FOUND")));
  router.use(errorHandler);
  return router;
}
