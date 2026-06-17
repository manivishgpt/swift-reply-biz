// Server-only HTTP client for talking to the self-hosted Baileys bridge.
import { createHmac, timingSafeEqual } from "crypto";

const BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL;
const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET;

function requireBridge() {
  if (!BRIDGE_BASE_URL || !BRIDGE_SHARED_SECRET) {
    throw new Error(
      "Bridge is not configured. Set BRIDGE_BASE_URL and BRIDGE_SHARED_SECRET in project secrets, and deploy your Baileys bridge.",
    );
  }
  return { url: BRIDGE_BASE_URL.replace(/\/$/, ""), secret: BRIDGE_SHARED_SECRET };
}

function signBody(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function call<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { url, secret } = requireBridge();
  const body = init.json !== undefined ? JSON.stringify(init.json) : (init.body as string | undefined);
  const request = async (signatureBody: string) => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set("Content-Type", "application/json");
    headers.set("X-Wapix-Signature", signBody(secret, signatureBody));
    const res = await fetch(`${url}${path}`, { ...init, body, headers });
    return { res, text: await res.text() };
  };

  let { res, text } = await request(body ?? "");

  // Older bridge deployments signed empty GET/DELETE requests as "{}" because
  // Express populated req.body with an empty object. Retry once for compatibility.
  if (!res.ok && res.status === 401 && body === undefined && text.includes("Invalid signature")) {
    ({ res, text } = await request("{}"));
  }

  if (!res.ok) throw new Error(`Bridge ${path} failed: ${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const bridge = {
  startSession: (accountId: string, opts: { reset?: boolean } = {}) =>
    call(`/sessions`, { method: "POST", json: { accountId, reset: opts.reset ?? false } }),
  getQr: (accountId: string) =>
    call<{ qr: string | null; status: string }>(`/sessions/${accountId}/qr`),
  status: (accountId: string) =>
    call<{ status: string; phone?: string }>(`/sessions/${accountId}/status`),
  logout: (accountId: string) => call(`/sessions/${accountId}`, { method: "DELETE" }),
  send: (accountId: string, payload: { to: string; type: "text" | "image"; body?: string; mediaUrl?: string }) =>
    call<{ wa_message_id: string }>(`/sessions/${accountId}/send`, { method: "POST", json: payload }),
};

export function verifyWebhookSignature(body: string, signature: string | null): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}