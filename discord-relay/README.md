# discord-relay

Tiny Node worker that keeps Discord Gateway WebSocket connections open and forwards `MESSAGE_CREATE` events to the main Worker over HTTPS. Runs on Fly.io.

## What it does

1. On startup, fetches `GET ${WORKER_URL}/internal/discord/bots` with a Bearer token. Worker returns `[{botId, token}, ...]` from D1.
2. Opens one `discord.js` Client per bot (intents: Guilds, GuildMessages, MessageContent, DirectMessages).
3. For every raw `MESSAGE_CREATE` gateway packet, POSTs `{type, data}` to `${WORKER_URL}/webhook/discord/${botId}` with `X-Relay-Signature: <HMAC-SHA256(body, DISCORD_RELAY_SECRET)>`.
4. Every 10 minutes, re-fetches the bot list. Opens new connections, closes removed ones, rotates on token change.

No state, no storage — the Worker + D1 is the source of truth.

## Deploy

Run these inside `discord-relay/`. You need `flyctl` installed and authenticated (`fly auth login`).

```bash
# 1. Install deps (generates pnpm-lock.yaml if first time)
pnpm install

# 2. Create the Fly app using the committed fly.toml.
#    Edit fly.toml to replace "CHANGE_ME" with your app name first.
fly launch --copy-config --no-deploy

# 3. Set secrets (same DISCORD_RELAY_SECRET as Worker; WORKER_URL of your deployed Worker)
fly secrets set \
  WORKER_URL="https://<your-worker>.workers.dev" \
  DISCORD_RELAY_SECRET="<same value as Worker secret>"

# 4. Deploy
fly deploy

# 5. Make sure exactly 1 machine stays up
fly scale count 1 --region nrt

# 6. Tail logs
fly logs
```

## Adding / removing bots

Nothing to do on Fly. Just register / remove bots on the Worker side:

```bash
pnpm bot:create --remote  # pick "discord" at the platform prompt
```

The relay will pick up the change within the next 10-minute refresh. To force an immediate refresh, restart the relay: `fly apps restart <app-name>`.

## Discord Developer Portal

For each Discord bot:

1. Create an application at <https://discord.com/developers/applications>
2. Add a **Bot** to it and copy the bot token (that's what goes into `pnpm bot:create`)
3. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT** (required so the relay sees message text in guilds)
4. Generate an invite URL with `bot` scope + permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`. Invite the bot to your server.

## Env vars

| Name | Required | Default | Notes |
|---|---|---|---|
| `WORKER_URL` | yes | — | Worker base URL, no trailing slash |
| `DISCORD_RELAY_SECRET` | yes | — | Shared HMAC / bearer secret; must match Worker's `DISCORD_RELAY_SECRET` |
| `REFRESH_INTERVAL_MS` | no | `600000` | Bot list re-fetch interval |
