# Telegram Mini App + Dual Auth Mode

## Summary

Enable the webapp to run as a Telegram Mini App while preserving the existing anonymous web flow. Every API endpoint (except health check) is secured: requests are authenticated either by Telegram `initData` signature, API key, or allowed origin. Telegram users are automatically created/resolved on every request.

## Security Model

All endpoints except `health.check` use a secured procedure (`securedProcedure`). The middleware checks three signals **in this order** (Telegram first because its authentication is based on the HMAC signature of initData signed by the bot token, not by origin):

| Priority | Signal                                               | Auth mode     | CORS                               | `context.user`                            |
| -------- | ---------------------------------------------------- | ------------- | ---------------------------------- | ----------------------------------------- |
| 1        | `x-telegram-init-data` header                        | Telegram      | No                                 | `DbUser` found-or-created by `telegramId` |
| 2        | `Authorization: Bearer ...` header                   | API key       | No                                 | `null`                                    |
| 3        | `ns-anonymous-id` header + origin in ALLOWED_ORIGINS | Web anonymous | Yes — must match `ALLOWED_ORIGINS` | `DbUser` found-or-created by session UUID |

If none of the three checks pass: `401 UNAUTHORIZED`.

**Exception:** `health.check` stays on `publicProcedure` — it must be accessible to load balancers and uptime monitors without credentials.

### Replay attack prevention

The existing `authenticateTelegram()` in `src/auth/strategies/telegram.ts` validates the HMAC but does not check `auth_date` staleness. This must be added: parse `auth_date` from `initData` params and reject if older than a configurable threshold (default: 1 hour). This prevents a leaked `initData` string from being replayed indefinitely.

### Known limitation: anonymous owner verification

In anonymous mode, cluster endpoints take `ownerId` from the request body with no validation that the caller actually owns that ID. Any web client can pass any `ownerId`. This is the existing behavior and is not addressed in this work. A follow-up should add session-to-owner binding for anonymous users.

## API Changes

### New secured procedure

In `src/lib/orpc.ts`, export a new `securedProcedure` built from `accessMiddleware`. This is what all router files import instead of `publicProcedure`:

```ts
// src/lib/orpc.ts
export { accessMiddleware as securedProcedure } from '@/auth/middleware.js';
```

Router files change from `publicProcedure.route(...)` to `securedProcedure.route(...)`. `publicProcedure` remains only for `health.check`.

### Reorder `accessMiddleware` check priority

Current order in `src/auth/middleware.ts`: (1) Origin, (2) Telegram, (3) API key.
New order: **(1) Telegram, (2) API key, (3) Origin.**

Telegram authentication is based on the HMAC signature of `initData` (signed by the bot token), not by origin. Checking Telegram first ensures the `x-telegram-init-data` header is always evaluated before falling through to origin-based auth.

### CORS scoping

CORS headers must only be set for origin-authenticated requests. The current `CORSPlugin` in `server.ts` applies to all requests indiscriminately.

Implementation: replace the `CORSPlugin` with a custom handler-level interceptor (or wrap it) that checks: if the request has `x-telegram-init-data` or `Authorization` header, skip CORS processing entirely. Otherwise, delegate to the existing origin-matching logic. This runs at the handler level in `server.ts`, before the request reaches any procedure middleware.

### `context.user` type and population

The middleware's context type is extended with an optional `user` field:

```ts
// src/lib/orpc.ts — base context type
{
  logger: Logger;
  headers: Record<string, string | string[] | undefined>;
  user?: DbUser; // populated only for Telegram auth
}
```

Where `DbUser` is `{ id: bigint; username: string }` — the Prisma `User` record shape, NOT the `TelegramUser` from the auth strategy. The middleware flow for Telegram is:

1. `authenticateTelegram(initData)` returns `TelegramUser` (with `telegramId` as string)
2. `UserStorage.getOrCreateTelegram(...)` upserts and returns the DB `User` record
3. DB `User` is attached to `context.user`

This means `context.user.id` is always the DB `BigInt` that `Cluster.ownerId` foreign key expects.

### Telegram user find-or-create

New method on `UserStorage` (`src/storage/user.ts`):

