// 士軒 11/10 17:18：「文字短網址展開是詐騙群邀請也要刪文＋標注，不踢」。
// 文字帶短網址、展開為別群／社群 LINE 邀請、覆核 SCAM → deleteOnly（刪文＋標注、不踢）。資料全為假資料。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocketServer } from '../guard/node_modules/ws/wrapper.mjs';
import { shortInviteUrls, textShortInviteDecision } from '../guard/text-short-invite.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NET_MOCK = new URL('./fixtures/net-mock-text-invite-1110.mjs', import.meta.url).href;
const msg = (id, o = {}) => ({ messageId: id, channelId: 'cA', senderId: 'pBad', senderName: '陌生人', ...o });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const DEFAULT_CHANNELS = [
  { channelId: 'cA', name: '社群甲', kind: 'square' },
  { channelId: 'cB', name: '社群乙', kind: 'square' },
];
function readLogs(logDir) {
  if (!existsSync(logDir)) return [];
  const out = [];
  for (const name of readdirSync(logDir)) {
    if (!name.startsWith('guard-') || !name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(logDir, name), 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}
const flaggedTimes = (r, id) => r.logs.filter((x) => x.action === 'notified' && x.messageId === id && !String(x.kind).startsWith('done-')).length;
// 刪文成功時標注是「已刪除」通知（done-deleted）；本帳號被認定是管理員時另有刪前預告。
const markedTimes = (r, id) => r.logs.filter((x) => x.action === 'notified' && x.messageId === id).length;
const acted = (r, id) => r.logs.filter((x) => x.messageId === id && x.action === 'text-short-invite-flag').length;

// 假案例（仿 11/10 16:44，內容改寫、網址為假）
const DAYTRADE = '大家好！給大家分享一個當沖群，每天都會有新的當沖和隔日沖分享，當天總損益 141,897$，大家可以加入自選關注看看，不收取任何費用';
const OTHER = { lookup: { FakeOtherTk1110: 's-elsewhere' } };

// 啟動假 LLM、假 LINE WebSocket，並以子程序執行 guard，回傳 frames / sends / removes / deletes / logs
async function runGuard(opts = {}) {
  const {
    live = [], history = [], media = null, invites = {}, channels = null,
    config: extraConfig = {}, setup = null, waitMs = 6000, gapMs = 400,
    answer = 'SCAM\n測試', visionAnswer = null, reviewAnswer = null,
  } = opts;

  // 假 LLM：圖片請求使用 visionAnswer（若有），其餘請求使用 answer
  const llm = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const image = body.includes('image_url');
      const content = image && visionAnswer ? visionAnswer : answer;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((done) => llm.listen(0, '127.0.0.1', done));
  // 覆核用另一個假 LLM（reviewAnswer 有給才分開）
  const rv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: reviewAnswer ?? answer } }] })); });
  });
  await new Promise((done) => rv.listen(0, '127.0.0.1', done));

  // 假 LINE WebSocket 伺服器
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((done) => wss.on('listening', done));

  const frames = [];
  let seq = 0;
  let liveSent = false;
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'auth:ready', profile: { userId: 'uMe', displayName: 'bot' } }));
    socket.send(JSON.stringify({ type: 'channels', channels: channels ?? DEFAULT_CHANNELS }));
    socket.on('message', (data) => {
      const f = JSON.parse(data.toString());
      frames.push(f);
      if (f.type === 'history:fetch') socket.send(JSON.stringify({ type: 'history', requestId: f.requestId, chatId: f.chatId, messages: history.filter((m) => m.channelId === f.chatId), hasMore: false }));
      else if (f.type === 'message:send') socket.send(JSON.stringify({ type: 'sent', requestId: f.requestId, messageId: `sent${++seq}` }));
      else if (f.type === 'member:remove') socket.send(JSON.stringify({ type: 'member:removed', requestId: f.requestId, chatId: f.chatId, messageId: f.messageId, memberId: 'x', messageDeleted: true }));
      else if (f.type === 'media:fetch') socket.send(JSON.stringify(media ? { type: 'media', requestId: f.requestId, mime: 'image/png', data: media } : { type: 'error', requestId: f.requestId, code: 'NOT_FOUND' }));
      else if (f.type === 'message:delete') socket.send(JSON.stringify({ type: 'message:deleted', requestId: f.requestId }));
      else if (f.type === 'invite:own') socket.send(JSON.stringify({ type: 'invite:own', requestId: f.requestId, chatId: f.chatId, squareMid: `s-${f.chatId}`, links: invites.own ?? [] }));
      else if (f.type === 'invite:lookup') socket.send(JSON.stringify(invites.lookup?.[f.ticket] ? { type: 'invite:lookup', requestId: f.requestId, chatId: f.chatId, found: true, squareMid: invites.lookup[f.ticket] } : { type: 'invite:lookup', requestId: f.requestId, chatId: f.chatId, found: false }));
    });
    // 只在第一次連線時送出 live 訊息；每則之間間隔 gapMs，讓 guard 先處理前一則
    if (!liveSent) {
      liveSent = true;
      (async () => {
        await sleep(600);
        for (const m of live) {
          if (socket.readyState !== 1) break; // 1 = OPEN
          // createdAt 於送出當下產生
          socket.send(JSON.stringify({ type: 'message', message: { contentType: 'NONE', channelKind: 'square', ...m, createdAt: Date.now() } }));
          await sleep(gapMs);
        }
      })();
    }
  });

  const dir = mkdtempSync(join(tmpdir(), 'guard-text-invite-1110-'));
  const model = { backend: 'openai', baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'fake', apiKeyEnv: '' };
  const reviewModel = { ...model, baseUrl: `http://127.0.0.1:${rv.address().port}/v1` };
  const logDir = join(dir, 'logs');
  // 預設值模擬正式環境：通知冷卻 30 秒（第二則通知常被它吞掉）
  const config = {
    dryRun: false, localScreenAll: true, kickPolicy: 'strict', strongScore: 6, reviewScore: 3, notifyScore: 3,
    deleteMessage: true, kickMode: 'notify',
    llm: model, review: reviewModel, patterns: { enabled: false }, qr: { enabled: false }, logDir,
    fakeAdmin: { enabled: true, avatar: false }, impersonation: { kick: false, kickWithInvite: true },
    notify: { enabled: true, chats: ['cA', 'cB'], cooldownSeconds: 30, beforeActionMs: 10, retryDelayMs: 10, backoffMs: 10 },
    scamLink: { deleteOnConfirmed: true }, catchUp: { scanMinutes: 0 }, knowledge: { enabled: false, prefetch: false },
    ...extraConfig,
  };
  if (setup) setup(dir, config);
  const cfgPath = join(dir, 'guard.config.json');
  writeFileSync(cfgPath, JSON.stringify(config));
  const child = spawn(process.execPath, ['--import', NET_MOCK, 'guard/guard.mjs', cfgPath], {
    cwd: ROOT,
    env: {
      ...process.env, LINEJS_TOKEN: 'test',
      GUARD_NO_KICK_FILE: join(dir, 'no-GUARD_NO_KICK'),
      GUARD_NO_KICK_CHATS_FILE: join(dir, 'no-GUARD_NO_KICK_CHATS'),
      LINEJS_URL: `ws://127.0.0.1:${wss.address().port}`,
    },
    stdio: 'ignore',
  });

  try {
    await sleep(waitMs);
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once('exit', done));
    child.kill();
    await exited;
    // 必須在 rmSync 之前讀取日誌
    const logs = readLogs(logDir);
    return {
      frames,
      sends: frames.filter((f) => f.type === 'message:send'),
      removes: frames.filter((f) => f.type === 'member:remove'),
      deletes: frames.filter((f) => f.type === 'message:delete'),
      logs,
    };
  } finally {
    child.kill();
    llm.closeAllConnections?.();
    rv.closeAllConnections?.();
    wss.close();
    llm.close();
    rv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}


