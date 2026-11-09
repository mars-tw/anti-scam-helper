import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { benignUrlPattern, DEFAULT_BENIGN_DOMAINS } from '../guard/rules.mjs';

const guardDir = resolve(dirname(fileURLToPath(import.meta.url)), '../guard');

// Find the production pure-function module without depending on its filename.
function moduleFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return moduleFiles(path);
    return entry.isFile() && entry.name.endsWith('.mjs') ? [path] : [];
  });
}
const scopeFile = moduleFiles(guardDir).find((file) => {
  if (file === join(guardDir, 'guard.mjs')) return false;
  const source = readFileSync(file, 'utf8');
  return /export\s+function\s+classifyFetch\s*\(/.test(source) &&
    /export\s+function\s+unrecognizedLinkAction\s*\(/.test(source);
});
assert.ok(scopeFile, 'production link classification module must exist');
const { classifyFetch, unrecognizedLinkAction, GROUP_INVITE } = await import(pathToFileURL(scopeFile).href);

// Compile successive closing braces, rather than copying or reimplementing the
// function. This also tolerates nested blocks, templates, and regexp literals.
const guardSource = readFileSync(join(guardDir, 'guard.mjs'), 'utf8');
const declaration = /\basync\s+function\s+checkUnrecognizedLink\s*\(/.exec(guardSource);
assert.ok(declaration, 'production checkUnrecognizedLink must exist');
let functionSource;
const closingBraces = /^[ \t]*\}/gm;
closingBraces.lastIndex = declaration.index;
for (let match; (match = closingBraces.exec(guardSource));) {
  const candidate = guardSource.slice(declaration.index, match.index + match[0].length);
  try {
    new vm.Script(`(${candidate})`);
    functionSource = candidate;
    break;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}
assert.ok(functionSource, 'could not extract complete checkUnrecognizedLink');

const chatId = 'test-chat';
const message = Object.freeze({
  channelId: chatId,
  messageId: 'test-message',
  senderId: 'test-sender',
  senderName: '測試管理員',
  senderRole: undefined,
});
const socket = {};
const challengeResponse = {
  status: 403,
  headers: { server: 'cloudflare', 'cf-ray': 'test-only' },
  html: '<title>Just a moment</title>',
};

function harness({ dryRun = false, response = challengeResponse, finalUrl } = {}) {
  const fetches = [];
  const frames = [];
  const records = [];
  const marks = [];
  const errors = [];
  const context = {
    URL,
    unrecognized: { enabled: true, timeoutMs: 100, reportFile: 'test.jsonl' },
    config: { dryRun, kickScope: { excludeChats: [] } },
    learnOnly: new Set(),
    warnOnly: new Set(),
    notifyChats: new Set([chatId]),
    benignUrl: benignUrlPattern(DEFAULT_BENIGN_DOMAINS),
    GROUP_INVITE,
    unrecognizedLinkAction,
    neverKick: (received) => { assert.equal(received, message); return false; },
    noAction: () => false,
    sanitizeLinks: (text) => ({ text }),
    onlyMainstreamMediaLinks: () => false,
    isMainstreamMediaHost: () => false,
    expandUrlSafe: async (url) => {
      fetches.push(url);
      return { url: finalUrl ?? url, kind: classifyFetch(response) };
    },
    record: (entry) => records.push(entry),
    recordError: (...args) => errors.push(args),
    resolve,
    logDir: '/test-only-no-files',
    mkdirSync: () => {},
    appendFileSync: () => {},
    chmodSync: () => {},
    gateSend: () => false,
    preNotify: async () => {},
    sendNotice: async () => {},
    scrubNotice: (text) => text,
    UNRECOGNIZED_REPLY: 'test notice',
    blockedWords: [],
    call: async (ws, frame) => {
      assert.equal(ws, socket);
      frames.push(frame);
      return { type: frame.type === 'message:delete' ? 'message:deleted' : 'message:sent' };
    },
    unrecognizedReport: () => undefined,
    withAgentLabel: (text) => text,
    markSelfCanKick: (...args) => marks.push(args),
  };
  const check = new vm.Script(`(${functionSource})`).runInNewContext(context);
  return { check, fetches, frames, records, marks, errors };
}

function deletes(h) {
  return h.frames.filter((frame) => frame.type === 'message:delete');
}
function assertDeleted(h) {
  assert.equal(deletes(h).length, 1);
  assert.equal(deletes(h)[0].chatId, chatId);
  assert.equal(deletes(h)[0].messageId, message.messageId);
  assert.equal(h.marks.length, 1);
  assert.equal(h.errors.length, 0);
  const probe = h.records.find((entry) => entry.action === 'link-probe');
  assert.equal(probe?.result, 'cf-challenge');
  assert.equal(probe?.act, true);
}

for (const host of ['techorange.com', 'www.techorange.com', 'midjourney.com', 'www.midjourney.com']) {
  test(`official ${host} is not fetched or deleted`, async () => {
    const h = harness();
    assert.equal(await h.check(socket, message, `https://${host}/article`), false);
    assert.equal(h.fetches.length, 0);
    assert.equal(deletes(h).length, 0);
  });
}

for (const domain of ['techorange.com', 'midjourney.com']) {
  for (const dot of ['\u3002', '\uff0e', '\uff61']) {
    const url = `https://${domain}${dot}evil.invalid/article`;
    test(`Unicode-dot hostile suffix is fetched and deleted: ${url}`, async () => {
      assert.equal(new URL(url).hostname, `${domain}.evil.invalid`);
      const h = harness();
      assert.equal(await h.check(socket, message, url), true);
      assert.equal(h.fetches.length, 1);
      assert.equal(new URL(h.fetches[0]).hostname, `${domain}.evil.invalid`);
      assertDeleted(h);
    });
  }
  test(`official ${domain} with Chinese punctuation is not fetched`, async () => {
    for (const text of [`https://${domain}。 這是新聞`, `https://${domain}/article。這是新聞`]) {
      const h = harness();
      assert.equal(await h.check(socket, message, text), false);
      assert.equal(h.fetches.length, 0);
      assert.equal(deletes(h).length, 0);
    }
  });
}

for (const domain of ['techorange.com', 'midjourney.com']) {
  for (const delimiter of [')', '（', '）', '（x）', '"', "'", '<', '>', '，', '。', '」', '』', '%29', '%EF%BC%88', '%EF%BC%89', '%22', '%27', '%3C', '%3E']) {
    const raw = `https://unknown.invalid/${delimiter}${domain}/x`;
    for (const finalUrl of new Set([raw, new URL(raw).href])) {
      test(`redirected hostile path remains actionable: ${finalUrl}`, async () => {
        assert.equal(new URL(finalUrl).hostname, 'unknown.invalid');
        const h = harness({ finalUrl });
        const inputUrl = 'https://unknown.invalid/start';
        assert.equal(await h.check(socket, message, inputUrl), true);
        assert.deepEqual(h.fetches, [inputUrl]);
        assertDeleted(h);
      });
    }
  }
}

test('unknown Cloudflare challenge actually deletes the message', async () => {
  assert.equal(classifyFetch(challengeResponse), 'cf-challenge');
  const h = harness();
  const url = 'https://unknown.invalid/article';
  assert.equal(await h.check(socket, message, url), true);
  assert.deepEqual(h.fetches, [url]);
  assertDeleted(h);
});

for (const url of [
  'https://techorange.com.evil.invalid/article',
  'https://fake-techorange.com.invalid/article',
  'https://midjourney.com.evil.invalid/article',
  'https://notmidjourney.com.invalid/article',
  'https://unknown.invalid/techorange.com/article',
  'https://unknown.invalid/midjourney.com/article',
]) {
  test(`nonofficial URL remains actionable: ${url}`, async () => {
    const h = harness();
    assert.equal(await h.check(socket, message, url), true);
    assert.equal(h.fetches.length, 1);
    assert.notEqual(new URL(h.fetches[0]).hostname, 'techorange.com');
    assert.notEqual(new URL(h.fetches[0]).hostname, 'midjourney.com');
    assertDeleted(h);
  });
}

for (const text of [
  'https://www.techorange.com/article https://unknown.invalid/article',
  'https://unknown.invalid/article https://www.midjourney.com/article',
]) {
  test(`official and unknown mixed links still delete: ${text}`, async () => {
    const h = harness();
    assert.equal(await h.check(socket, message, text), true);
    assert.deepEqual(h.fetches, ['https://unknown.invalid/article']);
    assertDeleted(h);
  });
}

test('LINE group invite is left to the separate invite handler', async () => {
  const h = harness();
  assert.equal(await h.check(socket, message, 'https://line.me/ti/g/test-invite https://unknown.invalid/article'), false);
  assert.equal(h.fetches.length, 0);
  assert.equal(deletes(h).length, 0);
});

test('dry run reports action but does not delete', async () => {
  const h = harness({ dryRun: true });
  assert.equal(await h.check(socket, message, 'https://unknown.invalid/article'), true);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.records.find((entry) => entry.action === 'link-probe')?.result, 'cf-challenge');
  assert.ok(h.records.some((entry) => entry.action === 'unrecognized-link-dry-run'));
  assert.equal(deletes(h).length, 0);
  assert.equal(h.marks.length, 0);
});

test('ordinary HTTP failure is not a Cloudflare challenge', async () => {
  const response = { status: 403, headers: { server: 'example' }, html: 'Forbidden' };
  assert.equal(classifyFetch(response), 'http-403');
  const h = harness({ response });
  assert.equal(await h.check(socket, message, 'https://unknown.invalid/article'), false);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.records.find((entry) => entry.action === 'link-probe')?.result, 'http-403');
  assert.equal(deletes(h).length, 0);
});
