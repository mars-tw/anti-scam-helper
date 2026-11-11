// 11/10 規則：每次對方發出新訊息（新 messageId）就要照現行規則再標一次。
// 同一則訊息（同 messageId）重複送達不得重複通知；踢人規則不放寬；QR 外部社群邀請只刪文、不踢。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import QRCode from 'qrcode';
import { WebSocketServer } from '../guard/node_modules/ws/wrapper.mjs';

// 專案根目錄（guard/guard.mjs 相對於此路徑）
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 網路模擬預載檔：阻擋真實外網、模擬短網址展開
const NET_MOCK = new URL('./fixtures/net-mock-1110.mjs', import.meta.url).href;

// 假搬家公告（刻意插空格，用來繞過關鍵字比對）
const SPACED = '通知 : 本 群 明 天 要 刪 除了\n請 大 家 加 入 新  群\n謝 謝 配 合！\n';

// 訊息工廠：預設為陌生人、cA 群、一般文字
const msg = (id, o = {}) => ({ messageId: id, channelId: 'cA', senderId: 'pBad', senderName: '陌生人', ...o });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const DEFAULT_CHANNELS = [
  { channelId: 'cA', name: '社群甲', kind: 'square' },
  { channelId: 'cB', name: '社群乙', kind: 'square' },
];

