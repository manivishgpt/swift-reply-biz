import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const bridgeConfigured = Boolean(
      process.env.BRIDGE_BASE_URL && process.env.BRIDGE_SHARED_SECRET,
    );
    const webhookConfigured = Boolean(process.env.WEBHOOK_SECRET);

    let bridgeReachable = false;
    let bridgeError: string | null = null;
    if (bridgeConfigured) {
      try {
        const url = process.env.BRIDGE_BASE_URL!.replace(/\/$/, "");
        const res = await fetch(`${url}/`, { method: "GET" });
        bridgeReachable = res.status < 500;
      } catch (e) {
        bridgeError = e instanceof Error ? e.message : "Unknown error";
      }
    }

    const { data: accts } = await context.supabase
      .from("wa_accounts")
      .select("id, status")
      .eq("created_by", context.userId);

    const hasAccount = (accts ?? []).length > 0;
    const hasConnected = (accts ?? []).some((a) => a.status === "connected");

    return {
      bridgeConfigured,
      webhookConfigured,
      bridgeReachable,
      bridgeError,
      hasAccount,
      hasConnected,
    };
  });