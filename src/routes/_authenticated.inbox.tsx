import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Send, Inbox as InboxIcon, Plus } from "lucide-react";
import { sendMessage, markConversationRead, startConversation } from "@/lib/inbox.functions";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
});

type ConvRow = {
  id: string;
  account_id: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  contacts: { display_name: string | null; phone: string | null; wa_jid: string } | null;
  wa_accounts: { label: string } | null;
};

type MsgRow = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  created_at: string;
  status: string;
  sent_by_ai: boolean;
};

function InboxPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, account_id, unread_count, last_message_at, last_message_preview, contacts(display_name, phone, wa_jid), wa_accounts(label)")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as ConvRow[];
    },
  });

  // realtime: conversations
  useEffect(() => {
    const ch = supabase
      .channel("realtime:conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [queryClient]);

  return (
    <div className="grid h-screen grid-cols-[340px_1fr]">
      <aside className="flex flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
          <div>
            <h2 className="font-semibold">Inbox</h2>
            <p className="text-xs text-muted-foreground">{conversations.data?.length ?? 0} conversations</p>
          </div>
          <NewChatDialog
            onCreated={(convId) => {
              setSelectedId(convId);
              queryClient.invalidateQueries({ queryKey: ["conversations"] });
            }}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : conversations.data && conversations.data.length > 0 ? (
            conversations.data.map((c) => {
              const active = selectedId === c.id;
              const name = c.contacts?.display_name ?? c.contacts?.phone ?? c.contacts?.wa_jid ?? "Unknown";
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left text-sm transition-colors",
                    active ? "bg-accent" : "hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{name}</span>
                    {c.last_message_at && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{c.last_message_preview ?? "No messages yet"}</span>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.wa_accounts?.label}
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyInbox />
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col">
        {selectedId ? <Thread conversationId={selectedId} /> : <EmptyThread />}
      </section>
    </div>
  );
}

function EmptyInbox() {
  return (
    <div className="p-6 text-sm text-muted-foreground">
      <InboxIcon className="mb-2 h-5 w-5" />
      No conversations yet. They'll appear here when your WhatsApp bridge starts delivering messages.
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Select a conversation to start chatting.
    </div>
  );
}

type WaAccountRow = { id: string; label: string; status: string; phone: string | null };

function NewChatDialog({ onCreated }: { onCreated: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const startFn = useServerFn(startConversation);

  const accounts = useQuery({
    queryKey: ["wa_accounts", "connected"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_accounts")
        .select("id, label, status, phone")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WaAccountRow[];
    },
  });

  useEffect(() => {
    if (open && !accountId && accounts.data && accounts.data.length > 0) {
      const connected = accounts.data.find((a) => a.status === "connected");
      setAccountId((connected ?? accounts.data[0]).id);
    }
  }, [open, accounts.data, accountId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !phone.trim() || !body.trim() || busy) return;
    setBusy(true);
    try {
      const res = await startFn({
        data: {
          accountId,
          phone: phone.trim(),
          body: body.trim(),
          displayName: displayName.trim() || undefined,
        },
      });
      toast.success("Message sent");
      setOpen(false);
      setPhone("");
      setDisplayName("");
      setBody("");
      onCreated(res.conversationId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1 h-4 w-4" /> New
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Send a WhatsApp message to any number. We'll create the conversation automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>WhatsApp account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder={accounts.isLoading ? "Loading…" : "Select an account"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.data?.map((a) => (
                  <SelectItem key={a.id} value={a.id} disabled={a.status !== "connected"}>
                    {a.label} {a.phone ? `· ${a.phone}` : ""} {a.status !== "connected" ? `(${a.status})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Phone number (with country code)</Label>
            <Input
              placeholder="e.g. 919876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
            <p className="text-[11px] text-muted-foreground">Digits only — no +, spaces or dashes needed.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Name (optional)</Label>
            <Input
              placeholder="John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              placeholder="Hi 👋"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !accountId || !phone.trim() || !body.trim()}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Thread({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const sendFn = useServerFn(sendMessage);
  const markRead = useServerFn(markConversationRead);

  const messages = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, body, created_at, status, sent_by_ai")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as MsgRow[];
    },
  });

  useEffect(() => {
    markRead({ data: { conversationId } }).catch(() => {});
    const ch = supabase
      .channel(`realtime:messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => queryClient.invalidateQueries({ queryKey: ["messages", conversationId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, queryClient, markRead]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    const text = draft.trim();
    console.log("[inbox] send click", { conversationId, length: text.length });
    try {
      const res = await sendFn({ data: { conversationId, body: text } });
      console.log("[inbox] send OK", res);
      setDraft("");
    } catch (e) {
      console.error("[inbox] send FAILED", e);
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 p-6">
        {messages.data?.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-md rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                m.direction === "out"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-card-foreground border border-border",
              )}
            >
              {m.sent_by_ai && (
                <p className={cn("mb-0.5 text-[10px] font-medium uppercase tracking-wide", m.direction === "out" ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  AI
                </p>
              )}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={cn("mt-1 text-[10px]", m.direction === "out" ? "text-primary-foreground/60" : "text-muted-foreground")}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {m.direction === "out" && m.status !== "sent" && m.status !== "delivered" && m.status !== "read" && ` · ${m.status}`}
              </p>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-border bg-card p-3">
        <Input
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </>
  );
}