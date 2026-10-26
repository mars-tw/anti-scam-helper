import type { AuthState, Channel, Mention, Message, Note, Profile, ReactionKind, Reactions, ReadPosition, ScamAnalysis, StickerPackage } from "../model/dto.js";

export type ListenState = "starting" | "listening" | "reconnecting";

/** Bumped only when frames change incompatibly; a page built for another number must reload. */
export const PROTOCOL_VERSION = 2;

export type ServerFrame =
  | { type: "hello"; protocol: number; serverVersion: string }
  /** A newer release exists on GitHub. Public information only; sent to every connection, signed in or not. */
  | { type: "update:available"; version: string; current: string; url: string }
  | { type: "auth:state"; state: AuthState }
  | { type: "auth:qr"; url: string }
  | { type: "auth:pin"; code: string }
  | { type: "auth:ready"; profile: Profile }
  /** Answer to `profile:get`, only to the connection that asked: the same profile `auth:ready` carries. */
  | { type: "profile"; requestId: string; profile: Profile }
  | { type: "channels"; channels: Channel[] }
  /** One chat changed (new activity, its preview, its badge): pages only, bots keep the plain message stream. */
  | { type: "channel"; channel: Channel }
  /** This account read the chat elsewhere (the phone): pages drop its badge, however they counted it. */
  | { type: "chat:checked"; chatId: string }
  | { type: "message"; message: Message }
  /** Connect-time snapshot of one chat's cached messages, oldest first. Old news: never counted as unread. */
  | { type: "messages"; chatId: string; messages: readonly Message[] }
  | { type: "message:edit"; message: Message }
  /** The sender took a message back: show a placeholder instead of its content. */
  | { type: "message:unsend"; chatId: string; messageId: string }
  /** A message's reactions changed (absent: nobody reacts now). Pages only. */
  | { type: "message:reactions"; chatId: string; messageId: string; reactions?: Reactions }
  | { type: "status"; state: ListenState }
  | { type: "history"; requestId: string; chatId: string; messages: Message[]; hasMore: boolean; cursor?: string }
  | { type: "sent"; requestId: string; messageId: string }
  | { type: "read"; chatId: string; positions: ReadPosition[] }
  | { type: "stickers"; requestId: string; packages: StickerPackage[] }
  /** Bot API status; sent to /ws connections (page and CLI) only. `chats` is the allow-list from config.yaml, `createdAt` the active token's age. */
  | { type: "api:state"; enabled: boolean; chats: string[]; createdAt?: number }
  /** A freshly made bot token: shown once, only to the connection that asked (the CLI), never repeated or stored in clear. */
  | { type: "api:token"; token: string }
  /** Whether config.yaml has a Jev token, i.e. whether `scam:check` is available. Pages only; the token itself never leaves the server. */
  | { type: "scam:state"; enabled: boolean }
  /** Answer to `scam:check`, only to the connection that asked. */
  | { type: "scam:result"; requestId: string; chatId: string; messageId: string; analysis: ScamAnalysis }
  /** Answer to a bot's `member:remove`: the sender is out; `messageDeleted` says whether their message went too. */
  | { type: "member:removed"; requestId: string; chatId: string; messageId: string; memberId: string; messageDeleted: boolean }
  /** Answer to a bot's `message:delete`: the OpenChat message is gone for everyone. */
  | { type: "message:deleted"; requestId: string; chatId: string; messageId: string }
  /** Answer to a bot's `media:fetch`: the picture of a received image message, base64. */
  | { type: "media"; requestId: string; chatId: string; messageId: string; mime: string; data: string }
  /** Answer to a bot's `file:fetch`: the bytes of a received FILE message, base64. */
  | { type: "file"; requestId: string; chatId: string; messageId: string; name: string; data: string }
  /** Answer to a bot's `notes:list`: the OpenChat's recent notes (記事本), newest first. */
  | { type: "notes"; requestId: string; chatId: string; notes: Note[] }
  /** Answer to a bot's `invite:own`: this OpenChat's existing invitation links (read-only) and its square mid. */
  | { type: "invite:own"; requestId: string; chatId: string; squareMid: string; links: string[] }
  /** Answer to a bot's `invite:lookup`: the OpenChat a ticket belongs to (`found: false` when LINE does not know it). */
  | { type: "invite:lookup"; requestId: string; chatId: string; found: boolean; squareMid?: string }
  /** Answer to a bot's `thread:fetch`: one OpenChat thread's messages (read-only), oldest first. */
  | { type: "thread"; requestId: string; chatId: string; threadId: string; messages: Message[] }
  /** An OpenChat's note count changed (a note was posted or removed): bots may list notes again. */
  | { type: "note:status"; chatIds: string[]; noteCount?: number; latestCreatedAt?: number }
  /** Answer to a client `ping`: lets the page tell a silent connection from a dead one. */
  | { type: "pong" }
  | { type: "error"; requestId?: string; code: string; message: string };

export type ClientFrame =
  | { type: "auth:start" }
  | { type: "auth:logout" }
  | { type: "history:fetch"; requestId: string; chatId: string; limit?: number; before?: string }
  | { type: "message:send"; requestId: string; chatId: string; text?: string; mentions?: Mention[]; mediaId?: string; sticker?: { packageId: number; stickerId: number } }
  | { type: "chat:read"; chatId: string; messageId: string }
  /** Take back one of this account's own messages (pages only; bots cannot). */
  | { type: "message:unsend"; requestId: string; chatId: string; messageId: string }
  /** Set this account's reaction (`null` takes it back). Pages only. */
  | { type: "message:react"; requestId: string; chatId: string; messageId: string; reaction: ReactionKind | null }
  /** Rate a received text message (someone else's, shown by this server) with Jev. Bots only within `api.chats`. */
  | { type: "scam:check"; requestId: string; chatId: string; messageId: string }
  /** Bots only, with `api.moderation`: remove the sender of a message shown by this server (and, in OpenChat, delete it). */
  | { type: "member:remove"; requestId: string; chatId: string; messageId: string; deleteMessage?: boolean }
  /** Bots only, with `api.moderation`: delete someone else's message for everyone (OpenChat, this account a manager). */
  | { type: "message:delete"; requestId: string; chatId: string; messageId: string }
  /** Bots only, read-only: the OpenChat's recent notes (記事本). */
  | { type: "notes:list"; requestId: string; chatId: string; limit?: number }
  /** Bots only, read-only: this OpenChat's own invitation links as LINE already shows them (never creates or resets one). */
  | { type: "invite:own"; requestId: string; chatId: string }
  /** Bots only, read-only: which OpenChat an invitation ticket (from a QR code) belongs to; never joins. */
  | { type: "invite:lookup"; requestId: string; chatId: string; ticket: string }
  /** Bots only, read-only: one OpenChat thread's (討論串) messages; never joins the thread or marks it read. */
  | { type: "thread:fetch"; requestId: string; chatId: string; threadId: string; limit?: number }
  /** Bots only, with `api.moderation`: the picture of an image message shown by this server (e.g. to read QR codes). */
  | { type: "media:fetch"; requestId: string; chatId: string; messageId: string }
  | { type: "file:fetch"; requestId: string; chatId: string; messageId: string }
  /** This account's own id, name and picture, on demand (pages and bots alike). */
  | { type: "profile:get"; requestId: string }
  | { type: "stickers:list"; requestId: string }
  | { type: "api:token:create"; requestId?: string }
  | { type: "api:token:revoke"; requestId?: string }
  | { type: "channels:refresh" }
  | { type: "ping" };
