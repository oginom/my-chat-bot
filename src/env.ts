export interface Env {
  DB: D1Database;
  RATE_LIMITER: DurableObjectNamespace;
  PROFILE_CACHE: KVNamespace;
  ENCRYPTION_KEY: string;
}