// 讀取 guard 寫出的 guard-*.jsonl 日誌，逐行解析成陣列
function readLogs(logDir) {
  if (!existsSync(logDir)) return [];
  const out = [];
  for (const name of readdirSync(logDir)) {
    if (!name.startsWith('guard-') || !name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(logDir, name), 'utf8').split('\n')) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

// 被標記（notified）的 messageId 清單
const notifiedIds = (r) => r.logs.filter((x) => x.action === 'notified').map((x) => x.messageId);
// 某則 messageId 被標記的次數
const flaggedTimes = (r, id) => r.logs.filter((x) => x.action === 'notified' && x.messageId === id).length;

// 產生 QR 圖片的 base64，供 media:fetch 回傳
async function qrBase64(url) {
  return (await QRCode.toBuffer(url, { width: 300 })).toString('base64');
}

// 啟動假 LLM、假 LINE WebSocket，並以子程序執行 guard，回傳 frames / sends / removes / deletes / logs
async function runGuard(opts = {}) {
  const {
    live = [], history = [], media = null, invites = {}, channels = null,
    config: extraConfig = {}, setup = null, waitMs = 6000, gapMs = 400,
    answer = 'SCAM\n測試', visionAnswer = null,
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

  const dir = mkdtempSync(join(tmpdir(), 'guard-notify-1110-'));
  const model = { backend: 'openai', baseUrl: `http://127.0.0.1:${llm.address().port}/v1`, model: 'fake', apiKeyEnv: '' };
  const logDir = join(dir, 'logs');
  // 預設值模擬正式環境：通知冷卻 30 秒（第二則通知常被它吞掉）
  const config = {
    dryRun: false, localScreenAll: true, kickPolicy: 'strict', strongScore: 6, reviewScore: 3, notifyScore: 3,
    deleteMessage: true, kickMode: 'notify',
    llm: model, review: model, patterns: { enabled: false }, qr: { enabled: false }, logDir,
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
    wss.close();
    llm.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// T1：自稱管理員兩則插空格假搬家＋短網址展開為別群邀請，兩則都要標，不踢
test('T1 11/10 情形一：自稱管理員兩則插空格假搬家＋短網址展開為別群邀請 → 兩則都標，不踢', async () => {
  const r = await runGuard({
    live: [
      msg('m1', { senderName: '管理員小美', text: SPACED + '1url.cz/TestAa1' }),
      msg('m2', { senderName: '管理員小美', text: SPACED + '1url.cz/TestAa1' }),
    ],
  });
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  assert.equal(r.removes.length, 0);
});

// T2a：自稱管理員兩則插空格假搬家，第二則不能被 fake-admin-cooldown／suspect-cooldown 跳過
test('T2a 11/10 情形二：自稱管理員兩則插空格假搬家（叫人私我拿新群），第二則不能因 fake-admin-cooldown／suspect-cooldown 被跳過', async () => {
  const r = await runGuard({
    live: [
      msg('m1', { senderName: '管理員小美', text: SPACED + '還沒進新群的私我拿連結' }),
      msg('m2', { senderName: '管理員小美', text: SPACED + '還沒進新群的私我拿連結' }),
    ],
    // 沒有連結時，強特徵閘照現行規則不在群內發話；這裡比照 guard-e2e 的 runGuardLegacy 關掉總閘，只驗證「冷卻」這一段不再吞掉第二則。
    config: { outboundGate: { enabled: false } },
  });
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  const skipped = r.logs.filter((x) => x.messageId === 'm2' && ['fake-admin-cooldown', 'suspect-cooldown'].includes(x.action));
  assert.equal(skipped.length, 0, 'm2 不應因冷卻被跳過');
  assert.equal(r.removes.length, 0);
  assert.equal(r.deletes.length, 0);
});

// 展開失敗時強特徵閘（strong-gate）照現行規則可能不放行通知；本測試只驗證第二則不會因冷卻而跟第一則不同。
test('T2b 短網址展開失敗：第二則與第一則處置一致（不因冷卻跳過；強特徵閘不放寬）', async () => {
  const r = await runGuard({
    live: [
      msg('m1', { senderName: '管理員小美', text: SPACED + '1url.cz/Down01' }),
      msg('m2', { senderName: '管理員小美', text: SPACED + '1url.cz/Down01' }),
    ],
  });
  assert.equal(flaggedTimes(r, 'm2'), flaggedTimes(r, 'm1'), 'm2 應與 m1 處置一致');
  const skipped = r.logs.filter((x) => ['fake-admin-cooldown', 'suspect-cooldown'].includes(x.action));
  assert.equal(skipped.length, 0, '不應有任何因冷卻被跳過的紀錄');
  assert.equal(r.removes.length, 0);
});

// T3：同一短網址兩則（一般暱稱）都要標
test('T3 同一短網址兩則（一般暱稱）都標', async () => {
  const r = await runGuard({
    live: [
      msg('m1', { text: '本群明天要刪除，請大家加入新群 1url.cz/TestBb2' }),
      msg('m2', { text: '這是新群連結 1url.cz/TestBb2 請大家加入新群' }),
    ],
  });
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  assert.equal(r.removes.length, 0);
});

// T4：收回再重發（同內容、新 messageId）仍要再標
test('T4 收回再重發（同內容、新 messageId）仍要再標', async () => {
  const text = '請大家加入新群 https://line.me/ti/g2/ExtGroup1110';
  const r = await runGuard({
    live: [msg('m1', { text }), msg('m2', { text })],
  });
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  assert.equal(r.removes.length, 0);
});

// T5：QR 緊跟在前一則通知後，群為只警告（warnOnly），不刪不踢，但仍要標
test('T5 QR 緊跟在前一則通知後（只警告群，不刪不踢）也要標', async () => {
  const png = await qrBase64('https://line.me/ti/g2/FakeGroup0001');
  const r = await runGuard({
    config: { groupPolicies: { cA: { warnOnly: true } }, qr: { enabled: true, kickOnConfirmed: false } },
    media: png,
    invites: { lookup: { FakeGroup0001: 's-elsewhere' } },
    live: [
      msg('m1', { text: '請大家加入新群 https://line.me/ti/g2/ExtGroup1110' }),
      msg('m2', { contentType: 'IMAGE' }),
    ],
    waitMs: 7000,
  });
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
});

// T6：圖片 QR 為別社群邀請且覆核為 SCAM：刪文＋標注、不踢（kickOnConfirmed 仍為 false）
test('T6 圖 QR 是別的社群邀請、覆核 SCAM：刪文＋標注、不踢（kickOnConfirmed 仍關）', async () => {
  const png = await qrBase64('https://line.me/ti/g2/FakeGroup0001');
  const r = await runGuard({
    config: { qr: { enabled: true, kickOnConfirmed: false } },
    media: png,
    invites: { lookup: { FakeGroup0001: 's-elsewhere' } },
    live: [msg('m1', { contentType: 'IMAGE' })],
  });
  assert.deepEqual(r.deletes.map((f) => f.messageId), ['m1']);
  assert.equal(r.removes.length, 0);
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
});

// T7：圖 QR 緊跟在前一則 QR 之後（兩張別群邀請 QR）：兩張都刪、都標、不踢
test('T7 圖 QR 緊跟在前一則 QR 之後（兩張別群邀請 QR）：兩張都刪都標、不踢', async () => {
  const png = await qrBase64('https://line.me/ti/g2/FakeGroup0001');
  const r = await runGuard({
    config: { qr: { enabled: true, kickOnConfirmed: false } },
    media: png,
    invites: { lookup: { FakeGroup0001: 's-elsewhere' } },
    live: [msg('m1', { contentType: 'IMAGE' }), msg('m2', { contentType: 'IMAGE' })],
    waitMs: 7000,
  });
  const deleted = r.deletes.map((f) => f.messageId);
  assert.ok(deleted.includes('m1'), 'm1 應被刪除');
  assert.ok(deleted.includes('m2'), 'm2 應被刪除');
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  assert.equal(r.removes.length, 0);
});

// T8：假旅行社群邀請：刪文＋標注
test('T8 假旅行社群邀請：刪文＋標注', async () => {
  const r = await runGuard({
    live: [msg('m1', { text: '幸福旅行社官方VIP會員群 誠邀加入，每月抽免費機票 https://line.me/ti/g2/FakeTravel1110' })],
  });
  assert.ok(r.deletes.map((f) => f.messageId).includes('m1'), 'm1 應被刪除');
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.equal(r.removes.length, 0);
});

// T9：假旅行社群，短網址展開成別群邀請：也要刪文＋標注
test('T9 假旅行社群：短網址展開成別群邀請也刪文＋標注', async () => {
  const r = await runGuard({
    live: [msg('m1', { text: '幸福旅行社官方福利群 歡迎加入 1url.cz/Travel1' })],
  });
  assert.ok(r.deletes.map((f) => f.messageId).includes('m1'), 'm1 應被刪除');
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.equal(r.removes.length, 0);
});

// T10：假超商群邀請：刪文＋標注
test('T10 假超商群邀請：刪文＋標注', async () => {
  const r = await runGuard({
    live: [msg('m1', { text: '超商會員福利群 每天領免費咖啡券 歡迎加入 https://line.me/ti/g2/FakeStore1110' })],
  });
  assert.ok(r.deletes.map((f) => f.messageId).includes('m1'), 'm1 應被刪除');
  assert.ok(flaggedTimes(r, 'm1') >= 1, 'm1 應被標記');
  assert.equal(r.removes.length, 0);
});

// T11：假超商群 QR：刪文＋標注、不踢
test('T11 假超商群 QR：刪文＋標注、不踢', async () => {
  const png = await qrBase64('https://line.me/ti/g2/FakeStore1110');
  const r = await runGuard({
    config: { qr: { enabled: true, kickOnConfirmed: false } },
    media: png,
    invites: { lookup: { FakeStore1110: 's-elsewhere' } },
    live: [
      msg('m1', { text: '超商會員福利群 每天領免費咖啡券 掃碼加入' }),
      msg('m2', { contentType: 'IMAGE' }),
    ],
    waitMs: 7000,
  });
  assert.ok(r.deletes.map((f) => f.messageId).includes('m2'), 'm2 應被刪除');
  assert.ok(flaggedTimes(r, 'm2') >= 1, 'm2 應被標記');
  assert.equal(r.removes.length, 0);
});

// T12（對抗）：同一則訊息（同 messageId）重複送達，只能標一次
test('T12 對抗「同一則訊息重複送達（同 messageId）只標一次」', async () => {
  const text = '請大家加入新群 https://line.me/ti/g2/ExtGroup1110';
  const r = await runGuard({
    live: [msg('m1', { text }), msg('m1', { text })],
  });
  const nonDone = r.logs.filter((x) => x.action === 'notified' && x.messageId === 'm1' && !String(x.kind).startsWith('done-'));
  assert.ok(nonDone.length <= 1, `m1 通知次數應 <= 1，實際 ${nonDone.length}`);
  assert.equal(r.removes.length, 0);
});

// T13（對抗）：一般聊天兩則不標
test('T13 對抗「一般聊天兩則不標」', async () => {
  const r = await runGuard({
    answer: 'OK\n正常',
    live: [msg('m1', { text: '我剛剛醒，睡很久' }), msg('m2', { text: '今天午餐吃什麼' })],
  });
  assert.equal(notifiedIds(r).length, 0);
  assert.equal(r.sends.length, 0);
  assert.equal(r.deletes.length, 0);
  assert.equal(r.removes.length, 0);
});

// T14（對抗）：踢人群，同一位自稱管理員連發兩則邀請，最多踢一次
test('T14 對抗「踢人群：同一位自稱管理員連發兩則邀請，最多踢一次」', async () => {
  const text = '新群在這 https://line.me/ti/g2/ExtGroup999';
  const r = await runGuard({
    config: { kickMode: 'kick' },
    live: [
      msg('m1', { senderName: '管理員小美', text }),
      msg('m2', { senderName: '管理員小美', text }),
    ],
  });
  assert.ok(r.removes.length <= 1, `踢人次數應 <= 1，實際 ${r.removes.length}`);
});

// T15（對抗）：範例設定檔中 qr.kickOnConfirmed 不得為 true
test('T15 對抗「qr.kickOnConfirmed 預設仍為 false、設定檔範例未開」', async () => {
  const example = JSON.parse(readFileSync(new URL('../guard/guard.config.example.json', import.meta.url), 'utf8'));
  assert.ok(example.qr?.kickOnConfirmed !== true, 'qr.kickOnConfirmed 不可為 true');
});
