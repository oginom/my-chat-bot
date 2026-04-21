import { Hono } from "hono";
import type { Env } from "./env.ts";
import { handleLineWebhook } from "./platforms/line/webhook.ts";

export { RateLimiter } from "./rate-limit.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("my-chat-bot"));

app.post("/webhook/line/:botId", (c) => handleLineWebhook(c, c.req.param("botId")));

export default app;