```ts
async getOrCreateTelegram({ telegramId, username }: { telegramId: string; username?: string }) {
  const tgId = BigInt(telegramId); // Telegram IDs are numeric, fits BigInt directly

  return this.prisma.user.upsert({
    where: { userId: tgId },
    update: { username: username ?? undefined }, // refresh username if changed
    create: {
      id: tgId,        // PK = Telegram user ID
      userId: tgId,    // unique Telegram ID field
      username: username ?? `tg:${telegramId}`,
    },
    select: { id: true, username: true },
  });
}
```

Both `User.id` and `User.userId` are set to the Telegram numeric ID as `BigInt`. This is safe because Telegram user IDs and the anonymous hex-derived IDs occupy different numeric ranges (Telegram IDs are small positive integers, anonymous IDs are 60-bit hex values).

### `auth_date` expiry check

Added to `authenticateTelegram()` in `src/auth/strategies/telegram.ts`, after HMAC validation passes:

```ts
const authDate = Number(params.get('auth_date'));
const now = Math.floor(Date.now() / 1000);
const MAX_AGE_SECONDS = 3600; // 1 hour

if (!authDate || now - authDate > MAX_AGE_SECONDS) {
  throw new ORPCError('UNAUTHORIZED', { message: 'Telegram init data expired' });
}
```

### Endpoint owner resolution

Cluster endpoints that need an owner use this logic:

- If `context.user` exists (Telegram mode): use `context.user.id` as owner. Ignore any `ownerId` in the request body.
- If `context.user` is `null` (web anonymous or API key): use `ownerId` from the request body, as today.

### Update `telegramAuthProcedure`

The existing `telegramAuthProcedure` in `src/auth/middleware.ts` calls `authenticateTelegram()` and puts the raw `TelegramUser` (auth strategy shape with string IDs) into `context.user`. It must be updated to also call `UserStorage.getOrCreateTelegram()` and populate `context.user` with the DB `User` record — same as `accessMiddleware`. This keeps both Telegram auth paths consistent: `context.user` is always a `DbUser` with BigInt `id`.

### New endpoint: `user.me`

```
GET /users/me → { success: true, data: { id: string, username: string } }
```

Uses `securedProcedure` — works for both Telegram and anonymous users since both auth paths populate `context.user`. Returns `401` if no user in context (API key auth has no user).

**Important:** `context.user.id` is a `BigInt` which is not JSON-serializable. The handler must call `.toString()` when building the response: `{ id: context.user.id.toString(), username: context.user.username }`.

Used by the webapp's `useUserId` hook in both modes to get the DB user ID.

### Remove dead code

After this work, `telegramAuthProcedure` is used (for `user.me`). `publicProcedure` is used only for `health.check`. `baseProcedure` stays as the internal building block. No dead code to remove.

## Webapp Changes

### Module-level `initData` store

New file `lib/telegram-init-data.ts` (client-only — must never be imported from server components):

```ts
let initData: string | null = null;

export function setTelegramInitData(data: string) {
  initData = data;
}

export function getTelegramInitData(): string | null {
  return initData;
}
```

### `TelegramProvider` update

