// 假冒管理員偵測（暱稱＋頭像）：詐騙者常把暱稱取成「管理員」「小幫手」「官方客服」，
// 夾看不見的字元或一堆裝飾符號，頭像放假的管理員皇冠／官方徽章，假裝是管理員。
// 這裡只放純函式（好測試）；排除真管理員、受保護成員、本帳號，以及通知／踢人的決定都在 guard.mjs。

// 看不見或顯示不出來的字元：零寬字元、方向控制、Hangul 填充字、點字空白、軟連字號、蒙古文變體選擇符、標籤字元。
export const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/u;
const INVISIBLE_ALL = new RegExp(INVISIBLE_RE.source, "gu");
// 私用區字元（一般字型顯示不出來）。U+FFFC（LINE 表情貼在暱稱裡常變成這個）很常見，不算。
const PRIVATE_USE_RE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
// 疊一堆組合符號（Zalgo 字）。
const COMBINING_RUN_RE = /\p{M}{3,}/u;
// 假的官方／管理員徽章符號（星星、愛心這類一般人常用的裝飾不算）。
const BADGE_RE = /[👑♔♕♚♛🔰✅☑✔✓🛡⚜🎖🏅®™Ⓥ]|[【〖［\[]\s*(官方|管理|客服|admin|official)/iu;
// 自稱管理員／官方的字眼（比對前已去掉空白、標點、符號、看不見的字元，「管 理 員」「管_理_員」也算）。
const STAFF_CJK_RE = /管理員|管理员|管理者|管理人|管理組|管理组|小幫手|小帮手|客服|官方|群主|版主|小編|小编|站長|站长|社長助理|管理團隊|管理团队/;
// 英文要整個字（badminton 不算 admin）；字母之間被符號隔開（a.d.m.i.n）也算。
const STAFF_EN_RE = /(?:^|[^a-z])(admin|administrator|moderator|official|support|staff|customer\s*service)(?:[^a-z]|$)/i;
const STAFF_EN_SPACED_RE = /(?:^|[^a-z])a\W{1,3}d\W{1,3}m\W{1,3}i\W{1,3}n(?:[^a-z]|$)/i;
// 常見的西里爾／希臘字母假冒拉丁字母（аdmіn）。
const CONFUSABLE = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ԁ": "d", "ѕ": "s", "м": "m", "п": "n", "т": "t", "ɑ": "a", "ο": "o", "ι": "i", "ν": "v", "α": "a" };
const EMOJI_RE = /\p{Extended_Pictographic}/u;
// 表情符號序列（含 ZWJ、變體選擇符、膚色）本身會用到零寬連接符，先拿掉再檢查看不見的字元。
const EMOJI_SEQ_ALL = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\uFE0E\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]|\u200D(?:\p{Extended_Pictographic}|[\u2640\u2642\u2695\u2696\u2708\u2764]))*\uFE0F?/gu;

function deconfuse(text) {
  return [...text].map((ch) => CONFUSABLE[ch] ?? ch).join("");
}

/**
 * 分析暱稱。回傳 { signals: [{ type, label }], compact }。
 * type：staff（自稱管理員）、blank（看起來是空白）、invisible（看不見／顯示不出來的字元）、badge（假徽章符號）、decor（大量裝飾符號）。
 */
export function analyzeName(rawName) {
  const raw = String(rawName ?? "");
  const signals = [];
  const add = (type, label) => { if (!signals.some((s) => s.type === type)) signals.push({ type, label }); };
  const normal = deconfuse(raw.normalize("NFKC")).toLowerCase();
  const visible = normal.replace(INVISIBLE_ALL, "");
  const compact = visible.replace(/[\s\p{P}\p{S}\p{C}\p{M}]/gu, "");
  if (STAFF_CJK_RE.test(compact) || STAFF_EN_RE.test(visible) || STAFF_EN_SPACED_RE.test(visible) || /^(admin|official|moderator)$/.test(compact)) add("staff", "暱稱自稱管理員／官方／小幫手");
  if (raw.length > 0 && visible.trim() === "") add("blank", "暱稱看起來是空白");
  const noEmoji = raw.replace(EMOJI_SEQ_ALL, "");
  if (INVISIBLE_RE.test(noEmoji) || PRIVATE_USE_RE.test(raw) || COMBINING_RUN_RE.test(raw.normalize("NFC"))) add("invisible", "暱稱含看不見或顯示不出來的字元");
  if (BADGE_RE.test(raw.normalize("NFKC"))) add("badge", "暱稱含假的官方／管理員徽章符號");
  const chars = [...visible.replace(/\s/g, "")];
  const decor = chars.filter((ch) => /[\p{P}\p{S}]/u.test(ch) && !EMOJI_RE.test(ch)).length;
  if (decor >= 4 && decor >= chars.length * 0.4) add("decor", "暱稱用大量裝飾符號");
  return { signals, compact };
}

