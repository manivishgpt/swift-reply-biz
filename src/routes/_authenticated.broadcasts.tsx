import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Megaphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/broadcasts")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Broadcasts</h1>
      <p className="mt-1 text-sm text-muted-foreground">Throttled bulk campaigns to tag-segmented contacts.</p>
      <Card className="mt-6 p-12 text-center text-sm text-muted-foreground">
        <Megaphone className="mx-auto mb-2 h-6 w-6" />
        Broadcast composer ships in the next phase. Stay tuned.
      </Card>
    </div>
  ),
});