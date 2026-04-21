export async function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  let expected = "";
  for (const b of new Uint8Array(sig)) expected += String.fromCharCode(b);
  return btoa(expected) === signatureHeader;
}
