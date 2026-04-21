import { LIMITS } from "./config.ts";
import type { Env } from "./env.ts";

export class RateLimiter implements DurableObject {
  private state: DurableObjectState;
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/check") {
      const allowed = await this.check();
      return Response.json({ allowed });
    }
    return new Response("not found", { status: 404 });
  }

  private async check(): Promise<boolean> {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const hourAgo = now - 3_600_000;
    const stored = (await this.state.storage.get<number[]>("timestamps")) ?? [];
    const recent = stored.filter((t) => t > hourAgo);
    const lastMinute = recent.filter((t) => t > minuteAgo).length;
    const lastHour = recent.length;
    if (lastMinute >= LIMITS.RATE_LIMIT_PER_MINUTE) return false;
    if (lastHour >= LIMITS.RATE_LIMIT_PER_HOUR) return false;
    recent.push(now);
    await this.state.storage.put("timestamps", recent);
    return true;
  }
}

export async function checkRateLimit(env: Env, botId: string, channelId: string): Promise<boolean> {
  const id = env.RATE_LIMITER.idFromName(`${botId}:${channelId}`);
  const stub = env.RATE_LIMITER.get(id);
  const res = await stub.fetch("https://do/check");
  const data = (await res.json()) as { allowed: boolean };
  return data.allowed;
}
