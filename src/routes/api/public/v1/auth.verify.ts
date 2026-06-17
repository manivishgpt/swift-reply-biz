import { createFileRoute } from "@tanstack/react-router";

// Lightweight "login" check — clients POST with Authorization: Bearer wapix_…
// and get back the account info if the key is valid. Useful to validate stored
// keys from a mobile app / external integration.
export const Route = createFileRoute("/api/public/v1/auth/verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") ?? "";
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (!match) {
          return new Response(
            JSON.stringify({ ok: false, error: "missing_token" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        const plaintext = match[1].trim();
        const { createHash } = await import("crypto");
        const keyHash = createHash("sha256").update(plaintext).digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("api_keys")
          .select("id, label, account_id, revoked_at, key_prefix, wa_accounts(label, phone, status)")
          .eq("key_hash", keyHash)
          .maybeSingle();

        if (!data || data.revoked_at) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid_or_revoked" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }

        return Response.json({
          ok: true,
          key: { id: data.id, label: data.label, prefix: data.key_prefix },
          account: {
            id: data.account_id,
            ...(data.wa_accounts as object | null),
          },
        });
      },
    },
  },
});