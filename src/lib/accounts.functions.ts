import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: import("@supabase/supabase-js").SupabaseClient, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only admins can perform this action");
}

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ label: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("wa_accounts")
      .insert({ label: data.label, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const requestQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { bridge } = await import("./bridge.server");
    await bridge.startSession(data.accountId);
    await context.supabase
      .from("wa_accounts")
      .update({ status: "connecting" })
      .eq("id", data.accountId);
    const result = await bridge.getQr(data.accountId);
    if (result.qr) {
      await context.supabase
        .from("wa_accounts")
        .update({ last_qr: result.qr, last_qr_at: new Date().toISOString() })
        .eq("id", data.accountId);
    }
    return result;
  });

export const disconnectAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    try {
      const { bridge } = await import("./bridge.server");
      await bridge.logout(data.accountId);
    } catch (e) {
      // ignore bridge errors on logout — still mark disconnected
      console.warn("Bridge logout failed:", e);
    }
    await context.supabase
      .from("wa_accounts")
      .update({ status: "disconnected", last_qr: null })
      .eq("id", data.accountId);
    return { ok: true };
  });

export const updateAccountSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        ai_prompt: z.string().max(4000).optional(),
        auto_reply_enabled: z.boolean().optional(),
        ai_enabled: z.boolean().optional(),
        throttle_per_min: z.number().int().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { accountId, ...patch } = data;
    const { error } = await context.supabase
      .from("wa_accounts")
      .update(patch)
      .eq("id", accountId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });