import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SessionStorage } from "./line/session.js";
import { EvexLineProvider } from "./line/provider.js";
import { describeProxy, loadProxy, useProxy } from "./line/proxy.js";
import { LoginController } from "./line/login.js";
import { ApiTokenStore } from "./http/apiToken.js";
import { JevClient } from "./jev/client.js";
import { createWebServer } from "./http/server.js";
import { MediaService } from "./media/service.js";
import { ChatStore } from "./model/store.js";
import { UpdateChecker } from "./update/checker.js";
import { createHub } from "./ws/hub.js";

const RESTORE_FIRST_DELAY_MS = 30_000;
const RESTORE_MAX_DELAY_MS = 10 * 60_000;
const RESTORE_MAX_ATTEMPTS = 20;
const RECOVERY_EXIT_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  process.umask(0o077);
  const config = await loadConfig();
  const manifest: { version: string } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const storage = new SessionStorage(resolve("session.json"));
  const store = new ChatStore(config.cache.messagesPerChannel);
  // Optional: LINE sees the proxy's address instead of this host's (LINEJS_PROXY or proxy.txt).
  const proxy = await loadProxy(resolve("proxy.txt"));
  const proxyFetch = proxy ? useProxy(proxy) : undefined;
  const provider = new EvexLineProvider(storage, config.line.device, {
    onMessage: (message, kind) => {
      console.info(`LINE 訊息收到：id=${message.messageId} type=${message.contentType} kind=${kind}`);
      hub.handleMessage(message, kind);
    },
    onRead: (chatId, position) => hub.handleRead(chatId, position),
    onUnsend: (chatHint, messageId) => {
      console.info(`LINE 訊息收回：id=${messageId}`);
      hub.handleUnsend(chatHint, messageId);
    },
    onChecked: (chatId) => hub.handleChecked(chatId),
    onChatsChanged: () => hub.handleChatsChanged(),
    onReactions: (chatId, messageId, reactions) => hub.handleReactions(chatId, messageId, reactions),
    onStatus: (state) => {
      console.info(`LINE 狀態：${state}`);
      hub.setStatus(state);
    },
    onError: (code) => {
      console.error(code);
      if (code === "SESSION_WRITE_FAILED") login.fail();
    },
    // A connection that died silently (host suspended, sockets gone) cannot be trusted to recover in
    // place: the pooled HTTP/2 sessions are dead too. Exit and let the process manager start a fresh one,
    // which is exactly what a manual restart does. The session token is kept on disk.
    onStale: (reason, detail) => {
      console.error(`LINE_STALE reason=${reason} silent=${Math.round(detail.silentMs / 1000)}s${detail.jumpMs !== undefined ? ` jump=${Math.round(detail.jumpMs / 1000)}s` : ""}：連線已失效，結束行程交給 pm2 重啟`);
      restartForRecovery();
    },
  }, proxyFetch, config.limits.downloadMaxBytes);
  let stopping = false;
  // Set once `stop` exists; the provider can only report a stale connection after login, i.e. later.
  let restartForRecovery = (): void => { process.exitCode = 1; };
  const login = new LoginController(provider);
  const media = new MediaService(config.cache.mediaMaxBytes, provider);
  const apiTokens = new ApiTokenStore(resolve("api-token.json"));
  await apiTokens.load();
  const web = createWebServer(config, resolve("dist/web"), media, apiTokens);
  const hub = createHub({
    server: web.server,
    authorizeUpgrade: web.authorizeUpgrade,
    authorizeApiUpgrade: web.authorizeApiUpgrade,
    apiTokens,
    config,
    login,
    media,
    provider,
    store,
    serverVersion: manifest.version,
    ...(config.jev.token ? { scam: new JevClient({ token: config.jev.token, model: config.jev.model }) } : {}),
  });
  await new Promise<void>((ready, reject) => {
    web.server.once("error", reject);
    web.server.listen(config.server.port, config.server.host, () => {
      web.server.off("error", reject);
      ready();
    });
  });
  // `linejs stop|restart` finds the running service through this file (scripts/service.mjs).
  const pidPath = resolve("linejs.pid");
  await writeFile(pidPath, String(process.pid), { mode: 0o600 }).catch(() => {
    console.warn("警告：無法寫入 linejs.pid，管理腳本的 stop／restart 將找不到此服務。");
  });
  const releasePid = async (): Promise<void> => {
    // A newer instance may already own the file; only remove our own.
    if ((await readFile(pidPath, "utf8").catch(() => "")) === String(process.pid)) await rm(pidPath, { force: true });
  };
  console.info(`LINE.js：http://${config.server.host}:${config.server.port}`);
  if (!["127.0.0.1", "localhost", "::1"].includes(config.server.host)) {
    console.warn("警告：監聽位址不是本機迴路。能連到此位址的人都能開啟網頁並操作已登入的 LINE 帳號，請確認網路環境可信。");
  }
  if (config.api.enabled) console.info(`機器人 API：ws://${config.server.host}:${config.server.port}/api/ws（Token 以 npm run cli -- token 產生）`);
  if (config.jev.token) console.info(`詐騙訊息分析：已啟用（TypeSafe ${config.jev.model}；只在你對訊息按右鍵選擇分析時送出該則文字）`);
  if (proxy) console.info(`對外連線經代理：${describeProxy(proxy)}`);
  console.info("請使用次要帳號；QR 與 PIN 僅於網頁顯示。");
  // A restore that fails because the network is not back yet (e.g. right after a wake) would leave the
  // service signed out until someone restarts it. Retry while a saved token exists; a token LINE rejects
  // stops being retried after a bounded number of attempts.
  let restoreAttempt = 0;
  let restoreTimer: NodeJS.Timeout | undefined;
  const restore = async (): Promise<void> => {
    await login.restore();
    if (stopping || login.state === "ready" || restoreAttempt >= RESTORE_MAX_ATTEMPTS) return;
    const token = await storage.get("userAuthToken").catch(() => undefined);
    if (typeof token !== "string" || !token) return;
    const delay = Math.min(RESTORE_FIRST_DELAY_MS * 2 ** restoreAttempt, RESTORE_MAX_DELAY_MS);
    restoreAttempt++;
    console.warn(`LINE_RESTORE_RETRY attempt=${restoreAttempt} in=${Math.round(delay / 1000)}s：登入狀態還原失敗，稍後重試`);
    restoreTimer = setTimeout(() => { void restore(); }, delay);
  };
  void restore();
  const updates = config.update.check ? new UpdateChecker({ current: manifest.version, onUpdate: (info) => hub.setUpdate(info) }) : undefined;
  updates?.start();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(restoreTimer);
    updates?.stop();
    hub.close();
    web.server.close();
    web.server.closeAllConnections();
    try {
      await provider.close();
      await releasePid();
      process.exit(process.exitCode ?? 0);
    } catch {
      console.error("SESSION_WRITE_FAILED");
      await releasePid().catch(() => {});
      process.exit(1);
    }
  };
  restartForRecovery = () => {
    process.exitCode = 1;
    // Teardown touches the dead connection; never let it keep the process alive.
    setTimeout(() => process.exit(1), RECOVERY_EXIT_TIMEOUT_MS).unref();
    void stop();
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  // linejs runs push and polling loops nobody awaits; one stray rejection must not take the service
  // (and the signed-in session) down. Only a code and the message go to the log: upstream error
  // objects can carry authentication material.
  const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown");
  process.on("unhandledRejection", (reason) => { console.error("UNHANDLED_REJECTION", describe(reason)); });
  // A thrown exception may have left state behind it inconsistent: shut down cleanly (session flushed,
  // pid file released) instead of dying mid-write, and let the user restart.
  process.once("uncaughtException", (error) => {
    console.error("UNCAUGHT_EXCEPTION", describe(error));
    process.exitCode = 1;
    void stop();
  });
}

main().catch(() => {
  console.error("STARTUP_FAILED：請檢查本機設定、session 權限及監聽埠。");
  process.exitCode = 1;
});
