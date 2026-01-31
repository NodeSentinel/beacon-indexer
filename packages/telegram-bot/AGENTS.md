# AGENTS.md — Telegram Bot

This package is the Telegram bot for validator alerts. Root project context: see repository root `AGENTS.md`.

## Purpose

Send real-time alerts to users about their validators:

- Missed attestations
- Block proposals
- Sync committee participation
- Slashing events
- Balance changes

## Tech stack

- **grammy**: Telegram bot framework
- **Hono**: Lightweight web server for webhooks
- **Valibot/Zod**: Input validation
- **@grammyjs/i18n**: Localization

## Architecture

- Bot runs as a separate service.
- Consumes data from the API or directly from database.
- Separate instances for Ethereum and Gnosis (one per chain deployment).

## Design document

See `idea.md` in the repository root for related context on validator monitoring.
