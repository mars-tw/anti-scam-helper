// 網路模擬（僅供測試）：由 node --import 載入到 guard 子程序，禁止真實外網。
import dns from 'node:dns/promises';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

// 保存原始 lookup，供 localhost 與 IP 字面值使用
const originalLookup = dns.lookup;

// 任何網域一律解析為測試用 TEST-NET 位址 203.0.113.10
dns.lookup = async function mockLookup(host, options) {
  if (host === 'localhost' || net.isIP(host)) return originalLookup.call(dns, host, options);
  if (options && options.all) return [{ address: '203.0.113.10', family: 4 }];
  return { address: '203.0.113.10', family: 4 };
};
// 讓 guard 模組中 import { lookup } from 'node:dns/promises' 看到替換後的函式
syncBuiltinESMExports();

// 包裝 fetch：本機放行，其餘網域由假資料回應
const originalFetch = globalThis.fetch;
globalThis.fetch = async function mockFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(raw);
  const host = u.hostname;
  if (host === '127.0.0.1' || host === 'localhost') return originalFetch(input, init);
  if (host === '1url.cz') {
    // /Down01 模擬展開失敗；其餘路徑 302 到別群邀請
    if (u.pathname === '/Down01') throw new TypeError('fetch failed');
    return new Response(null, { status: 302, headers: { location: 'https://line.me/ti/g2/FakeMove1110Tk' } });
  }
  if (host === 'line.me' || host.endsWith('.line.me')) return new Response('', { status: 404 });
  throw new TypeError('fetch failed (offline mock)');
};
