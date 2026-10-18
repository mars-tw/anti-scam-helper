import assert from "node:assert/strict";
import test from "node:test";
import { makeGroupCooldown, makeNameMatcher, stripQuotedAndMentions } from "../guard/name-trigger.mjs";

const calls = makeNameMatcher(["阿軒", "軒哥", "軒割", "軒割割"]);

test("叫名字：在對本人說話就算（含簡體、稱呼、句首句尾）", () => {
  for (const text of ["阿軒", "阿軒你好", "問一下阿軒", "阿軒割割在嗎", "阿轩 这个是诈骗吗", "嗨阿軒", "這是詐騙嗎阿軒", "阿軒，H3 好用嗎", "請問阿軒 這是什麼", "幫我看一下 阿軒", "那這個阿軒你覺得呢", "謝謝阿軒！", "阿軒?",
    "軒哥", "軒哥在嗎", "軒割割 這是詐騙嗎", "轩哥你好", "问一下軒割", "請問軒哥 H3 要多少顯卡", "這是詐騙嗎軒哥", "軒哥哥救命", "阿軒哥 幫看"]) {
    assert.equal(calls(text), true, text);
  }
});

test("叫名字：只是在講他、別人的名字、引用 → 不算", () => {
  for (const text of ["阿軒的機器人剛剛踢人了", "我剛剛看到阿軒", "跟阿軒說一下", "子軒你好", "軒軒在嗎", "阿軒說這個是詐騙", "「阿軒你好」是他寫的", "> 阿軒你好\n這段好笑", "剛剛阿軒有回", "阿軒他很忙",
    "這群是阿軒開的", "阿軒已經處理了", "王子軒哥哥你好", "子軒哥在嗎", "軒哥的機器人踢人了", "軒割說的", "我跟軒哥很熟", "小軒割草", "今天天氣如何"]) {
    assert.equal(calls(text), false, text);
  }
});

test("@ 別人（暱稱含阿軒）那一段不算叫名字", () => {
  assert.equal(calls("@阿軒粉絲團 你好", [{ userId: "pOther", start: 0, end: 6 }]), false);
  assert.equal(stripQuotedAndMentions("@abc hi", [{ start: 0, end: 4 }]).trim(), "hi");
});

test("沒有設定名字：永遠不觸發", () => {
  assert.equal(makeNameMatcher([])("阿軒你好"), false);
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
