import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Inbox, Phone, Users, Megaphone, type LucideIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value, to }: { icon: LucideIcon; label: string; value: number | string; to: string }) {
  return (
    <Link to={to}>
      <Card className="transition-colors hover:border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className="h-4 w-4" />
            {label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{value}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Dashboard() {
  const stats = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const [accounts, contacts, conversations, msgs24h] = await Promise.all([
        supabase.from("wa_accounts").select("id", { count: "exact", head: true }),
        supabase.from("contacts").select("id", { count: "exact", head: true }),
        supabase.from("conversations").select("id", { count: "exact", head: true }),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      ]);
      return {
        accounts: accounts.count ?? 0,
        contacts: contacts.count ?? 0,
        conversations: conversations.count ?? 0,
        msgs24h: msgs24h.count ?? 0,
      };
    },
  });

  const s = stats.data;
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Overview of your WhatsApp workspace.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Phone} label="WhatsApp accounts" value={s?.accounts ?? "—"} to="/accounts" />
        <StatCard icon={Inbox} label="Conversations" value={s?.conversations ?? "—"} to="/inbox" />
        <StatCard icon={Users} label="Contacts" value={s?.contacts ?? "—"} to="/contacts" />
        <StatCard icon={Megaphone} label="Messages (24h)" value={s?.msgs24h ?? "—"} to="/inbox" />
      </div>

      <div className="mt-10 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Getting started</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Add a <Link to="/accounts" className="text-primary underline">WhatsApp account</Link> and scan the QR from your self-hosted bridge.</li>
          <li>Wapix will auto-create contacts and conversations from incoming messages.</li>
          <li>Configure <Link to="/rules" className="text-primary underline">auto-reply rules</Link> or enable AI replies per account.</li>
          <li>Launch a <Link to="/broadcasts" className="text-primary underline">broadcast</Link> to a tag-segmented list.</li>
        </ol>
      </div>
    </div>
  );
}