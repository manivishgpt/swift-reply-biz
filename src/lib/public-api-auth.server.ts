// Shared helper for authenticating /api/public/v1/* requests using a
// "wapix_..." API key. Returns the owning user_id and (if present) the
// account_id the key is bound to.

export type PublicApiAuth = {
  userId: string;
  apiKeyId: string;
  accountId: string | null;
};

export function jsonError(status: number, code: string, message: string) {
  // Lazy import to avoid bundling concerns; CORS_HEADERS is a plain object.
  const { CORS_HEADERS } = require("./public-api-cors") as typeof import("./public-api-cors");
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function authenticatePublicApi(
  request: Request,
): Promise<{ ok: true; auth: PublicApiAuth } | { ok: false; response: Response }> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, response: jsonError(401, "missing_token", "Authorization: Bearer <key> required") };
  }
  const plaintext = match[1].trim();
  if (!plaintext.startsWith("wapix_")) {
    return { ok: false, response: jsonError(401, "invalid_token", "Invalid API key format") };
  }

  const { createHash } = await import("crypto");
  const keyHash = createHash("sha256").update(plaintext).digest("hex");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, account_id, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) return { ok: false, response: jsonError(500, "auth_error", error.message) };
  if (!data) return { ok: false, response: jsonError(401, "invalid_token", "API key not recognized") };
  if (data.revoked_at) return { ok: false, response: jsonError(401, "revoked", "API key has been revoked") };

  // Fire-and-forget last_used_at update.
  void supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    ok: true,
    auth: { userId: data.user_id, apiKeyId: data.id, accountId: data.account_id ?? null },
  };
}

// Verify that the account belongs to the authenticated user.
export async function assertAccountOwnership(userId: string, accountId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("wa_accounts")
    .select("id, created_by, status, label, phone")
    .eq("id", accountId)
    .maybeSingle();
  if (error) return { ok: false as const, response: jsonError(500, "db_error", error.message) };
  if (!data) return { ok: false as const, response: jsonError(404, "not_found", "Account not found") };
  if (data.created_by !== userId) {
    return { ok: false as const, response: jsonError(403, "forbidden", "API key does not own this account") };
  }
  return { ok: true as const, account: data };
}