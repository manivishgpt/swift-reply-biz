// Runtime config resolver. Reads from the app_settings table first (so the
// install wizard can persist secrets without restarting the server), and
// falls back to process.env. Values are cached in-memory for 10s.

type Key =
  | "BRIDGE_BASE_URL"
  | "BRIDGE_SHARED_SECRET"
  | "WEBHOOK_SECRET"
  | "OPENROUTER_API_KEY";

const cache = new Map<Key, { value: string | undefined; expires: number }>();
const TTL_MS = 10_000;

export async function getConfig(key: Key): Promise<string | undefined> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  let value: string | undefined;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (data?.value) value = data.value;
  } catch {
    // table may not exist yet (pre-migration); fall through to env
  }
  if (!value) value = process.env[key];

  cache.set(key, { value, expires: now + TTL_MS });
  return value;
}

export function invalidateConfigCache(keys?: Key[]) {
  if (!keys) return cache.clear();
  for (const k of keys) cache.delete(k);
}

export async function getConfigStatus(): Promise<Record<Key, boolean>> {
  const keys: Key[] = [
    "BRIDGE_BASE_URL",
    "BRIDGE_SHARED_SECRET",
    "WEBHOOK_SECRET",
    "OPENROUTER_API_KEY",
  ];
  const out = {} as Record<Key, boolean>;
  for (const k of keys) out[k] = Boolean(await getConfig(k));
  return out;
}