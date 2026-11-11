// 11/10 review: (a) restore 90ad8b6, (b) split notify targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../guard/guard.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function deleteOnly(');
assert.notEqual(start, -1, 'deleteOnly must exist in guard.mjs');
const end = source.indexOf('\n}\n', start);
assert.notEqual(end, -1, 'deleteOnly must have a closing brace');
const functionSource = source.slice(start, end + 2);

// Synthetic fixtures only
const message = {
  channelId: 'synthetic-chat-1110',
  messageId: 'synthetic-message-1110',
  senderId: 'synthetic-member-1110',
  senderName: 'Synthetic Member',
};
const entry = {
  chatId: message.channelId,
  messageId: message.messageId,
  senderId: message.senderId,
  senderName: message.senderName,
};

// Build a deleteOnly instance inside a vm context with stubbed deps
function harness(opts = {}) {
  const chat = message.channelId;
  const calls = [];
  const records = [];
  const errors = [];
  const notifications = [];
  const marks = [];
  const kicked = new Set(); // must never be modified
  const context = {
    config: { deleteMessage: opts.deleteMessage ?? true, dryRun: !!opts.dryRun },
    excludedChat: (id) => !!opts.excluded && id === chat,
    learnOnly: new Set(opts.learnOnly ? [chat] : []),
    warnOnly: new Set(opts.warnOnly ? [chat] : []),
    noDeleteChats: new Set(opts.noDelete ? [chat] : []),
    neverKick: () => !!opts.neverKick,
    killSwitchOn: () => !!opts.killSwitch,
    record: (value) => { records.push(value); return value; },
    recordError: (...args) => errors.push(args),
    notifyAdmins: async (_ws, _e, kind, extra) => { notifications.push({ kind, extra }); },
    preNotify: async () => true,
    notifyThenAct: async (before, action) => {
      const result = await before();
      await action();
      return result;
    },
    call: async (_ws, request, timeout, meta) => {
      calls.push({ request, timeout, meta });
      return opts.answer ?? { type: 'message:deleted' };
    },
    notify: {},
    sleep: async () => {},
    markSelfCanKick: (...args) => marks.push(args),
    gateHeld: (answer) => !!answer.held,
    kicked,
  };
  const deleteOnly = vm.runInNewContext(`(${functionSource})`, context);
  return { deleteOnly, calls, records, errors, notifications, marks, kicked };
}

// Assert no delete, no kick, no mark, nothing kicked
function assertNoActionTaken(h) {
  assert.equal(h.calls.length, 0, 'no call expected');
  assert.equal(h.marks.length, 0, 'no markSelfCanKick expected');
  assert.equal(h.kicked.size, 0, 'kicked must stay empty');
  assert.ok(!h.calls.some((c) => c.request.type === 'member:remove'), 'no member:remove');
}

// A. Record-only chat policy (excluded / learnOnly)
for (const [name, opts] of [
  ['excluded chat', { excluded: true }],
  ['learnOnly chat', { learnOnly: true }],
]) {
  test(`A: ${name} is record-only with zero notifications`, async () => {
    const h = harness(opts);
    await h.deleteOnly({}, message, entry, 'synthetic');
    const last = h.records.at(-1);
    assert.equal(last.action, 'synthetic-delete-skipped');
    assert.equal(last.reason, 'chat-policy');
    assert.equal(h.notifications.length, 0);
    assertNoActionTaken(h);
  });
}

test('A: excluded chat with killSwitch still record-only', async () => {
  const h = harness({ excluded: true, killSwitch: true });
  await h.deleteOnly({}, message, entry, 'synthetic');
  assert.equal(h.records.at(-1).reason, 'chat-policy');
  assert.equal(h.notifications.length, 0);
  assertNoActionTaken(h);
});

test('A: learnOnly chat with deleteMessage=false still record-only', async () => {
  const h = harness({ learnOnly: true, deleteMessage: false });
  await h.deleteOnly({}, message, entry, 'synthetic');
  assert.equal(h.records.at(-1).reason, 'chat-policy');
  assert.equal(h.notifications.length, 0);
  assertNoActionTaken(h);
});

// B. Notify-only skip reasons
const notifyCases = [
  ['warn-only', { warnOnly: true }, 'warn-only'],
  ['no-delete-permission', { noDelete: true }, 'no-delete-permission'],
  ['kill-switch', { killSwitch: true }, 'kill-switch'],
  ['delete-disabled', { deleteMessage: false }, 'delete-disabled'],
];

