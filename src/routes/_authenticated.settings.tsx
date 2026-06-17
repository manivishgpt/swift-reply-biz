import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMasterApiKey, resetMasterApiKey } from "@/lib/api-keys.functions";
import { useState } from "react";
import { Copy, RefreshCw, KeyRound } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Workspace and bridge configuration.</p>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold">Baileys bridge</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wapix talks to your self-hosted Baileys/whatsapp-web.js bridge over HTTPS. Configure these secrets in your Lovable Cloud project:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-xs">BRIDGE_BASE_URL</code>
            <span className="text-muted-foreground">e.g. https://my-bridge.onrender.com</span>
          </li>
          <li className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-xs">BRIDGE_SHARED_SECRET</code>
            <span className="text-muted-foreground">used to HMAC-sign outbound requests to your bridge</span>
          </li>
          <li className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-xs">WEBHOOK_SECRET</code>
            <span className="text-muted-foreground">used to verify incoming webhook signatures from your bridge</span>
          </li>
        </ul>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="font-semibold">Incoming webhook URLs</h2>
        <p className="mt-1 text-sm text-muted-foreground">Point your bridge at these endpoints. Each request must include an <code className="rounded bg-muted px-1.5 py-0.5 text-xs">X-Wapix-Signature</code> HMAC-SHA256 header over the raw body, signed with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">WEBHOOK_SECRET</code>.</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">POST</Badge>
            <code className="text-xs">/api/public/wa/message</code>
            <span className="text-muted-foreground">— incoming WhatsApp message</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">POST</Badge>
            <code className="text-xs">/api/public/wa/status</code>
            <span className="text-muted-foreground">— account status change</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">POST</Badge>
            <code className="text-xs">/api/public/wa/delivery</code>
            <span className="text-muted-foreground">— delivery / read receipts</span>
          </div>
        </div>
      </Card>

      <MasterApiKeyCard />
    </div>
  );
}

function MasterApiKeyCard() {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getMasterApiKey);
  const resetFn = useServerFn(resetMasterApiKey);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["master-api-key"],
    queryFn: async () => {
      const r = await getFn({ data: undefined as never });
      if (r.created && r.key) setRevealed(r.key);
      return r;
    },
    staleTime: 60_000,
  });

  async function reset() {
    if (!window.confirm(
      "Reset your master API key? The old key will stop working immediately and a new one will be issued.",
    )) return;
    setBusy(true);
    try {
      const r = await resetFn({ data: undefined as never });
      setRevealed(r.key);
      toast.success("Master key reset — copy the new key now");
      queryClient.invalidateQueries({ queryKey: ["master-api-key"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  }

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4" /> Master API key
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A single account-wide key that works for every WhatsApp number you connect.
            It is never deleted — only reset. When using it from the API, include
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">account_id</code>
            in the request body to choose which number to send from.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reset} disabled={busy || q.isLoading}>
          <RefreshCw className={busy ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          Reset
        </Button>
      </div>

      {q.data && (
        <div className="mt-4 space-y-3">
          {revealed ? (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs font-medium text-primary">Copy this key now — it won't be shown again.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background p-2 text-xs">{revealed}</code>
                <Button size="sm" variant="outline" onClick={() => copy(revealed)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <code className="rounded bg-muted px-2 py-1 text-xs">{q.data.key_prefix}…</code>
              <span className="text-muted-foreground text-xs">
                {q.data.last_used_at ? `last used ${new Date(q.data.last_used_at).toLocaleString()}` : "never used"}
              </span>
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">Send from any of your WhatsApp numbers</p>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px]">
{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/public/v1/messages \\
  -H "Authorization: Bearer ${revealed ?? "wapix_..."}" \\
  -H "Content-Type: application/json" \\
  -d '{"account_id":"<wa_account_uuid>","to":"919876543210","body":"Hi from master key"}'`}
            </pre>
          </div>
        </div>
      )}
    </Card>
  );
}