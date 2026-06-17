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

// Returns info about the user's master API key (creates it on first call).
// The plaintext is returned ONLY when the key was just created. Otherwise
// only prefix + metadata is returned (the raw key is never stored).
export const getMasterApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: selErr } = await supabase
      .from("api_keys")
      .select("id, key_prefix, last_used_at, created_at")
      .eq("user_id", userId)
      .eq("is_master", true)
      .is("revoked_at", null)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    if (existing) {
      return { ok: true, created: false, key: null as string | null, ...existing };
    }

    const { plaintext, prefix, keyHash } = await import("crypto").then((c) => {
      const raw = c.randomBytes(24).toString("hex");
      const pt = `wapix_${raw}`;
      return { plaintext: pt, prefix: pt.slice(0, 12), keyHash: c.createHash("sha256").update(pt).digest("hex") };
    });

    const { data: ins, error } = await supabase
      .from("api_keys")
      .insert({
        user_id: userId,
        account_id: null,
        label: "Master API key",
        key_prefix: prefix,
        key_hash: keyHash,
        is_master: true,
      })
      .select("id, key_prefix, last_used_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, created: true, key: plaintext, ...ins };
  });

// Rotates the master key: revokes the current one and issues a fresh one.
// Returns the new plaintext ONCE.
export const resetMasterApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const { error: revErr } = await supabase
      .from("api_keys")
      .update({ revoked_at: nowIso })
      .eq("user_id", userId)
      .eq("is_master", true)
      .is("revoked_at", null);
    if (revErr) throw new Error(revErr.message);

    const c = await import("crypto");
    const raw = c.randomBytes(24).toString("hex");
    const plaintext = `wapix_${raw}`;
    const prefix = plaintext.slice(0, 12);
    const keyHash = c.createHash("sha256").update(plaintext).digest("hex");

    const { data: ins, error } = await supabase
      .from("api_keys")
      .insert({
        user_id: userId,
        account_id: null,
        label: "Master API key",
        key_prefix: prefix,
        key_hash: keyHash,
        is_master: true,
      })
      .select("id, key_prefix, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, key: plaintext, ...ins };
  });