// OpenChat threads (討論串): pick one thread's messages out of a fetchSquareChatEvents page. Read-only.
export interface ThreadEventRaw { message: { id: string; to: string }; threadInfo?: { chatThreadMid?: string } }
export interface ThreadEvent { payload: Record<string, unknown> }

/** Messages of `chatMid` found in the events (normal, own and thread notifications), with the sender's display name. */
export function threadMessagesFromEvents<T extends ThreadEventRaw>(events: readonly ThreadEvent[], chatMid: string): Array<{ raw: T; name?: string }> {
  const found = new Map<string, { raw: T; name?: string }>();
  for (const event of events) {
    const payload = event.payload as Record<string, { squareMessage?: T; senderDisplayName?: string } | undefined>;
    const item = payload.receiveMessage ?? payload.sendMessage ?? payload.notificationThreadMessage ?? payload.notificationMessage;
    const raw = item?.squareMessage;
    if (!item || !raw?.message?.id || raw.message.to !== chatMid) continue;
    found.set(raw.message.id, { raw, ...(item.senderDisplayName ? { name: item.senderDisplayName } : {}) });
  }
  return [...found.values()];
}
