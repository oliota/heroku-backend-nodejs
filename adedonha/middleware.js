import { assert, ApiError } from "./errors.js";

export function cors(req, res, next) {
  const allowed = (
    process.env.ADEDONHA_CORS_ORIGINS ||
    "https://oliota.com,http://localhost:3000,http://localhost:3002"
  )
    .split(",")
    .map((s) => s.trim());
  res.removeHeader("Access-Control-Allow-Origin");
  res.vary("Origin");
  if (req.headers.origin) {
    if (!allowed.includes(req.headers.origin))
      return next(new ApiError(403, "ORIGIN_NOT_ALLOWED"));
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type,Idempotency-Key",
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}
export function rateLimit({ max = 300, windowMs = 60000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of buckets)
      if (value.until < now) buckets.delete(key);
    const key = req.ip;
    const value = buckets.get(key) || { count: 0, until: now + windowMs };
    if (buckets.size >= 10000 && !buckets.has(key))
      return next(new ApiError(429, "RATE_LIMITED"));
    value.count++;
    buckets.set(key, value);
    if (value.count > max) {
      res.setHeader("Retry-After", Math.ceil((value.until - now) / 1000));
      return next(new ApiError(429, "RATE_LIMITED"));
    }
    next();
  };
}
export function authenticate(getAuth) {
  return async (req, res, next) => {
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
      assert(match && match[1].length <= 8192, 401, "AUTH_REQUIRED");
      const auth = getAuth();
      let user;
      try {
        user = await auth.verifyIdToken(match[1], true);
      } catch (error) {
        if (
          /^(auth\/(network-request-failed|internal-error|certificate-fetch-failed))$/.test(
            error.code || "",
          ) ||
          [4, 14, "ECONNRESET", "ENOTFOUND"].includes(error.code)
        )
          throw new ApiError(503, "BACKEND_UNAVAILABLE");
        throw new ApiError(401, "INVALID_TOKEN");
      }
      assert(
        user.firebase?.sign_in_provider === "google.com",
        403,
        "GOOGLE_LOGIN_REQUIRED",
      );
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