// ── 純函式 ──────────────────────────────────────────────
test('U1 shortInviteUrls：落地為邀請／頁面寫死邀請 → 取出；展開失敗、一般頁、加好友 → 空', () => {
  assert.deepEqual(shortInviteUrls({ invite: true, url: 'https://line.me/ti/g2/FakeTk01', html: '' }), ['https://line.me/ti/g2/FakeTk01']);
  assert.deepEqual(shortInviteUrls({ invite: true, url: 'https://relay.example/x', html: 'go "https:\\/\\/line.me\\/ti\\/g2\\/FakeTk02"' }), ['https://line.me/ti/g2/FakeTk02']);
  assert.deepEqual(shortInviteUrls(undefined), []);
  assert.deepEqual(shortInviteUrls({ invite: false, url: 'https://news.example.org/a' }), []);
  assert.deepEqual(shortInviteUrls({ invite: true, url: 'https://line.me/R/ti/p/@fakeoa' }), []);
});
test('U2 textShortInviteDecision：只有邀請＋覆核 SCAM＋非受保護＋非本群才 act', () => {
  const base = { names: ['短網址導向群組邀請'], review: 'SCAM', inviteUrls: ['https://line.me/ti/g2/FakeTk01'], origins: [{ origin: 'other' }] };
  assert.equal(textShortInviteDecision(base).act, true);
  assert.equal(textShortInviteDecision({ ...base, origins: [{ origin: 'unknown' }] }).act, true);
  assert.equal(textShortInviteDecision({ ...base, origins: [{ origin: 'own' }] }).reason, 'own-invite');
  assert.equal(textShortInviteDecision({ ...base, origins: [{ origin: 'other' }, { origin: 'own' }] }).reason, 'own-invite');
  assert.equal(textShortInviteDecision({ ...base, review: 'OK' }).reason, 'review-not-scam');
  assert.equal(textShortInviteDecision({ ...base, review: 'UNSURE' }).reason, 'review-not-scam');
  assert.equal(textShortInviteDecision({ ...base, protectedSender: true }).reason, 'protected-sender');
  assert.equal(textShortInviteDecision({ ...base, inviteUrls: [] }).reason, 'no-invite-url');
  assert.equal(textShortInviteDecision({ ...base, names: ['短網址'] }).reason, 'not-invite');
  assert.equal(textShortInviteDecision({ ...base, allow: ['https://line.me/ti/g2/FakeTk01'] }).reason, 'qr-allow');
});

