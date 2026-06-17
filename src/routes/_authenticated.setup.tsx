import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Check, CheckCircle2, AlertTriangle, Copy, RefreshCw, ExternalLink,
  ArrowLeft, ArrowRight, Sparkles, Server, Globe, Phone, PartyPopper,
} from "lucide-react";
import { toast } from "sonner";
import { getSetupStatus } from "@/lib/setup.functions";
import { createAccount, requestQr } from "@/lib/accounts.functions";

export const Route = createFileRoute("/_authenticated/setup")({
  ssr: false,
  component: SetupWizard,
});

type StepKey = "welcome" | "bridge" | "domain" | "whatsapp" | "done";
const STEPS: { key: StepKey; title: string; icon: typeof Sparkles }[] = [
  { key: "welcome", title: "Welcome", icon: Sparkles },
  { key: "bridge", title: "Bridge", icon: Server },
  { key: "domain", title: "Domain", icon: Globe },
  { key: "whatsapp", title: "WhatsApp", icon: Phone },
  { key: "done", title: "Done", icon: PartyPopper },
];

function SetupWizard() {
  const [step, setStep] = useState<StepKey>("welcome");
  const idx = STEPS.findIndex((s) => s.key === step);
  const progress = ((idx + 1) / STEPS.length) * 100;

  const statusFn = useServerFn(getSetupStatus);
  const status = useQuery({
    queryKey: ["setup", "status"],
    queryFn: () => statusFn(),
    refetchInterval: step === "whatsapp" ? 3000 : 15000,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">W</span>
            Wapix Setup
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/app">Skip for now</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {idx + 1} of {STEPS.length}</span>
          <span>{STEPS[idx].title}</span>
        </div>
        <Progress value={progress} className="mb-6" />

        <div className="mb-8 flex items-center gap-2 overflow-x-auto">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < idx;
            const active = i === idx;
            return (
              <button
                key={s.key}
                onClick={() => setStep(s.key)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : done
                      ? "border-primary/30 bg-primary/5 text-primary/70"
                      : "border-border text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                {s.title}
              </button>
            );
          })}
        </div>

        {step === "welcome" && <WelcomeStep onNext={() => setStep("bridge")} />}
        {step === "bridge" && (
          <BridgeStep
            status={status.data}
            loading={status.isLoading}
            onRefresh={() => status.refetch()}
            onBack={() => setStep("welcome")}
            onNext={() => setStep("domain")}
          />
        )}
        {step === "domain" && (
          <DomainStep onBack={() => setStep("bridge")} onNext={() => setStep("whatsapp")} />
        )}
        {step === "whatsapp" && (
          <WhatsAppStep
            bridgeReady={Boolean(status.data?.bridgeConfigured)}
            onBack={() => setStep("domain")}
            onDone={() => {
              status.refetch();
              setStep("done");
            }}
          />
        )}
        {step === "done" && <DoneStep />}
      </div>
    </div>
  );
}

/* --------------------------------- Welcome -------------------------------- */
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <Card className="p-8">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-semibold">Welcome to Wapix</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Let's get your fresh domain ready in 3 quick steps:
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <Server className="mt-0.5 h-4 w-4 text-primary" />
          <span><b>Bridge</b> — verify your self-hosted WhatsApp bridge is reachable.</span>
        </li>
        <li className="flex items-start gap-2">
          <Globe className="mt-0.5 h-4 w-4 text-primary" />
          <span><b>Domain</b> — point your custom domain to Wapix (optional).</span>
        </li>
        <li className="flex items-start gap-2">
          <Phone className="mt-0.5 h-4 w-4 text-primary" />
          <span><b>WhatsApp</b> — connect your first WhatsApp number by scanning a QR.</span>
        </li>
      </ul>
      <div className="mt-8 flex justify-end">
        <Button onClick={onNext}>Start <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

