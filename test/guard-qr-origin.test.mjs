import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyQrOrigin, qrReviewContext, squareTicket } from "../guard/qr.mjs";

const own = { squareMid: "s-own", links: ["https://line.me/ti/g2/OwnTicket1?utm_source=invitation", "https://openchat.line.me/tw/cover/OwnTicket2"] };

test("squareTicket reads OpenChat tickets only; plain groups and friends are not tickets", () => {
  assert.equal(squareTicket("https://line.me/ti/g2/AbC-123_x?utm_source=x"), "AbC-123_x");
  assert.equal(squareTicket("line.me/R/ti/g2/Tick1234"), "Tick1234");
  assert.equal(squareTicket("https://openchat.line.me/tw/cover/Tick5678"), "Tick5678");
  assert.equal(squareTicket("https://openchat.line.me/jp/join/Tick9999"), "Tick9999");
  assert.equal(squareTicket("https://line.me/ti/g/GroupTk1"), undefined);
  assert.equal(squareTicket("https://line.me/ti/p/~someone"), undefined);
  assert.equal(squareTicket("https://example.com/ti/g2/Tick1234"), undefined);
});

test("own link matches without any lookup", async () => {
  let calls = 0;
  const lookup = async () => { calls += 1; return { squareMid: "s-own" }; };
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g2/OwnTicket1", { own, lookup }), { origin: "own", via: "own-link" });
  assert.deepEqual(await classifyQrOrigin("https://openchat.line.me/tw/cover/OwnTicket1", { own, lookup }), { origin: "own", via: "own-link" });
  assert.equal(calls, 0);
});

test("lookup decides same community vs another one; failures and plain groups stay unknown", async () => {
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g2/Other111", { own, lookup: async () => ({ squareMid: "s-own" }) }), { origin: "own", via: "lookup" });
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g2/Other111", { own, lookup: async () => ({ squareMid: "s-else" }) }), { origin: "other", via: "lookup" });
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g2/Other111", { own, lookup: async () => undefined }), { origin: "unknown", via: "lookup-not-found" });
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g2/Other111", { own, lookup: async () => { throw new Error("x"); } }), { origin: "unknown", via: "lookup-failed" });
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g2/Other111", { own: undefined, lookup: async () => ({ squareMid: "s-else" }) }), { origin: "unknown", via: "no-own-info" });
  assert.deepEqual(await classifyQrOrigin("https://line.me/ti/g/GroupTk1", { own, lookup: async () => ({ squareMid: "s-own" }) }), { origin: "unknown", via: "not-square" });
});

test("review prompt says 'not this community' only when confirmed", () => {
  assert.match(qrReviewContext("other"), /屬於別的社群/);
  assert.doesNotMatch(qrReviewContext("unknown"), /不是本社群自己的連結。/);
  assert.match(qrReviewContext("unknown"), /無法確認/);
});

test("guard wires QR origin in, never calls ticket-issuing or join APIs", () => {
  const guard = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(guard, /QR_OWN_GROUP/);
  assert.match(guard, /qrReviewContext\(entry\.qrOrigin\)/);
  for (const file of ["../guard/guard.mjs", "../guard/qr.mjs", "../src/line/provider.ts", "../src/ws/hub.ts"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(code, /reissue\w*Ticket|getInvitationTicketUrl|joinSquare|acceptChatInvitation|createSquareChatAnnouncement/i, file);
  }
});

test("guard QR allow-list check uses global linkAllow and group links", () => {
  const guard = readFileSync(new URL("../guard/guard.mjs", import.meta.url), "utf8");
  assert.match(guard, /const sanitizeLinks = \(text\) => sanitizeWith\(text, linkAllow\)/);
  assert.match(guard, /redPacketAllowed\(message\.channelId, content\)/);
});
