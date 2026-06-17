import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/contacts")({
  component: ContactsPage,
});

const STAGE_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-700",
  qualified: "bg-yellow-500/15 text-yellow-700",
  customer: "bg-primary/15 text-primary",
  lost: "bg-muted text-muted-foreground",
};

function ContactsPage() {
  const [q, setQ] = useState("");
  const contacts = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, display_name, phone, wa_jid, pipeline_stage, created_at, wa_accounts(label)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = (contacts.data ?? []).filter((c) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (c.display_name ?? "").toLowerCase().includes(s) ||
      (c.phone ?? "").toLowerCase().includes(s) ||
      (c.wa_jid ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every WhatsApp contact your team has touched.</p>

      <div className="mt-6 flex items-center gap-3">
        <Input placeholder="Search name, phone, JID…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <span className="text-sm text-muted-foreground">{rows.length} contacts</span>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-sm text-muted-foreground">
            <Users className="h-6 w-6" />
            No contacts yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">
                    <Link to="/contacts/$id" params={{ id: c.id }} className="hover:underline">
                      {c.display_name ?? "Unnamed"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.phone ?? c.wa_jid}</td>
                  <td className="px-4 py-2 text-muted-foreground">{(c as { wa_accounts: { label: string } | null }).wa_accounts?.label}</td>
                  <td className="px-4 py-2">
                    <Badge className={STAGE_COLORS[c.pipeline_stage as string] ?? "bg-muted"}>{c.pipeline_stage as string}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}