/* --------------------------------- Bridge --------------------------------- */
function BridgeStep({
  status, loading, onRefresh, onBack, onNext,
}: {
  status: Awaited<ReturnType<typeof getSetupStatus>> | undefined;
  loading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const ok = status?.bridgeConfigured && status?.bridgeReachable;
  return (
    <Card className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Self-hosted Bridge</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Wapix talks to WhatsApp through your own Baileys bridge.
          </p>
        </div>
        <Badge className={ok ? "bg-primary/15 text-primary" : "bg-yellow-500/15 text-yellow-700"}>
          {loading ? "checking…" : ok ? "Connected" : "Not connected"}
        </Badge>
      </div>

      <div className="mt-6 grid gap-3 text-sm">
        <CheckRow ok={!!status?.bridgeConfigured} label="BRIDGE_BASE_URL & BRIDGE_SHARED_SECRET configured" />
        <CheckRow ok={!!status?.webhookConfigured} label="WEBHOOK_SECRET configured" />
        <CheckRow ok={!!status?.bridgeReachable} label="Bridge URL is reachable" />
      </div>

      {!ok && (
        <div className="mt-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-700" />
            <div className="space-y-2">
              <p className="font-medium text-yellow-800">Deploy your bridge first</p>
              <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                <li>Deploy the Baileys bridge (see <code>/bridge</code> in this repo) to Render or any Docker host.</li>
                <li>Add a persistent disk mounted at <code>/app/auth_states</code>.</li>
                <li>
                  In Lovable Cloud → Backend secrets, add:
                  <code className="ml-1">BRIDGE_BASE_URL</code>,{" "}
                  <code>BRIDGE_SHARED_SECRET</code>, <code>WEBHOOK_SECRET</code>.
                </li>
                <li>Click <b>Re-check</b> below.</li>
              </ol>
              <a
                href="https://docs.render.com/web-services"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Render docs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Re-check
          </Button>
          <Button onClick={onNext}>
            {ok ? "Next" : "Skip for now"} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------- Domain --------------------------------- */
function DomainStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [domain, setDomain] = useState("");
  const records = [
    { type: "A", name: "@", value: "185.158.133.1" },
    { type: "A", name: "www", value: "185.158.133.1" },
    { type: "TXT", name: "_lovable", value: "lovable_verify=<token from Project Settings>" },
  ];

  function copy(t: string) {
    navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  }

  return (
    <Card className="p-8">
      <h2 className="text-xl font-semibold">Connect your domain</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Point a fresh domain at Wapix. You can also do this later from Project Settings → Domains.
      </p>

      <div className="mt-6 space-y-2">
        <Label htmlFor="dom">Your domain</Label>
        <Input id="dom" placeholder="app.yourbusiness.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          Add these DNS records at your registrar (Cloudflare, GoDaddy, Namecheap…). Then go to
          Project Settings → Domains and click <b>Connect domain</b> to finish verification.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.type + r.name} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{r.type}</td>
                <td className="px-3 py-2 font-mono">{r.name}</td>
                <td className="px-3 py-2 font-mono break-all">{r.value}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => copy(r.value)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        SSL is provisioned automatically by Lovable. DNS propagation can take up to 72 hours.
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <Button onClick={onNext}>Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

/* -------------------------------- WhatsApp -------------------------------- */
function WhatsAppStep({
  bridgeReady, onBack, onDone,
}: {
  bridgeReady: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const createFn = useServerFn(createAccount);
  const qrFn = useServerFn(requestQr);

  const [label, setLabel] = useState("My WhatsApp");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  const acct = useQuery({
    queryKey: ["setup", "wa", accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_accounts")
        .select("id, status, phone")
        .eq("id", accountId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [qr]);

  useEffect(() => {
    if (acct.data?.status === "connected") {
      toast.success(`Connected as ${acct.data.phone ?? "WhatsApp"}`);
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    }
  }, [acct.data?.status, acct.data?.phone, queryClient]);

  async function createAndQr() {
    if (!label.trim()) return;
    setBusy("create");
    try {
      const a = await createFn({ data: { label: label.trim() } });
      setAccountId(a.id);
      const r = await qrFn({ data: { accountId: a.id } });
      setQr(r.qr);
      setQrAt(r.qr ? Date.now() : null);
      if (!r.qr) toast.message("Waiting for QR from bridge…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function refreshQr() {
    if (!accountId) return;
    setBusy("qr");
    try {
      const r = await qrFn({ data: { accountId } });
      setQr(r.qr);
      setQrAt(r.qr ? Date.now() : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const connected = acct.data?.status === "connected";
  const elapsed = qrAt ? Math.floor((now - qrAt) / 1000) : 0;
  const remaining = Math.max(0, 60 - elapsed);

  return (
    <Card className="p-8">
      <h2 className="text-xl font-semibold">Connect your first WhatsApp number</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create an account, then scan the QR with WhatsApp → Linked devices → Link a device.
      </p>

      {!bridgeReady && (
        <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-800">
          Bridge is not configured. You can still create an account, but pairing will fail until the bridge is live.
        </div>
      )}

      {!accountId ? (
        <div className="mt-6 space-y-3">
          <div>
            <Label htmlFor="lbl">Account label</Label>
            <Input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sales line" />
          </div>
          <Button onClick={createAndQr} disabled={busy !== null || !label.trim()}>
            {busy === "create" && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
            Create & get QR
          </Button>
        </div>
      ) : connected ? (
        <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          <p className="mt-2 font-medium">Paired as {acct.data?.phone ?? "WhatsApp"}</p>
          <p className="text-xs text-muted-foreground">You're ready to send and receive messages.</p>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-6 text-center">
          {qr ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">Scan with WhatsApp on your phone</p>
              <img
                alt="WhatsApp QR"
                className="mx-auto h-56 w-56 rounded bg-white p-2"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=224x224&data=${encodeURIComponent(qr)}`}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {remaining > 0
                  ? <>QR refresh in <span className="font-medium text-foreground">{remaining}s</span></>
                  : <>QR expired — click Refresh QR</>}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
              Waiting for QR from bridge…
            </p>
          )}
          <Button size="sm" variant="outline" className="mt-4" onClick={refreshQr} disabled={busy !== null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "qr" ? "animate-spin" : ""}`} />
            Refresh QR
          </Button>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <Button onClick={onDone} disabled={!connected}>
          Finish <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

/* ---------------------------------- Done ---------------------------------- */
function DoneStep() {
  const navigate = useNavigate();
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <PartyPopper className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-2xl font-semibold">You're all set</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your bridge is live, your domain is configured, and your first WhatsApp number is connected.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={() => navigate({ to: "/app" })}>Open dashboard</Button>
        <Button variant="outline" onClick={() => navigate({ to: "/accounts" })}>Manage accounts</Button>
      </div>
    </Card>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-primary" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-yellow-700" />
      )}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}