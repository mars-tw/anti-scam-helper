// 語言模型介面：本機 AI 派工器（免費，只在這台電腦），或 OpenAI 相容 API（GPT、Grok 等，雲端可用、依用量計費）。
//
// 設定範例：
//   { "backend": "local", "url": "http://127.0.0.1:11440", "capability": "text_fast" }
//   { "backend": "openai", "baseUrl": "https://api.openai.com/v1", "model": "<模型名稱>", "apiKeyEnv": "OPENAI_API_KEY" }
//   { "backend": "openai", "baseUrl": "https://api.x.ai/v1", "model": "<模型名稱>", "apiKeyEnv": "XAI_API_KEY" }
// 推理型模型會把一部分 token 花在思考上，回答被截斷時把 maxTokens 調高。

/** 回傳模型的文字回答；連不上、逾時或格式不對時回 undefined（呼叫端自行退回保守處理）。 */
export async function complete(llm, system, user, maxTokens) {
  try {
    if ((llm.backend ?? "local") === "openai") return await openai(llm, system, user, maxTokens);
    return await local(llm, system, user, maxTokens);
  } catch (error) {
    console.error(`模型無法使用（${llm.backend ?? "local"}）：${error.message}`);
    return undefined;
  }
}

async function openai(llm, system, user, maxTokens) {
  const key = process.env[llm.apiKeyEnv ?? "OPENAI_API_KEY"];
  if (!key) throw new Error(`缺少環境變數 ${llm.apiKeyEnv ?? "OPENAI_API_KEY"}`);
  if (!llm.model) throw new Error("設定檔缺少 model");
  const response = await fetch(`${(llm.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      // OpenAI 新模型只收 max_completion_tokens；其他相容服務若只認 max_tokens，可在設定改 maxTokensField。
      [llm.maxTokensField ?? "max_completion_tokens"]: llm.maxTokens ?? maxTokens,
    }),
    signal: AbortSignal.timeout(llm.timeoutMs ?? 60_000),
  });
  // 錯誤內容可能夾帶請求細節，只記狀態碼。
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : undefined;
}

async function local(llm, system, user, maxTokens) {
  const url = llm.url ?? "http://127.0.0.1:11440";
  const created = await fetch(`${url}/v1/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: llm.capability ?? "text_fast", payload: { task: `${system}\n\n${user}`, max_tokens: maxTokens, allow_cloud: false }, priority: 5 }),
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json());
  const deadline = Date.now() + (llm.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const task = await fetch(`${url}/v1/tasks/${created.id}`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
    if (task.status === "completed") {
      const text = task.result?.output?.answer;
      return typeof text === "string" ? text.trim() : undefined;
    }
    if (["failed", "cancelled", "rejected"].includes(task.status)) throw new Error(`任務 ${task.status}`);
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error("逾時");
}