In `TelegramAppInitializer`, after the SDK is initialized and `lp.initData` is available, call `setTelegramInitData()` with the **raw `initData` query string** (the URL-encoded string that Telegram puts in `tgWebAppData`, which is what the API's HMAC validation expects).

The raw string is available from `lp.initDataRaw` (the `@tma.js/sdk` launch params expose both parsed `initData` and raw `initDataRaw`).

**Dev mock note:** The existing `setupTelegramMock()` in `lib/mockTelegramEnv.ts` sets `tgWebAppData` in the mock launch params, which becomes `initDataRaw`. For the Telegram auth flow to work end-to-end during development, the mock's `initData` hash must either be valid (computed with the dev bot token) or the API must skip HMAC validation in dev mode.

```ts
useEffect(() => {
  if (lp.initDataRaw) {
    setTelegramInitData(lp.initDataRaw);
  }
}, [lp]);
```

### oRPC `RPCLink` header injection

Modify `lib/orpc.ts` — the `RPCLink` gains a `headers` callback:

```ts
const link = new RPCLink({
  url: `${env.NEXT_PUBLIC_API_URL}/rpc`,
  headers: () => {
    const initData = getTelegramInitData();
    if (initData) {
      return { 'x-telegram-init-data': initData };
    }
    return {};
  },
});
```

Every oRPC request automatically includes the Telegram header when `initData` is set.

### `useUserId` hook — dual path

`lib/user-id.ts` is modified to branch based on `getTelegramInitData()`:

**Telegram mode** (when `getTelegramInitData()` is non-null):

- Calls `orpcClient.user.me()` to get the user resolved by the middleware
- Stores `id` in React state
- No localStorage, no anonymous UUID
- On error: logs the error, leaves `userId` as empty string (same behavior as current anonymous error path). The UI already handles empty `userId` by disabling queries via `enabled: !!userId`.

**Web anonymous mode** (when `getTelegramInitData()` is null):

- Existing flow unchanged: generates UUID, stores in localStorage, calls `orpcClient.user.anonymous({ sessionId })`

Both paths return the same type: `string` (the DB user ID or empty string while loading). Downstream hooks and components are unaffected.

## What does NOT change

- Webapp pages, components, and hooks (other than `useUserId`) remain identical
- Cluster form, dashboard, validator pages work the same — auth header injection is transparent
- The telegram-bot package is not modified
- The DB schema is not modified — the existing `User` model already supports Telegram identity
- Read-only endpoints (chain stats, validator lookup) work for all auth modes — they just require one of the three auth signals

## File change summary

### API (`packages/api`)

| File                              | Change                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/auth/middleware.ts`          | Reorder checks in `accessMiddleware`: Telegram first, API key second, origin third. Add `getOrCreateTelegram` call to populate `context.user` with DB record. Update `telegramAuthProcedure` to also call `getOrCreateTelegram` for consistency. |
| `src/auth/strategies/telegram.ts` | Add `auth_date` expiry validation (1 hour max).                                                                                                                                                                                                  |
| `src/auth/types.ts`               | No change — `TelegramUser` type stays as-is (used internally by the strategy).                                                                                                                                                                   |
| `src/lib/orpc.ts`                 | Export `securedProcedure` (re-export of `accessMiddleware`). Extend base context type with optional `user` field.                                                                                                                                |
| `src/storage/user.ts`             | Add `getOrCreateTelegram({ telegramId, username })` method with upsert on `userId`.                                                                                                                                                              |
| `src/routers/user/index.ts`       | Add `user.me` endpoint using `telegramAuthProcedure`.                                                                                                                                                                                            |
| `src/routers/user/me.ts`          | New file — `user.me` handler returning `context.user`.                                                                                                                                                                                           |
| `src/routers/**/*.ts`             | Replace `publicProcedure` with `securedProcedure` in all router files except `health.ts`.                                                                                                                                                        |
| `src/server.ts`                   | Scope CORS to skip Telegram/API-key requests.                                                                                                                                                                                                    |

### Webapp (`packages/webapp`)

| File                                       | Change                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `lib/telegram-init-data.ts`                | New file — module-level `initData` store (client-only).                          |
| `lib/orpc.ts`                              | Add `headers` callback to `RPCLink` for conditional Telegram header injection.   |
| `lib/user-id.ts`                           | Dual-path: Telegram calls `user.me`, anonymous calls `user.anonymous` as today.  |
| `components/telegram/TelegramProvider.tsx` | Call `setTelegramInitData(lp.initDataRaw)` in `TelegramAppInitializer` on mount. |

## Testing

- **API auth middleware**: test all three auth modes (Telegram, API key, origin). Test rejection when none match. Test that Telegram is checked before origin (a request with both Telegram header and matching origin must be classified as Telegram).
- **API `auth_date` expiry**: test that `initData` older than 1 hour is rejected.
- **API `user.me`**: returns correct DB user in Telegram mode. Returns 401 without Telegram auth.
- **API `getOrCreateTelegram`**: creates new user on first call, returns existing on second. Updates username if changed.
- **API cluster CRUD**: uses `context.user.id` in Telegram mode, `ownerId` from body in anonymous mode.
- **API CORS**: CORS headers present for origin-based requests, absent for Telegram/API-key requests.
- **Webapp**: oRPC client sends `x-telegram-init-data` header when `initData` is set, no header when not.
- **Webapp**: `useUserId` returns user ID from both Telegram and anonymous paths.
