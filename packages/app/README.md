# Dashboard – M.O.N.K.Y

_Automatically synced with your [v0.app](https://v0.app) deployments_

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/nicosamplers-projects/v0-dashboard-m-o-n-k-y)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/ajS4OsOhuNw)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/nicosamplers-projects/v0-dashboard-m-o-n-k-y](https://vercel.com/nicosamplers-projects/v0-dashboard-m-o-n-k-y)**

## Build your app

Continue building your app on:

**[https://v0.app/chat/projects/ajS4OsOhuNw](https://v0.app/chat/projects/ajS4OsOhuNw)**

## Development

### Local HTTPS Setup (for Telegram Mini Apps)

This project supports HTTPS in development mode, which is required for testing Telegram Mini Apps locally.

#### First-time Setup

1. Install `mkcert` (one-time system requirement):

   ```bash
   brew install mkcert nss
   ```

2. Generate local SSL certificates:
   ```bash
   pnpm cert:setup
   ```

#### Running the App

- **Standard HTTP**: `pnpm dev` → http://localhost:3000
- **HTTPS (required for Telegram)**: `pnpm dev:https` → https://localhost:3000

#### Mobile Testing

⚠️ **Important**: Self-signed certificates don't work in iOS/Android Telegram WebViews due to OS security restrictions.

For testing on mobile devices, you need a public HTTPS URL with a valid certificate:

**Option 1: Use a tunnel (recommended for development)**

First, make sure your HTTPS server is running:

```bash
pnpm dev:https
```

Then, in another terminal, start the tunnel:

```bash
pnpm dev:tunnel
```

This requires either `cloudflared` or `ngrok` installed:

- **cloudflared**: `brew install cloudflared`
- **ngrok**: `brew install ngrok`

The tunnel will give you a public HTTPS URL you can use in Telegram.

**Option 2: Deploy to staging**

Deploy to Vercel (provides HTTPS automatically) for testing in the actual Telegram environment.

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository
