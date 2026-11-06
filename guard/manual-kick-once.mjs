// 一次性手動踢人。member:remove 先經過與 guard.mjs 相同的 enforcement-gate；
// 關卡不允許就不連線、不送。不會把新 ID 寫進 protectedIds，也不會把 Token 印出來。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gateForConfig } from "./enforcement-gate.mjs";

function arg(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** 只判斷，不連線、不改設定。 */
export function planManualKick({ config = {}, frame = {}, env = process.env } = {}) {
  const armed = gateForConfig(config, { env });
  const before = [...armed.protectedInfo.ids];
  if (frame.messageId) armed.gate.note({ messageId: frame.messageId, senderId: frame.senderId, senderName: frame.senderName });
  const decision = armed.gate.check(
    { type: "member:remove", chatId: frame.chatId, messageId: frame.messageId },
    { senderId: frame.senderId, senderName: frame.senderName },
  );
  const after = [...armed.protectedInfo.ids];
  return { decision, protectedIds: before, addedIds: after.filter((id) => !before.includes(id)) };
}

async function sendRemove({ url, token, frame }) {
  const { default: WebSocket } = await import("ws");
  await new Promise((done, fail) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => { ws.close(); fail(new Error("TIMEOUT")); }, 15_000);
    ws.on("error", () => { clearTimeout(timer); fail(new Error("CONNECT_FAILED")); });
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === "auth:ready") {
        ws.send(JSON.stringify({ type: "member:remove", chatId: frame.chatId, messageId: frame.messageId, deleteMessage: frame.deleteMessage === true }));
        return;
      }
      if (msg.type === "member:removed" || (msg.type === "error" && msg.requestId === undefined)) {
        clearTimeout(timer);
        ws.close();
        if (msg.type === "error") fail(new Error(typeof msg.code === "string" ? msg.code : "REMOVE_FAILED"));
        else done(msg);
      }
    });
  });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const configPath = arg(argv, "--config");
  if (!configPath || argv.includes("--help")) {
    console.error("用法：node guard/manual-kick-once.mjs --config <guard.config.json> --chat <聊天室> --message <訊息> [--sender <ID>] [--name <名稱>] [--delete] [--check]");
    return 1;
  }
  const frame = {
    chatId: arg(argv, "--chat"),
    messageId: arg(argv, "--message"),
    senderId: arg(argv, "--sender"),
    senderName: arg(argv, "--name"),
    deleteMessage: argv.includes("--delete"),
  };
  if (!frame.chatId || !frame.messageId) {
    console.error("缺少 --chat 或 --message");
    return 1;
  }
  let config;
  try { config = JSON.parse(readFileSync(resolve(configPath), "utf8")); } catch {
    console.error("無法讀取設定檔");
    return 1;
  }
  const plan = planManualKick({ config, frame, env });
  if (plan.addedIds.length) {
    console.error("手動踢人不得改寫 protectedIds");
    return 1;
  }
  if (!plan.decision.allow) {
    console.error(`手動踢人已擋下：${plan.decision.reason}`);
    return 2;
  }
  if (argv.includes("--check")) {
    console.log(JSON.stringify({ allow: true, chatId: frame.chatId, messageId: frame.messageId }));
    return 0;
  }
  let token = env.LINEJS_TOKEN ?? "";
  if (!token && config.tokenFile) {
    try { token = readFileSync(resolve(dirname(configPath), config.tokenFile), "utf8").trim(); }
    catch { console.error("無法讀取 Token 檔"); return 1; }
  }
  const url = env.LINEJS_URL ?? config.url;
  if (!token || !url) {
    console.error("缺少連線設定");
    return 1;
  }
  try {
    await sendRemove({ url, token, frame });
    console.log("已送出手動踢人");
    return 0;
  } catch (error) {
    console.error(`手動踢人失敗：${error?.message ?? "REMOVE_FAILED"}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().then((code) => process.exit(code));
}
