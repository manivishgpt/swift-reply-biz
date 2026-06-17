import { createFileRoute } from "@tanstack/react-router";

// Cleans up "abandoned" WhatsApp accounts: rows that were created but never
// successfully paired (no phone, status != connected) and are older than the
// grace window. We log the bridge session out (best effort) and delete the row.
// Called by pg_cron every couple of minutes.
export const Route = createFileRoute("/api/public/hooks/cleanup-accounts")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        const { data: rows, error } = await supabaseAdmin
          .from("wa_accounts")
          .select("id, label, status, phone, created_at")
          .is("phone", null)
          .neq("status", "connected")
          .lt("created_at", cutoff);

        if (error) {
          console.error("[cleanup-accounts] query failed", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results: Array<{ id: string; deleted: boolean; bridge_error?: string }> = [];
        for (const r of rows ?? []) {
          let bridgeError: string | undefined;
          try {
            const { bridge } = await import("@/lib/bridge.server");
            await bridge.logout(r.id);
          } catch (e) {
            bridgeError = e instanceof Error ? e.message : String(e);
            console.warn("[cleanup-accounts] bridge logout failed", { id: r.id, bridgeError });
          }
          const { error: delErr } = await supabaseAdmin
            .from("wa_accounts")
            .delete()
            .eq("id", r.id);
          if (delErr) {
            console.error("[cleanup-accounts] delete failed", { id: r.id, delErr });
            results.push({ id: r.id, deleted: false, bridge_error: bridgeError });
          } else {
            console.log("[cleanup-accounts] removed abandoned account", { id: r.id, label: r.label });
            results.push({ id: r.id, deleted: true, bridge_error: bridgeError });
          }
        }

        return new Response(
          JSON.stringify({ ok: true, scanned: rows?.length ?? 0, results }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});