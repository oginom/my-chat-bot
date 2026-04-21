interface LineBotInfo {
  userId: string;
  basicId: string;
  displayName: string;
}

export async function replyMessage(
  accessToken: string,
  replyToken: string,
  text: string,
): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 5000) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE reply failed ${res.status}: ${await res.text()}`);
  }
}

export async function getBotInfo(accessToken: string): Promise<LineBotInfo> {
  const res = await fetch("https://api.line.me/v2/bot/info", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LINE bot/info failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as LineBotInfo;
}
