import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Payload = z.object({
  accountId: z.string().uuid(),
  status: z.enum(["disconnected", "connecting", "connected", "banned", "error"]),
  phone: z.string().optional(),
  qr: z.string().optional().nullable(),
});

export const Route = createFileRoute("/api/public/wa/status")({
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
        await supabaseAdmin.from("webhook_events").insert({ kind: "status", payload: parsed });
        const patch: {
          status: typeof parsed.status;
          phone?: string;
          last_qr?: string | null;
          last_qr_at?: string | null;
        } = { status: parsed.status };
        if (parsed.phone) patch.phone = parsed.phone;
        if (parsed.qr !== undefined) {
          patch.last_qr = parsed.qr;
          patch.last_qr_at = parsed.qr ? new Date().toISOString() : null;
        }
        await supabaseAdmin.from("wa_accounts").update(patch).eq("id", parsed.accountId);
        return Response.json({ ok: true });
      },
    },
  },
});