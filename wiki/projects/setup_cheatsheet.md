---
title: "New Project Setup Cheatsheet"
tags: ["setup", "supabase", "netlify", "gcp", "n8n", "pwa", "capacitor"]
description: "Step-by-step commands and URLs for wiring up a new React+Vite+Supabase+Netlify project from scaffold to live prototype"
updated: "2026-03-11"
---

# New Project Setup Cheatsheet

End-to-end steps to take a scaffolded project (React + Vite + Supabase + Netlify) from local code to live testable prototype. Written for StoryLoft but applies to any project on this stack.

---

## 1. Supabase — New Project

**URL:** https://supabase.com/dashboard

1. Click **New project**
2. Choose organization → enter project name → set a strong database password (save it)
3. Select region: **US West** (or closest to you)
4. Wait ~2 minutes for provisioning

### Get your keys
Settings → API:
- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public key** → `VITE_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never in client)

### Run migrations
SQL Editor → New query → paste contents of `supabase/migrations/001_initial_schema.sql` → Run

### Enable Google OAuth
Authentication → Providers → Google → Enable
- Add your Google OAuth Client ID + Secret (get from Google Cloud Console below)
- Redirect URL shown in Supabase → copy it for Google Cloud Console

### Enable email confirmations (optional for prototype)
Authentication → Email → toggle "Confirm email" on/off as needed for testing

---

## 2. Google Cloud Console — OAuth Credentials

**URL:** https://console.cloud.google.com

Only needed if using Google OAuth login (recommended).

1. Select or create a project
2. APIs & Services → Credentials → **Create Credentials** → OAuth client ID
3. Application type: **Web application**
4. Authorized redirect URIs → paste the URL from Supabase (ends in `/auth/v1/callback`)
5. Copy **Client ID** and **Client Secret** → paste into Supabase Google provider settings

---

## 3. Local .env Setup

In project root, copy `.env.example` → `.env` and fill in:

```bash
cp .env.example .env
```

Minimum for StoryLoft:
```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_APP_ENV=development
```

Server-side keys (go in Netlify dashboard, NOT in .env for production):
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
BREVO_API_KEY=xkeysib-...
```

---

## 4. Local Dev

```bash
cd /Users/jamesbeach/Documents/visual-studio-code/github-copilot/StoryLoft

npm install          # first time only
npm run dev          # starts Vite dev server at http://localhost:5173
npm run build        # production build — always run before deploying
npm run preview      # preview the production build locally
```

---

## 5. Netlify — New Site from GitHub

**URL:** https://app.netlify.com

