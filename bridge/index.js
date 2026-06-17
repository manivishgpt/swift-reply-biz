import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

const app = express();
// Capture the raw body string so HMAC verification matches exactly what the client signed.
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.length ? buf.toString('utf8') : '';
  },
}));

const PORT = process.env.PORT || 3000;
const BRIDGE_SHARED_SECRET = process.env.BRIDGE_SHARED_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // dashboard's message callback
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BRIDGE_SHARED_SECRET) {
  console.warn("WARNING: BRIDGE_SHARED_SECRET environment variable is not set!");
}

// Force stdout to be unbuffered/synchronous so Docker `docker logs` shows
// every line immediately instead of batching them behind pino's JSON output.
try {
  if (process.stdout._handle && typeof process.stdout._handle.setBlocking === 'function') {
    process.stdout._handle.setBlocking(true);
  }
  if (process.stderr._handle && typeof process.stderr._handle.setBlocking === 'function') {
    process.stderr._handle.setBlocking(true);
  }
} catch {}

// Direct, formatted writers that bypass any logger and always hit stdout.
function logBlock(lines) {
  process.stdout.write('\n' + lines.join('\n') + '\n');
}

function logIncomingMessage({ accountId, phone, jid, pushName, type, body, ts }) {
  logBlock([
    '========================',
    'INCOMING MESSAGE',
    '================',
    '',
    `Account ID : ${accountId}`,
    `From Phone : ${phone}`,
    `From JID   : ${jid}`,
    `Push Name  : ${pushName || '(unknown)'}`,
    `Type       : ${type}`,
    `Message    : ${(body ?? '').toString().slice(0, 1000)}`,
    `Time       : ${ts}`,
    '=================================',
  ]);
}

function logOutgoingMessage({ accountId, fromPhone, toPhone, type, body, ts }) {
  logBlock([
    '========================',
    'OUTGOING MESSAGE',
    '================',
    '',
    `Account ID : ${accountId}`,
    `From Phone : ${fromPhone}`,
    `To Phone   : ${toPhone}`,
    `Type       : ${type}`,
    `Message    : ${(body ?? '').toString().slice(0, 1000)}`,
    `Time       : ${ts}`,
    '=================================',
  ]);
}

// In-memory active sockets and QR states
const sessions = {};
// Baileys is very chatty at 'info'. Quiet it to 'warn' so our INCOMING/OUTGOING
// blocks are not buried under hundreds of JSON lines in Docker logs.
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });
let sendEndpointHitCount = 0;

// Global request tracer — logs EVERY hit, even before signature verification.
app.use((req, _res, next) => {
  console.log(`[HTTP IN] ${req.method} ${req.path}`);
  next();
});

// Verify incoming request signature from Wapix dashboard
function verifySignature(req, res, next) {
  const signature = req.headers['x-wapix-signature'];
  console.log(`[HTTP] ${req.method} ${req.path}`, {
    hasSignature: Boolean(signature),
    bodyPreview: (req.rawBody ?? '').slice(0, 300),
  });
  if (!BRIDGE_SHARED_SECRET) return next(); // skip verification if not configured for testing
  
  if (!signature) {
    console.warn(`[HTTP] ${req.method} ${req.path} -> 401 missing signature`);
    return res.status(401).send("Unauthorized: Missing signature");
  }

  const bodyStr = req.rawBody ?? '';
  const expected = createHmac('sha256', BRIDGE_SHARED_SECRET).update(bodyStr).digest('hex');

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      console.warn(`[HTTP] ${req.method} ${req.path} -> 401 invalid signature`, {
        got: String(signature).slice(0, 12) + '…',
        expected: expected.slice(0, 12) + '…',
        bodyLen: bodyStr.length,
      });
      return res.status(401).send("Unauthorized: Invalid signature");
    }
  } catch (e) {
    console.warn(`[HTTP] ${req.method} ${req.path} -> 401 signature compare error`, e.message);
    return res.status(401).send("Unauthorized");
  }
  next();
}

