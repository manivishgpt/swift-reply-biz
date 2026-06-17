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

// In-memory active sockets and QR states
const sessions = {};
const logger = pino({ level: 'info' });

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
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
      if (msg.key.fromMe) {
        console.log(`[messages.upsert] skip fromMe id=${msg.key.id}`);
        continue;
      }

      const from = msg.key.remoteJid;
      const display_name = msg.pushName || '';
      const phone = from.split('@')[0];

      let body = '';
      let type = 'text';
      let mediaUrl = null;

      if (msg.message?.conversation) {
        body = msg.message.conversation;
      } else if (msg.message?.extendedTextMessage?.text) {
        body = msg.message.extendedTextMessage.text;
      } else if (msg.message?.imageMessage) {
        type = 'image';
        body = msg.message.imageMessage.caption || '';
        // Note: Real media download and host is out-of-scope for simple bridge templates. 
        // A production implementation would download from Baileys & upload to S3/Cloud Storage.
      } else {
        type = 'system';
        body = '[Other Message Type]';
      }

      const isGroup = from.endsWith('@g.us');
      console.log(`[INCOMING MSG]`, {
        accountId,
        from,
        fromName: display_name,
        fromPhone: phone,
        isGroup,
        type,
        waMessageId: msg.key.id,
        bodyLen: body.length,
        body: body.slice(0, 500),
      });

      await sendWebhook('/api/public/wa/message', {
        accountId,
        from,
        fromName: display_name,
        fromPhone: phone,
        body,
        type,
        mediaUrl,
        waMessageId: msg.key.id,
        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString()
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

  console.log(`[SEND REQUEST]`, {
    accountId,
    to,
    type,
    bodyLen: body?.length ?? 0,
    bodyPreview: (body ?? '').slice(0, 300),
    mediaUrl: mediaUrl ?? null,
  });

  const session = sessions[accountId];
  if (!session || session.status !== 'connected') {
    console.warn(`[SEND BLOCKED] session not connected`, {
      accountId,
      exists: Boolean(session),
      status: session?.status,
    });
    return res.status(400).send("WhatsApp session is not connected");
  }

  try {
    let sentMsg;
    if (type === 'image' && mediaUrl) {
      sentMsg = await session.sock.sendMessage(to, { image: { url: mediaUrl }, caption: body });
    } else {
      sentMsg = await session.sock.sendMessage(to, { text: body });
    }

    console.log(`[SEND OK]`, { accountId, to, wa_message_id: sentMsg.key.id });
    res.json({ wa_message_id: sentMsg.key.id });
  } catch (e) {
    console.error(`[SEND FAILED]`, { accountId, to, error: e.message, stack: e.stack });
    res.status(500).json({ error: e.message });
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
  await restoreSessions();
});
