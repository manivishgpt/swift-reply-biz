## Goal
Make sure (1) every incoming WhatsApp message is logged on the bridge with full sender info, and (2) we can clearly see whether dashboard replies are reaching the bridge — and why they're not, if they aren't.

## Root-cause hypotheses
- **Incoming info missing**: `bridge/index.js` `messages.upsert` returns early when `m.type !== 'notify'` and silently skips `fromMe` / unknown payload shapes. Some Baileys events arrive with `type: 'append'` (e.g. ephemeral, view-once, reactions, edits) so the INCOMING MESSAGE block never prints. The current `body` extraction also ignores `ephemeralMessage`, `viewOnceMessage`, `buttonsResponseMessage`, `listResponseMessage`, `documentMessage`, `audioMessage`, `videoMessage`, `stickerMessage`, `locationMessage`, `contactMessage` → such messages log nothing useful.
- **Reply not reaching bridge**: dashboard either (a) never calls `bridge.send` (server-fn error before that), (b) calls a wrong/stale `BRIDGE_BASE_URL`, or (c) gets 401 from signature mismatch. There's no single startup log on the dashboard saying which bridge URL it's pointing to, so we can't tell which case it is.

## Changes

### 1. `bridge/index.js` — always log every incoming event
- Remove the silent `m.type !== 'notify'` early return; instead log `[messages.upsert] received type=<x> count=<n>` for every event, then only skip processing (still log a one-liner) for non-notify types.
- For `fromMe` messages, log a single `[messages.upsert] skip fromMe to=<jid> id=<id>` line (already partly there) and continue.
- Expand the body/type extractor to cover: `ephemeralMessage.message`, `viewOnceMessage.message`, `viewOnceMessageV2.message`, `documentMessage` (filename + caption), `audioMessage`, `videoMessage` (caption), `stickerMessage`, `locationMessage` (lat,lng), `contactMessage` (displayName), `buttonsResponseMessage.selectedDisplayText`, `listResponseMessage.title`, `reactionMessage.text`. Anything still unknown logs `Type: unknown` plus `Object.keys(msg.message ?? {})` so we see what arrived.
- Print the formatted INCOMING MESSAGE block for every processed message (group or not). The dashboard already decides whether to auto-reply.

### 2. `bridge/index.js` — confirm outgoing path is reachable
- On boot, log the resolved `BRIDGE_SHARED_SECRET` presence and `WEBHOOK_URL` so the operator can confirm config in one glance.
- Add a global `app.use((req,_res,next)=>{ console.log('[HTTP IN]', req.method, req.path); next(); })` before routes so any request — even one that fails signature — is visible. This will instantly tell us whether the dashboard is hitting the bridge at all.

### 3. `src/lib/bridge.server.ts` — surface dashboard-side config
- On first call, log a one-time `[bridge] config` line with `BRIDGE_BASE_URL` (URL only, not secret) and a boolean `hasSecret`. This lets us confirm in worker logs which bridge the dashboard is actually targeting.
- Keep existing request/response logs.

### 4. `src/lib/inbox.functions.ts` — no logic change
Already has detailed `[sendMessage]` logs; leave as-is.

## Verification steps (after deploy + bridge redeploy)
1. Send a WhatsApp message from a phone → bridge logs must show `[HTTP IN]` (none expected, it's incoming) and a full `INCOMING MESSAGE` block with name/phone/JID/body.
2. Click Send in the dashboard Inbox →
   - Dashboard logs: `[sendMessage] start` → `[bridge] config` (first call) → `[bridge] -> request` → `[bridge] <- response`.
   - Bridge logs: `[HTTP IN] POST /sessions/<id>/send` → `[SEND REQUEST]` → `OUTGOING MESSAGE` → `✅ MESSAGE SENT` and `[SEND RESPONSE] status=200`.
3. If bridge shows no `[HTTP IN]` for the send, the dashboard's `BRIDGE_BASE_URL` is wrong — the `[bridge] config` log in the dashboard tells us exactly which URL it called.

## Out of scope
- No DB / schema changes.
- No UI changes.
- Auto-reply rule logic untouched.
