export interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

export type LineEventSource =
  | { type: "user"; userId: string }
  | { type: "group"; groupId: string; userId?: string }
  | { type: "room"; roomId: string; userId?: string };

export interface LineMessageEvent {
  type: "message";
  replyToken: string;
  timestamp: number;
  source: LineEventSource;
  message: LineMessage;
}

export type LineEvent = LineMessageEvent | { type: string };

export interface LineMessage {
  id: string;
  type: string;
  text?: string;
  mention?: {
    mentionees: {
      index: number;
      length: number;
      userId?: string;
      type?: "user" | "all";
    }[];
  };
}
