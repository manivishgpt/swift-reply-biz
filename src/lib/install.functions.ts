import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SETTING_KEYS = [
  "BRIDGE_BASE_URL",
  "BRIDGE_SHARED_SECRET",
  "WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

async function countAdmins(): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Public server fn — no auth required. Returns only counts and booleans,
// never PII. Safe to call from the public /install wizard.
export const getInstallStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getConfig } = await import("@/lib/runtime-config.server");
  const env = {
    bridgeBaseUrl: Boolean(await getConfig("BRIDGE_BASE_URL")),
    bridgeSharedSecret: Boolean(await getConfig("BRIDGE_SHARED_SECRET")),
    webhookSecret: Boolean(await getConfig("WEBHOOK_SECRET")),
    openRouterApiKey: Boolean(await getConfig("OPENROUTER_API_KEY")),
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
  };

  let bridgeReachable = false;
  let bridgeError: string | null = null;
  if (env.bridgeBaseUrl) {
    try {
      const url = (await getConfig("BRIDGE_BASE_URL"))!.replace(/\/$/, "");
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

// Save runtime configuration. First-run (no admin exists) is open so a fresh
// install can be configured. Once an admin exists, only admins may update.
const SaveSchema = z.object({
  BRIDGE_BASE_URL: z.string().trim().url().optional().or(z.literal("")),
  BRIDGE_SHARED_SECRET: z.string().trim().min(8).optional().or(z.literal("")),
  WEBHOOK_SECRET: z.string().trim().min(8).optional().or(z.literal("")),
  OPENROUTER_API_KEY: z.string().trim().min(10).optional().or(z.literal("")),
});

export const saveInstallSecrets = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SaveSchema.parse(data))
  .handler(async ({ data }) => {
    const admins = await countAdmins();
    if (admins > 0) {
      // Lock down after first admin: require authenticated admin.
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const auth = getRequestHeader("authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (!token) throw new Error("Forbidden: install is locked. Sign in as admin.");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: userRes, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !userRes?.user) throw new Error("Forbidden: invalid session.");
      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: userRes.user.id,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Forbidden: admin role required.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows: { key: SettingKey; value: string }[] = [];
    for (const k of SETTING_KEYS) {
      const v = (data as Record<string, string | undefined>)[k];
      if (v && v.length > 0) rows.push({ key: k, value: v });
    }
    if (rows.length === 0) return { ok: true, saved: 0 };

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);

    const { invalidateConfigCache } = await import("@/lib/runtime-config.server");
    invalidateConfigCache();

    return { ok: true, saved: rows.length };
  });

// Create the first admin. Only callable when zero admins exist.
const AdminSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(120).optional(),
});

export const createFirstAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AdminSchema.parse(data))
  .handler(async ({ data }) => {
    const admins = await countAdmins();
    if (admins > 0) {
      throw new Error("An admin already exists. Sign in instead.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: data.fullName ? { full_name: data.fullName } : undefined,
    });
    if (error || !created.user) {
      throw new Error(error?.message ?? "Failed to create user");
    }
    const userId = created.user.id;
    // Grant admin role.
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "admin" });
    if (roleErr) {
      throw new Error(`User created but role grant failed: ${roleErr.message}`);
    }
    return { ok: true, userId, email: data.email };
  });