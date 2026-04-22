// Subset of Discord MESSAGE_CREATE payload forwarded by the Fly relay.
// Relay sends: { type: "MESSAGE_CREATE", data: <raw gateway message payload> }

export interface DiscordRelayEnvelope {
  type: "MESSAGE_CREATE";
  data: DiscordMessage;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  bot?: boolean;
}

export interface DiscordMember {
  nick: string | null;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  member?: DiscordMember;
  content: string;
  mentions: DiscordUser[];
  // Discord message.type 0 = DEFAULT, 19 = REPLY, etc.
  type: number;
}
