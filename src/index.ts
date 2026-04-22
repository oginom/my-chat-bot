import { Hono } from "hono";
import type { Env } from "./env.ts";
import { handleDiscordWebhook } from "./platforms/discord/webhook.ts";
import { handleLineWebhook } from "./platforms/line/webhook.ts";
import { listDiscordBots } from "./repository/bot.ts";
import { timingSafeEqual } from "./platforms/discord/verify.ts";

export { RateLimiter } from "./rate-limit.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("my-chat-bot"));

app.post("/webhook/line/:botId", (c) => handleLineWebhook(c, c.req.param("botId")));

app.post("/webhook/discord/:botId", (c) => handleDiscordWebhook(c, c.req.param("botId")));

app.get("/internal/discord/bots", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const expected = `Bearer ${c.env.DISCORD_RELAY_SECRET}`;
  if (!timingSafeEqual(auth, expected)) return c.text("unauthorized", 401);
  const bots = await listDiscordBots(c.env.DB, c.env.ENCRYPTION_KEY);
  return c.json(bots);
});

export default app;
