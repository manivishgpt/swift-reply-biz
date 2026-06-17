
# WhatsApp Automation Tool — Build Plan

## Architecture overview

Lovable is the **dashboard + brain**. A separate **Baileys bridge service** (you self-host on Render/Railway/VPS) holds the WhatsApp socket(s) and talks to Lovable over HTTPS.

```text
 WhatsApp <--socket--> Baileys Bridge (your VPS)  <--webhooks-->  Lovable (this app)
                              |  REST                                    |
                              +<------ outbound send / QR fetch --------+
                                              Postgres (Lovable Cloud)
                                              Auth, RLS, AI, UI
```

- Bridge stores only WhatsApp auth-state files locally; all business data lives in Lovable Cloud (Postgres).
- Multi-account = multiple Baileys sessions in the bridge, one row per account in Lovable.
- Auth between bridge and Lovable: shared `BRIDGE_SHARED_SECRET` + HMAC signature on every webhook.

## Scope for v1 (in this Lovable project)

1. **Auth & team** — email/password + Google sign-in, profiles (name, avatar), roles `admin` / `agent` in a separate `user_roles` table with `has_role()` security-definer function.
2. **WhatsApp accounts** — connect/disconnect, show QR (fetched from bridge), status (connected/disconnected/banned), assign accounts to agents.
3. **Shared inbox** — conversations list, message thread, send text/image, assignment to agent, unread counts, realtime updates via Supabase Realtime.
4. **CRM** — contacts (auto-created from incoming msgs), tags, notes, pipeline stages (New / Qualified / Customer / Lost), contact detail page with full chat history.
5. **Auto-reply engine**
   - Rule-based: keyword/regex → template reply, with business-hours and per-account toggles.
   - AI fallback: Lovable AI (`google/gemini-3-flash-preview`) using a per-account system prompt + last N messages + business context snippets. Handoff-to-human trigger words.
6. **Broadcasts** — pick contacts by tag/segment, compose message (text + 1 media), schedule, throttled send queue (bridge enforces rate limit), per-recipient delivery status.
7. **Outbound API** — `POST /api/public/v1/send` with per-user API key so external systems can trigger sends through Lovable → bridge.
8. **Settings** — bridge URL, shared secret, per-account AI prompt, business hours, rate limits.

Out of scope for v1 (call out): voice/video calls, WhatsApp Groups admin, payments, multi-language UI, analytics dashboards beyond basic counters.

## Database (Lovable Cloud / Postgres)

All tables with `GRANT` + RLS as required by platform rules.

- `profiles` (id=auth.uid, full_name, avatar_url) — trigger on signup.
- `user_roles` (user_id, role enum `admin|agent`) + `has_role()` SECURITY DEFINER.
- `wa_accounts` (id, owner_user_id, label, phone, status, last_qr_at, ai_prompt, auto_reply_enabled, business_hours jsonb).
- `wa_account_agents` (account_id, agent_user_id) — who can see which inbox.
- `contacts` (id, account_id, wa_jid, display_name, phone, pipeline_stage, notes, created_at).
- `contact_tags` (contact_id, tag).
- `conversations` (id, account_id, contact_id, assigned_agent_id, unread_count, last_message_at).
- `messages` (id, conversation_id, direction `in|out`, type, body, media_url, status, wa_message_id, created_at, sent_by_user_id, sent_by_ai bool).
- `reply_rules` (id, account_id, name, trigger_type `keyword|regex`, pattern, response_template, priority, enabled).
- `broadcasts` (id, account_id, created_by, body, media_url, status, scheduled_at, throttle_per_min).
- `broadcast_recipients` (broadcast_id, contact_id, status, error, sent_at).
- `api_keys` (id, user_id, hashed_key, label, last_used_at).
- `webhook_events` (id, kind, payload jsonb, processed_at, error) — idempotency + audit.

RLS: agents see only conversations for accounts in `wa_account_agents`; admins see all. `user_roles` is auth-only.

## Lovable ↔ Bridge contract (you'll implement the bridge separately)

**Lovable → Bridge** (calls bridge REST, signed with shared secret):

| Endpoint | Purpose |
|---|---|
| `POST /sessions` `{accountId}` | start a new WhatsApp session |
| `GET  /sessions/:id/qr` | poll QR string until paired |
| `DELETE /sessions/:id` | logout |
| `POST /sessions/:id/send` `{to, type, body, mediaUrl}` | send message |
| `GET  /sessions/:id/status` | connected / disconnected / banned |

**Bridge → Lovable webhooks** (public TSS routes under `/api/public/wa/*`, HMAC verified):

| Path | Payload |
|---|---|
| `POST /api/public/wa/message` | incoming message (account, from, body, media, wa_message_id, ts) |
| `POST /api/public/wa/status` | account status change |
| `POST /api/public/wa/delivery` | sent/delivered/read receipts |

Incoming message handler → upserts contact + conversation, inserts message, then runs the auto-reply pipeline (rules first, AI fallback if enabled and outside business-hours rules don't fire), then calls bridge `/send` for the reply.

## Tech mapping (TanStack Start)

- **Server functions** (`src/lib/*.functions.ts`) for app-internal: list conversations, send message, create rule, run broadcast tick, etc. All use `requireSupabaseAuth`.
- **Public server routes** (`src/routes/api/public/wa/*.ts`) for bridge webhooks — HMAC-verify the body, then write via `supabaseAdmin` (loaded inside handler).
- **Outbound API** (`src/routes/api/public/v1/send.ts`) — auth by `Authorization: Bearer <api-key>`, lookup hashed key, enforce per-user account ownership, forward to bridge.
- **AI** via Lovable AI Gateway, `google/gemini-3-flash-preview`, called from a server function with the conversation context.
- **Realtime** via Supabase Realtime subscription on `messages` and `conversations` so the inbox updates live.
- **Routes**: `/auth`, then under `_authenticated/`: `/inbox`, `/inbox/:conversationId`, `/contacts`, `/contacts/:id`, `/accounts`, `/accounts/:id`, `/rules`, `/broadcasts`, `/broadcasts/new`, `/settings`, `/api-keys`. Admin-only nested layout for `/accounts`, `/rules`, `/api-keys`, `/settings`.

## Secrets needed

- `BRIDGE_BASE_URL`, `BRIDGE_SHARED_SECRET` — for talking to your self-hosted Baileys.
- `WEBHOOK_SECRET` — HMAC for incoming webhooks from bridge.
- `LOVABLE_API_KEY` — auto-provisioned for AI.

## Build phases (so you see value fast)

1. Enable Lovable Cloud; auth + profiles + roles; empty dashboard shell with nav.
2. `wa_accounts` table + accounts page with mocked connect flow (QR placeholder, manual status toggle) — proves the UI before the bridge exists.
3. Webhook endpoints + send-message server fn wired to a configurable bridge URL; contacts/conversations/messages tables; inbox UI with realtime.
4. Reply rules engine + AI auto-reply with per-account prompt.
5. Broadcasts (compose, schedule, throttled sender driven by a server function you can trigger from a cron URL).
6. Outbound REST API + API key management.
7. Polish: business hours, handoff-to-human, agent assignment, basic counters.

## Design direction

Dashboard-heavy product (inbox + CRM). I'll skip design exploration and use a clean, dense SaaS dashboard look (sidebar nav, list+detail panes, neutral palette with one accent). If you want me to explore distinct visual directions first, say so and I'll generate options before phase 1.

## What I need from you to start building

- Approve this plan.
- Confirm: I'll deliver phases 1–3 in the first build pass and stop there for review, unless you say "do it all".
- Note: the Baileys bridge itself is **not** built by this Lovable project — I'll give you a separate minimal Node/Baileys reference (server.js, Dockerfile, env vars) you can drop on Render/Railway. Tell me if you want that reference included as a `bridge/` folder of docs in this repo or delivered as chat instructions.