// Helper to sign webhook requests sent to Wapix
function signBody(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function sendWebhook(endpoint, payload) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.log(`[Webhook Skipped] No WEBHOOK_URL or WEBHOOK_SECRET set. Event: ${endpoint}`, payload);
    return;
  }

  const url = `${WEBHOOK_URL.replace(/\/$/, '')}${endpoint}`;
  const body = JSON.stringify(payload);
  const signature = signBody(WEBHOOK_SECRET, body);

  console.log(`[Webhook ->] ${endpoint}`, {
    url,
    bodyLen: body.length,
    payloadPreview: body.slice(0, 400),
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wapix-Signature': signature
      },
      body
    });
    if (!res.ok) {
      console.error(`[Webhook Failed] ${endpoint} returned status ${res.status}: ${await res.text()}`);
    } else {
      console.log(`[Webhook Success] ${endpoint}`);
    }
  } catch (err) {
    console.error(`[Webhook Error] Failed to trigger ${url}:`, err.message);
  }
}

// Initialize/Start a WhatsApp Baileys session
async function startWhatsAppSession(accountId, { reset = false } = {}) {
  if (reset && sessions[accountId]) {
    try { await sessions[accountId].sock.logout(); } catch {}
    try { sessions[accountId].sock.end?.(); } catch {}
    delete sessions[accountId];
  }
  if (reset) {
    const authFolder = path.join(process.cwd(), 'auth_states', accountId);
    try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
  }
  if (sessions[accountId]) {
    return sessions[accountId];
  }

  console.log(`Initializing Baileys session for account: ${accountId}`);
  const authFolder = path.join(process.cwd(), 'auth_states', accountId);
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger
  });

  const session = {
    sock,
    qr: null,
    status: 'connecting',
    phone: null
  };
  sessions[accountId] = session;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.qr = qr;
      session.status = 'qr';
      await sendWebhook('/api/public/wa/status', { accountId, status: 'qr' });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`Connection closed for ${accountId}. Reason: ${lastDisconnect?.error}. Reconnecting: ${shouldReconnect}`);
      
      session.status = 'disconnected';
      await sendWebhook('/api/public/wa/status', { accountId, status: 'disconnected' });

      if (shouldReconnect) {
        // Clean up memory reference before rebuilding
        delete sessions[accountId];
        startWhatsAppSession(accountId);
      } else {
        // Logged out: wipe credentials folder
        console.log(`Logged out of WhatsApp. Cleaning credentials directory for ${accountId}`);
        try {
          fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to wipe credentials folder for ${accountId}:`, e.message);
        }
        delete sessions[accountId];
      }
    } else if (connection === 'open') {
      session.qr = null;
      session.status = 'connected';
      
      const phone = sock.user?.id?.split(':')[0] || '';
      session.phone = phone;
      
      console.log(`WhatsApp Session Connected: ${phone}`);
      await sendWebhook('/api/public/wa/status', { accountId, status: 'connected', phone });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    console.log(`[messages.upsert] account=${accountId} type=${m.type} count=${m.messages?.length ?? 0}`);
    for (const msg of m.messages) {
      if (msg.key.fromMe) {
        console.log(`[messages.upsert] skip fromMe to=${msg.key.remoteJid} id=${msg.key.id}`);
        continue;
      }
      if (m.type !== 'notify') {
        console.log(`[messages.upsert] non-notify type=${m.type} from=${msg.key.remoteJid} id=${msg.key.id} keys=${Object.keys(msg.message ?? {}).join(',') || '(none)'}`);
        // still continue to log/forward so we can see history-sync or append events
      }

      const from = msg.key.remoteJid;
      const display_name = msg.pushName || '';
      const phone = from.split('@')[0];

      let body = '';
      let type = 'text';
      let mediaUrl = null;

      // Unwrap ephemeral / viewOnce wrappers so we read the real payload.
      const inner =
        msg.message?.ephemeralMessage?.message ||
        msg.message?.viewOnceMessage?.message ||
        msg.message?.viewOnceMessageV2?.message ||
        msg.message?.viewOnceMessageV2Extension?.message ||
        msg.message ||
        {};

      if (inner.conversation) {
        body = inner.conversation;
      } else if (inner.extendedTextMessage?.text) {
        body = inner.extendedTextMessage.text;
      } else if (inner.imageMessage) {
        type = 'image';
        body = inner.imageMessage.caption || '[image]';
      } else if (inner.videoMessage) {
        type = 'video';
        body = inner.videoMessage.caption || '[video]';
      } else if (inner.audioMessage) {
        type = 'audio';
        body = inner.audioMessage.ptt ? '[voice note]' : '[audio]';
      } else if (inner.documentMessage) {
        type = 'document';
        body = inner.documentMessage.fileName
          ? `[document] ${inner.documentMessage.fileName}${inner.documentMessage.caption ? ' — ' + inner.documentMessage.caption : ''}`
          : '[document]';
      } else if (inner.stickerMessage) {
        type = 'sticker';
        body = '[sticker]';
      } else if (inner.locationMessage) {
        type = 'location';
        body = `[location] ${inner.locationMessage.degreesLatitude},${inner.locationMessage.degreesLongitude}`;
      } else if (inner.contactMessage) {
        type = 'contact';
        body = `[contact] ${inner.contactMessage.displayName ?? ''}`;
      } else if (inner.buttonsResponseMessage) {
        body = inner.buttonsResponseMessage.selectedDisplayText || inner.buttonsResponseMessage.selectedButtonId || '[button response]';
      } else if (inner.listResponseMessage) {
        body = inner.listResponseMessage.title || inner.listResponseMessage.singleSelectReply?.selectedRowId || '[list response]';
      } else if (inner.reactionMessage) {
        type = 'system';
        body = `[reaction] ${inner.reactionMessage.text ?? ''}`;
      } else {
        type = 'system';
        body = `[unknown type] keys=${Object.keys(inner).join(',') || '(empty)'}`;
      }

      const isGroup = from.endsWith('@g.us');
      const incomingTs = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString();
      logIncomingMessage({
        accountId,
        phone,
        jid: from,
        pushName: display_name,
        type,
        body,
        ts: incomingTs,
      });
      if (isGroup) {
        process.stdout.write(`(group message, waMsgId=${msg.key.id})\n`);
      }

      await sendWebhook('/api/public/wa/message', {
        accountId,
        from,
        fromName: display_name,
        fromPhone: phone,
        body,
        type,
        mediaUrl,
        waMessageId: msg.key.id,
        timestamp: incomingTs
      });
    }
  });

  return session;
}

// ---------------- REST API ----------------

// 1. Start session
app.post('/sessions', verifySignature, async (req, res) => {
  const { accountId, reset } = req.body;
  if (!accountId) return res.status(400).send("accountId is required");
  
  try {
    await startWhatsAppSession(accountId, { reset: Boolean(reset) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Get QR Code or Status
app.get('/sessions/:accountId/qr', verifySignature, (req, res) => {
  const { accountId } = req.params;
  const session = sessions[accountId];
  if (!session) {
    return res.status(404).json({ status: 'not_found' });
  }
  res.json({
    status: session.status,
    qr: session.qr
  });
});

// 3. Status check
app.get('/sessions/:accountId/status', verifySignature, (req, res) => {
  const { accountId } = req.params;
  const session = sessions[accountId];
  if (!session) {
    return res.status(404).json({ status: 'not_found' });
  }
  res.json({
    status: session.status,
    phone: session.phone
  });
});

// 4. Logout / Delete session
app.delete('/sessions/:accountId', verifySignature, async (req, res) => {
  const { accountId } = req.params;
  const session = sessions[accountId];
  if (!session) return res.json({ ok: true, status: 'already_deleted' });

  try {
    await session.sock.logout();
    res.json({ ok: true });
  } catch (e) {
    // If socket is already broken, just wipe memory state
    delete sessions[accountId];
    res.json({ ok: true, error: e.message });
  }
});

// 5. Send Message
app.post('/sessions/:accountId/send', verifySignature, async (req, res) => {
  const { accountId } = req.params;
  const { to, type, body, mediaUrl } = req.body;
  const reqTs = new Date().toISOString();
  sendEndpointHitCount++;

  console.log(
    `\n[SEND REQUEST] ${reqTs}\n` +
    `  accountId : ${accountId}\n` +
    `  to        : ${to}\n` +
    `  type      : ${type}\n` +
    `  body      : ${(body ?? '').slice(0, 500)}\n` +
    `  mediaUrl  : ${mediaUrl ?? '(none)'}\n`
  );

  const session = sessions[accountId];
  if (!session || session.status !== 'connected') {
    const errMsg = `WhatsApp session is not connected (exists=${Boolean(session)}, status=${session?.status ?? 'none'})`;
    console.warn(
      `\n❌ MESSAGE FAILED\n` +
      `From  : (session not ready)\n` +
      `To    : ${to}\n` +
      `Error : ${errMsg}\n`
    );
    const respBody = { error: errMsg };
    console.log(`[SEND RESPONSE] status=400 body=${JSON.stringify(respBody)} time=${new Date().toISOString()}`);
    return res.status(400).json(respBody);
  }

  const fromPhone = session.phone || '(unknown)';
  const toPhone = (to || '').split('@')[0];
  logOutgoingMessage({
    accountId,
    fromPhone,
    toPhone,
    type,
    body,
    ts: reqTs,
  });

  try {
    console.log(`[bridge] -> calling sendMessage to=${to} type=${type}`);
    let sentMsg;
    if (type === 'image' && mediaUrl) {
      sentMsg = await session.sock.sendMessage(to, { image: { url: mediaUrl }, caption: body });
    } else {
      sentMsg = await session.sock.sendMessage(to, { text: body });
    }

    console.log(
      `\n✅ MESSAGE SENT\n` +
      `From : ${fromPhone}\n` +
      `To   : ${to}\n` +
      `ID   : ${sentMsg.key.id}\n`
    );
    const respBody = { wa_message_id: sentMsg.key.id };
    console.log(`[SEND RESPONSE] status=200 body=${JSON.stringify(respBody)} time=${new Date().toISOString()}`);
    res.json(respBody);
  } catch (e) {
    console.error(
      `\n❌ MESSAGE FAILED\n` +
      `From  : ${fromPhone}\n` +
      `To    : ${to}\n` +
      `Error : ${e.message}\n` +
      `Stack : ${e.stack}\n`
    );
    const respBody = { error: e.message };
    console.log(`[SEND RESPONSE] status=500 body=${JSON.stringify(respBody)} time=${new Date().toISOString()}`);
    res.status(500).json(respBody);
  }
});

// Root Health check
app.get('/', (req, res) => {
  res.send('WhatsApp Bridge is healthy and running!');
});

// Auto-restore active session files on start if directory exists
async function restoreSessions() {
  const authDir = path.join(process.cwd(), 'auth_states');
  if (fs.existsSync(authDir)) {
    const folders = fs.readdirSync(authDir);
    for (const folder of folders) {
      if (fs.statSync(path.join(authDir, folder)).isDirectory()) {
        try {
          console.log(`Auto-restoring session for: ${folder}`);
          await startWhatsAppSession(folder);
        } catch (e) {
          console.error(`Failed restoring session for ${folder}:`, e.message);
        }
      }
    }
  }
}

app.listen(PORT, async () => {
  console.log(`WhatsApp Bridge listening on port ${PORT}`);
  console.log(`[BOOT CONFIG]`, {
    hasSharedSecret: Boolean(BRIDGE_SHARED_SECRET),
    webhookUrl: WEBHOOK_URL || '(unset)',
    hasWebhookSecret: Boolean(WEBHOOK_SECRET),
  });
  await restoreSessions();

  // Watchdog: warn if no dashboard ever calls /sessions/:accountId/send
  setTimeout(() => {
    if (!sendEndpointHitCount) {
      console.warn(
        `\n⚠️  WARNING: No send requests received yet.\n` +
        `   The dashboard is NOT calling POST /sessions/:accountId/send on this bridge.\n` +
        `   Verify BRIDGE_URL in the dashboard env points to this bridge instance.\n`
      );
    }
  }, 60_000);
});