1. **Add new site** → Import an existing project → GitHub
2. Select repository: `mindfu23/StoryLoft`
3. Build settings (auto-detected from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Click **Deploy site**

### Set environment variables
Site settings → Environment variables → Add:

| Key | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | from Supabase | public, safe |
| `VITE_SUPABASE_ANON_KEY` | from Supabase | public, safe |
| `VITE_APP_ENV` | `production` | public, safe |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase | secret — server only |
| `BREVO_API_KEY` | from Brevo | secret — server only |
| `RESEND_API_KEY` | from Resend | secret — server only |

After adding vars → **Trigger redeploy** (Deploys → Trigger deploy → Deploy site)

### Custom domain (optional)
Site settings → Domain management → Add custom domain

---

## 6. Brevo — Email Delivery

**URL:** https://app.brevo.com

1. Create free account
2. Settings → SMTP & API → API Keys → **Generate a new API key**
3. Copy key → add as `BREVO_API_KEY` in Netlify env vars
4. **Verify your sender domain** (important for deliverability):
   - Settings → Senders & IP → Domains → Add a domain
   - Add the DNS records they give you to your domain registrar
5. Free tier: **300 emails/day** — sufficient for prototype

### Resend (fallback)
**URL:** https://resend.com
1. Create account → API Keys → Create API Key
2. Add as `RESEND_API_KEY` in Netlify
3. Verify a domain here too for production sends

---

## 7. Sentry — Error Monitoring

**URL:** https://sentry.io

1. Create account → New Project → **React**
2. Copy the DSN (looks like `https://abc123@o123.ingest.sentry.io/456`)
3. Install: `npm install @sentry/react`
4. Add to `src/main.tsx`:
```typescript
import * as Sentry from '@sentry/react';
Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
```
5. Add `VITE_SENTRY_DSN` to `.env` and Netlify env vars
6. Free tier: 5,000 errors/month

---

## 8. n8n — Supabase Keep-Alive Ping

The n8n VM is already running at `35.188.141.23:5678`.

### Import the StoryLoft workflow
1. Open n8n at your instance URL
2. Workflows → **Import from file**
3. Select `n8n_workflows/workflows/storyloft-supabase-keepalive.json`

### Add environment variables in n8n
Settings → Variables (or edit `.env` on the VM):
```
STORYLOFT_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
STORYLOFT_SUPABASE_ANON_KEY=eyJhbGc...
```

### Activate
Open the imported workflow → toggle **Active** → it runs every 5 days automatically.

### SSH to VM if needed
```bash
gcloud compute ssh n8n-instance --zone=us-central1-a

# Restart n8n
cd /path/to/n8n && docker compose restart

# Check memory
free -h && docker stats --no-stream
```

---

## 9. GCP — If Starting a New VM (n8n or Cloud Run)

**URL:** https://console.cloud.google.com

### Always Free tier limits (as of 2026)
- **e2-micro** VM: 1 free/month in us-central1, us-east1, or us-west1
- **Cloud Run**: 2M requests/month free
- **Cloud Storage**: 5GB free

### Spin up e2-micro for n8n
```bash
gcloud compute instances create n8n-instance \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --tags=http-server,https-server
```

### Add swap (prevents OOM on 1GB RAM)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Deploy to Cloud Run (Python/FastAPI backend)
```bash
gcloud run deploy SERVICE_NAME \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars KEY=VALUE
```

---

## 10. PWA — iOS/Android Home Screen

Already configured in StoryLoft. For any new project:

**`public/manifest.json`** (minimum):
```json
{
  "name": "App Name",
  "short_name": "App",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4f46e5",
  "icons": [{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }]
}
```

**`index.html`** additions:
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#4f46e5" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="App Name" />
<link rel="apple-touch-icon" href="/icon.svg" />
```

To test on device: deploy to Netlify → open on phone → Share → Add to Home Screen.

---

## 11. Phase 3 — Capacitor (iOS/Android App)

When ready to wrap for App Store (not needed for prototype):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "App Name" com.yourcompany.appname --web-dir dist
npx cap add ios
npx cap add android
npm run build && npx cap sync
npx cap open ios     # opens Xcode
npx cap open android # opens Android Studio
```

**Before App Store submission:**
- Replace `public/icon.svg` with 1024×1024 PNG → run `flutter_launcher_icons` or Capacitor Assets
- Add `PrivacyInfo.xcprivacy` (iOS requirement)
- Set `usesNonExemptEncryption = false` in Xcode if no custom encryption
- Bump version in `package.json` + `Info.plist`
- Always open `.xcworkspace` not `.xcodeproj`

---

## 12. Pre-Deploy Checklist

Run before every Netlify deploy:

```bash
npm run build          # must pass clean
grep -r 'VITE_.*KEY' src/  # should return zero results (no API keys in client code)
```

Verify in Netlify dashboard:
- [ ] All env vars set (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, secrets)
- [ ] `netlify.toml` has SPA redirect (`/* → /index.html, 200`)
- [ ] `NODE_VERSION = "20"` in `[build.environment]`
- [ ] No `VITE_*_API_KEY` or `VITE_*_SECRET` in source code

---

## 13. Useful URLs Quick Reference

| Service | URL |
|---|---|
| Supabase dashboard | https://supabase.com/dashboard |
| Netlify dashboard | https://app.netlify.com |
| Google Cloud Console | https://console.cloud.google.com |
| Brevo dashboard | https://app.brevo.com |
| Resend dashboard | https://resend.com/overview |
| Sentry dashboard | https://sentry.io |
| n8n instance | http://35.188.141.23:5678 |
| StoryLoft GitHub | https://github.com/mindfu23/StoryLoft |
| n8n workflows GitHub | https://github.com/mindfu23/n8n_workflows |
| Novel data spreadsheet | https://docs.google.com/spreadsheets/d/1vSGcfSPmDKBUAvk7vJK7Y76PX5rJNr3L82ipCP5xsjI |
