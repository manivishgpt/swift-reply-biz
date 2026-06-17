import { createServerFn } from "@tanstack/react-start";

// Public server fn — no auth required. Returns only counts and booleans,
// never PII. Safe to call from the public /install wizard.
export const getInstallStatus = createServerFn({ method: "GET" }).handler(async () => {
  const env = {
    bridgeBaseUrl: Boolean(process.env.BRIDGE_BASE_URL),
    bridgeSharedSecret: Boolean(process.env.BRIDGE_SHARED_SECRET),
    webhookSecret: Boolean(process.env.WEBHOOK_SECRET),
    lovableApiKey: Boolean(process.env.LOVABLE_API_KEY),
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
  };

  let bridgeReachable = false;
  let bridgeError: string | null = null;
  if (env.bridgeBaseUrl) {
    try {
      const url = process.env.BRIDGE_BASE_URL!.replace(/\/$/, "");
      const res = await fetch(`${url}/`, { method: "GET" });
      bridgeReachable = res.status < 500;
    } catch (e) {
      bridgeError = e instanceof Error ? e.message : "Unknown error";
    }
  }

  let adminCount = 0;
  let userCount = 0;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count: ac } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    adminCount = ac ?? 0;
    const { count: uc } = await supabaseAdmin
      .from("profiles")
      .select("*", { count: "exact", head: true });
    userCount = uc ?? 0;
  } catch {
    // ignore — return zeros so wizard still renders
  }

  return { env, bridgeReachable, bridgeError, adminCount, userCount };
});