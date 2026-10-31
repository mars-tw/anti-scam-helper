import { test } from "node:test";
import assert from "node:assert/strict";
import { threadMessagesFromEvents } from "../dist/line/threads.js";
import { parseThreadFetch } from "../dist/ws/requests.js";

test("討論串事件：只取這個聊天室的訊息（含討論串通知），去重並帶顯示名稱", () => {
  const sq = (id, to, thread) => ({ message: { id, to }, threadInfo: { chatThreadMid: thread } });
  const events = [
    { payload: { receiveMessage: { squareMessage: sq("1", "mA", "t1"), senderDisplayName: "甲" } } },
    { payload: { notificationThreadMessage: { squareMessage: sq("2", "mA", "t1"), senderDisplayName: "乙" } } },
    { payload: { receiveMessage: { squareMessage: sq("3", "mB", "t1") } } },
    { payload: { sendMessage: { squareMessage: sq("1", "mA", "t1") } } },
    { payload: { notifiedDestroyMessage: {} } },
  ];
  const out = threadMessagesFromEvents(events, "mA");
  assert.deepEqual(out.map((x) => x.raw.message.id), ["1", "2"]);
  assert.equal(out[1].name, "乙");
});
test("thread:fetch 請求：檢查 id 與上限", () => {
  assert.deepEqual(parseThreadFetch({ requestId: "r1", chatId: "m0123456789abcdef", threadId: "t0123456789" }), { ok: true, value: { requestId: "r1", chatId: "m0123456789abcdef", threadId: "t0123456789", limit: 50 } });
  assert.equal(parseThreadFetch({ requestId: "r1", chatId: "m0123456789abcdef", threadId: "bad id!" }).ok, false);
  assert.equal(parseThreadFetch({ requestId: "r1", chatId: "m0123456789abcdef", threadId: "t0123456789", limit: 101 }).ok, false);
});
