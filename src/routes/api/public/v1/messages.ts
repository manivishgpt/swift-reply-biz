import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CORS_HEADERS, corsPreflight, withCors } from "@/lib/public-api-cors";

const SendSchema = z.object({
  to: z.string().trim().min(6).max(20),
  body: z.string().trim().min(1).max(4096),
  type: z.literal("text").optional(),
  // Required when using a master (user-scoped) API key.
  // Ignored when the key is already bound to an account.
  account_id: z.string().uuid().optional(),
});

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function authenticate(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: jsonError(401, "missing_token", "Authorization: Bearer <key> required") };
  const plaintext = match[1].trim();
  if (!plaintext.startsWith("wapix_")) {
    return { error: jsonError(401, "invalid_token", "Invalid API key format") };
  }

  const { createHash } = await import("crypto");
  const keyHash = createHash("sha256").update(plaintext).digest("hex");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, account_id, revoked_at, is_master")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) return { error: jsonError(500, "auth_error", error.message) };
  if (!data) return { error: jsonError(401, "invalid_token", "API key not recognized") };
  if (data.revoked_at) return { error: jsonError(401, "revoked", "API key has been revoked") };

  // Fire-and-forget last_used_at update.
  void supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    accountId: data.account_id as string | null,
    userId: data.user_id as string,
    apiKeyId: data.id,
    isMaster: Boolean(data.is_master),
  };
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, "");
}

export const Route = createFileRoute("/api/public/v1/messages")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        let payload;
        try {
          payload = SendSchema.parse(await request.json());
        } catch (e) {
          return jsonError(400, "bad_request", e instanceof Error ? e.message : "Invalid body");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve which WhatsApp account to send from.
        let accountId = auth.accountId;
        if (!accountId) {
          if (!payload.account_id) {
            return jsonError(
              400,
              "account_required",
              "Master API keys must specify 'account_id' in the body (the WhatsApp account to send from)",
            );
          }
          // Verify the master key owns this account.
          const { data: owned } = await supabaseAdmin
            .from("wa_accounts")
            .select("id, created_by")
            .eq("id", payload.account_id)
            .maybeSingle();
          if (!owned || owned.created_by !== auth.userId) {
            return jsonError(403, "forbidden", "API key does not own this account");
          }
          accountId = payload.account_id;
        }

        const phone = normalizePhone(payload.to);
        if (phone.length < 6) return jsonError(400, "bad_request", "Invalid phone number");
        const waJid = `${phone}@s.whatsapp.net`;

        // Upsert contact + conversation.
        const { data: existingContact } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("account_id", accountId)
          .eq("wa_jid", waJid)
          .maybeSingle();
        let contactId = existingContact?.id;
        if (!contactId) {
          const { data: ins, error } = await supabaseAdmin
            .from("contacts")
            .insert({ account_id: accountId, wa_jid: waJid, phone })
            .select("id")
            .single();
          if (error) return jsonError(500, "db_error", error.message);
          contactId = ins.id;
        }

        const { data: existingConv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("account_id", accountId)
          .eq("contact_id", contactId)
          .maybeSingle();
        let conversationId = existingConv?.id;
        if (!conversationId) {
          const { data: ins, error } = await supabaseAdmin
            .from("conversations")
            .insert({ account_id: accountId, contact_id: contactId })
            .select("id")
            .single();
          if (error) return jsonError(500, "db_error", error.message);
          conversationId = ins.id;
        }

        const { data: msg, error: msgErr } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: conversationId,
            direction: "out",
            type: "text",
            body: payload.body,
            status: "pending",
          })
          .select("id")
          .single();
        if (msgErr) return jsonError(500, "db_error", msgErr.message);

        try {
          const { bridge } = await import("@/lib/bridge.server");
          const result = await bridge.send(accountId, {
            to: waJid,
            type: "text",
            body: payload.body,
          });
          await supabaseAdmin
            .from("messages")
            .update({ status: "sent", wa_message_id: result.wa_message_id })
            .eq("id", msg.id);
          await supabaseAdmin
            .from("conversations")
            .update({
              last_message_at: new Date().toISOString(),
              last_message_preview: payload.body.slice(0, 120),
            })
            .eq("id", conversationId);

          return withCors(Response.json({
            ok: true,
            message_id: msg.id,
            wa_message_id: result.wa_message_id,
            conversation_id: conversationId,
            to: phone,
          }));
        } catch (e) {
          await supabaseAdmin.from("messages").update({ status: "failed" }).eq("id", msg.id);
          return jsonError(502, "bridge_error", e instanceof Error ? e.message : "Bridge send failed");
        }
      },
    },
  },
});