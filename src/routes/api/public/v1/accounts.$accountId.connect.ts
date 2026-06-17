import { createFileRoute } from "@tanstack/react-router";
import {
  assertAccountOwnership,
  authenticatePublicApi,
  jsonError,
} from "@/lib/public-api-auth.server";
import { corsPreflight, withCors } from "@/lib/public-api-cors";

// POST /api/public/v1/accounts/:accountId/connect
// Asks the bridge to start a session and returns the pairing QR string.
// Render it as a QR code on the client (any QR library, or the public
// https://api.qrserver.com/v1/create-qr-code/?data=... helper).
export const Route = createFileRoute("/api/public/v1/accounts/$accountId/connect")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request, params }) => {
        const a = await authenticatePublicApi(request);
        if (!a.ok) return a.response;

        const own = await assertAccountOwnership(a.auth.userId, params.accountId);
        if (!own.ok) return own.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { bridge } = await import("@/lib/bridge.server");

        try {
          if (own.account.status === "connected") {
            const r = await bridge.getQr(params.accountId);
            return withCors(Response.json({
              ok: true,
              status: r.status ?? "connected",
              qr: r.qr ?? null,
              already_connected: true,
            }));
          }

          await bridge.startSession(params.accountId, { reset: true });
          await supabaseAdmin
            .from("wa_accounts")
            .update({ status: "connecting", last_qr: null, last_qr_at: null })
            .eq("id", params.accountId);

          // Poll the bridge briefly for the QR — Baileys emits it asynchronously.
          let result = await bridge.getQr(params.accountId);
          for (let i = 0; i < 15 && !result.qr; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            result = await bridge.getQr(params.accountId);
          }

          if (result.qr) {
            await supabaseAdmin
              .from("wa_accounts")
              .update({ last_qr: result.qr, last_qr_at: new Date().toISOString() })
              .eq("id", params.accountId);
          }

          return withCors(Response.json({
            ok: true,
            status: result.status ?? "qr",
            qr: result.qr ?? null,
            qr_image_url: result.qr
              ? `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(result.qr)}`
              : null,
            poll: `/api/public/v1/accounts/${params.accountId}/status`,
          }));
        } catch (e) {
          return jsonError(502, "bridge_error", e instanceof Error ? e.message : "Bridge unreachable");
        }
      },
    },
  },
});