/**
 * 綜合暱稱與頭像。sameGroupImpersonation：暱稱冒充同群群主／管理員（頭像訊號只在這時算數）。avatarCrown：頭像判定有假皇冠／官方徽章（true／false／undefined＝沒查）。
 * fake：算是假冒管理員；byName：光看暱稱就成立（可以進「冒名＋連結」踢人）；strong：兩種以上訊號（單獨也值得通知一次）。
 */
export function fakeAdminVerdict(signals, avatarCrown, sameGroupImpersonation = false) {
  const types = new Set(signals.map((s) => s.type));
  const byName = types.has("staff") || types.has("blank") || (types.has("invisible") && types.has("badge"));
  // 頭像判定靠地端小模型，常把一般照片看成皇冠（10/21 自拍誤判）：只有暱稱也冒充「同一個群」的群主／管理員時才算數，
  // 單獨或只搭配一般內容訊號（叫人私聊…）都不算。
  const avatar = avatarCrown === true && sameGroupImpersonation === true;
  // 頭像判定靠小模型，單獨不夠當踢人依據：要配上任何一種暱稱訊號才算 byName 等級。
  const byNameOrBacked = byName || (avatar && types.size > 0);
  const fake = byNameOrBacked || avatar;
  const count = types.size + (avatar ? 1 : 0);
  const labels = [...signals.map((s) => s.label), ...(avatar ? ["頭像放假的管理員皇冠／官方徽章"] : [])];
  return { fake, byName: byNameOrBacked, strong: fake && count >= 2, labels, weak: !fake && types.size > 0 };
}

/** 頭像媒體 ID（LINE.js 的 senderPictureId：avatar-p-…／avatar-o-…）→ 公開 CDN 網址；認不得回 undefined。 */
export function avatarUrl(pictureId) {
  const m = /^avatar(?:full)?-([po])-([A-Za-z0-9_-]{8,200})$/.exec(String(pictureId ?? ""));
  if (!m) return undefined;
  return `${m[1] === "p" ? "https://profile.line-scdn.net" : "https://obs.line-scdn.net"}/${m[2]}/preview`;
}

export const AVATAR_SYSTEM = `你在檢查 LINE 社群成員的大頭貼，判斷它是不是在「假裝成管理員／官方」。
看得到這些才算 YES：皇冠圖示、「管理員」「官方」「客服」「Admin」「Official」字樣、認證勾勾／官方徽章、仿 LINE 官方標誌。
一般人像、風景、動物、卡通、公司 logo、純文字以外的普通圖都算 NO。
第一行只能寫 YES 或 NO，第二行寫 15 字內理由。`;

/** 頭像模型回答 → true／false／undefined（看不懂）。 */
// 小模型常回 YES 但理由自相矛盾（「非官方」「沒有管理員字樣」）：YES 要有具體的皇冠／官方訊號，而且理由沒有否定，才算。
const AVATAR_CONCRETE = /皇冠|王冠|管理|官方|客服|admin|official|認證|徽章|勾勾|打勾|標誌|badge|crown/i;
const AVATAR_NEGATED = /非|不是|沒有|並無|無任何|不具|不符|未見|看不出/;
export function parseAvatarAnswer(answer) {
  const text = String(answer ?? "").trim();
  const first = text.split(/\s/)[0]?.toUpperCase().replace(/[^A-Z]/g, "") ?? "";
  if (first.startsWith("YES")) {
    const reason = text.replace(/^\S+/, "");
    return AVATAR_CONCRETE.test(reason) && !AVATAR_NEGATED.test(reason);
  }
  if (first.startsWith("NO")) return false;
  return undefined;
}

/** 頭像判定快取（只存 ID 雜湊 → 判定與時間）；過期與上限修剪。 */
export function pruneAvatarCache(cache, now = Date.now(), ttlMs = 30 * 86_400_000, max = 5000) {
  for (const [key, value] of Object.entries(cache)) if (!value || now - value.at > ttlMs) delete cache[key];
  const keys = Object.keys(cache);
  if (keys.length > max) for (const key of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - max)) delete cache[key];
  return cache;
}
