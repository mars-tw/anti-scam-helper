import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeProxy, loadProxy, parseProxy } from "../dist/line/proxy.js";

async function dir(t) {
  const root = await mkdtemp(join(tmpdir(), "linejs-proxy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("host:port:user:pass and URLs are accepted; printing never shows the credentials", () => {
  const line = parseProxy("relay.example.com:1337:user1:secret2");
  assert.equal(line.protocol, "http:");
  assert.equal(line.hostname, "relay.example.com");
  assert.equal(line.port, "1337");
  assert.equal(decodeURIComponent(line.username), "user1");
  assert.equal(decodeURIComponent(line.password), "secret2");
  assert.equal(describeProxy(line), "http://relay.example.com:1337");
  assert.equal(parseProxy("relay.example.com:8080").username, "");
  assert.equal(parseProxy("socks5://u:p@10.0.0.1:1080").protocol, "socks5:");
  assert.ok(!describeProxy(parseProxy("socks5://u:secret@10.0.0.1:1080")).includes("secret"));
});

test("malformed proxy settings are refused instead of silently connecting directly", () => {
  for (const bad of ["relay.example.com", "a:1:b", "a:1:b:c:d", "ftp://a:21", "http://a", "relay.example.com:port:u:p"]) {
    assert.throws(() => parseProxy(bad), /PROXY_INVALID|Invalid URL/, bad);
  }
});

test("the environment variable wins over proxy.txt; neither means no proxy", async (t) => {
  const root = await dir(t);
  const file = join(root, "proxy.txt");
  assert.equal(await loadProxy(file, undefined), undefined);
  await writeFile(file, "file.example.com:1000:a:b\r\n");
  assert.equal((await loadProxy(file, undefined)).hostname, "file.example.com");
  assert.equal((await loadProxy(file, "env.example.com:2000")).hostname, "env.example.com");
  await writeFile(file, "  \n");
  assert.equal(await loadProxy(file, ""), undefined);
});
