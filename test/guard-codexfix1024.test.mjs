import test from "node:test";
import assert from "node:assert/strict";
import { makeNameMatcher } from "../guard/name-trigger.mjs";
import { expandUrlSafe } from "../guard/shop.mjs";
import { visionVerdict, isFakeGroupImage } from "../guard/policy.mjs";

test("機器人名字：句首叫名字直接接指令也算", () => {
  const bot = makeNameMatcher(["喵嗚"], { botName: true });
  assert.equal(bot("喵嗚查詢現任美國總統資料", []), true);
  assert.equal(bot("喵嗚幫我查", []), true);
  assert.equal(bot("我家貓會喵嗚叫", []), false);
});
test("真人名字不受影響：名字後直接接動詞不算", () => {
  const owner = makeNameMatcher(["阿華"]);
  assert.equal(owner("阿華查詢一下資料", []), false);
});
const resolve = async () => [{ address: "93.184.216.34" }];
const page = (html) => ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), body: new Response(html).body });
test("短網址中繼頁 meta refresh 到群組邀請：跟到下一跳", async () => {
  const fetchImpl = async (u) => String(u).includes("hop1") ? page('<meta http-equiv="refresh" content="0;url=https://example.org/hop2">') : page('<a href="https://line.me/ti/g2/abc">join</a>');
  const r = await expandUrlSafe("https://example.org/hop1", { fetchImpl, resolve });
  assert.equal(r.invite, true);
});
test("短網址中繼頁 location.href 轉址：跟到下一跳", async () => {
  const fetchImpl = async (u) => String(u).includes("hop1") ? page('<script>window.location.href="https://example.org/hop2"</script>') : page("<p>hello</p>");
  const r = await expandUrlSafe("https://example.org/hop1", { fetchImpl, resolve });
  assert.equal(r.invite, false);
  assert.match(r.url, /hop2/);
});
test("假搬家公告圖：被『公告』降成 SCAM_WEAK 但仍認得是假群組圖", () => {
  const reason = "假搬家公告，附短網址要成員申請加入新群";
  assert.equal(visionVerdict("SCAM", reason), "SCAM_WEAK");
  assert.equal(isFakeGroupImage(reason), true);
  assert.equal(isFakeGroupImage("官方公告：系統維護時間"), false);
});
