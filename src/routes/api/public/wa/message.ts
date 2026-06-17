import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Payload = z.object({
  accountId: z.string().uuid(),
  from: z.string().min(1), // wa_jid
  fromName: z.string().optional(),
  fromPhone: z.string().optional(),
  body: z.string().nullable().optional(),
  type: z.enum(["text", "image", "audio", "video", "document", "sticker", "location", "contact", "system"]).default("text"),
  mediaUrl: z.string().url().optional().nullable(),
  waMessageId: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/wa/message")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { verifyWebhookSignature } = await import("@/lib/bridge.server");
        if (!verifyWebhookSignature(raw, request.headers.get("x-wapix-signature"))) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed;
        try {
          parsed = Payload.parse(JSON.parse(raw));
        } catch (e) {
          console.error("[wa/message] bad payload", (e as Error).message, raw.slice(0, 500));
          return new Response("Bad request", { status: 400 });
        }

        const isGroup = parsed.from.endsWith("@g.us");
        console.log("[wa/message] incoming", {
          accountId: parsed.accountId,
          from: parsed.from,
          fromName: parsed.fromName ?? null,
          fromPhone: parsed.fromPhone ?? null,
          type: parsed.type,
          isGroup,
          waMessageId: parsed.waMessageId ?? null,
          timestamp: parsed.timestamp ?? null,
          body: parsed.body ?? null,
          bodyLen: parsed.body?.length ?? 0,
          mediaUrl: parsed.mediaUrl ?? null,
        });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        await supabaseAdmin.from("webhook_events").insert({ kind: "message", payload: parsed });

        // Upsert contact
        const { data: contactRow } = await supabaseAdmin
          .from("contacts")
          .upsert(
            {
              account_id: parsed.accountId,
              wa_jid: parsed.from,
              display_name: parsed.fromName ?? null,
              phone: parsed.fromPhone ?? null,
            },
            { onConflict: "account_id,wa_jid", ignoreDuplicates: false },
          )
          .select("id")
          .single();

        if (!contactRow) return new Response("contact upsert failed", { status: 500 });

        // Upsert conversation
        const { data: convRow } = await supabaseAdmin
          .from("conversations")
          .upsert(
            { account_id: parsed.accountId, contact_id: contactRow.id },
            { onConflict: "account_id,contact_id", ignoreDuplicates: false },
          )
          .select("id, unread_count")
          .single();

        if (!convRow) return new Response("conversation upsert failed", { status: 500 });

        // Insert message
        await supabaseAdmin.from("messages").insert({
          conversation_id: convRow.id,
          direction: "in",
          type: parsed.type,
          body: parsed.body ?? null,
          media_url: parsed.mediaUrl ?? null,
          status: "delivered",
          wa_message_id: parsed.waMessageId ?? null,
          created_at: parsed.timestamp ?? new Date().toISOString(),
        });

        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: (parsed.body ?? `[${parsed.type}]`).slice(0, 120),
            unread_count: (convRow.unread_count ?? 0) + 1,
          })
          .eq("id", convRow.id);

        // Auto-reply pipeline (rule engine + AI fallback)
        try {
          if (isGroup) {
            console.log("[wa/message] skip auto-reply (group chat)", { from: parsed.from });
          } else {
            console.log("[wa/message] running auto-reply", { from: parsed.from, conversationId: convRow.id });
            await runAutoReply({
            accountId: parsed.accountId,
            conversationId: convRow.id,
            from: parsed.from,
            incomingBody: parsed.body ?? "",
            supabaseAdmin,
            });
          }
        } catch (e) {
          console.error("[auto-reply] failed:", (e as Error).message);
        }

        return Response.json({ ok: true });
      },
    },
  },
});

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function runAutoReply(args: {
  accountId: string;
  conversationId: string;
  from: string;
  incomingBody: string;
  supabaseAdmin: AdminClient;
}) {
  const { accountId, conversationId, from, incomingBody, supabaseAdmin } = args;

  const { data: acct } = await supabaseAdmin
    .from("wa_accounts")
    .select("auto_reply_enabled, ai_enabled, ai_prompt, status")
    .eq("id", accountId)
    .maybeSingle();

  if (!acct || !acct.auto_reply_enabled || acct.status !== "connected") return;

  // 1. Match rules
  const { data: rules } = await supabaseAdmin
    .from("reply_rules")
    .select("trigger_type, pattern, response_template, priority")
    .eq("account_id", accountId)
    .eq("enabled", true)
    .order("priority", { ascending: false });

  const text = (incomingBody || "").trim();
  const lower = text.toLowerCase();
  let reply: string | null = null;

  for (const r of rules ?? []) {
    const pattern = (r.pattern ?? "").trim();
    if (r.trigger_type === "any") {
      reply = r.response_template;
      break;
    }
    if (!pattern) continue;
    if (r.trigger_type === "keyword") {
      const kws = pattern.split(",").map((k: string) => k.trim().toLowerCase()).filter(Boolean);
      if (kws.some((k: string) => lower.includes(k))) {
        reply = r.response_template;
        break;
      }
    } else if (r.trigger_type === "regex") {
      try {
        if (new RegExp(pattern, "i").test(text)) {
          reply = r.response_template;
          break;
        }
      } catch {
        // ignore invalid regex
      }
    }
  }

  // 2. AI fallback
  if (!reply && acct.ai_enabled && text) {
    // Fetch last ~10 messages of this conversation for context
    const { data: history } = await supabaseAdmin
      .from("messages")
      .select("direction, body, created_at")
      .eq("conversation_id", conversationId)
      .not("body", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);

    const chatHistory = (history ?? [])
      .reverse()
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.body as string,
      }));

    reply = await generateAiReply(acct.ai_prompt ?? "", chatHistory, text);
  }

  if (!reply) return;

  // 3. Send via bridge + log outbound message
  const { bridge } = await import("@/lib/bridge.server");
  const { data: msg } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "out",
      type: "text",
      body: reply,
      status: "pending",
    })
    .select("id")
    .single();

  try {
    const result = await bridge.send(accountId, { to: from, type: "text", body: reply });
    if (msg) {
      await supabaseAdmin
        .from("messages")
        .update({ status: "sent", wa_message_id: result.wa_message_id })
        .eq("id", msg.id);
    }
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: reply.slice(0, 120),
      })
      .eq("id", conversationId);
  } catch (e) {
    if (msg) {
      await supabaseAdmin.from("messages").update({ status: "failed" }).eq("id", msg.id);
    }
    throw e;
  }
}

async function generateAiReply(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userText: string,
): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.warn("[auto-reply] LOVABLE_API_KEY missing — skipping AI reply");
    return null;
  }
  const system =
    (systemPrompt?.trim() ||
      "You are a helpful WhatsApp assistant. Reply concisely in the same language as the user.") +
    "\n\nIMPORTANT: Read the user's latest message carefully and the prior conversation context. Understand intent before replying. Keep the reply short, relevant, and natural — no greetings unless the user greeted first.";

  // Ensure last message is the current user text (avoid duplicate if history already contains it)
  const msgs = [...history];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user" || last.content !== userText) {
    msgs.push({ role: "user", content: userText });
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: system }, ...msgs],
      }),
    });
    if (!res.ok) {
      console.error("[auto-reply] AI gateway error:", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[auto-reply] AI call failed:", (e as Error).message);
    return null;
  }
}