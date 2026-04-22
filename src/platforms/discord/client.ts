const API = "https://discord.com/api/v10";

export interface DiscordSelfUser {
  id: string;
  username: string;
}

export async function getSelfUser(botToken: string): Promise<DiscordSelfUser> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord /users/@me failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as DiscordSelfUser;
}

export async function sendChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
  replyToMessageId?: string,
): Promise<void> {
  const body: Record<string, unknown> = { content: content.slice(0, 2000) };
  if (replyToMessageId) {
    body.message_reference = { message_id: replyToMessageId };
  }
  const res = await fetch(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Discord send message failed ${res.status}: ${await res.text()}`,
    );
  }
}
