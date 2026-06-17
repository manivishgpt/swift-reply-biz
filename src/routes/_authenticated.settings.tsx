import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Workspace and bridge configuration.</p>

      <Card className="mt-6 p-5">
        <h2 className="font-semibold">Baileys bridge</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Wapix talks to your self-hosted Baileys/whatsapp-web.js bridge over HTTPS. Configure these secrets in your Lovable Cloud project:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-xs">BRIDGE_BASE_URL</code>
            <span className="text-muted-foreground">e.g. https://my-bridge.onrender.com</span>
          </li>
          <li className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-xs">BRIDGE_SHARED_SECRET</code>
            <span className="text-muted-foreground">used to HMAC-sign outbound requests to your bridge</span>
          </li>
          <li className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5 text-xs">WEBHOOK_SECRET</code>
            <span className="text-muted-foreground">used to verify incoming webhook signatures from your bridge</span>
          </li>
        </ul>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="font-semibold">Incoming webhook URLs</h2>
        <p className="mt-1 text-sm text-muted-foreground">Point your bridge at these endpoints. Each request must include an <code className="rounded bg-muted px-1.5 py-0.5 text-xs">X-Wapix-Signature</code> HMAC-SHA256 header over the raw body, signed with <code className="rounded bg-muted px-1.5 py-0.5 text-xs">WEBHOOK_SECRET</code>.</p>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">POST</Badge>
            <code className="text-xs">/api/public/wa/message</code>
            <span className="text-muted-foreground">— incoming WhatsApp message</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">POST</Badge>
            <code className="text-xs">/api/public/wa/status</code>
            <span className="text-muted-foreground">— account status change</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">POST</Badge>
            <code className="text-xs">/api/public/wa/delivery</code>
            <span className="text-muted-foreground">— delivery / read receipts</span>
          </div>
        </div>
      </Card>
    </div>
  );
}