// Server-only HTTP client for talking to the self-hosted Baileys bridge.
import { createHmac, timingSafeEqual } from "crypto";
import { getConfig } from "./runtime-config.server";

async function requireBridge() {
  const baseUrl = await getConfig("BRIDGE_BASE_URL");
  const secret = await getConfig("BRIDGE_SHARED_SECRET");
  if (!baseUrl || !secret) {
    throw new Error(
      "Bridge is not configured. Set BRIDGE_BASE_URL and BRIDGE_SHARED_SECRET in your environment / project secrets and deploy your Baileys bridge.",
    );
  }
  return { url: baseUrl.replace(/\/$/, ""), secret };
}

function signBody(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function call<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { url, secret } = await requireBridge();
  const body = init.json !== undefined ? JSON.stringify(init.json) : (init.body as string | undefined);
  const request = async (signatureBody: string) => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set("Content-Type", "application/json");
    headers.set("X-Wapix-Signature", signBody(secret, signatureBody));
    console.log("[bridge] -> request", {
      method: init.method ?? "GET",
      url: `${url}${path}`,
      bodyPreview: body ? body.slice(0, 500) : null,
      signatureHeader: headers.get("X-Wapix-Signature")?.slice(0, 12) + "…",
      signedBodyLen: signatureBody.length,
    });
    const res = await fetch(`${url}${path}`, { ...init, body, headers });
    const text = await res.text();
    console.log("[bridge] <- response", {
      url: `${url}${path}`,
      status: res.status,
      ok: res.ok,
      bodyPreview: text.slice(0, 500),
    });
    return { res, text };
  };

  let { res, text } = await request(body ?? "");

  // Older bridge deployments signed empty GET/DELETE requests as "{}" because
  // Express populated req.body with an empty object. Retry once for compatibility.
  if (!res.ok && res.status === 401 && body === undefined && text.includes("Invalid signature")) {
    console.log("[bridge] retrying with '{}' signature body for legacy compat");
    ({ res, text } = await request("{}"));
  }

  if (!res.ok) {
    console.error("[bridge] !! call failed", { path, status: res.status, text });
    throw new Error(`Bridge ${path} failed: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const bridge = {
  startSession: (accountId: string, opts: { reset?: boolean } = {}) =>
    call(`/sessions`, { method: "POST", json: { accountId, reset: opts.reset ?? false } }),
  getQr: (accountId: string) =>
    call<{ qr: string | null; status: string }>(`/sessions/${accountId}/qr`),
  status: (accountId: string) =>
    call<{ status: string; phone?: string }>(`/sessions/${accountId}/status`),
  logout: (accountId: string) => {
    // Log a stack trace so we can identify every caller of DELETE in production.
    console.warn(
      `[bridge] !! DELETE /sessions/${accountId} invoked — this will log the WhatsApp session out and wipe credentials. Caller stack:\n` +
        new Error("bridge.logout caller trace").stack,
    );
    return call(`/sessions/${accountId}`, { method: "DELETE" });
  },
  send: (accountId: string, payload: { to: string; type: "text" | "image"; body?: string; mediaUrl?: string }) =>
    call<{ wa_message_id: string }>(`/sessions/${accountId}/send`, { method: "POST", json: payload }),
};

export async function verifyWebhookSignature(body: string, signature: string | null): Promise<boolean> {
  const secret = await getConfig("WEBHOOK_SECRET");
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}