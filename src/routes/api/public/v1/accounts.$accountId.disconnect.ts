import { createFileRoute } from "@tanstack/react-router";
import {
  assertAccountOwnership,
  authenticatePublicApi,
} from "@/lib/public-api-auth.server";
import { corsPreflight, withCors } from "@/lib/public-api-cors";

// POST /api/public/v1/accounts/:accountId/disconnect
// Explicit user action — logs the WhatsApp session out on the bridge and
// wipes its credentials. A new QR scan is required to reconnect.
export const Route = createFileRoute("/api/public/v1/accounts/$accountId/disconnect")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request, params }) => {
        const a = await authenticatePublicApi(request);
        if (!a.ok) return a.response;

        const own = await assertAccountOwnership(a.auth.userId, params.accountId);
        if (!own.ok) return own.response;

        try {
          const { bridge } = await import("@/lib/bridge.server");
          await bridge.logout(params.accountId);
        } catch (e) {
          console.warn("[public-api] bridge logout failed:", e);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("wa_accounts")
          .update({ status: "disconnected", last_qr: null })
          .eq("id", params.accountId);

        return withCors(Response.json({ ok: true, status: "disconnected" }));
      },
    },
  },
});