# Telegram Time Tracker

A Telegram bot for employee work-time tracking with administrative monitoring. Built with Next.js 14+ (App Router), TypeScript, Supabase (PostgreSQL + Storage), and deployed to Vercel.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Supabase Setup](#supabase-setup)
3. [Vercel Deployment](#vercel-deployment)
4. [Environment Variables](#environment-variables)
5. [Telegram Webhook Registration](#telegram-webhook-registration)
6. [Verification](#verification)
7. [Local Development](#local-development)

---

## Prerequisites

Before deploying, make sure you have:

- A [Telegram bot token](https://core.telegram.org/bots/tutorial) obtained from [@BotFather](https://t.me/BotFather)
- A [Supabase](https://supabase.com) account
- A [Vercel](https://vercel.com) account connected to your Git repository
- Node.js 18+ and npm installed locally

---

## Supabase Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project** and fill in the project name, database password, and region.
3. Wait for the project to be provisioned (usually 1–2 minutes).

### 2. Apply the Database Schema

1. In your Supabase project, navigate to **SQL Editor**.
2. Click **New query**.
3. Copy the contents of `src/lib/db/schema.sql` from this repository and paste them into the editor.
4. Click **Run** to execute the DDL.
5. Verify that the following tables were created under **Table Editor**:
   - `users`
   - `projects`
   - `tasks`
   - `time_logs`
   - `attachments`
   - `sessions`

### 3. Create the Storage Bucket

1. In your Supabase project, navigate to **Storage**.
2. Click **New bucket**.
3. Set the bucket name to `task-attachments`.
4. Leave **Public bucket** unchecked (the bucket should be private; files are accessed via signed URLs).
5. Click **Save**.

### 4. Collect Supabase Credentials

From your Supabase project settings (**Settings → API**), note down:

- **Project URL** — used as `NEXT_PUBLIC_SUPABASE_URL`
- **service_role** key (under *Project API keys*) — used as `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ The `service_role` key bypasses Row Level Security. Keep it secret and never expose it in client-side code.

---

## Vercel Deployment

### 1. Import the Repository

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import your Git repository.
3. Vercel will auto-detect Next.js — leave the framework preset as **Next.js**.

### 2. Configure Environment Variables

In the Vercel project settings (**Settings → Environment Variables**), add all variables listed in the [Environment Variables](#environment-variables) section below.

Make sure to set them for the **Production** environment (and optionally **Preview**).

### 3. Deploy

Click **Deploy**. Vercel will build and deploy the application. Once complete, note the deployment URL (e.g., `https://your-app.vercel.app`).

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `123456:ABC-DEF...` |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token for webhook authentication (generate a random string) | `my-super-secret-token` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xyzcompany.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) | `eyJhbGci...` |
| `SUPABASE_STORAGE_BUCKET` | Supabase Storage bucket name | `task-attachments` |
| `NEXT_PUBLIC_APP_URL` | Public URL of the deployed application | `https://your-app.vercel.app` |

For local development, copy `.env.local` and fill in the real values:

```bash
cp .env.local .env.local.real
# Edit .env.local.real with your actual credentials
```

> `.env.local` is listed in `.gitignore` and will not be committed.

---

## Telegram Webhook Registration

After deploying to Vercel, register the webhook so Telegram knows where to send updates.

### Register the Webhook

Replace `<BOT_TOKEN>`, `<APP_URL>`, and `<WEBHOOK_SECRET>` with your actual values:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<APP_URL>/api/telegram/webhook",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

**Example:**

```bash
curl -X POST "https://api.telegram.org/bot123456:ABC-DEF/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.vercel.app/api/telegram/webhook",
    "secret_token": "my-super-secret-token",
    "allowed_updates": ["message", "callback_query"]
  }'
```

A successful response looks like:

```json
{
  "ok": true,
  "result": true,
  "description": "Webhook was set"
}
```

---

## Verification

### Check Webhook Status

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

A healthy response looks like:

```json
{
  "ok": true,
  "result": {
    "url": "https://your-app.vercel.app/api/telegram/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": null,
    "last_error_message": null,
    "max_connections": 40,
    "allowed_updates": ["message", "callback_query"]
  }
}
```

Key things to verify:

- `url` matches your deployment URL + `/api/telegram/webhook`
- `pending_update_count` is 0 (no backlog)
- `last_error_message` is absent or null (no recent errors)

### Test the Bot

1. Open Telegram and find your bot.
2. Send `/start` — the bot should respond with a welcome message.
3. If the user is not registered, the bot will prompt them to contact an administrator.

---

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Edit `.env.local` with your actual Supabase and Telegram credentials:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret_here

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://xyzcompany.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SUPABASE_STORAGE_BUCKET=task-attachments

# Application Configuration
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

### 3. Start the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### 4. Expose Localhost for Webhook Testing

Telegram requires a publicly accessible HTTPS URL. Use a tunneling tool such as [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

Then register the webhook using the ngrok URL:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<ngrok-id>.ngrok.io/api/telegram/webhook",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

### 5. Run Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

---

## Deployment Checklist

Use this checklist before going live:

- [ ] Supabase project created
- [ ] `schema.sql` applied via SQL Editor — all 6 tables exist
- [ ] `task-attachments` storage bucket created (private)
- [ ] Supabase credentials collected (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] Telegram bot created via @BotFather — token obtained
- [ ] `TELEGRAM_WEBHOOK_SECRET` generated (random string, at least 32 characters)
- [ ] All 6 environment variables set in Vercel project settings
- [ ] Application deployed to Vercel successfully
- [ ] Telegram webhook registered via `setWebhook` API call
- [ ] `getWebhookInfo` confirms webhook URL is correct and no errors
- [ ] `/start` command tested in Telegram — bot responds correctly
- [ ] At least one admin user added to the `users` table in Supabase
