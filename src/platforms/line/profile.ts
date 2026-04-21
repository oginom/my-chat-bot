import type { Env } from "../../env.ts";

const TTL_SECONDS = 60 * 60 * 24;

export interface Profile {
  userId: string;
  displayName: string | null;
}

async function kvGetJson<T>(env: Env, key: string): Promise<T | null> {
  return env.PROFILE_CACHE.get<T>(key, { type: "json" });
}

async function kvPutJson<T>(env: Env, key: string, value: T): Promise<void> {
  await env.PROFILE_CACHE.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
}

async function fetchJson<T>(url: string, accessToken: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    throw new Error(`LINE API ${url} failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function getBotDisplayName(env: Env, botId: string, accessToken: string): Promise<string | null> {
  const key = `bot:${botId}:displayName`;
  const cached = await kvGetJson<{ displayName: string }>(env, key);
  if (cached) return cached.displayName;

  const info = await fetchJson<{ userId: string; displayName: string }>(
    "https://api.line.me/v2/bot/info",
    accessToken,
  );
  if (!info) return null;
  await kvPutJson(env, key, { displayName: info.displayName });
  return info.displayName;
}

export async function getDmUserProfile(
  env: Env,
  botId: string,
  userId: string,
  accessToken: string,
): Promise<Profile> {
  const key = `bot:${botId}:user:${userId}`;
  const cached = await kvGetJson<Profile>(env, key);
  if (cached) return cached;

  const info = await fetchJson<{ userId: string; displayName: string }>(
    `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
    accessToken,
  );
  const profile: Profile = { userId, displayName: info?.displayName ?? null };
  await kvPutJson(env, key, profile);
  return profile;
}

export async function getGroupSummary(
  env: Env,
  botId: string,
  groupId: string,
  accessToken: string,
): Promise<{ groupId: string; name: string | null }> {
  const key = `bot:${botId}:group:${groupId}:summary`;
  const cached = await kvGetJson<{ groupId: string; name: string | null }>(env, key);
  if (cached) return cached;

  const info = await fetchJson<{ groupId: string; groupName: string }>(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`,
    accessToken,
  );
  const summary = { groupId, name: info?.groupName ?? null };
  await kvPutJson(env, key, summary);
  return summary;
}

async function fetchGroupMemberIds(groupId: string, accessToken: string): Promise<string[]> {
  const out: string[] = [];
  let start: string | undefined;
  do {
    const url = new URL(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/members/ids`);
    if (start) url.searchParams.set("start", start);
    const res = await fetchJson<{ memberIds: string[]; next?: string }>(url.toString(), accessToken);
    if (!res) return out;
    out.push(...res.memberIds);
    start = res.next;
  } while (start);
  return out;
}

export async function getGroupMembers(
  env: Env,
  botId: string,
  groupId: string,
  accessToken: string,
): Promise<Profile[]> {
  const key = `bot:${botId}:group:${groupId}:members`;
  const cached = await kvGetJson<Profile[]>(env, key);
  if (cached) return cached;

  const ids = await fetchGroupMemberIds(groupId, accessToken);
  const profiles = await Promise.all(
    ids.map(async (userId): Promise<Profile> => {
      const info = await fetchJson<{ userId: string; displayName: string }>(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
        accessToken,
      );
      return { userId, displayName: info?.displayName ?? null };
    }),
  );
  await kvPutJson(env, key, profiles);
  return profiles;
}

async function fetchRoomMemberIds(roomId: string, accessToken: string): Promise<string[]> {
  const out: string[] = [];
  let start: string | undefined;
  do {
    const url = new URL(`https://api.line.me/v2/bot/room/${encodeURIComponent(roomId)}/members/ids`);
    if (start) url.searchParams.set("start", start);
    const res = await fetchJson<{ memberIds: string[]; next?: string }>(url.toString(), accessToken);
    if (!res) return out;
    out.push(...res.memberIds);
    start = res.next;
  } while (start);
  return out;
}

export async function getRoomMembers(
  env: Env,
  botId: string,
  roomId: string,
  accessToken: string,
): Promise<Profile[]> {
  const key = `bot:${botId}:room:${roomId}:members`;
  const cached = await kvGetJson<Profile[]>(env, key);
  if (cached) return cached;

  const ids = await fetchRoomMemberIds(roomId, accessToken);
  const profiles = await Promise.all(
    ids.map(async (userId): Promise<Profile> => {
      const info = await fetchJson<{ userId: string; displayName: string }>(
        `https://api.line.me/v2/bot/room/${encodeURIComponent(roomId)}/member/${encodeURIComponent(userId)}`,
        accessToken,
      );
      return { userId, displayName: info?.displayName ?? null };
    }),
  );
  await kvPutJson(env, key, profiles);
  return profiles;
}

export async function getGroupMemberDisplayName(
  env: Env,
  botId: string,
  groupId: string,
  userId: string,
  accessToken: string,
): Promise<string | null> {
  const key = `bot:${botId}:group:${groupId}:member:${userId}`;
  const cached = await kvGetJson<{ displayName: string | null }>(env, key);
  if (cached) return cached.displayName;

  const info = await fetchJson<{ userId: string; displayName: string }>(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
    accessToken,
  );
  const displayName = info?.displayName ?? null;
  await kvPutJson(env, key, { displayName });
  return displayName;
}

export async function getRoomMemberDisplayName(
  env: Env,
  botId: string,
  roomId: string,
  userId: string,
  accessToken: string,
): Promise<string | null> {
  const key = `bot:${botId}:room:${roomId}:member:${userId}`;
  const cached = await kvGetJson<{ displayName: string | null }>(env, key);
  if (cached) return cached.displayName;

  const info = await fetchJson<{ userId: string; displayName: string }>(
    `https://api.line.me/v2/bot/room/${encodeURIComponent(roomId)}/member/${encodeURIComponent(userId)}`,
    accessToken,
  );
  const displayName = info?.displayName ?? null;
  await kvPutJson(env, key, { displayName });
  return displayName;
}
