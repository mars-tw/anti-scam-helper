import assert from "node:assert/strict";
import test from "node:test";
import { makeGroupCooldown, makeNameMatcher, stripQuotedAndMentions } from "../guard/name-trigger.mjs";

const calls = makeNameMatcher(["阿華", "華哥", "華割", "華割割"]);

test("叫名字：在對本人說話就算（含簡體、稱呼、句首句尾）", () => {
  for (const text of ["阿華", "阿華你好", "問一下阿華", "阿華割割在嗎", "阿华 这个是诈骗吗", "嗨阿華", "這是詐騙嗎阿華", "阿華，H3 好用嗎", "請問阿華 這是什麼", "幫我看一下 阿華", "那這個阿華你覺得呢", "謝謝阿華！", "阿華?",
    "華哥", "華哥在嗎", "華割割 這是詐騙嗎", "华哥你好", "问一下華割", "請問華哥 H3 要多少顯卡", "這是詐騙嗎華哥", "華哥哥救命", "阿華哥 幫看"]) {
    assert.equal(calls(text), true, text);
  }
});

test("叫名字：只是在講他、別人的名字、引用 → 不算", () => {
  for (const text of ["阿華的機器人剛剛踢人了", "我剛剛看到阿華", "跟阿華說一下", "子華你好", "華華在嗎", "阿華說這個是詐騙", "「阿華你好」是他寫的", "> 阿華你好\n這段好笑", "剛剛阿華有回", "阿華他很忙",
    "這群是阿華開的", "阿華已經處理了", "王子華哥哥你好", "子華哥在嗎", "華哥的機器人踢人了", "華割說的", "我跟華哥很熟", "小華割草", "今天天氣如何"]) {
    assert.equal(calls(text), false, text);
  }
});

test("@ 別人（暱稱含阿華）那一段不算叫名字", () => {
  assert.equal(calls("@阿華粉絲團 你好", [{ userId: "pOther", start: 0, end: 6 }]), false);
  assert.equal(stripQuotedAndMentions("@abc hi", [{ start: 0, end: 4 }]).trim(), "hi");
});

test("沒有設定名字：永遠不觸發", () => {
  assert.equal(makeNameMatcher([])("阿華你好"), false);
});

test("每群冷卻", () => {
  let t = 0;
  const ok = makeGroupCooldown(120, () => t);
  assert.equal(ok("a"), true);
  assert.equal(ok("a"), false);
  assert.equal(ok("b"), true);
  t = 121_000;
  assert.equal(ok("a"), true);
});
