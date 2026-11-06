import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeEnforcementGate, protectedFromConfig, similarName, normalizeGuardName, ENFORCEMENT_FRAMES, HAO_NO_AUTO_KICK, HAO_KICK_NOTE, gateForConfig, noAutoKickSet, readNoKickFlags, DEFAULT_NO_KICK_FLAG, DEFAULT_NO_KICK_CHATS } from "../guard/enforcement-gate.mjs";
import { planManualKick } from "../guard/manual-kick-once.mjs";

const cfg = {
  whitelist: ["pWL1"],
  protectedIds: [{ note: "BotStar（某群 coAdmin；士軒核准）", ids: ["pOLD1", "pOLD2"] }, "pPLAIN"],
  protectedMembers: [{ name: "AdminA", ids: ["pADM"] }],
  protectedNames: ["Mini"],
};
const prot = protectedFromConfig(cfg);
const gate = (options = {}) => makeEnforcementGate({ protectedIds: prot.ids, protectedNames: prot.names, kickModeOf: () => "kick", ...options });

test("protectedFromConfig 收齊 ID 與名稱，且不改原設定", () => {
  for (const id of ["pWL1", "pOLD1", "pOLD2", "pPLAIN", "pADM"]) assert.ok(prot.ids.has(id), id);
  assert.deepEqual(new Set(prot.names), new Set(["BotStar", "AdminA", "Mini"]));
  assert.deepEqual(cfg.protectedIds[0].ids, ["pOLD1", "pOLD2"]);
});

test("killSwitch 擋住踢與刪；一般訊息放行", () => {
  const g = gate({ killSwitch: () => true });
  g.note({ messageId: "m1", senderId: "pX", senderName: "scammer" });
  for (const type of ENFORCEMENT_FRAMES) assert.equal(g.check({ type, chatId: "c", messageId: "m1" }).reason, "kill-switch", type);
  assert.equal(g.check({ type: "message:send", chatId: "c" }).allow, true);
});

test("kickMode=notify 不踢；刪文仍放行。每群覆寫 kick 仍可踢", () => {
  const notify = gate({ kickModeOf: () => "notify" });
  notify.note({ messageId: "m1", senderId: "pX", senderName: "scammer" });
  assert.equal(notify.check({ type: "member:remove", chatId: "any", messageId: "m1" }).reason, "kickMode-notify");
  assert.equal(notify.check({ type: "message:delete", chatId: "any", messageId: "m1" }).allow, true);
  const mixed = gate({ kickModeOf: (chatId) => (chatId === "cKick" ? "kick" : "notify") });
  mixed.note({ messageId: "m1", senderId: "pX", senderName: "scammer" });
  assert.equal(mixed.check({ type: "member:remove", chatId: "cKick", messageId: "m1" }).allow, true);
  assert.equal(mixed.check({ type: "member:remove", chatId: "cOther", messageId: "m1" }).reason, "kickMode-notify");
});

test("白名單 ID 不踢不刪", () => {
  const g = gate();
  for (const id of ["pWL1", "pOLD1", "pADM", "pPLAIN"]) {
    g.note({ messageId: `m-${id}`, senderId: id, senderName: "whatever" });
    for (const type of ENFORCEMENT_FRAMES) assert.equal(g.check({ type, chatId: "c", messageId: `m-${id}` }).reason, "protected-id", id + type);
  }
});

test("受保護名稱換新 ID：暫緩，不踢不刪，不加入可信 ID", () => {
  const g = gate();
  const before = prot.ids.size;
  for (const [i, name] of ["\uFFFCBotStar", "BotStar", "BotStar "].entries()) {
    g.note({ messageId: `n${i}`, senderId: `pNEW${i}`, senderName: name });
    for (const type of ENFORCEMENT_FRAMES) {
      const result = g.check({ type, chatId: "c", messageId: `n${i}` });
      assert.equal(result.allow, false);
      assert.equal(result.hold, true);
      assert.equal(result.reason, "protected-name-hold");
      assert.equal(result.matched, "BotStar");
    }
  }
  assert.equal(prot.ids.has("pNEW0"), false);
  assert.equal(prot.ids.size, before);
});

test("相似名稱只暫緩，不自動放行、也不加入可信", () => {
  const g = gate();
  for (const name of ["BotStarr", "B0tStar", "BotStar官方", "mini", "Mini 小幫手"]) {
    g.note({ messageId: name, senderId: "pFAKE", senderName: name });
    assert.equal(g.check({ type: "member:remove", chatId: "c", messageId: name }).hold, true, name);
  }
  assert.equal(prot.ids.has("pFAKE"), false);
  assert.equal(gate().check({ type: "member:remove", chatId: "c", messageId: "x" }, { senderId: "pFAKE", senderName: "BotStar" }).hold, true);
});

