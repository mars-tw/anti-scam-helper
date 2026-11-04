import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
const fnSrc = src.match(/export function bandanDeletePlan\([\s\S]*?\n\}/)[0].replace("export ", "");
const bandanDeletePlan = new Function(`${fnSrc}; return bandanDeletePlan;`)();
const handler = src.slice(src.indexOf("const priorLure = recentBandanLure(message);"), src.indexOf("async function deleteScamLink("));

test("有前一則＋本則刪成功 → 併刪前一則，不記 kickFailed", () => {
  assert.deepEqual(bandanDeletePlan({ deleted: true, priorMessageId: "m1" }), { markCanKick: true, kickFailed: false, deletePrior: true });
});
test("有前一則＋本則刪失敗 → 不併刪，記 kickFailed", () => {
  assert.deepEqual(bandanDeletePlan({ deleted: false, priorMessageId: "m1" }), { markCanKick: false, kickFailed: true, deletePrior: false });
});
test("無前一則＋本則刪成功 → 不記多餘 kickFailed、不併刪", () => {
  assert.deepEqual(bandanDeletePlan({ deleted: true, priorMessageId: undefined }), { markCanKick: true, kickFailed: false, deletePrior: false });
});
test("源碼：else kickFailed 緊接 if (deleted)，併刪只看 plan.deletePrior", () => {
  assert.match(handler, /if \(deleted\) markSelfCanKick\(entry\.chatId, "bandan-line-oa-deleted"\);\n\s*else record\(\{ action: "kickFailed"/);
  assert.match(handler, /if \(plan\.deletePrior\) \{/);
  assert.doesNotMatch(handler, /\}\n\s*else record\(\{ action: "kickFailed"/);
  assert.doesNotMatch(handler, /kick:\s*true|chat:kick|member:kick/);
});
