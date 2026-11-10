export class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function assert(condition, status, code, message) {
  if (!condition) throw new ApiError(status, code, message);
}
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const external = [
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "ECONNRESET",
    "ENOTFOUND",
    4,
    14,
  ].includes(err.code);
  const status = err.status || (external ? 503 : 500);
  res.status(status).json({
    error: {
      code:
        err.code && err instanceof ApiError
          ? err.code
          : external
            ? "BACKEND_UNAVAILABLE"
            : status === 400
              ? "INVALID_PAYLOAD"
              : status === 413
                ? "PAYLOAD_TOO_LARGE"
                : "INTERNAL_ERROR",
      message:
        err instanceof ApiError
          ? err.message
          : status === 400
            ? "Invalid JSON payload"
            : status === 413
              ? "Payload exceeds 32 KiB"
              : "Service temporarily unavailable",
    },
  });
}
