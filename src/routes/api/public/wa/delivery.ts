import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Payload = z.object({
  waMessageId: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
});

export const Route = createFileRoute("/api/public/wa/delivery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyWebhookSignature } = await import("@/lib/bridge.server");
        if (!(await verifyWebhookSignature(raw, request.headers.get("x-wapix-signature")))) {
          return new Response("Invalid signature", { status: 401 });
        }
        let parsed;
        try {
          parsed = Payload.parse(JSON.parse(raw));
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("messages")
          .update({ status: parsed.status })
          .eq("wa_message_id", parsed.waMessageId);
        return Response.json({ ok: true });
      },
    },
  },
});