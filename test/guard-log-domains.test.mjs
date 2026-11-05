import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { domainsOf, createDomainLog } from "../guard/log-domains.mjs";

test("domainsOf：只記主機名，不記路徑與參數，去 www、小寫、去重", () => {
  assert.deepEqual(domainsOf("看 https://WWW.Example.com/a/b?token=x&id=1 還有 http://example.com/c 跟 https://shop.test/p?q=1"), ["example.com", "shop.test"]);
  assert.deepEqual(domainsOf("沒有連結"), []);
  const many = Array.from({ length: 8 }, (_, i) => `https://d${i}.test/x`).join(" ");
  assert.equal(domainsOf(many).length, 5);
});

test("createDomainLog.tag：有網址的 messageId 才加 domains，其他欄位不動", () => {
  const log = createDomainLog(3);
  log.note("m1", "https://news.test/article/1?utm=a");
  const entry = { action: "outbound-gated", messageId: "m1", score: 7, names: ["x"] };
  const tagged = log.tag(entry);
  assert.deepEqual(tagged, { ...entry, domains: ["news.test"] });
  assert.equal(entry.domains, undefined, "不改原物件");
  assert.ok(!JSON.stringify(tagged).includes("utm"), "不記參數");
  for (const action of ["notified", "scam-shop-suspect", "scam-link-deleted", "kick-suppressed", "flagged"]) {
    assert.deepEqual(log.tag({ action, messageId: "m1" }).domains, ["news.test"]);
  }
  assert.equal(log.tag({ action: "notified", messageId: "m2" }).domains, undefined);
  assert.equal(log.tag({ action: "error" }).domains, undefined);
  assert.deepEqual(log.tag({ messageId: "m1", domains: ["keep"] }).domains, ["keep"]);
  for (const id of ["a", "b", "c"]) log.note(id, `https://${id}.test`);
  assert.equal(log.tag({ messageId: "m1" }).domains, undefined, "超過上限丟最舊");
});

test("guard.mjs：domains 只接在 record 寫檔處與 handle 入口，不進判定", () => {
  const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  const uses = src.split("\n").filter((l) => /domainLog\./.test(l));
  assert.equal(uses.length, 2);
  assert.ok(uses.some((l) => l.includes("appendFileSync") && l.includes("domainLog.tag(entry)")));
  assert.ok(uses.some((l) => l.includes("domainLog.note(message.messageId")));
});
