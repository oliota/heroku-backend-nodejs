import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ApiError } from "./errors.js";

let cached;
export function firebase() {
  if (cached) return cached;
  const projectId = process.env.ADEDONHA_FIREBASE_PROJECT_ID || "adedonha-stop";
  if (projectId !== "adedonha-stop")
    throw new ApiError(503, "FIREBASE_PROJECT_MISMATCH");
  const clientEmail = process.env.ADEDONHA_FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.ADEDONHA_FIREBASE_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );
  if (!clientEmail || !privateKey)
    throw new ApiError(
      503,
      "BACKEND_UNAVAILABLE",
      "Adedonha Firebase credentials are not configured",
    );
  try {
    const app =
      getApps().find((a) => a.name === "adedonha-stop-admin") ||
      initializeApp(
        { projectId, credential: cert({ projectId, clientEmail, privateKey }) },
        "adedonha-stop-admin",
      );
    cached = { auth: getAuth(app), db: getFirestore(app) };
    return cached;
  } catch {
    throw new ApiError(
      503,
      "BACKEND_UNAVAILABLE",
      "Adedonha Firebase configuration is invalid",
    );
  }
}
export function firebaseStatus() {
  try {
    firebase();
    return "configured";
  } catch {
    return "unavailable";
  }
}

// Queue writes until all reads finish: Firestore requires reads before writes.
export class FirestoreRepository {
  constructor(db) {
    this.db = db;
  }
  async transaction(callback) {
    return this.db.runTransaction(
      async (tx) => {
        const pending = new Map();
        const unit = {
          get: async (path) =>
            pending.has(path)
              ? structuredClone(pending.get(path))
              : ((await tx.get(this.db.doc(path))).data() ?? null),
          set: (path, value) => pending.set(path, structuredClone(value)),
          delete: (path) => pending.set(path, null),
          list: async (path, filters = [], limit = 50, after = "") => {
            let query = this.db.collection(path);
            for (const [field, op, value] of filters)
              query = query.where(field, op, value);
            query = query.orderBy("__name__");
            if (after) query = query.startAfter(after);
            return (await tx.get(query.limit(limit))).docs.map((d) => ({
              ...d.data(),
              id: d.id,
            }));
          },
        };
        const result = await callback(unit);
        for (const [path, value] of pending)
          value === null
            ? tx.delete(this.db.doc(path))
            : tx.set(this.db.doc(path), value);
        return result;
      },
      { maxAttempts: 5 },
    );
  }
}
