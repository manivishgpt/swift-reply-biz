import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Bot } from "lucide-react";

export const Route = createFileRoute("/_authenticated/rules")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Auto-reply rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">Keyword and AI replies, configured per account.</p>
      <Card className="mt-6 p-12 text-center text-sm text-muted-foreground">
        <Bot className="mx-auto mb-2 h-6 w-6" />
        Rule builder is coming in the next iteration. Toggle AI replies and set the system prompt from the <a href="/accounts" className="text-primary underline">account settings</a> in the meantime.
      </Card>
    </div>
  ),
});