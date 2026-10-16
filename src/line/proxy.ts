import { readFile } from "node:fs/promises";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import type { FetchLike } from "@evex/linejs/base";

/**
 * Outbound proxy for every connection to LINE (and the other HTTPS requests this server makes).
 * Read from the LINEJS_PROXY environment variable, else from `proxy.txt`; neither is required.
 * Accepted forms: a URL (`http://user:pass@host:port`, `socks5://…`) or the `host:port:user:pass`
 * line many proxy providers hand out. The credentials never leave this module except to the proxy.
 */
export async function loadProxy(file: string, env = process.env.LINEJS_PROXY): Promise<URL | undefined> {
  let text = env?.trim();
  if (!text) {
    try {
      text = (await readFile(file, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  if (!text) return undefined;
  return parseProxy(text);
}

export function parseProxy(text: string): URL {
  let url: URL;
  if (/^[a-z0-9]+:\/\//i.test(text)) {
    url = new URL(text);
  } else {
    const parts = text.split(":");
    if (parts.length !== 2 && parts.length !== 4) throw new Error("PROXY_INVALID");
    const [host, port, user, pass] = parts;
    url = new URL(`http://${host}:${port}`);
    if (user !== undefined && pass !== undefined) {
      url.username = encodeURIComponent(user);
      url.password = encodeURIComponent(pass);
    }
  }
  if (!["http:", "https:", "socks5:", "socks:"].includes(url.protocol) || !url.hostname || !url.port) throw new Error("PROXY_INVALID");
  return url;
}

/** Where the proxy is, without its credentials: safe to print. */
export function describeProxy(url: URL): string {
  return `${url.protocol}//${url.hostname}:${url.port}`;
}

/**
 * Routes all of Node's fetch through the proxy, and returns the fetch LINE's client must use.
 * The client normally picks its own connection pools (HTTP/2 only for PUSH, the live event stream);
 * a custom fetch replaces them, so the same split is kept here.
 */
export function useProxy(url: URL): FetchLike {
  const uri = url.href;
  const http1 = new ProxyAgent({ uri });
  const http2 = new ProxyAgent({ uri, allowH2: true, requestTls: { allowH2: true } });
  setGlobalDispatcher(http1);
  return (request) => {
    const dispatcher = new URL(request.url).pathname.startsWith("/PUSH/") ? http2 : http1;
    return fetch(request, { dispatcher } as RequestInit);
  };
}
