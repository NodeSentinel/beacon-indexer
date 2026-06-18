#!/usr/bin/env bash

# Setup script for generating local SSL certificates with mkcert
# This enables HTTPS in development mode for Telegram Mini Apps

set -e

echo "🔐 Setting up local HTTPS certificates..."

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
  echo "❌ mkcert is not installed."
  echo "Please install it first:"
  echo "  macOS:  brew install mkcert nss"
  echo "  Linux:  https://github.com/FiloSottile/mkcert#installation"
  exit 1
fi

# Create .cert directory if it doesn't exist
mkdir -p .cert

# Install local CA (only needed once per system)
echo "📦 Installing local certificate authority..."
mkcert -install

# Generate certificates for localhost
echo "🔑 Generating certificates for localhost..."
mkcert -key-file ./.cert/localhost-key.pem -cert-file ./.cert/localhost.pem localhost 127.0.0.1 ::1

echo "✅ Certificates generated successfully!"
echo ""
echo "You can now run: pnpm dev:https"
echo ""
echo "⚠️  Note: Self-signed certificates may not work on iOS/Android WebViews."
echo "    For mobile testing, use: pnpm dev:tunnel"

