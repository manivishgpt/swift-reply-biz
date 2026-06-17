import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Check, CheckCircle2, AlertTriangle, Copy, RefreshCw, ExternalLink,
  ArrowLeft, ArrowRight, Sparkles, Server, Globe, UserPlus, PartyPopper, KeyRound, Database,
} from "lucide-react";
import { toast } from "sonner";
import { getInstallStatus, saveInstallSecrets, createFirstAdmin, validateSupabaseCreds } from "@/lib/install.functions";

export const Route = createFileRoute("/install")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Install Wapix — first-run wizard" },
      { name: "description", content: "Fresh install setup for Wapix: configure secrets, point your domain, deploy the bridge, and create the first admin." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InstallWizard,
});

type StepKey = "welcome" | "supabase" | "secrets" | "bridge" | "domain" | "admin" | "done";
const STEPS: { key: StepKey; title: string; icon: typeof Sparkles }[] = [
  { key: "welcome", title: "Welcome", icon: Sparkles },
  { key: "supabase", title: "Database", icon: Database },
  { key: "secrets", title: "Secrets", icon: KeyRound },
  { key: "bridge", title: "Bridge", icon: Server },
  { key: "domain", title: "Domain", icon: Globe },
  { key: "admin", title: "Admin", icon: UserPlus },
  { key: "done", title: "Done", icon: PartyPopper },
];

function InstallWizard() {
  const [step, setStep] = useState<StepKey>("welcome");
  const idx = STEPS.findIndex((s) => s.key === step);
  const progress = ((idx + 1) / STEPS.length) * 100;

  const statusFn = useServerFn(getInstallStatus);
  const status = useQuery({
    queryKey: ["install", "status"],
    queryFn: () => statusFn(),
    refetchInterval: 20000,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">W</span>
            Wapix Installer
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">Back to site</Link>
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

        {step === "welcome" && (
          <WelcomeStep
            userCount={status.data?.userCount ?? 0}
            onNext={() => setStep("supabase")}
          />
        )}
        {step === "supabase" && (
          <SupabaseStep
            supabaseUrlSet={status.data?.env.supabaseUrl ?? false}
            onBack={() => setStep("welcome")}
            onNext={() => setStep("secrets")}
          />
        )}
        {step === "secrets" && (
          <SecretsStep
            env={status.data?.env}
            loading={status.isLoading}
            onRefresh={() => status.refetch()}
            onBack={() => setStep("supabase")}
            onNext={() => setStep("bridge")}
          />
        )}
        {step === "bridge" && (
          <BridgeStep
            reachable={status.data?.bridgeReachable ?? false}
            error={status.data?.bridgeError ?? null}
            configured={status.data?.env.bridgeBaseUrl ?? false}
            loading={status.isLoading}
            onRefresh={() => status.refetch()}
            onBack={() => setStep("secrets")}
            onNext={() => setStep("domain")}
          />
        )}
        {step === "domain" && (
          <DomainStep onBack={() => setStep("bridge")} onNext={() => setStep("admin")} />
        )}
        {step === "admin" && (
          <AdminStep
            adminCount={status.data?.adminCount ?? 0}
            onRefresh={() => status.refetch()}
            onBack={() => setStep("domain")}
            onNext={() => setStep("done")}
          />
        )}
        {step === "done" && <DoneStep />}
      </div>
    </div>
  );
}

/* --------------------------------- Welcome -------------------------------- */
function WelcomeStep({ userCount, onNext }: { userCount: number; onNext: () => void }) {
  return (
    <Card className="p-8">
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-semibold">Fresh install of Wapix</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This wizard sets up a brand-new Wapix instance: secrets, bridge, domain, and the first admin user.
      </p>

      {userCount > 0 && (
        <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-800">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          This instance already has {userCount} user{userCount === 1 ? "" : "s"}. You can still re-run the
          wizard to verify configuration, but the admin step will be skipped.
        </div>
      )}

      <ul className="mt-6 space-y-2 text-sm">
        <li className="flex gap-2"><KeyRound className="mt-0.5 h-4 w-4 text-primary" /><span><b>Secrets</b> — verify backend secrets exist.</span></li>
        <li className="flex gap-2"><Server className="mt-0.5 h-4 w-4 text-primary" /><span><b>Bridge</b> — confirm the self-hosted WhatsApp bridge responds.</span></li>
        <li className="flex gap-2"><Globe className="mt-0.5 h-4 w-4 text-primary" /><span><b>Domain</b> — DNS records to point your domain here.</span></li>
        <li className="flex gap-2"><UserPlus className="mt-0.5 h-4 w-4 text-primary" /><span><b>Admin</b> — create the first administrator account.</span></li>
      </ul>

      <div className="mt-8 flex justify-end">
        <Button onClick={onNext}>Start install <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

/* --------------------------------- Secrets -------------------------------- */
function SecretsStep({
  env, loading, onRefresh, onBack, onNext,
}: {
  env: { bridgeBaseUrl: boolean; bridgeSharedSecret: boolean; webhookSecret: boolean; openRouterApiKey: boolean; supabaseUrl: boolean } | undefined;
  loading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const fields = [
    { key: "BRIDGE_BASE_URL", envKey: "bridgeBaseUrl", label: "Bridge URL", placeholder: "https://my-bridge.onrender.com", desc: "Public URL of your deployed Baileys bridge.", type: "url" as const },
    { key: "BRIDGE_SHARED_SECRET", envKey: "bridgeSharedSecret", label: "Bridge Shared Secret", placeholder: "long random string", desc: "HMAC secret — must match the bridge's BRIDGE_SHARED_SECRET.", type: "password" as const },
    { key: "WEBHOOK_SECRET", envKey: "webhookSecret", label: "Webhook Secret", placeholder: "long random string", desc: "Verifies incoming webhooks from the bridge — must match the bridge's WEBHOOK_SECRET.", type: "password" as const },
    { key: "OPENROUTER_API_KEY", envKey: "openRouterApiKey", label: "OpenRouter API Key", placeholder: "sk-or-v1-…", desc: "Free-model auto-reply. Get one at openrouter.ai/keys.", type: "password" as const },
  ] as const;

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const saveFn = useServerFn(saveInstallSecrets);

  const allOk = fields.every((f) => env?.[f.envKey as keyof typeof env]);

  function rand() {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) if (values[f.key]?.trim()) payload[f.key] = values[f.key].trim();
      if (Object.keys(payload).length === 0) {
        toast.info("Nothing to save — fill in at least one field.");
        return;
      }
      const res = await saveFn({ data: payload });
      toast.success(`Saved ${res.saved} setting${res.saved === 1 ? "" : "s"}`);
      setValues({});
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Configure secrets</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste your credentials below — they save directly to the database. No env file editing.
          </p>
        </div>
        <Badge className={allOk ? "bg-primary/15 text-primary" : "bg-yellow-500/15 text-yellow-700"}>
          {loading ? "checking…" : allOk ? "All set" : "Missing"}
        </Badge>
      </div>

      <div className="mt-6 space-y-4">
        {fields.map((f) => {
          const present = env?.[f.envKey as keyof typeof env] ?? false;
          const isSecret = f.type === "password";
          return (
            <div key={f.key} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={f.key} className="text-sm font-medium">{f.label}</Label>
                <Badge variant="outline" className={present ? "text-primary border-primary/30" : "text-muted-foreground"}>
                  {present ? <><CheckCircle2 className="mr-1 h-3 w-3" />saved</> : <><AlertTriangle className="mr-1 h-3 w-3" />not set</>}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
              <div className="mt-2 flex gap-2">
                <Input
                  id={f.key}
                  type={f.type}
                  placeholder={present ? "•••••••• (saved — paste to update)" : f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="font-mono text-xs"
                />
                {isSecret && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const r = rand();
                      setValues((v) => ({ ...v, [f.key]: r }));
                      navigator.clipboard.writeText(r).then(() => toast.success("Generated & copied"));
                    }}
                  >
                    Generate
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        Tip: The <b>BRIDGE_SHARED_SECRET</b> and <b>WEBHOOK_SECRET</b> values you generate here
        must also be set as environment variables on your Baileys bridge (Render/Docker) — that's
        the only place they can't be auto-synced.
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Re-check
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <Button onClick={onNext} variant={allOk ? "default" : "outline"}>
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------- Bridge --------------------------------- */
function BridgeStep({
  reachable, error, configured, loading, onRefresh, onBack, onNext,
}: {
  reachable: boolean;
  error: string | null;
  configured: boolean;
  loading: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Self-hosted Bridge</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Wapix talks to WhatsApp via your own Baileys bridge (Render or any Docker host).
          </p>
        </div>
        <Badge className={reachable ? "bg-primary/15 text-primary" : "bg-yellow-500/15 text-yellow-700"}>
          {loading ? "checking…" : reachable ? "Reachable" : configured ? "Unreachable" : "Not configured"}
        </Badge>
      </div>

      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Push the contents of the <code>/bridge</code> folder to a private GitHub repo.</li>
        <li>On Render, create a Web Service from that repo (Docker) on the Starter plan.</li>
        <li>Add a 1 GB persistent disk mounted at <code>/app/auth_states</code>.</li>
        <li>
          Set bridge env vars: <code>PORT=3000</code>, <code>BRIDGE_SHARED_SECRET</code>,
          {" "}<code>WEBHOOK_SECRET</code>, and <code>WEBHOOK_URL</code> = this site's URL.
        </li>
        <li>Copy the live Render URL into Lovable Cloud secret <code>BRIDGE_BASE_URL</code>.</li>
      </ol>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Last reach attempt failed: {error}
        </div>
      )}

      <a
        href="https://docs.render.com/web-services"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Render Web Services docs <ExternalLink className="h-3 w-3" />
      </a>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Re-check
          </Button>
          <Button onClick={onNext}>Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------- Domain --------------------------------- */
function DomainStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const records = [
    { type: "A", name: "@", value: "185.158.133.1" },
    { type: "A", name: "www", value: "185.158.133.1" },
    { type: "TXT", name: "_lovable", value: "lovable_verify=<token from Project Settings → Domains>" },
  ];
  function copy(t: string) {
    navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  }
  return (
    <Card className="p-8">
      <h2 className="text-xl font-semibold">Point your fresh domain</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Add these DNS records at your registrar. Then open Project Settings → Domains in Lovable
        and click <b>Connect domain</b> to verify and provision SSL automatically.
      </p>
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
      <p className="mt-3 text-xs text-muted-foreground">
        DNS propagation can take up to 72 hours. You can skip this step and connect a domain later.
      </p>
      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <Button onClick={onNext}>Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </div>
    </Card>
  );
}

/* ---------------------------------- Admin --------------------------------- */
function AdminStep({
  adminCount, onRefresh, onBack, onNext,
}: {
  adminCount: number;
  onRefresh: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const exists = adminCount > 0;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [creating, setCreating] = useState(false);
  const createFn = useServerFn(createFirstAdmin);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createFn({ data: { email, password, fullName: fullName || undefined } });
      toast.success("Admin created! You can now sign in.");
      setEmail(""); setPassword(""); setFullName("");
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create admin");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">First admin account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the first administrator. After this, additional users sign up as agents.
          </p>
        </div>
        <Badge className={exists ? "bg-primary/15 text-primary" : "bg-yellow-500/15 text-yellow-700"}>
          {exists ? `${adminCount} admin${adminCount === 1 ? "" : "s"}` : "no admin yet"}
        </Badge>
      </div>

      {exists ? (
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          <p>Admin already exists. You can sign in to manage the instance.</p>
          <div className="mt-3 flex gap-2">
            <Button asChild><Link to="/auth">Sign in</Link></Button>
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />Re-check
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="admin-name">Full name (optional)</Label>
            <Input id="admin-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@yourdomain.com" autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="admin-pass">Password (min 8 characters)</Label>
            <Input id="admin-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={creating}>
              <UserPlus className="mr-2 h-4 w-4" />{creating ? "Creating…" : "Create admin"}
            </Button>
            <Button type="button" variant="outline" onClick={onRefresh}>
              <RefreshCw className="mr-2 h-4 w-4" />Re-check
            </Button>
          </div>
        </form>
      )}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
        <Button onClick={onNext} disabled={!exists}>Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
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
      <h2 className="mt-4 text-2xl font-semibold">Install complete</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your Wapix instance is ready. Sign in to connect your first WhatsApp number.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={() => navigate({ to: "/auth" })}>Sign in</Button>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>Go home</Button>
      </div>
    </Card>
  );
}