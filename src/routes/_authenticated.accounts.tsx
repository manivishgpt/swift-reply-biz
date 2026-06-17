import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Phone, RefreshCw, Power } from "lucide-react";
import { createAccount, requestQr, disconnectAccount, updateAccountSettings } from "@/lib/accounts.functions";
import { toast } from "sonner";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
});

type Account = {
  id: string;
  label: string;
  phone: string | null;
  status: string;
  ai_prompt: string | null;
  auto_reply_enabled: boolean;
  ai_enabled: boolean;
  throttle_per_min: number;
  last_qr: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-primary/15 text-primary",
  connecting: "bg-yellow-500/15 text-yellow-700",
  disconnected: "bg-muted text-muted-foreground",
  banned: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
};

function AccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_accounts")
        .select("id, label, phone, status, ai_prompt, auto_reply_enabled, ai_enabled, throttle_per_min, last_qr")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Account[];
    },
    // Poll every 2s while any account is mid-pairing (qr/connecting) so the
    // card flips to "connected" the instant the bridge webhook updates the row.
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as Account[];
      const pairing = rows.some((r) => r.status === "qr" || r.status === "connecting" || r.last_qr);
      return pairing ? 2000 : false;
    },
    refetchOnWindowFocus: true,
  });

  // Realtime: instantly reflect status changes pushed by the bridge webhook.
  useEffect(() => {
    const channel = supabase
      .channel("wa_accounts_status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wa_accounts" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["accounts"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connect WhatsApp numbers through your self-hosted bridge.</p>
        </div>
        <NewAccountButton onCreated={() => queryClient.invalidateQueries({ queryKey: ["accounts"] })} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {accounts.data?.map((a) => (
          <AccountCard key={a.id} account={a} />
        ))}
        {accounts.data?.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <Phone className="mx-auto mb-2 h-6 w-6" />
            No accounts yet. Add one to get started.
          </Card>
        )}
      </div>
    </div>
  );
}

function NewAccountButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(createAccount);

  async function submit() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await fn({ data: { label: label.trim() } });
      toast.success("Account created");
      setLabel("");
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />New account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New WhatsApp account</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="lbl">Label</Label>
            <Input id="lbl" value={label} placeholder="Sales line" onChange={(e) => setLabel(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">After creating, click "Connect" to fetch a QR from your bridge and pair the number.</p>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !label.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountCard({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState(account.ai_prompt ?? "");
  const [aiEnabled, setAiEnabled] = useState(account.ai_enabled);
  const [autoReply, setAutoReply] = useState(account.auto_reply_enabled);
  const [qr, setQr] = useState<string | null>(account.last_qr);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<number | null>(account.last_qr ? Date.now() : null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [qr]);

  const reqQrFn = useServerFn(requestQr);
  const disconnectFn = useServerFn(disconnectAccount);
  const updateFn = useServerFn(updateAccountSettings);

  async function connect() {
    setBusy("connect");
    try {
      const r = await reqQrFn({ data: { accountId: account.id } });
      setQr(r.qr);
      setQrAt(r.qr ? Date.now() : null);
      toast.success(r.qr ? "Scan the QR with WhatsApp" : "Session already started");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bridge unreachable. Configure BRIDGE_BASE_URL.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(
      `Disconnect "${account.label}"? This logs the WhatsApp session out and wipes its credentials — you'll need to scan a new QR to reconnect.`,
    )) {
      return;
    }
    setBusy("disconnect");
    try {
      await disconnectFn({ data: { accountId: account.id } });
      setQr(null);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      await updateFn({
        data: {
          accountId: account.id,
          ai_prompt: prompt,
          ai_enabled: aiEnabled,
          auto_reply_enabled: autoReply,
        },
      });
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{account.label}</h3>
          <p className="text-xs text-muted-foreground">{account.phone ?? "Not yet paired"}</p>
        </div>
        <Badge className={STATUS_COLORS[account.status] ?? STATUS_COLORS.disconnected}>{account.status}</Badge>
      </div>

      <div className="mt-4 flex gap-2">
        {account.status === "connected" ? (
          <Button size="sm" variant="outline" onClick={disconnect} disabled={busy !== null}>
            <Power className="mr-2 h-4 w-4" />Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={busy !== null}>
            <RefreshCw className={busy === "connect" ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            Connect
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide" : "Settings"}
        </Button>
      </div>

      {qr && account.status !== "connected" && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4 text-center">
          <p className="mb-2 text-xs text-muted-foreground">Scan with WhatsApp on your phone</p>
          <img
            alt="WhatsApp QR"
            className="mx-auto h-48 w-48"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(qr)}`}
          />
          {qrAt && (() => {
            const elapsed = Math.floor((now - qrAt) / 1000);
            const remaining = Math.max(0, 60 - elapsed);
            return (
              <p className="mt-3 text-xs text-muted-foreground">
                {remaining > 0
                  ? <>New QR in <span className="font-medium text-foreground">{remaining}s</span></>
                  : <>QR expired — click Connect to get a fresh one</>}
              </p>
            );
          })()}
        </div>
      )}

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <Label htmlFor={`ar-${account.id}`}>Auto-reply (rules)</Label>
            <Switch id={`ar-${account.id}`} checked={autoReply} onCheckedChange={setAutoReply} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`ai-${account.id}`}>AI fallback replies</Label>
            <Switch id={`ai-${account.id}`} checked={aiEnabled} onCheckedChange={setAiEnabled} />
          </div>
          <div>
            <Label htmlFor={`p-${account.id}`}>AI system prompt</Label>
            <Textarea
              id={`p-${account.id}`}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are a friendly customer-success agent for…"
            />
          </div>
          <Button size="sm" onClick={save} disabled={busy !== null}>Save</Button>
        </div>
      )}
    </Card>
  );
}