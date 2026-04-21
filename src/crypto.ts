const ALG = "AES-GCM";
const IV_BYTES = 12;

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(masterKeyB64: string): Promise<CryptoKey> {
  const raw = base64Decode(masterKeyB64);
  if (raw.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");
  }
  return crypto.subtle.importKey("raw", raw, ALG, false, ["encrypt", "decrypt"]);
}

export async function encryptString(
  plaintext: string,
  masterKeyB64: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const buf = await crypto.subtle.encrypt({ name: ALG, iv }, key, encoded);
  return {
    ciphertext: base64Encode(new Uint8Array(buf)),
    iv: base64Encode(iv),
  };
}

export async function decryptString(
  ciphertext: string,
  ivB64: string,
  masterKeyB64: string,
): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = base64Decode(ivB64);
  const data = base64Decode(ciphertext);
  const buf = await crypto.subtle.decrypt({ name: ALG, iv }, key, data);
  return new TextDecoder().decode(buf);
}
