export interface Env {
  DB: D1Database;
  RATE_LIMITER: DurableObjectNamespace;
  ENCRYPTION_KEY: string;
}
