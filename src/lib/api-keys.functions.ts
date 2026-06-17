import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Returns the plaintext key ONCE on creation. After that only prefix + hash live in DB.
export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify the user can access this account (RLS would also block, but fail early).
    const { data: acct, error: acctErr } = await supabase
      .from("wa_accounts")
      .select("id")
      .eq("id", data.accountId)
      .maybeSingle();
    if (acctErr) throw new Error(acctErr.message);
    if (!acct) throw new Error("Account not found or access denied");

    const { randomBytes, createHash } = await import("crypto");
    const raw = randomBytes(24).toString("hex"); // 48 chars
    const plaintext = `wapix_${raw}`;
    const prefix = plaintext.slice(0, 12); // e.g. "wapix_abc123"
    const keyHash = createHash("sha256").update(plaintext).digest("hex");

    const { error } = await supabase.from("api_keys").insert({
      user_id: userId,
      account_id: data.accountId,
      label: data.label,
      key_prefix: prefix,
      key_hash: keyHash,
    });
    if (error) throw new Error(error.message);

    return { ok: true, key: plaintext, prefix };
  });

export const listApiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("api_keys")
      .select("id, label, key_prefix, last_used_at, revoked_at, created_at")
      .eq("account_id", data.accountId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });