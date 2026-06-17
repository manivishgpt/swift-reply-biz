import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticatePublicApi, jsonError } from "@/lib/public-api-auth.server";

const CreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  key_label: z.string().trim().min(1).max(80).optional(),
});

// POST /api/public/v1/accounts
// Creates a new WhatsApp account under the user that owns the calling API key,
// and issues a fresh account-scoped API key for it. The plaintext key is
// returned ONCE in the response.
export const Route = createFileRoute("/api/public/v1/accounts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const a = await authenticatePublicApi(request);
        if (!a.ok) return a.response;

        let payload;
        try {
          payload = CreateSchema.parse(await request.json());
        } catch (e) {
          return jsonError(400, "bad_request", e instanceof Error ? e.message : "Invalid body");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: acct, error: acctErr } = await supabaseAdmin
          .from("wa_accounts")
          .insert({ label: payload.label, created_by: a.auth.userId })
          .select("id, label, status")
          .single();
        if (acctErr) return jsonError(500, "db_error", acctErr.message);

        // Issue a new account-scoped API key so the caller can use this account
        // immediately via /messages, /connect, /status, /disconnect.
        const { randomBytes, createHash } = await import("crypto");
        const raw = randomBytes(24).toString("hex");
        const plaintext = `wapix_${raw}`;
        const prefix = plaintext.slice(0, 12);
        const keyHash = createHash("sha256").update(plaintext).digest("hex");

        const { error: keyErr } = await supabaseAdmin.from("api_keys").insert({
          user_id: a.auth.userId,
          account_id: acct.id,
          label: payload.key_label ?? `${payload.label} default`,
          key_prefix: prefix,
          key_hash: keyHash,
        });
        if (keyErr) return jsonError(500, "db_error", keyErr.message);

        return Response.json({
          ok: true,
          account: { id: acct.id, label: acct.label, status: acct.status },
          api_key: { key: plaintext, prefix },
          next: {
            connect: `/api/public/v1/accounts/${acct.id}/connect`,
            status: `/api/public/v1/accounts/${acct.id}/status`,
            send: `/api/public/v1/messages`,
          },
        });
      },
    },
  },
});