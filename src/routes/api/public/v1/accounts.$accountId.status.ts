import { createFileRoute } from "@tanstack/react-router";
import {
  assertAccountOwnership,
  authenticatePublicApi,
} from "@/lib/public-api-auth.server";

// GET /api/public/v1/accounts/:accountId/status
// Returns the current pairing/connection state plus the latest QR (if any).
// Use this to poll after calling /connect.
export const Route = createFileRoute("/api/public/v1/accounts/$accountId/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const a = await authenticatePublicApi(request);
        if (!a.ok) return a.response;

        const own = await assertAccountOwnership(a.auth.userId, params.accountId);
        if (!own.ok) return own.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("wa_accounts")
          .select("id, label, phone, status, last_qr, last_qr_at")
          .eq("id", params.accountId)
          .single();

        return Response.json({
          ok: true,
          account: data,
          qr: data?.last_qr ?? null,
          qr_image_url: data?.last_qr
            ? `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(data.last_qr)}`
            : null,
        });
      },
    },
  },
});