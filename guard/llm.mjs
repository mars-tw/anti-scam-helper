// 語言模型介面：本機 AI 派工器（免費，只在這台電腦），或 OpenAI 相容 API。
// OpenAI 相容 API 可以是付費服務（GPT、Grok），也可以是主機上自己跑的免費模型（llama.cpp 的 llama-server 等）。
//
// 設定範例：
//   { "backend": "local", "url": "http://127.0.0.1:11440", "capability": "text_fast" }
//   { "backend": "openai", "baseUrl": "https://api.openai.com/v1", "model": "<模型名稱>", "apiKeyEnv": "OPENAI_API_KEY" }
//   { "backend": "openai", "baseUrl": "https://api.x.ai/v1", "model": "<模型名稱>", "apiKeyEnv": "XAI_API_KEY" }
//   { "backend": "openai", "baseUrl": "http://127.0.0.1:8080/v1", "model": "qwen3-vl-2b", "apiKeyEnv": "", "maxTokensField": "max_tokens" }
// apiKeyEnv 設成空字串＝不帶金鑰（主機上自己跑的模型）。
// 推理型模型會把一部分 token 花在思考上，回答被截斷時把 maxTokens 調高。

/**
 * 回傳模型的文字回答；連不上、逾時或格式不對時回 undefined（呼叫端自行退回保守處理）。
 * `image`（選用）：{ mime, base64 }，給看得懂圖片的模型。
 */
export async function complete(llm, system, user, maxTokens, image) {
  const answer = await completeOne(llm, system, user, maxTokens, image);
  // 備援：主模型連不上、沒金鑰或答非所問時，改問 llm.fallback（例如主機上的 llama-server）。
  if (answer === undefined && llm.fallback) {
    console.error(`模型 ${llm.model ?? llm.backend ?? "local"} 無法使用，改用備援模型（${llm.fallback.model ?? llm.fallback.backend ?? "local"}）`);
    // 備援可以再有備援（例如 Meta → xAI → 地端）。
    return complete(llm.fallback, system, user, maxTokens, image);
  }
  return answer;
}

async function completeOne(llm, system, user, maxTokens, image) {
  try {
    const backend = llm.backend ?? "local";
    const answer = backend === "openai"
      ? await openai(llm, system, user, maxTokens, image)
      : backend === "responses"
        ? await responses(llm, system, user, maxTokens, image)
        : await local(llm, system, user, maxTokens, image);
    // Qwen3 等模型可能先輸出 <think>…</think> 的思考過程，只留最後的回答。
    return answer?.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || undefined;
  } catch (error) {
    console.error(`模型無法使用（${llm.backend ?? "local"}）：${error.message}`);
    return undefined;
  }
}

async function openai(llm, system, user, maxTokens, image) {
  const keyEnv = llm.apiKeyEnv ?? "OPENAI_API_KEY";
  const key = keyEnv ? process.env[keyEnv] : undefined;
  if (keyEnv && !key) throw new Error(`缺少環境變數 ${keyEnv}`);
  if (!llm.model) throw new Error("設定檔缺少 model");
  const content = image
    ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } }]
    : user;
  const response = await fetch(`${(llm.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: llm.model,
      messages: [{ role: "system", content: system }, { role: "user", content }],
      // OpenAI 新模型只收 max_completion_tokens；llama-server 等其他相容服務用 max_tokens，可在設定改 maxTokensField。
      [llm.maxTokensField ?? "max_completion_tokens"]: llm.maxTokens ?? maxTokens,
    }),
    signal: AbortSignal.timeout(llm.timeoutMs ?? 60_000),
  });
  // 錯誤內容可能夾帶請求細節，只記狀態碼。
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : undefined;
}

// OpenAI Responses 格式（例如 Meta：POST https://api.meta.ai/v1/responses）。
async function responses(llm, system, user, maxTokens, image) {
  const keyEnv = llm.apiKeyEnv ?? "OPENAI_API_KEY";
  const key = keyEnv ? process.env[keyEnv] : undefined;
  if (keyEnv && !key) throw new Error(`缺少環境變數 ${keyEnv}`);
  if (!llm.model) throw new Error("設定檔缺少 model");
  const content = [{ type: "input_text", text: user }, ...(image ? [{ type: "input_image", image_url: `data:${image.mime};base64,${image.base64}` }] : [])];
  const response = await fetch(`${(llm.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: llm.model,
      instructions: system,
      input: [{ role: "user", content }],
      stream: false,
      ...(llm.maxTokens ?? maxTokens ? { max_output_tokens: llm.maxTokens ?? maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(llm.timeoutMs ?? 60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  const texts = (data.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text);
  return texts.length ? texts.join("\n") : undefined;
}

async function local(llm, system, user, maxTokens, image) {
  const url = llm.url ?? "http://127.0.0.1:11440";
  const payload = { task: `${system}\n\n${user}`, max_tokens: maxTokens, allow_cloud: false, ...(image ? { image_url: `data:${image.mime};base64,${image.base64}` } : {}) };
  const created = await fetch(`${url}/v1/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: llm.capability ?? (image ? "vision" : "text_fast"), payload, priority: 5 }),
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json());
  const deadline = Date.now() + (llm.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const task = await fetch(`${url}/v1/tasks/${created.id}`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
    if (task.status === "completed") {
      const text = task.result?.output?.answer;
      return typeof text === "string" ? text : undefined;
    }
    if (["failed", "cancelled", "rejected"].includes(task.status)) throw new Error(`任務 ${task.status}`);
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error("逾時");
}