// ── 端到端（假 LINE、假 LLM、假網路）────────────────────
test('E1 11/10 16:44 類案例：當沖群文字＋reurl.cc 展開為別群邀請、覆核 SCAM → 刪文＋標注、不踢（kickMode notify）', async () => {
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.deepEqual(r.deletes.map((f) => f.messageId), ['m1']);
  assert.equal(r.removes.length, 0);
  assert.ok(markedTimes(r, 'm1') >= 1, 'm1 應被標注');
  assert.equal(acted(r, 'm1'), 1);
  assert.ok(r.logs.some((x) => x.action === 'text-short-invite-deleted' && x.messageId === 'm1'));
});
test('E2 中繼頁寫死別群邀請（invite:lookup 查無 → unknown，比照 QR 外部邀請）→ 刪文＋標注、不踢', async () => {
  const r = await runGuard({ live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeHtml1` })] });
  assert.deepEqual(r.deletes.map((f) => f.messageId), ['m1']);
  assert.equal(r.removes.length, 0);
});
test('E3 對抗：本群自己的邀請（invite:own 同邀請碼）→ 不刪不踢', async () => {
  const r = await runGuard({ invites: { own: ['https://line.me/ti/g2/FakeOwnTk1110'] }, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOwn1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(acted(r, 'm1'), 0);
  assert.ok(r.logs.some((x) => x.action === 'text-short-invite-check' && x.reason === 'own-invite'));
});
test('E3b 對抗：本群邀請碼經 invite:lookup 查到同一社群 → 不刪不踢', async () => {
  const r = await runGuard({ invites: { lookup: { FakeOwnTk1110: 's-cA' } }, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOwn1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
});
test('E4 對抗：管理員本人（notify.admins）貼的 → 不刪不踢', async () => {
  const r = await runGuard({
    invites: OTHER,
    config: { notify: { enabled: true, chats: ['cA', 'cB'], cooldownSeconds: 30, beforeActionMs: 10, retryDelayMs: 10, backoffMs: 10, admins: { cA: [{ id: 'pAdm', name: '阿管' }] } } },
    live: [msg('m1', { senderId: 'pAdm', senderName: '阿管', text: `${DAYTRADE} reurl.cc/FakeOther1` })],
  });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(acted(r, 'm1'), 0);
});
test('E4b 對抗：群主／共同管理員（senderRole）貼的 → 不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { senderId: 'pOwner', senderName: '群主', senderRole: 'coAdmin', text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
});
test('E4c 對抗：白名單成員貼的 → 不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, config: { whitelist: ['pFriend'] }, live: [msg('m1', { senderId: 'pFriend', senderName: '老朋友', text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
});
test('E5 對抗：覆核不是 SCAM（OK）→ 不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, reviewAnswer: 'OK\n正常', live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(acted(r, 'm1'), 0);
});
test('E5b 對抗：覆核 UNSURE → 不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, reviewAnswer: 'UNSURE\n不確定', live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
});
test('E6 對抗：短網址展開失敗 → 不刪不踢（維持原行為）', async () => {
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeFail1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(acted(r, 'm1'), 0);
});
test('E7 對抗：展開後是一般網址 → 不刪不踢、不走本規則', async () => {
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeNormal1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(acted(r, 'm1'), 0);
});
test('E8 對抗：純文字當沖分享、沒有連結 → 不刪不踢不標', async () => {
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { text: DAYTRADE })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(flaggedTimes(r, 'm1'), 0);
  assert.equal(acted(r, 'm1'), 0);
});
for (const [label, config] of [
  ['warnOnly', { groupPolicies: { cA: { warnOnly: true } } }],
  ['noDeleteChats', { questionRedact: { noDeleteChats: ['cA'] } }],
  ['deleteMessage=false', { deleteMessage: false }],
]) {
  test(`E9 對抗：${label} → 只通知一次，不刪不踢`, async () => {
    const r = await runGuard({ invites: OTHER, config, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
    assert.equal(r.deletes.length, 0);
    assert.equal(r.removes.length, 0);
    assert.equal(flaggedTimes(r, 'm1'), 1, `${label} 應通知一次`);
  });
}
test('E9b 對抗：kill switch（enforcement.killSwitch）開著 → 只通知一次，不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, config: { enforcement: { killSwitch: true } }, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(flaggedTimes(r, 'm1'), 1);
});
test('E9c GUARD_NO_KICK 旗標（只擋踢）開著 → 照樣刪文＋標注、不踢', async () => {
  const r = await runGuard({ invites: OTHER, setup: (dir) => writeFileSync(join(dir, 'no-GUARD_NO_KICK'), '1'), live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.deepEqual(r.deletes.map((f) => f.messageId), ['m1']);
  assert.equal(r.removes.length, 0);
});
for (const [label, config] of [
  ['learnOnly', { groupPolicies: { cA: { learnOnly: true } } }],
  ['excludeChats', { kickScope: { excludeChats: ['cA'] } }],
]) {
  test(`E10 對抗：${label} → 只記錄，不刪不踢不標`, async () => {
    const r = await runGuard({ invites: OTHER, config, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
    assert.equal(r.deletes.length, 0);
    assert.equal(r.removes.length, 0);
    assert.equal(flaggedTimes(r, 'm1'), 0);
  });
}
const ADMIN_HISTORY = [{ messageId: 'h1', channelId: 'cA', senderId: 'pAdmin', senderName: '阿明', senderRole: 'coAdmin', channelKind: 'square', contentType: 'NONE', text: '大家好', createdAt: Date.now() - 60_000 }];
test('E11 既有踢人路徑：冒名管理員＋短網址別群邀請（kickMode kick、kickWithInvite）→ 仍會踢', async () => {
  const r = await runGuard({ invites: OTHER, history: ADMIN_HISTORY, config: { kickMode: 'kick', impersonation: { kick: false, kickWithInvite: true } }, live: [msg('m1', { senderId: 'pImp', senderName: '阿明', text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.removes.length, 1, '冒名＋邀請應照舊踢');
  assert.equal(acted(r, 'm1'), 0, '踢人路徑不應被改成只刪');
});
test('E12 kickMode notify：冒名＋短網址別群邀請 → 不踢', async () => {
  const r = await runGuard({ invites: OTHER, history: ADMIN_HISTORY, config: { kickMode: 'notify', impersonation: { kick: false, kickWithInvite: true } }, live: [msg('m1', { senderId: 'pImp', senderName: '阿明', text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.removes.length, 0);
});
test('E13 對抗：同一則（同 messageId）重複送達 → 只刪一次、只標一次、不踢', async () => {
  const text = `${DAYTRADE} reurl.cc/FakeOther1`;
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { text }), msg('m1', { text })] });
  assert.equal(r.deletes.length, 1);
  assert.ok(flaggedTimes(r, 'm1') <= 1);
  assert.equal(r.removes.length, 0);
});
test('E14 每則都標（6f50b0f）：同人兩則新訊息都刪都標、不踢', async () => {
  const text = `${DAYTRADE} reurl.cc/FakeOther1`;
  const r = await runGuard({ invites: OTHER, live: [msg('m1', { text }), msg('m2', { text })], waitMs: 7000 });
  assert.deepEqual(r.deletes.map((f) => f.messageId).sort(), ['m1', 'm2']);
  assert.ok(markedTimes(r, 'm1') >= 1 && markedTimes(r, 'm2') >= 1);
  assert.equal(r.removes.length, 0);
});
test('E15 設定範例：qr.kickOnConfirmed 仍非 true', () => {
  const example = JSON.parse(readFileSync(new URL('../guard/guard.config.example.json', import.meta.url), 'utf8'));
  assert.ok(example.qr?.kickOnConfirmed !== true);
});
test('E16 對抗：受保護名（protectedNames）發文者 → 不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, config: { protectedNames: ['守護長老'] }, live: [msg('m1', { senderName: '守護長老', text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.equal(acted(r, 'm1'), 0);
});
test('E17 對抗：邀請網址在 qr.allow 白名單前綴 → 不刪不踢', async () => {
  const r = await runGuard({ invites: OTHER, config: { qr: { enabled: false, kickOnConfirmed: false, allow: ['https://line.me/ti/g2/FakeOtherTk1110'] } }, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
  assert.ok(r.logs.some((x) => x.action === 'text-short-invite-check' && x.reason === 'qr-allow'));
});
test('E18 kickMode kick、非冒名：既有踢人路徑照舊踢一次，本規則不介入、不改成只刪', async () => {
  const r = await runGuard({ invites: OTHER, config: { kickMode: 'kick' }, live: [msg('m1', { text: `${DAYTRADE} reurl.cc/FakeOther1` })] });
  assert.equal(r.removes.length, 1);
  assert.equal(acted(r, 'm1'), 0);
});
