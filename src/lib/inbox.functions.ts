import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        body: z.string().trim().min(1).max(4096),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    console.log("[sendMessage] start", { conversationId: data.conversationId, userId, bodyLen: data.body.length });

    // Load conversation + account
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, account_id, contact_id, contacts(wa_jid)")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convErr) { console.error("[sendMessage] conv load error", convErr); throw new Error(convErr.message); }
    if (!conv) { console.error("[sendMessage] conversation not found", data.conversationId); throw new Error("Conversation not found"); }

    const waJid = (conv as { contacts: { wa_jid: string } | null }).contacts?.wa_jid;
    const accountId = (conv as { account_id: string }).account_id;
    console.log("[sendMessage] resolved", { accountId, waJid });
    if (!waJid) { console.error("[sendMessage] missing wa_jid"); throw new Error("Contact has no WhatsApp JID"); }

    // Insert pending message
    const { data: msg, error: insErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        direction: "out",
        type: "text",
        body: data.body,
        status: "pending",
        sent_by_user_id: userId,
      })
      .select("id")
      .single();
    if (insErr) { console.error("[sendMessage] insert pending failed", insErr); throw new Error(insErr.message); }
    console.log("[sendMessage] pending message inserted", { messageId: msg.id });

    // Send via bridge
    try {
      const { bridge } = await import("./bridge.server");
      console.log("[sendMessage] calling bridge.send", { accountId, to: waJid, type: "text" });
      const result = await bridge.send(accountId, {
        to: waJid,
        type: "text",
        body: data.body,
      });
      console.log("[sendMessage] bridge.send OK", { wa_message_id: result.wa_message_id });
      await supabase
        .from("messages")
        .update({ status: "sent", wa_message_id: result.wa_message_id })
        .eq("id", msg.id);
    } catch (e) {
      console.error("[sendMessage] bridge.send FAILED", e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e);
      await supabase
        .from("messages")
        .update({ status: "failed" })
        .eq("id", msg.id);
      throw e;
    }

    // Touch conversation preview
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: data.body.slice(0, 120),
      })
      .eq("id", data.conversationId);

    return { ok: true };
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });