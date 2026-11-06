// 踢人／刪文總關卡（2026-11-06：受保護成員換新 ID 後被踢）。
// guard.mjs 的 sendKick／call，以及 ws.send 最後一道，還有 manual-kick-once.mjs，都走這裡。
// 只會更保守，不改詐騙評分門檻，也不會把新 ID 寫進 protectedIds。
import { existsSync, readFileSync } from "node:fs";
import { kickModeFor } from "./policy.mjs";

export const ENFORCEMENT_FRAMES = new Set(["member:remove", "message:delete", "message:unsend"]);
export const DEFAULT_NO_KICK_FLAG = "/home/antiscam/GUARD_NO_KICK";
export const DEFAULT_NO_KICK_CHATS = "/home/antiscam/GUARD_NO_KICK_CHATS";
/** 士軒 2026-11-06 08:32「先關Hao踢人」。這三群不自動踢；groupPolicies[id].autoKick=true 才重新允許。 */
export const HAO_KICK_NOTE = "2026-11-06 08:32 士軒「先關Hao踢人」。此群不自動踢。";
export const HAO_NO_AUTO_KICK = [
  { chatId: "m6e67dc9769ef0f015e9bf37110ea4b9e", label: "Claude Code", kickNote: HAO_KICK_NOTE },
  { chatId: "m4326d9310ae6a55d7aa25f7bf5f8d596", label: "Codex", kickNote: HAO_KICK_NOTE },
  { chatId: "m428a4fc16b94b601aadd924056883c86", label: "xAI Grok", kickNote: HAO_KICK_NOTE },
];

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFFC\uFFFD\u3164\u115F\u1160]/g;

/** 名稱正規化：NFKC、去隱形字元／物件取代字元（￼）、去空白與符號、小寫。 */
export function normalizeGuardName(name) {
  if (typeof name !== "string") return "";
  return name.normalize("NFKC").replace(INVISIBLE, "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

/** protectedIds 的 note 取名稱：第一個括號、空白或逗號前的字。 */
export function nameFromNote(note) {
  if (typeof note !== "string") return "";
  return note.split(/[（(\s，,]/)[0].trim();
}

function editDistanceAtMost1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    diff += 1;
    if (diff > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/** 相同或相似：正規化後相同；或兩邊都 ≥3 字且編輯距離 ≤1；或一方 ≥2 字且被另一方包含。 */
export function similarName(a, b) {
  const x = normalizeGuardName(a);
  const y = normalizeGuardName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && editDistanceAtMost1(x, y)) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= 2 && longer.includes(shorter);
}

/** 從設定收集受保護 ID 與受保護名稱。不寫回設定。 */
export function protectedFromConfig(config = {}) {
  const ids = new Set(config.whitelist ?? []);
  const names = new Set();
  for (const entry of config.protectedIds ?? []) {
    if (typeof entry === "string") { ids.add(entry); continue; }
    for (const id of [...(entry?.ids ?? []), ...(entry?.id ? [entry.id] : [])]) ids.add(id);
    const name = entry?.name ?? nameFromNote(entry?.note);
    if (name) names.add(name);
  }
  for (const entry of config.protectedMembers ?? []) {
    for (const id of entry?.ids ?? []) ids.add(id);
    if (entry?.name) names.add(entry.name);
  }
  for (const name of config.protectedNames ?? []) if (name) names.add(name);
  return { ids, names: [...names] };
}

export function noKickPaths(config = {}, env = process.env) {
  return {
    flagFile: config?.enforcement?.noKickFlagFile ?? env.GUARD_NO_KICK_FILE ?? DEFAULT_NO_KICK_FLAG,
    chatsFile: config?.enforcement?.noKickChatsFile ?? env.GUARD_NO_KICK_CHATS_FILE ?? DEFAULT_NO_KICK_CHATS,
  };
}

/** 熱修旗標：全域檔存在，或按群檔含這個聊天室，就不送 member:remove。 */
export function readNoKickFlags({ flagFile = DEFAULT_NO_KICK_FLAG, chatsFile = DEFAULT_NO_KICK_CHATS, exists = existsSync, read = readFileSync } = {}) {
  let chats = [];
  try { chats = String(read(chatsFile, "utf8")).split(/\s+/).filter(Boolean); } catch { chats = []; }
  let global = false;
  try { global = exists(flagFile); } catch { global = false; }
  return { global, chats: new Set(chats) };
}

export function noAutoKickSet(groupPolicies = {}) {
  const ids = new Set(HAO_NO_AUTO_KICK.map((entry) => entry.chatId));
  for (const [chatId, policy] of Object.entries(groupPolicies ?? {})) {
    if (policy?.autoKick === true) ids.delete(chatId);
  }
  return ids;
}

export function kickNoteFor(chatId, groupPolicies = {}) {
  const fromConfig = groupPolicies?.[chatId]?.kickNote;
  if (typeof fromConfig === "string" && fromConfig.trim()) return fromConfig.trim();
  return HAO_NO_AUTO_KICK.find((entry) => entry.chatId === chatId)?.kickNote;
}

/**
 * @param {object} [options]
 * @param {() => boolean} [options.killSwitch]
 * @param {(chatId: string) => "kick"|"notify"} [options.kickModeOf]
 * @param {Set<string>} [options.protectedIds]
 * @param {string[]} [options.protectedNames]
 * @param {string|(() => string)} [options.self]
 * @param {Set<string>} [options.noAutoKickChats]
 * @param {(chatId: string) => string} [options.kickNoteOf]
 * @param {() => { global: boolean, chats: Set<string> }} [options.noKickState]
 */
export function makeEnforcementGate({
  killSwitch = () => false,
  kickModeOf = () => "notify",
  protectedIds = new Set(),
  protectedNames = [],
  self,
  noAutoKickChats = new Set(),
  kickNoteOf = () => undefined,
  noKickState = () => ({ global: false, chats: new Set() }),
  maxIds = 20_000,
} = {}) {
  const senders = new Map();
  function note(message) {
    if (!message?.messageId) return;
    senders.set(message.messageId, { senderId: message.senderId, senderName: message.senderName });
    if (senders.size > maxIds) senders.delete(senders.keys().next().value);
  }
  function matchProtectedName(name) {
    return protectedNames.find((protectedName) => similarName(name, protectedName));
  }
  function check(frame, hint = {}) {
    if (!frame || !ENFORCEMENT_FRAMES.has(frame.type)) return { allow: true };
    const noted = senders.get(frame.messageId) ?? {};
    const who = { ...noted, ...Object.fromEntries(Object.entries(hint ?? {}).filter(([, value]) => value !== undefined)) };
    const mine = typeof self === "function" ? self() : self;
    if (frame.type === "member:remove") {
      let flags = { global: false, chats: new Set() };
      try { flags = noKickState() ?? flags; } catch { flags = { global: false, chats: new Set() }; }
      if (flags.global || flags.chats?.has?.(frame.chatId)) return { allow: false, reason: "no-kick-switch", senderId: who.senderId };
      if (noAutoKickChats.has(frame.chatId)) return { allow: false, reason: "recorded-kick-note", kickNote: kickNoteOf(frame.chatId), senderId: who.senderId };
    }
    if (killSwitch()) return { allow: false, reason: "kill-switch", senderId: who.senderId };
    if (frame.type === "member:remove" && kickModeOf(frame.chatId) !== "kick") return { allow: false, reason: "kickMode-notify", senderId: who.senderId };
    if (who.senderId && (protectedIds.has(who.senderId) || who.senderId === mine)) return { allow: false, reason: "protected-id", senderId: who.senderId };
    const matched = who.senderName ? matchProtectedName(who.senderName) : undefined;
    if (matched) return { allow: false, reason: "protected-name-hold", hold: true, matched, senderId: who.senderId };
    if (frame.type === "member:remove" && !who.senderId && !who.senderName) return { allow: false, reason: "unknown-sender-hold", hold: true };
    return { allow: true };
  }
  return { note, check, matchProtectedName, size: () => senders.size };
}

/** 守衛與手動腳本共用的同一套設定解讀。 */
export function gateForConfig(config = {}, { env = process.env, self } = {}) {
  const protectedInfo = protectedFromConfig(config);
  const noAutoKickChats = noAutoKickSet(config.groupPolicies);
  const globalMode = config.kickMode === "notify" ? "notify" : "kick";
  const killSwitchOn = () => config.enforcement?.killSwitch === true;
  const flagsNow = () => readNoKickFlags(noKickPaths(config, env));
  const chatKickMode = (chatId) => {
    if (killSwitchOn()) return "notify";
    if (noAutoKickChats.has(chatId)) return "notify";
    const flags = flagsNow();
    if (flags.global || flags.chats.has(chatId)) return "notify";
    return kickModeFor(chatId, { globalMode, groupPolicies: config.groupPolicies ?? {} });
  };
  const gate = makeEnforcementGate({
    killSwitch: killSwitchOn,
    kickModeOf: chatKickMode,
    protectedIds: protectedInfo.ids,
    protectedNames: protectedInfo.names,
    self,
    noAutoKickChats,
    kickNoteOf: (chatId) => kickNoteFor(chatId, config.groupPolicies),
    noKickState: flagsNow,
  });
  return { protectedInfo, killSwitchOn, chatKickMode, globalMode, gate, noAutoKickChats };
}
