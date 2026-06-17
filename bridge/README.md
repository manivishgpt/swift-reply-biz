# self-hosted-baileys-bridge

A secure and minimal WhatsApp Baileys bridge API template. 
It enables the Wapix dashboard to scan QR codes, poll statuses, send messages, and receive real-time webhooks.

## 🚀 Easy Deployment to Render

To deploy this bridge to Render in 5 minutes:

### Step 1: Create a GitHub Repository
1. Create a new, **private** repository on GitHub (e.g., `whatsapp-bridge`).
2. Copy the files from your local `/bridge` directory in this workspace (`package.json`, `index.js`, `Dockerfile`) and push them to your new repo.

### Step 2: Set up a Render Web Service
1. Log in to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub account and select your newly created private repository.
4. Set the following details:
   - **Name**: `whatsapp-bridge`
   - **Language**: `Docker` (or `Node` if you prefer, but `Docker` is highly recommended for Baileys to handle system-level dependencies easily).
   - **Region**: Select a region close to your database.
   - **Instance Type**: **Starter** (requires paid tier because WhatsApp sockets require persistent processes that do not spin down on free tiers. Free tier will close sockets when idle).

### Step 3: Add Persistent Disk (CRITICAL)
WhatsApp sessions save credentials locally so you don't have to scan the QR code every time the server restarts.
1. Scroll down to **Advanced** or find **Disks** in Render dashboard.
2. Add a disk with:
   - **Name**: `auth-storage`
   - **Mount Path**: `/app/auth_states` (matches our file location)
   - **Size**: `1 GB` (or minimal)

### Step 4: Configure Environment Variables
In the **Environment** section of your Web Service in Render, add:

| Key | Value / Instructions |
|---|---|
| `PORT` | `3000` |
| `BRIDGE_SHARED_SECRET` | Create a strong, random password. Used to verify requests sent from your Lovable App to the bridge. |
| `WEBHOOK_SECRET` | Create another strong, random password. Used to verify webhooks sent from the bridge back to your Lovable App. |
| `WEBHOOK_URL` | Your live Lovable app URL (e.g., `https://your-app-id-preview.lovable.app` or your published custom domain). |

---

## 🔒 Connect to Lovable Cloud

Once Render is done deploying:
1. Copy the live Render service URL (e.g. `https://whatsapp-bridge.onrender.com`).
2. Open your Lovable dashboard, click on **View Backend** or go to Project Secrets.
3. Configure the following **Runtime Secrets**:
   - **`BRIDGE_BASE_URL`**: Your Render live URL (e.g., `https://whatsapp-bridge.onrender.com`)
   - **`BRIDGE_SHARED_SECRET`**: The same strong password you set on Render.
   - **`WEBHOOK_SECRET`**: The same webhook secret you set on Render.
