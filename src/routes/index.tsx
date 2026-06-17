import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MessageSquare, Sparkles, Users, Send, ShieldCheck, Bot } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wapix — WhatsApp automation for growing businesses" },
      { name: "description", content: "Shared team inbox, AI auto-replies, CRM and broadcast campaigns. Connect your own WhatsApp number via your self-hosted bridge." },
      { property: "og:title", content: "Wapix — WhatsApp automation" },
      { property: "og:description", content: "Shared inbox, AI auto-replies, CRM, broadcasts." },
    ],
  }),
  component: Index,
});

function Index() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">W</span>
            Wapix
          </div>
          <div className="flex gap-2">
            {signedIn ? (
              <Button asChild><Link to="/app">Open dashboard</Link></Button>
            ) : (
              <>
                <Button variant="ghost" asChild><Link to="/auth">Sign in</Link></Button>
                <Button asChild><Link to="/auth" search={{ mode: "signup" }}>Get started</Link></Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-sm font-medium text-primary">For sales teams that run on WhatsApp</p>
          <h1 className="mt-3 text-5xl font-bold tracking-tight text-foreground max-w-3xl">
            Reply faster, qualify smarter, grow on WhatsApp.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Wapix gives your team a shared WhatsApp inbox with AI auto-replies, contact CRM, and broadcast campaigns —
            running on top of your own WhatsApp number through a self-hosted bridge you control.
          </p>
          <div className="mt-8 flex gap-3">
            <Button size="lg" asChild>
              <Link to="/auth" search={{ mode: "signup" }}>Start free</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/auth">I have an account</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24 grid gap-6 md:grid-cols-3">
          {[
            { Icon: MessageSquare, title: "Shared inbox", desc: "Every agent sees every chat in real time, with assignment and unread counts." },
            { Icon: Bot, title: "AI + rule replies", desc: "Keyword rules for FAQs, AI fallback trained on your business voice." },
            { Icon: Users, title: "Built-in CRM", desc: "Contacts auto-created from chats, with tags, notes and a pipeline." },
            { Icon: Send, title: "Broadcasts", desc: "Throttled bulk campaigns to segmented contact lists, scheduled." },
            { Icon: Sparkles, title: "Multi-account", desc: "Connect multiple WhatsApp numbers, assign agents per account." },
            { Icon: ShieldCheck, title: "Your data, your bridge", desc: "Self-host the Baileys bridge. Wapix is the brain & dashboard." },
          ].map(({ Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold text-card-foreground">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Wapix
        </div>
      </footer>
    </div>
  );
}
