import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/contacts/$id")({
  component: ContactDetail,
});

const STAGES = ["new", "qualified", "customer", "lost"] as const;

function ContactDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const contact = useQuery({
    queryKey: ["contact", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, display_name, phone, wa_jid, pipeline_stage, notes, created_at, account_id, wa_accounts(label)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (contact.data?.notes !== undefined) setNotes(contact.data.notes ?? "");
  }, [contact.data?.notes]);

  const tags = useQuery({
    queryKey: ["contact-tags", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("contact_tags").select("tag").eq("contact_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function saveStage(stage: string) {
    const { error } = await supabase.from("contacts").update({ pipeline_stage: stage }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Stage updated");
    queryClient.invalidateQueries({ queryKey: ["contact", id] });
  }

  async function saveNotes() {
    const { error } = await supabase.from("contacts").update({ notes }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Notes saved");
  }

  async function addTag(tag: string) {
    if (!tag.trim()) return;
    const { error } = await supabase.from("contact_tags").insert({ contact_id: id, tag: tag.trim() });
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["contact-tags", id] });
  }

  if (contact.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!contact.data) return <div className="p-8 text-sm text-muted-foreground">Contact not found.</div>;

  const c = contact.data;

  return (
    <div className="p-8">
      <Link to="/contacts" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" />Back to contacts
      </Link>
      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.display_name ?? c.phone ?? "Unnamed"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{c.phone ?? c.wa_jid}</p>
          <p className="text-xs text-muted-foreground">Account: {(c as { wa_accounts: { label: string } | null }).wa_accounts?.label}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={c.pipeline_stage as string} onValueChange={saveStage}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold">Tags</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(tags.data ?? []).map((t) => (
              <Badge key={t.tag} variant="secondary">{t.tag}</Badge>
            ))}
            <NewTagInline onAdd={addTag} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold">Notes</h2>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} className="mt-2" placeholder="Internal notes about this contact…" />
          <Button size="sm" className="mt-3" onClick={saveNotes}>Save notes</Button>
        </div>
      </div>
    </div>
  );
}

function NewTagInline({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(v);
        setV("");
      }}
      className="inline-flex items-center"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="+ tag"
        className="w-20 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
      />
    </form>
  );
}