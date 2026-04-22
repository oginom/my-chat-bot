# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node and pnpm versions are pinned via `mise.toml` (Node 22.22.2, pnpm 10.33.0). Prefix commands with `mise exec --` if your shell isn't mise-activated.

- `pnpm dev` — local worker via `wrangler dev` (regenerates `wrangler.toml` first)
- `pnpm typecheck` — `tsc --noEmit` (there is no test runner in this repo)
- `pnpm cf:deploy` — deploy to Cloudflare (regenerates `wrangler.toml` first)
- `pnpm db:migrate:local` / `pnpm db:migrate:remote` — apply D1 migrations from `migrations/`
- `pnpm bot:create|list|edit|delete|set-key|add-platform [--remote]` — CLI under `scripts/` to manage bots. Omitting `--remote` targets the local D1 backend
- `pnpm keygen` — generate a base64 32-byte master key for `ENCRYPTION_KEY`

Every `pnpm` script that touches wrangler first runs `pnpm gen:config` (see below) — never invoke `wrangler` directly without regenerating the config, or stale values will ship.

## Config generation (important)

`wrangler.toml` is **gitignored and auto-generated** from `wrangler.toml.template` by `scripts/gen-wrangler-config.ts`, which substitutes `${PROJECT_NAME}`, `${CF_D1_DATABASE_ID}`, `${CF_KV_PROFILE_CACHE_ID}` from `.env` (or the process env, which is how Cloudflare Builds supplies them). Do not edit `wrangler.toml` directly — edit `wrangler.toml.template` and let `pnpm gen:config` regenerate.

## Architecture

Single Cloudflare Worker (Hono) hosting multiple bots. Requests land at `POST /webhook/line/:botId` or `POST /webhook/discord/:botId`; bot config is looked up in D1 by `botId`.

**Discord is split across two processes.** The Worker cannot hold Discord Gateway WebSocket connections, so `discord-relay/` (a separate Node process deployed to Fly.io) owns the WS side. It fetches `GET /internal/discord/bots` on startup (bearer-authenticated with `DISCORD_RELAY_SECRET`), opens one `discord.js` client per bot, and forwards every raw `MESSAGE_CREATE` packet to `POST /webhook/discord/:botId` with an HMAC signature in `X-Relay-Signature`. The Worker decrypts bot credentials from D1 and sends replies via Discord REST (`POST /channels/{id}/messages`). The relay is stateless — D1 is the single source of truth; the relay re-fetches the bot list every 10 minutes so `pnpm bot:create` alone suffices to register a new bot.

**Per-request flow in `src/platforms/line/webhook.ts`:**
1. Fetch `bot_platforms` row, decrypt LINE credentials (AES-GCM, key from `ENCRYPTION_KEY` Worker secret), verify `x-line-signature`.
2. Return `200 ok` immediately; all downstream work runs under `c.executionCtx.waitUntil(...)`.
3. For each text message event: store it (with `"DisplayName: text"` prefix in groups/rooms), then respond **only** if the bot is DM'd or mentioned.
4. Gate responses through the `RateLimiter` Durable Object (keyed by `botId:channelId`). Rate-limited requests are silently dropped.
5. Handle the `clear` command (text == "clear" after stripping mentions, case-insensitive) by writing `channel_state.cleared_at = now`. Messages are never physically deleted; `getRecentMessages` filters by `created_at > cleared_at`.
6. Build history + context block in parallel, call the LLM, save the assistant reply, and send a LINE reply.

**Provider selection (`src/llm/provider.ts`):** the LLM provider is inferred from the bot's `model` string at request time (`gpt-|chatgpt|o1|o3|o4` → openai, `claude-` → anthropic, `gemini-` → gemini). Bots can have multiple encrypted API keys stored per provider in `bot_api_keys`; switching models just picks a different row. If the key for the inferred provider is missing, the request is logged and dropped.

**System prompt assembly:** the final prompt sent to the LLM is `bot.systemPrompt + PLATFORM_DIRECTIVES + contextBlock`. `PLATFORM_DIRECTIVES` (in `webhook.ts`) tells the model "no Markdown, don't prefix replies with names" — changes to LINE reply style belong here. `contextBlock` is built from LINE profile/group/member APIs cached in KV (`PROFILE_CACHE`, 24h TTL, keys are namespaced per `botId` — see `src/platforms/line/profile.ts`).

**Bindings (`src/env.ts`):** `DB` (D1), `RATE_LIMITER` (DO namespace), `PROFILE_CACHE` (KV), `ENCRYPTION_KEY` (secret), `DISCORD_RELAY_SECRET` (secret). The master key encrypts both `bot_api_keys.{ciphertext,iv}` and `bot_platforms.credentials_{ciphertext,iv}` via `src/crypto.ts`. CLI scripts read `ENCRYPTION_KEY` from `.env` to write encrypted rows; the Worker reads the same value from Cloudflare Secrets. `DISCORD_RELAY_SECRET` is shared with the Fly relay and is used both as the HMAC key for relay event POSTs and as the bearer token for `GET /internal/discord/bots`.

## Limits and knobs

Tunables live in `src/config.ts` (`LIMITS`): history window up to 200 messages, capped at a cumulative 8000 chars walked back from the newest (whichever hits first — see `src/repository/message.ts`); stored-message truncation at 4000 chars; rate limits 5/min & 30/hr per channel. Change them there, not inline.

## Secret bootstrap gotcha

Order matters on first setup: `ENCRYPTION_KEY` must be set as a Worker secret *after* the first `pnpm cf:deploy`, because `wrangler secret put` requires the Worker to exist. Any webhook request between deploy and secret-put will 500. See [`doc/setup.md`](doc/setup.md) for the full sequence.

## Documentation layout

User-facing docs live in `doc/`:
- `doc/architecture.md` — components, request flow, D1 schema, key behaviors
- `doc/setup.md` — initial Cloudflare setup, auto-deploy wiring
- `doc/line.md` — LINE bot setup and LINE-specific behavior
- `doc/discord.md` — Discord bot setup including the Fly relay, role-mention handling, Fly trial gotcha
- `doc/cli.md` — full `pnpm bot:*` / `pnpm db:*` reference
- `doc/operations.md` — model switching, logs, D1 queries, secret rotation, extension recipes

The root `README.md` is a short landing page pointing into these. When answering user questions about setup / operations / platform specifics, prefer reading the relevant `doc/*.md` first.

## User-instruction reminders

From the global CLAUDE.md (do not re-ask the user to confirm these):
- **No fallbacks that mask failures.** If an external API or data-format error is possible, surface it; don't substitute a silent alternative path.
- **No backward compatibility.** When changing behavior or schemas, change it cleanly — don't keep old code paths, shims, or deprecated fields.
- **Debug via logs, not guessing.** When the cause of an error would be visible in logs, add a log line, ask the user to run and paste the output, then diagnose.