for (const [reason, opts, expectedReason] of notifyCases) {
  test(`B: ${reason} notifies once with default kind 'suspect'`, async () => {
    const h = harness(opts);
    await h.deleteOnly({}, message, entry, 'synthetic');
    const last = h.records.at(-1);
    assert.equal(last.action, 'synthetic-delete-skipped');
    assert.equal(last.reason, expectedReason);
    assert.equal(h.notifications.length, 1, 'exactly one notification');
    assert.equal(h.notifications[0].kind, 'suspect');
    assertNoActionTaken(h);
  });

  test(`B: ${reason} notifies once with fallbackKind 'qr'`, async () => {
    const h = harness(opts);
    await h.deleteOnly({}, message, entry, 'qr-invite', 'qr');
    const last = h.records.at(-1);
    assert.equal(last.action, 'qr-invite-delete-skipped');
    assert.equal(last.reason, expectedReason);
    assert.equal(h.notifications.length, 1, 'exactly one notification');
    assert.equal(h.notifications[0].kind, 'qr');
    assertNoActionTaken(h);
  });
}

// C. Protected senders are record-only
test('C: protected sender in normal chat is record-only', async () => {
  const h = harness({ neverKick: true });
  await h.deleteOnly({}, message, entry, 'synthetic', 'qr');
  assert.equal(h.records.at(-1).action, 'protected-skip');
  assert.equal(h.notifications.length, 0);
  assertNoActionTaken(h);
});

test('C: protected sender in warnOnly chat is record-only', async () => {
  const h = harness({ neverKick: true, warnOnly: true });
  await h.deleteOnly({}, message, entry, 'synthetic', 'qr');
  assert.equal(h.records.at(-1).action, 'protected-skip');
  assert.equal(h.notifications.length, 0);
  assertNoActionTaken(h);
});

// D. Normal success path
test('D: normal chat deletes once, no member:remove, kicked stays empty', async () => {
  const h = harness();
  await h.deleteOnly({}, message, entry, 'synthetic', 'qr');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].request.type, 'message:delete');
  assert.equal(h.calls[0].request.messageId, message.messageId);
  assert.ok(!h.calls.some((c) => c.request.type === 'member:remove'));
  assert.equal(h.marks.length, 1);
  assert.equal(h.kicked.size, 0);
});

// E. Static regression checks against guard.mjs source
const imageStart = source.indexOf('士軒 11/7：圖片假搬家公告沒有 QR 也刪文');
const imageEnd = imageStart < 0 ? -1 : source.indexOf('10/22 通知層', imageStart);
const imageBlock = imageStart >= 0 && imageEnd > imageStart ? source.slice(imageStart, imageEnd) : '';

test('E: fake-group-image block markers exist', () => {
  assert.ok(imageStart >= 0, 'start marker must exist');
  assert.ok(imageEnd > imageStart, 'end marker must exist after start');
});

test('E: fake-group-image block lacks rejected 0777f90 patterns', () => {
  assert.ok(!imageBlock.includes('rv === "OK"'));
  assert.ok(!imageBlock.includes('rv === "UNSURE"'));
  assert.ok(!imageBlock.includes('verdict === "SCAM") return deleteOnly'));
});

test('E: kick branch is followed by deleteOnly (fake-move-image)', () => {
  const kickLine = 'if (decision === "kick" && !neverKick(message)) return remove(ws, message, flagged);';
  const at = imageBlock.indexOf(kickLine);
  assert.ok(at >= 0, 'kick line must exist in image block');
  const next = imageBlock
    .slice(at + kickLine.length)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0];
  assert.equal(next, 'return deleteOnly(ws, message, flagged, "fake-move-image");');
});

test('E: last isFakeGroupImage non-kick block deletes and never notifies', () => {
  const idx = imageBlock.lastIndexOf('if (isFakeGroupImage(reason)) {');
  assert.ok(idx >= 0, 'isFakeGroupImage block must exist');
  const close = imageBlock.indexOf('\n    }\n', idx);
  assert.ok(close > idx, 'block must close');
  const block = imageBlock.slice(idx, close);
  assert.ok(block.includes('return deleteOnly(ws, message, flagged, "fake-move-image");'));
  assert.ok(!block.includes('notifyAdmins'));
});

test('E: image block has only one remove( line, the kick decision, and no member:remove', () => {
  const removeLines = imageBlock.split('\n').filter((l) => l.includes('remove('));
  assert.equal(removeLines.length, 1);
  assert.ok(removeLines[0].includes('decision === "kick"'));
  assert.ok(!imageBlock.includes('member:remove'));
});

test('E: SCAM_WEAK fake-move block deletes and never notifies', () => {
  const key = 'if (verdict === "SCAM_WEAK" && isFakeGroupImage(reason)) {';
  const idx = source.indexOf(key);
  assert.ok(idx >= 0, 'SCAM_WEAK block must exist');
  const close = source.indexOf('\n  }\n', idx);
  assert.ok(close > idx, 'SCAM_WEAK block must close');
  const block = source.slice(idx, close);
  assert.ok(block.includes('deleteOnly('));
  assert.ok(block.includes('"fake-move-image"'));
  assert.ok(!block.includes('notifyAdmins'));
});

test('E: QR call site passes qr fallbackKind and keeps kickOnConfirmed check', () => {
  assert.ok(source.includes('deleteOnly(ws, message, flagged, "qr-invite", "qr")'));
  assert.ok(source.includes('qr.kickOnConfirmed === true'));
});