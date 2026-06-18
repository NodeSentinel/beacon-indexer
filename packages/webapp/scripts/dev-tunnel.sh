#!/usr/bin/env bash

# Development tunnel script for mobile testing
# Exposes local HTTPS server with a public valid SSL certificate

set -e

echo "🌐 Starting development tunnel..."
echo ""

# Check if cloudflared is installed
if command -v cloudflared &> /dev/null; then
  echo "Using cloudflared tunnel..."
  echo "📱 Access your app from mobile Telegram using the URL below"
  echo ""
  cloudflared tunnel --url https://localhost:3000
  exit 0
fi

# Check if ngrok is installed
if command -v ngrok &> /dev/null; then
  echo "Using ngrok tunnel..."
  echo "📱 Access your app from mobile Telegram using the URL below"
  echo ""
  ngrok http https://localhost:3000
  exit 0
fi

# Neither tool found
echo "❌ No tunnel tool found!"
echo ""
echo "Please install one of the following:"
echo ""
echo "cloudflared (recommended):"
echo "  macOS:  brew install cloudflared"
echo "  Other:  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
echo ""
echo "ngrok (alternative):"
echo "  macOS:  brew install ngrok"
echo "  Other:  https://ngrok.com/download"
echo ""
exit 1

