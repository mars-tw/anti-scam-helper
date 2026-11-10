// 網路模擬（僅供測試，資料全為假）：由 node --import 載入到 guard 子程序，禁止真實外網，模擬 reurl.cc 短網址展開。
import dns from 'node:dns/promises';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const originalLookup = dns.lookup;
dns.lookup = async function mockLookup(host, options) {
  if (host === 'localhost' || net.isIP(host)) return originalLookup.call(dns, host, options);
  if (options && options.all) return [{ address: '203.0.113.10', family: 4 }];
  return { address: '203.0.113.10', family: 4 };
};
syncBuiltinESMExports();

const html = (body) => new Response(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const to = (location) => new Response(null, { status: 302, headers: { location } });

const originalFetch = globalThis.fetch;
globalThis.fetch = async function mockFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(raw);
  const host = u.hostname;
  if (host === '127.0.0.1' || host === 'localhost') return originalFetch(input, init);
  if (host === 'reurl.cc') {
    if (u.pathname === '/FakeOther1') return to('https://line.me/ti/g2/FakeOtherTk1110');
    if (u.pathname === '/FakeOwn1') return to('https://line.me/ti/g2/FakeOwnTk1110');
    if (u.pathname === '/FakeFail1') throw new TypeError('fetch failed');
    if (u.pathname === '/FakeNormal1') return to('https://news.example.org/fake-article-1110');
    // 中繼頁：頁面寫死（跳脫斜線）別群邀請
    if (u.pathname === '/FakeHtml1') return html('<script>var j="https:\\/\\/line.me\\/ti\\/g2\\/FakeOtherTk1110";</script>');
    return new Response('', { status: 404 });
  }
  if (host === 'news.example.org') return html('<article><h1>今日盤勢整理</h1><p>大盤小漲，成交量放大。</p></article>');
  if (host === 'line.me' || host.endsWith('.line.me')) return new Response('', { status: 404 });
  throw new TypeError('fetch failed (offline mock)');
};
