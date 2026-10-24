// 叫名字就回應：訊息文字裡直接叫本人（例如「阿華你好」「問一下阿華」）時，跟 @ 一樣交給小助手。
// 只在「對本人說話」時觸發；只是在講他（「阿華的機器人剛剛…」「跟阿華說」）不觸發。
// 純規則判斷（便宜、可測），不呼叫模型。

// 簡體常用字 → 繁體（只轉判斷會用到的字）。
const SIMPLIFIED = { 轩: "軒", 华: "華", 问: "問", 请: "請", 谢: "謝", 吗: "嗎", 帮: "幫", 说: "說", 这: "這", 个: "個", 么: "麼", 会: "會", 认: "認", 觉: "覺", 欢: "歡", 麻: "麻", 烦: "煩", 们: "們", 对: "對", 吧: "吧" };
const toTraditional = (text) => String(text ?? "").replace(/[轩华问请谢吗帮说这个么会认觉欢烦们对]/g, (ch) => SIMPLIFIED[ch] ?? ch);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 去掉 @ 標記的那段、引號裡的內容、以 > 開頭的引用行。 */
export function stripQuotedAndMentions(text, mentions = []) {
  let out = String(text ?? "");
  for (const m of [...(mentions ?? [])].filter((m) => Number.isInteger(m?.start) && Number.isInteger(m?.end)).sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, m.start)} ${out.slice(m.end)}`;
  }
  return out
    .split("\n").filter((line) => !/^\s*[>＞]/.test(line)).join("\n")
    .replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"|【引用】[\s\S]*$/g, " ");
}

/**
 * names：本人的名字（例如 ["阿華"]）。名字後面可接常見稱呼（割割／哥／大大）。
 * 回傳 true＝在叫本人。
 */
export function makeNameMatcher(names, { botName = false } = {}) {
  const list = [...new Set((names ?? []).map((n) => toTraditional(String(n ?? "").trim())).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return () => false;
  const N = `(?:${list.map(escape).join("|")})(?:割割|哥哥|哥|大大|大)?`;
  const GREET = "(?:嗨|hi|hey|hello|哈囉|哈嘍|安安|早安|午安|晚安|欸|誒|喂|ㄟ|請問|問一下|問個|想問|問問|請教|拜託|麻煩|謝謝|感謝|多謝|謝啦|thx|thanks)";
  // 名字在句首（前面可有招呼語），後面是標點、第二人稱、請求或問句。
  const lead = new RegExp(`^\\s*(?:${GREET}\\s*[,，、~～!！]?\\s*)?${N}\\s*(?:$|[,，、:：!！?？~～.。…]|\\s|你|妳|您|請|在嗎|在不在|在?\\s*嗎|幫|可以|可不可以|能不能|能否|有沒有|知道|覺得|認為|怎麼|如何|是不是|會不會|要不要|快|救|help)`, "i");
  // 句中：招呼語／請求語直接接名字。
  const greet = new RegExp(`${GREET}\\s*[,，、~～]?\\s*${N}(?![的他她])`, "i");
  // 名字在句尾（前面是問句／請求，或後面只有標點）：「這是詐騙嗎阿華」「幫我看一下 阿華」。
  const tail = new RegExp(`(?:[?？嗎呢吧啊呀喔哦啦嘛!！~～,，]|一下|看看|謝謝)\\s*${N}\\s*[?？!！~～.。…]*\\s*$`, "i");
  // 名字後面直接接第二人稱：「…阿華你覺得呢」
  const second = new RegExp(`${N}\\s*[,，]?\\s*(?:你|妳|您)`, "i");
  const any = new RegExp(N, "i");
  const botLead = new RegExp(`^\\s*(?:${GREET}\\s*[,，、~～!！]?\\s*)?${N}(?!\\s*${N}\\s*$)\\s*\\S`, "i");
  // 不是「阿」開頭的名字（例如「華哥」）可能是別人名字的一部分（「子華哥」）：前面緊接著漢字，
  // 而且那個漢字不是招呼語／語助詞的結尾，就當成別人的名字，先換掉。
  const loose = list.filter((n) => !n.startsWith("阿"));
  const partOfOther = loose.length ? new RegExp(`(\\p{Script=Han})(?=${loose.map(escape).join("|")})`, "gu") : undefined;
  const okBefore = new RegExp(`(?:${GREET}|[阿嗎呢吧啊呀喔哦啦嘛])$`, "i");
  const maskOthers = (text) => {
    if (!partOfOther) return text;
    let out = "";
    let last = 0;
    for (const m of text.matchAll(partOfOther)) {
      const end = m.index + m[0].length;
      if (okBefore.test(text.slice(0, end))) continue;
      const name = loose.find((n) => text.startsWith(n, end));
      out += `${text.slice(last, end)}＊${"＊".repeat(name.length - 1)}`;
      last = end + name.length;
    }
    return out + text.slice(last);
  };
  return (text, mentions) => {
    const cleaned = maskOthers(toTraditional(stripQuotedAndMentions(text, mentions)).trim());
    if (!any.test(cleaned)) return false;
    // 機器人專屬名字（例如守護貓的名字，不是真人名）：句首叫名字後面直接接指令也算（「喵嗚查詢…」）。
    if (botName && botLead.test(cleaned)) return true;
    return lead.test(cleaned) || greet.test(cleaned) || tail.test(cleaned) || second.test(cleaned);
  };
}

/** 每個聊天室叫名字觸發的冷卻：回 true＝可以回，並記下時間。 */
export function makeGroupCooldown(seconds, now = () => Date.now()) {
  const last = new Map();
  return (chatId) => {
    const t = now();
    if (t - (last.get(chatId) ?? -Infinity) < seconds * 1000) return false;
    last.set(chatId, t);
    return true;
  };
}
