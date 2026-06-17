import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Payload = z.object({
  accountId: z.string().uuid(),
  from: z.string().min(1), // wa_jid
  fromName: z.string().optional(),
  fromPhone: z.string().optional(),
  body: z.string().nullable().optional(),
  type: z.enum(["text", "image", "audio", "video", "document", "sticker", "location", "contact", "system"]).default("text"),
  mediaUrl: z.string().url().optional().nullable(),
  waMessageId: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/wa/message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyWebhookSignature } = await import("@/lib/bridge.server");
        if (!verifyWebhookSignature(raw, request.headers.get("x-wapix-signature"))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed;
        try {
          parsed = Payload.parse(JSON.parse(raw));
        } catch (e) {
          return new Response("Bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        await supabaseAdmin.from("webhook_events").insert({ kind: "message", payload: parsed });

        // Upsert contact
        const { data: contactRow } = await supabaseAdmin
          .from("contacts")
          .upsert(
            {
              account_id: parsed.accountId,
              wa_jid: parsed.from,
              display_name: parsed.fromName ?? null,
              phone: parsed.fromPhone ?? null,
            },
            { onConflict: "account_id,wa_jid", ignoreDuplicates: false },
          )
          .select("id")
          .single();

        if (!contactRow) return new Response("contact upsert failed", { status: 500 });

        // Upsert conversation
        const { data: convRow } = await supabaseAdmin
          .from("conversations")
          .upsert(
            { account_id: parsed.accountId, contact_id: contactRow.id },
            { onConflict: "account_id,contact_id", ignoreDuplicates: false },
          )
          .select("id, unread_count")
          .single();

        if (!convRow) return new Response("conversation upsert failed", { status: 500 });

        // Insert message
        await supabaseAdmin.from("messages").insert({
          conversation_id: convRow.id,
          direction: "in",
          type: parsed.type,
          body: parsed.body ?? null,
          media_url: parsed.mediaUrl ?? null,
          status: "delivered",
          wa_message_id: parsed.waMessageId ?? null,
          created_at: parsed.timestamp ?? new Date().toISOString(),
        });

        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: (parsed.body ?? `[${parsed.type}]`).slice(0, 120),
            unread_count: (convRow.unread_count ?? 0) + 1,
          })
          .eq("id", convRow.id);

        // TODO (phase 4): run rule engine + AI auto-reply pipeline here.

        return Response.json({ ok: true });
      },
    },
  },
});