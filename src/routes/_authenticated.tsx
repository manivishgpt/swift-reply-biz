import { createFileRoute, Outlet, redirect, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Users, Phone, Settings, MessageSquare, LogOut, Megaphone, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const nav = [
  { to: "/app", label: "Dashboard", icon: MessageSquare },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/accounts", label: "WhatsApp accounts", icon: Phone },
  { to: "/rules", label: "Auto-reply rules", icon: Bot },
  { to: "/broadcasts", label: "Broadcasts", icon: Megaphone },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useLocation({ select: (l) => l.pathname });

  const { data: profile } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, email")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const display = profile?.full_name ?? profile?.email ?? user.email ?? "You";
  const initials = display.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-background">
      <aside className="flex flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-5 py-5 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">W</span>
          Wapix
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-md p-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{display}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">{user.email}</p>
            </div>
            <Button size="icon" variant="ghost" onClick={signOut} title="Sign out" className="text-sidebar-foreground/70 hover:text-sidebar-foreground">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}