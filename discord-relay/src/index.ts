import crypto from "node:crypto";
import process from "node:process";
import { Client, Events, GatewayIntentBits } from "discord.js";

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

const WORKER_URL = required("WORKER_URL").replace(/\/$/, "");
const RELAY_SECRET = required("DISCORD_RELAY_SECRET");
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 10 * 60 * 1000);

interface BotConfig {
  botId: string;
  token: string;
}

interface Connection {
  client: Client;
  token: string;
}

const connections = new Map<string, Connection>();

async function fetchBots(): Promise<BotConfig[]> {
  const url = `${WORKER_URL}/internal/discord/bots`;
  console.log(`fetchBots: GET ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${RELAY_SECRET}` },
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`fetchBots: response ${res.status}`);
  if (!res.ok) {
    throw new Error(
      `worker /internal/discord/bots failed ${res.status}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as BotConfig[];
  console.log(`fetchBots: received ${body.length} bot(s)`);
  return body;
}

async function forwardMessage(botId: string, data: unknown): Promise<void> {
  const body = JSON.stringify({ type: "MESSAGE_CREATE", data });
  const signature = crypto
    .createHmac("sha256", RELAY_SECRET)
    .update(body)
    .digest("base64");
  const res = await fetch(
    `${WORKER_URL}/webhook/discord/${encodeURIComponent(botId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Signature": signature,
      },
      body,
    },
  );
  if (!res.ok) {
    console.error(
      `forward failed bot=${botId} status=${res.status} body=${await res.text()}`,
    );
  }
}

async function connectBot(bot: BotConfig): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  // Use the raw gateway dispatch so we pass through Discord's original
  // payload rather than discord.js's Message object.
  client.on(Events.Raw, (packet: { t?: string; d?: unknown }) => {
    if (packet.t === "MESSAGE_CREATE") {
      forwardMessage(bot.botId, packet.d).catch((err) =>
        console.error(`forward error bot=${bot.botId}:`, err),
      );
    }
  });

  client.once(Events.ClientReady, () => {
    console.log(`connected bot=${bot.botId} as ${client.user?.tag}`);
  });

  client.on(Events.Error, (err) => {
    console.error(`client error bot=${bot.botId}:`, err);
  });

  await client.login(bot.token);
  connections.set(bot.botId, { client, token: bot.token });
}

async function disconnectBot(botId: string): Promise<void> {
  const entry = connections.get(botId);
  if (!entry) return;
  connections.delete(botId);
  try {
    await entry.client.destroy();
    console.log(`disconnected bot=${botId}`);
  } catch (err) {
    console.error(`destroy error bot=${botId}:`, err);
  }
}

async function syncConnections(): Promise<void> {
  const bots = await fetchBots();
  const desired = new Map(bots.map((b) => [b.botId, b.token] as const));

  for (const [botId, entry] of connections) {
    const newToken = desired.get(botId);
    if (newToken === undefined || newToken !== entry.token) {
      await disconnectBot(botId);
    }
  }

  for (const bot of bots) {
    if (!connections.has(bot.botId)) {
      try {
        await connectBot(bot);
      } catch (err) {
        console.error(`connect error bot=${bot.botId}:`, err);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `discord-relay starting; worker=${WORKER_URL} refresh=${REFRESH_INTERVAL_MS}ms`,
  );
  await syncConnections();
  setInterval(() => {
    syncConnections().catch((err) => console.error("sync error:", err));
  }, REFRESH_INTERVAL_MS);
}

const shutdown = async (signal: string) => {
  console.log(`received ${signal}, shutting down`);
  for (const botId of [...connections.keys()]) {
    await disconnectBot(botId);
  }
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
