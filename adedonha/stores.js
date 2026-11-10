import { createHash, sign } from "node:crypto";
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
import { assert, ApiError } from "./errors.js";

export function billingIdentity(uid) {
  const digest = createHash("sha256").update(`adedonha:${uid}`).digest("hex");
  return {
    google_account_id: digest,
    apple_account_token: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
  };
}
const env = (name) => process.env[`ADEDONHA_${name}`];
async function request(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new ApiError(503, "STORE_UNAVAILABLE");
  }
}
async function googleAccessToken() {
  const email = env("PLAY_CLIENT_EMAIL");
  const key = env("PLAY_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  assert(
    email && key,
    503,
    "STORE_UNAVAILABLE",
    "Google Play verification is not configured",
  );
  const issued = Math.floor(Date.now() / 1000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600 })}`;
  let assertion;
  try {
    assertion = `${payload}.${sign("RSA-SHA256", Buffer.from(payload), key).toString("base64url")}`;
  } catch {
    throw new ApiError(503, "STORE_UNAVAILABLE");
  }
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  assert(response.ok, 503, "STORE_UNAVAILABLE");
  const result = await response.json();
  assert(result.access_token, 503, "STORE_UNAVAILABLE");
  return result.access_token;
}
export const purchases = {
  async verify(input, uid) {
    if (input.platform === "android") {
      const packageName = env("PLAY_PACKAGE_NAME");
      const product = env("PLAY_PRODUCT_ID");
      assert(packageName && product, 503, "STORE_UNAVAILABLE");
      const token = await googleAccessToken();
      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(product)}/tokens/${encodeURIComponent(input.purchase_token)}`;
      const response = await request(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert(
        response.status !== 404 && response.status !== 410,
        403,
        "INVALID_PURCHASE",
      );
      assert(response.ok, 503, "STORE_UNAVAILABLE");
      const receipt = await response.json();
      assert(
        receipt.obfuscatedExternalAccountId ===
          billingIdentity(uid).google_account_id,
        403,
        "PURCHASE_ACCOUNT_MISMATCH",
      );
      assert([0, 1].includes(receipt.purchaseState), 409, "PURCHASE_PENDING");
      assert(
        receipt.consumptionState === 0 && receipt.purchaseType === undefined,
        403,
        "INVALID_PURCHASE",
        "Only production permanent purchases are accepted",
      );
      if (receipt.purchaseState === 0 && receipt.acknowledgementState === 0) {
        const acknowledged = await request(`${url}:acknowledge`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        assert(acknowledged.ok, 503, "STORE_UNAVAILABLE");
      }
      return {
        uid,
        verified: true,
        purchase_id: createHash("sha256")
          .update(input.purchase_token)
          .digest("hex"),
        product: "golden_wheel",
        revoked:
          receipt.purchaseState === 1 || receipt.refundableQuantity === 0,
      };
    }
    const privateKey = env("APPLE_PRIVATE_KEY")?.replace(/\\n/g, "\n");
    const keyId = env("APPLE_KEY_ID");
    const issuerId = env("APPLE_ISSUER_ID");
    const bundle = env("APPLE_BUNDLE_ID");
    const product = env("APPLE_PRODUCT_ID");
    const appId = Number(env("APPLE_APP_ID"));
    const roots = env("APPLE_ROOT_CERTIFICATES_BASE64");
    assert(
      privateKey && keyId && issuerId && bundle && product && appId && roots,
      503,
      "STORE_UNAVAILABLE",
      "App Store verification is not configured",
    );
    try {
      const client = new AppStoreServerAPIClient(
        privateKey,
        keyId,
        issuerId,
        bundle,
        Environment.PRODUCTION,
      );
      const verifier = new SignedDataVerifier(
        roots.split(",").map((r) => Buffer.from(r.trim(), "base64")),
        true,
        Environment.PRODUCTION,
        bundle,
        appId,
      );
      const result = await client.getTransactionInfo(input.transaction_id);
      assert(result.signedTransactionInfo, 403, "INVALID_PURCHASE");
      const receipt = await verifier.verifyAndDecodeTransaction(
        result.signedTransactionInfo,
      );
      assert(
        receipt.productId === product &&
          receipt.type === "Non-Consumable" &&
          receipt.bundleId === bundle,
        403,
        "INVALID_PURCHASE",
      );
      assert(
        receipt.appAccountToken?.toLowerCase() ===
          billingIdentity(uid).apple_account_token,
        403,
        "PURCHASE_ACCOUNT_MISMATCH",
      );
      assert(receipt.originalTransactionId, 403, "INVALID_PURCHASE");
      return {
        uid,
        verified: true,
        purchase_id: receipt.originalTransactionId,
        product: "golden_wheel",
        revoked: !!receipt.revocationDate,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        error.httpStatusCode === 404 ||
        error.name === "VerificationException"
      )
        throw new ApiError(403, "INVALID_PURCHASE");
      throw new ApiError(503, "STORE_UNAVAILABLE");
    }
  },
};