test("一般詐騙者可踢；查不到發訊者的踢人暫緩；無關名字不暫緩", () => {
  const g = gate();
  g.note({ messageId: "s1", senderId: "pSCAM", senderName: "投資老師Amy" });
  assert.equal(g.check({ type: "member:remove", chatId: "c", messageId: "s1" }).allow, true);
  assert.equal(g.check({ type: "member:remove", chatId: "c", messageId: "unknown" }).reason, "unknown-sender-hold");
  assert.equal(similarName("王小明", "BotStar"), false);
  assert.equal(similarName("AdminB", "AdminA"), true);
  assert.equal(normalizeGuardName("\uFFFC Bot.Star "), "botstar");
});

test("旗標檔：存在就擋 member:remove，不存在就不擋；按群清單只擋列出的群", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-flag-"));
  const flag = join(dir, "GUARD_NO_KICK");
  const chats = join(dir, "GUARD_NO_KICK_CHATS");
  const absent = join(dir, "absent");
  const open = gate({ noKickState: () => readNoKickFlags({ flagFile: absent, chatsFile: absent }) });
  open.note({ messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" });
  assert.equal(open.check({ type: "member:remove", chatId: "cA", messageId: "m1" }).allow, true);
  writeFileSync(flag, "");
  const global = gate({ noKickState: () => readNoKickFlags({ flagFile: flag, chatsFile: absent }) });
  global.note({ messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" });
  assert.equal(global.check({ type: "member:remove", chatId: "cA", messageId: "m1" }).reason, "no-kick-switch");
  assert.equal(global.check({ type: "message:delete", chatId: "cA", messageId: "m1" }).allow, true);
  writeFileSync(chats, `${HAO_NO_AUTO_KICK[0].chatId}\ncOther\n`);
  const listed = gate({ noKickState: () => readNoKickFlags({ flagFile: absent, chatsFile: chats }) });
  listed.note({ messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" });
  assert.equal(listed.check({ type: "member:remove", chatId: "cA", messageId: "m1" }).allow, true);
  assert.equal(listed.check({ type: "member:remove", chatId: "cOther", messageId: "m1" }).reason, "no-kick-switch");
});

test("Hao 三群預設不自動踢，kickNote 寫明 2026-11-06 08:32；autoKick 才恢復", () => {
  assert.equal(HAO_NO_AUTO_KICK.length, 3);
  for (const entry of HAO_NO_AUTO_KICK) {
    assert.match(entry.kickNote, /2026-11-06 08:32/);
    assert.match(entry.kickNote, /先關Hao踢人/);
    assert.equal(entry.kickNote, HAO_KICK_NOTE);
  }
  const quiet = { GUARD_NO_KICK_FILE: "/tmp/guard-no-kick-absent", GUARD_NO_KICK_CHATS_FILE: "/tmp/guard-no-kick-chats-absent" };
  const armed = gateForConfig({ kickMode: "kick", kickScope: { allChats: true } }, { env: quiet });
  armed.gate.note({ messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" });
  for (const entry of HAO_NO_AUTO_KICK) {
    const result = armed.gate.check({ type: "member:remove", chatId: entry.chatId, messageId: "m1" });
    assert.equal(result.reason, "recorded-kick-note", entry.label);
    assert.match(result.kickNote, /先關Hao踢人/);
    assert.equal(armed.chatKickMode(entry.chatId), "notify");
  }
  const reopened = "m6e67dc9769ef0f015e9bf37110ea4b9e";
  const allow = gateForConfig({ kickMode: "kick", groupPolicies: { [reopened]: { autoKick: true } } }, { env: quiet });
  allow.gate.note({ messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" });
  assert.equal(allow.gate.check({ type: "member:remove", chatId: reopened, messageId: "m1" }).allow, true);
  assert.equal(noAutoKickSet({ [reopened]: { autoKick: true } }).has(reopened), false);
  const example = JSON.parse(readFileSync(new URL("../guard/guard.config.example.json", import.meta.url), "utf8"));
  for (const entry of HAO_NO_AUTO_KICK) assert.match(example.groupPolicies[entry.chatId].kickNote, /2026-11-06 08:32 士軒「先關Hao踢人」/);
});

test("手動腳本與守衛走同一關卡：旗標、Hao、換新 ID 都不連線，且不新增 ID", () => {
  const dir = mkdtempSync(join(tmpdir(), "manual-kick-"));
  const flag = join(dir, "GUARD_NO_KICK");
  const chats = join(dir, "GUARD_NO_KICK_CHATS");
  writeFileSync(flag, "");
  const config = { kickMode: "kick", protectedIds: [{ note: "BotStar（測試）", ids: ["pOLD"] }], enforcement: { noKickFlagFile: flag, noKickChatsFile: chats } };
  const flagged = planManualKick({ config, frame: { chatId: "cA", messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" } });
  assert.equal(flagged.decision.reason, "no-kick-switch");
  assert.deepEqual(flagged.addedIds, []);
  const hao = planManualKick({
    config: { kickMode: "kick", enforcement: { noKickFlagFile: join(dir, "absent"), noKickChatsFile: chats } },
    frame: { chatId: HAO_NO_AUTO_KICK[1].chatId, messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" },
  });
  assert.equal(hao.decision.reason, "recorded-kick-note");
  const renamed = planManualKick({
    config: { kickMode: "kick", protectedIds: [{ note: "BotStar（測試）", ids: ["pOLD"] }], enforcement: { noKickFlagFile: join(dir, "absent"), noKickChatsFile: chats } },
    frame: { chatId: "cA", messageId: "m9", senderId: "pNEW", senderName: "\uFFFCBotStar" },
  });
  assert.equal(renamed.decision.hold, true);
  assert.equal(renamed.decision.reason, "protected-name-hold");
  assert.deepEqual(renamed.addedIds, []);
  assert.equal(renamed.protectedIds.includes("pNEW"), false);
  const allowed = planManualKick({
    config: { kickMode: "kick", enforcement: { noKickFlagFile: join(dir, "absent"), noKickChatsFile: chats } },
    frame: { chatId: "cA", messageId: "m1", senderId: "pSCAM", senderName: "投資老師Amy" },
  });
  assert.equal(allowed.decision.allow, true);
});

test("手動腳本 --check 在關卡擋下時結束，且原始碼在連線前先判斷", () => {
  const dir = mkdtempSync(join(tmpdir(), "manual-cli-"));
  const configPath = join(dir, "guard.config.json");
  const flag = join(dir, "GUARD_NO_KICK");
  writeFileSync(flag, "");
  writeFileSync(configPath, JSON.stringify({ kickMode: "kick", enforcement: { noKickFlagFile: flag, noKickChatsFile: join(dir, "no-chats") } }));
  const blocked = spawnSync(process.execPath, ["guard/manual-kick-once.mjs", "--config", configPath, "--chat", "cA", "--message", "m1", "--sender", "pSCAM", "--name", "投資老師Amy", "--check"], { encoding: "utf8" });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /no-kick-switch/);
  assert.equal(blocked.stdout, "");
  writeFileSync(flag, "");
  const openConfig = join(dir, "open.json");
  writeFileSync(openConfig, JSON.stringify({ kickMode: "kick", enforcement: { noKickFlagFile: join(dir, "absent"), noKickChatsFile: join(dir, "absent-chats") } }));
  const allowed = spawnSync(process.execPath, ["guard/manual-kick-once.mjs", "--config", openConfig, "--chat", "cA", "--message", "m1", "--sender", "pSCAM", "--name", "投資老師Amy", "--check"], { encoding: "utf8" });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).allow, true);
  const src = readFileSync(new URL("../guard/manual-kick-once.mjs", import.meta.url), "utf8");
  assert.ok(src.indexOf("planManualKick") < src.indexOf("new WebSocket"));
  assert.equal(src.includes("writeFileSync"), false);
});

test("guard.mjs：踢人與刪文都先經過總關卡，forced 不能繞過 notify", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(src, /function sendKick\(ws, frame, hint\) \{\n  if \(enforcementBlocked\(frame, hint\)\) return;/);
  assert.match(src, /function call\(ws, frame, timeoutMs = 30_000, hint\) \{\n  const blocked = enforcementBlocked\(frame, hint\);/);
  assert.match(src, /const blocked = frame \? enforcementBlocked\(frame\) : null;/);
  assert.equal((src.match(/ws\.send\(JSON\.stringify\(\{ type: "member:remove"/g) ?? []).length, 0);
  const removes = [...src.matchAll(/sendKick\(ws, \{ type: "member:remove"/g)].length;
  const frames = [...src.matchAll(/\{ type: "member:remove"/g)].length;
  assert.equal(removes, 3);
  assert.equal(frames, removes + 1, "多出來的那一個是 gateKickStop 交給總關卡的 frame，不是送出");
  assert.match(src, /function gateKickStop\(message\) \{\n  const frame = \{ type: "member:remove"/);
  assert.match(src, /const forced = mode === "kick" && \(entry\.forceScopeKick === true \|\| config\.kickScope\?\.allChats === true\)/);
  assert.match(src, /const escalate = undefined;/);
  assert.match(src, /kickWithInvite === true && chatKickMode\(message\.channelId\) === "kick"/);
  assert.match(src, /const shopKickAllowed = chatKickMode\(message\.channelId\) === "kick";/);
  assert.match(src, /gateForConfig/);
  assert.match(src, /"no-kick-switch-skip"/);
  assert.match(src, /enforcement\.note\(message\)/);
  const gateSrc = readFileSync(new URL("../guard/enforcement-gate.mjs", import.meta.url), "utf8");
  assert.match(gateSrc, new RegExp(DEFAULT_NO_KICK_FLAG.replaceAll("/", "\\/")));
  assert.match(gateSrc, new RegExp(DEFAULT_NO_KICK_CHATS.replaceAll("/", "\\/")));
  assert.equal(DEFAULT_NO_KICK_FLAG, "/home/antiscam/GUARD_NO_KICK");
  assert.equal(DEFAULT_NO_KICK_CHATS, "/home/antiscam/GUARD_NO_KICK_CHATS");
});
