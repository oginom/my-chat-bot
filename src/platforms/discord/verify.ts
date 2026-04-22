// HMAC-SHA256(body) == base64(signatureHeader), constant-time compare.
// Shared secret lives in Worker Secret DISCORD_RELAY_SECRET and in Fly env.

export async function verifyRelaySignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  let expected = "";
  for (const b of new Uint8Array(sig)) expected += String.fromCharCode(b);
  return timingSafeEqual(btoa(expected), signatureHeader);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
