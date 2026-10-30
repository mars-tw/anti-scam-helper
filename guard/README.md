# 反詐小幫手：反詐守衛＋群組小助手

自動監看 LINE 群組與社群：判定為詐騙就移除發言者（社群另刪除該則訊息），並回答成員的問題。

> ⚠️ 這是非官方 LINE API，用真人帳號自動踢人、自動發言可能被 LINE 限制或封號。誤判也可能把正常成員踢掉。請先用試跑模式（`dryRun: true`）觀察幾天。

## 會做的事

### 1. 文字詐騙

1. **規則篩選**（免費）：假搬家（移至新群、重新加入、統一核准）、LINE 邀請連結、加賴／ID、短網址、飆股帶單、兼職日領、私我、博弈貸款、假中獎客服、在群組分享聯絡人卡片等，每類命中加分。沒命中任何規則的訊息直接放行，不耗模型（想讓模型也看這些訊息，設 `localScreenAll: true`）。
2. **模型複核**：命中規則的訊息交給模型，回答 SCAM／UNSURE／OK。模型只判斷「發言者本人是不是在行騙」，所以有人問「這個連結是詐騙嗎？」不會被踢。
3. **處置**：模型判定 SCAM 就移除。模型不確定或連不上時，規則分數達 `strongScore`（預設 6）才移除。模型判定 OK 一律不動。
4. **設定了 `review`（覆核模型）時改用更嚴的分層巡邏**，見下方〈分層巡邏〉。沒設 `review` 就維持上面 1～3 的流程。

### 2. 冒名群主／管理員

詐騙者常把暱稱改成跟群主一樣，再發「請移至新 2 群」「所有成員重新➕一下」之類的假搬家公告。

- **社群**：自動記住真正管理員的名字（啟動時讀最近 100 則訊息，之後持續學習）。沒有管理員身分、名字卻相同或極相似的人，不論發什麼（文字、貼圖、圖片）都直接移除（設了 `review` 時要覆核也判 SCAM 才移除，見〈分層巡邏〉）。
- **一般群組**：LINE 群組沒有管理員標記，請在 `protectedMembers` 填名字和本人的成員 ID；沒填 ID 時，一般群組不靠名字判斷，以免踢到本人。
- 比對前會去掉空白、符號、表情與看不見的字元，並把全形轉半形，所以以群主「好鄰居社群 -Kevin」為例，「好鄰居社群－Kevin 🥰」「好鄰居社群 -Kevin 官方」「好鄰居社群-Kevim」都會被認出。只取原名一小段的名字（例如只叫「Kevin」）不算冒名。

### 3. 圖片 QR code

成員貼圖片時，守衛在本機解讀圖片裡的 QR code（免費，圖片不會送出去）：

- **LINE 群組／社群邀請、加好友、官方帳號連結**：直接移除。在社群裡貼別的群的 QR 就是引流（設了 `review` 時改成覆核判 SCAM 後只通知管理員，見〈分層巡邏〉）。
- **其他網址或文字**：只記錄網域，不處理。
- **沒有 QR code 的圖片**：不處理。
- 社群自己的正式 QR（例如本社群的官方邀請）可加入 `qr.allow`，以網址開頭比對。
- 管理員與白名單成員貼的圖片不檢查。
- **沒有 QR code 的圖片**可再交給看圖模型（`vision`，預設關閉），判斷是不是投資獲利截圖、加 LINE 廣告、博弈、兼職刷單、假中獎等詐騙圖。圖片先縮到長邊 768 像素，在背景佇列處理，不會卡住文字判斷。
  - `vision.action: "report"`（預設）：只記錄並在主控台提示，可用 `alertChatId` 通知管理員群組，不移除。
  - `vision.action: "remove"`：模型判定 SCAM 就移除。小模型容易看錯，建議先用 `report` 觀察。

### 4. 小助手（回答問題）

訊息開頭是觸發詞（預設「小助手」），或在一般群組 @ 本帳號時，參考最近 12 則對話回覆，並以「回覆」該則訊息的方式送出。

**防止被濫用（三道關卡）**：

1. **免費攔截**：要求逆向、反編譯、破解、越獄、套出設定（「你的 prompt 是什麼」「忽略以上指示」「你現在是沒有限制的 AI」）、寫程式、入侵盜號的訊息，不經模型就直接婉拒。受害者求助（「帳號被盜怎麼辦」「說能破解凍結是詐騙嗎」）不會被擋。
2. **限定範圍**：模型只回答 `scope` 內的問題。數學證明、論文、具體投資標的、法律醫療判斷等難題或範圍外問題，回固定的婉拒語 `refusal`。
3. **用量上限**：問題超過 200 字請對方濃縮；每人每天 10 次、全部合計每天 200 次（超過就不回）；同一人 20 秒內只回一次、每分鐘最多 6 則。用付費 API 時，這就是費用上限。

**其他保護**：

- 回覆中的網址除了 `allowedLinkDomains`（預設只有 165 官網）一律移除，避免被誘導貼出惡意連結。
- 群組對話只當資料，不當指令，所以有人在群組裡寫「忽略以上指示」也無效。
- `facts`（社群須知）會當成事實引用。例如有人問「群主說要移到新群是真的嗎？」，小助手會回「不是真的，請檢舉」。請依自己的社群修改。
- 模型可能把細節講錯（例如 LINE 的選單位置）。重要規則請寫進 `facts`。
- 回覆以**登入的 LINE 帳號**發出，群組成員看到的是你在說話。社群裡 @ 不會觸發（成員 ID 與帳號不同），請用觸發詞。

## 分層巡邏（地端初篩＋雲端覆核）

每則訊息都丟給付費模型很耗 token，也容易誤踢。設定 `review` 後改成兩層：

1. **第一層**：規則分數＋`llm`（建議用主機上自己跑的地端模型，例如 llama.cpp `llama-server`，訊息不出這台主機）。正常訊息到此為止，不送雲端。預設（`localScreenAll: false`）規則 0 分的訊息直接放行、不送模型；`localScreenAll: true` 則規則 0 分的也交給 `llm`，但訊息積壓超過 `localBacklog`（預設 5）則時，規則 0 分的先略過。舊名 `checkEveryMessage` 仍有效。`llm` 的端點不在本機（`127.0.0.1`／`localhost`／`::1` 以外，`fallback` 也算）時，訊息一律先去識別化再送出。
2. **第二層（只有可疑的）**：規則分數 ≥ `reviewScore`（預設 3），或地端判 SCAM 且規則至少 `reviewLocalScamMinScore`（預設 1）分，才送 `review` 覆核。送出前去識別化：網址只留網域、手機／email／帳號／LINE ID 換成代號。
3. **踢人**：規則分數 ≥ `strongScore` **且**地端判 SCAM **且**覆核也判 SCAM。覆核模型連不上就只記錄、不踢。

`review` 可以是：

| backend | 說明 |
|---|---|
| `openai` | OpenAI 相容的 Chat Completions 端點（`<baseUrl>/chat/completions`），例如 GPT、Grok |
| `responses` | OpenAI Responses 格式的端點（`<baseUrl>/responses`） |

```json
"llm":    { "backend": "openai", "baseUrl": "http://127.0.0.1:8080/v1", "model": "qwen3-vl-2b", "apiKeyEnv": "", "maxTokensField": "max_tokens" },
"review": { "backend": "responses", "baseUrl": "https://<服務網址>/v1", "model": "<模型名稱>", "apiKeyEnv": "MODEL_API_KEY", "timeoutMs": 60000 },
"reviewScore": 3
```

任何模型設定都可加 `fallback`（另一組模型設定，可再有 `fallback`）：主模型連不上、沒金鑰或答非所問時依序改用備援。金鑰只放環境變數（`apiKeyEnv` 填變數名稱），不要寫進設定檔。

有沒有設 `review`，處置會不一樣：

| | 沒設 `review`（舊流程） | 設了 `review`（分層巡邏） |
|---|---|---|
| 文字詐騙 | 模型判 SCAM 就踢；模型不確定或連不上時，規則分數 ≥ `strongScore` 才踢。`kickPolicy: "strict"`：模型判 SCAM **且**規則分數 ≥ `strongScore` 才踢 | 規則分數 ≥ `strongScore` **且**地端判 SCAM **且**覆核判 SCAM 才踢；覆核連不上只記錄 |
| 冒名群主／管理員 | 直接移除 | 覆核判 SCAM 才移除，否則只記錄 |
| 外部 LINE 邀請／加好友 QR | 直接移除 | 覆核判 SCAM 才處理：預設只通知管理員，`qr.kickOnConfirmed: true` 才移除 |

> 注意：設定了 `review` 之後，文字詐騙一定要覆核模型也判 SCAM 才會踢；覆核模型不可用時守衛只記錄。沒設 `review` 的舊設定檔照舊流程運作（啟動時會印提醒）；`review` 寫了但不是物件則拒絕啟動並說明原因。

## 自家群連結白名單 `linkAllow`

好心成員常會貼「本群」的邀請連結，若沒列白名單會被當成 LINE 邀請引流而加分。把自己社群的邀請網址列進 `linkAllow`（字串，或 `{ "url": "…" }`），貼這些連結不計分、不踢、不刪：

```json
"linkAllow": [ "https://line.me/ti/g2/<本群邀請碼>", { "url": "https://openchat.line.me/tw/cover/<本群代碼>" } ]
```

比對時會去掉 `https://`、`www.`、查詢參數與結尾斜線，以網址開頭比對。LINE 官方網站的一般頁面（不是邀請或加好友連結）也不當成可疑網址。圖片裡的 QR 另用 `qr.allow`。

## 通知管理員（依群分開）

踢人、踢人失敗或看圖確認可疑時，在**同一個**聊天室發一則提醒並 @ 群主與管理員：

```json
"notify": {
  "enabled": true,
  "chats": ["<要發通知的聊天室 ID>"],
  "admins": { "<聊天室 ID>": [ { "id": "<該群裡的成員 ID>", "name": "群主", "role": "admin" } ] },
  "mentionLearned": true,
  "cooldownSeconds": 30
}
```

- 只會發到 `notify.chats` 列出的聊天室；留空＝不發。同一聊天室有冷卻時間。試跑模式不送出，只在主控台顯示要發的內容（日誌只記字數）。
- **管理員名單要依群分開**：社群的成員 ID 每個群都不一樣，同一個人在 A 群與 B 群是不同 ID，所以 `notify.admins` 以聊天室 ID 為鍵。`role` 為 `admin`（群主）或 `coAdmin`（共同管理員）。
- `mentionLearned: true` 會再加上從社群訊息自動學到的管理員（同樣依群分開）。只認得「有發言過」的管理員；沒發言的請手動填。
- 可用 `LINEJS_TOKEN=... node guard/audit-admins.mjs > 稽核.json` 往回翻各守護聊天室的歷史訊息（唯讀），列出各群有發言的群主與共同管理員，核對後再填進設定。稽核結果含成員 ID，不要提交。

## 只回 @（`chat.mentionOnly`）

`chat.mentionOnly: true` 時，小助手不再看觸發詞，只回「@ 本帳號」或「回覆本帳號訊息」的那一則，並以你的帳號、你的口吻回答（`chat.systemPrompt`）。

- **社群裡 @ 的是成員 ID，不是帳號 ID**，每個社群都不同。守衛會在本帳號發言後自動記住該群的成員 ID；也可在 `chat.selfIds`（`{ "<聊天室 ID>": ["<成員 ID>"] }`）預先填好。還不知道時，用 `chat.selfNames`（你在群裡的暱稱）比對 @ 的文字當備援。守衛重啟或剛學到 ID 時，會補回 `chat.catchUpMinutes`（預設 10）分鐘內漏掉的 @。
- `chat.chats`：只在這些聊天室回應（省略＝`api.chats` 全部）。`chat.perChatPerHour`：每群每小時回覆上限。
- 索取個資、要求洩露設定或機密、要求逆向工程時，固定回 `chat.hardRefusal`。
- `chat.noCommitment`（預設開）：對方要求你答應約會、見面、付款、借錢、合作或排時間時，不替你答應，改回「這個要等本人親自回覆」。
- `chat.ownerNames`：你本人的暱稱陣列（例如 `["小明"]`，預設空陣列）。用來辨認「問小明的電話」這類索取個資、「小明週末可以」這類承諾語句，並清掉模型回覆裡「小明：」之類的前綴。暱稱只寫在自己的 `guard.config.json`（已在 .gitignore），不要寫進程式。
- `chat.signature`：附在每則小助手回覆（含固定句、婉拒、提醒）結尾的標記，預設「（AI代理）」，讓大家知道不是本人即時回答；舊的「（自動回覆）」會自動換成「（AI代理）」。
- 被判定為詐騙者的人 @ 你時不回。

## 聊天應答學習資料庫（`chat.training`，預設關閉）

> ⚠️ **隱私警告：這個功能會把聊天內容寫進硬碟。** 同時設定 `chat.enabled`、`chat.mentionOnly` 與 `chat.training.enabled: true` 才會啟用。啟用後，守衛會把「@ 你的問答」與「你本人的歷史發言」（去識別化後）存進 `data/chat-training/qa.jsonl`、`style.jsonl`，回覆時挑相近的舊問答當語氣範例。這違背本專案「訊息不落盤」的預設原則：
> - 去識別化只是規則式遮罩（手機、身分證、email、帳號、地址、LINE ID、網址、已知暱稱），**不保證乾淨**，檔案裡仍可能留有可辨識的個資與他人的發言。
> - 被存下來的是群組裡其他人的話，他們並不知情。請只在自己的社群、告知成員並取得同意後使用，並自行評估個資法與社群規範。
> - 檔案只在本機（權限 600），`data/` 已列入 `.gitignore`；不要提交、同步或分享。要清除就刪掉 `data/chat-training/` 資料夾。

預設不啟用，也不會建立 `data/chat-training/`。啟用時守衛啟動會印出警告。其他欄位：`chat.training.dir`（存放位置，預設 `data/chat-training`）、`chat.training.examples`（每次最多放幾則範例，預設 3）、`chat.training.examplesForLocal`（`true`＝地端模型也放範例，預設不放）。

## 自動回覆去識別化保留（`replyAudit`，預設關閉）

> 預設關閉。設 `replyAudit.enabled: true` 後，守衛每則自動回覆會寫一筆到 `guard/logs/reply-audit-日期.jsonl`：時間、群的雜湊、去識別化後的回覆全文與觸發問題。電話、email、LINE ID（含 u/p/m/c 長 ID）、身分證、信用卡／帳號數字、@暱稱、網址查詢參數都會遮掉；不存暱稱與成員 ID。超過 `maxAgeDays`（預設 7）的檔在啟動時與每日 `purgeHour`（台北，預設 3）刪掉。這些檔在 `.gitignore`、每日備份排除清單內，不要外傳。


## 群組整理指令 `/ai整理`（`aiSummary`，預設關閉）

成員在守護的群組打 `/ai整理`（全形 `／` 也可以；可加範圍：`今天`、`昨天`、`3天`、`12小時`、`2週`），守衛回覆一則（最多兩則）整理：主要話題、重要結論／資源、待回答的問題、提醒。

- 每群 `cooldownMinutes`（預設 10）分鐘最多一次，狀態存在 `data/ai-summary-state.json`（600），重啟不歸零；冷卻中只回一次「X 分鐘後可再用」，同群同時只跑一個。補掃到超過 `maxAgeMinutes`（10）分鐘的指令不理。
- 來源：伺服器歷史（往回翻頁，社群伺服器端最多約 5000 則）、記事本、本機去識別化社群摘錄（伺服器拿不到的較早部分），預算 `budgetTokens`（預設 400 萬，粗估 token）。被守衛標記或規則判疑似詐騙的訊息只留標記，不送內容；網址、ID、電話、邀請碼送出前與輸出時都拿掉。
- 模型：`llm`（預設 xAI `grok-4.20-0309-non-reasoning`，`XAI_API_KEY`）。每塊 `chunkTokens`（預設 18 萬，低於 20 萬的長上下文加價門檻）平行摘要（`concurrency`、`retries`），再合併；總時限 `timeoutMs`（8 分鐘），失敗回一句抱歉。
- 整理樣式：`profiles`（`{ "樣式名": [聊天室 id…] }`）指定哪個群用哪個樣式，其他群用 `defaultProfile`。`strategy`＝交易群（【結論】【點位】【策略邏輯蒸餾】＋免責聲明），`gist`＝只整理重點，`full`＝舊格式。
- 附加整理：`followups`（例如 `{ "strategy": "chat" }`）讓該樣式的群在主整理後再發一份【聊天重點】（只整理閒聊與非交易話題，不重複點位與策略）。兩份用同一份紀錄平行產生、各自最多兩則；主整理至少送出一則才開始冷卻，附加整理沒產生或沒送完記為 `partial`，主整理沒送出就不送附加整理。
- 格式檢查：合併時在結尾再提醒一次格式；輸出缺必要段落（例如 strategy 的【結論】【點位】【策略邏輯蒸餾】、chat 的【聊天重點】）或出現 Markdown 標題／表格，就要求重寫一次；仍不符照送，日誌記 `formatOk: false`。Markdown 標題與粗體記號送出前一律拿掉。
- 日誌只記則數、token、費用估算（`price`）、耗時，不記內容。
- 本機試跑（不發到 LINE）：在 `guard/logs/ai-summary-dryrun.json` 寫 `{"chatId":"…","arg":"3天"}`（可加 `"only":["chat"]` 只產生某一份、`"until":毫秒時間` 只取該時間以前），對守衛程序送 `SIGUSR2`，結果寫到 `guard/logs/ai-summary/`。

## 依群設定 `groupPolicies`（選用）

`groupPolicies` 的鍵是聊天室 id：
- `"warnOnly": true`：只警告。這個群所有情況（一般詐騙、冒名、冒名＋邀請、再犯、購物詐騙、詐騙連結、詢問者遮蔽、補刪）都不踢、不刪，改成發警告通知（「疑似詐騙，請管理員確認」；要不要 @管理員照原規則），日誌記 `kick-suppressed`（`reason: "warn-only"`）。踢人與刪訊息的請求在連線層也會擋下（`warn-only-blocked`）。啟動日誌另列「只警告的聊天室」。自動回覆在這種群被問到踢人時，給模型的守衛現況改成「本群只警告、其他群維持原規則」，回覆說成會踢／會刪也會被換成這句。
- `"learnOnly": true`：只學習。這個群的訊息（即時與歷史）和記事本照社群參考資料的規則去識別化收進本機（`chat.community`），其他功能全關：不判詐騙、不通知、不刪不踢、不看圖、不回 @（含補回）、不跑 `/ai整理`。送往這個群的發送、刪除、收回、表情、踢人、抓圖、已讀請求在連線層一律擋下（日誌記 `learn-only-blocked`），只允許讀歷史與記事本。啟動日誌另列「只學習的聊天室」。
- `"mention": false`：這個群的通知一律不 @ 群主／管理員（只引用那則訊息）。沒設時：本帳號在該群是群主／共同管理員（能踢人）就不 @，不是管理員才 @。
- `"redPacket": true`：官方紅包連結與紅包 QR（派網 pionex.com 紅包頁、幣安 s.binance.com／app.binance.com/uni-qr／官網紅包頁、OKX、Bybit 紅包頁、LINE Pay pay.line.me）不當詐騙：不通知、不刪、不踢。只認官方網域本身或子網域＋紅包路徑；夾帶加賴／私訊／先付費等字眼、短網址或其他連結就照一般流程。`redPacketHosts` 可加網域。
- `"noteLinks": true`：群主／管理員／受保護成員在這個群記事本貼的連結，自動加進這個群自己的白名單（`logs/note-links.json`，600）；同一個連結（主機＋路徑完全一樣，短網址代碼分大小寫）再出現就不當詐騙，夾帶引流字眼或混了其他連結照常判斷。`"linkAllow": [...]` 可手動加。
  - YouTube 的 `v`、Drive 的 `id` 參數會留在比對鍵裡（只放行同一支影片／同一個檔案）。
  - 作者認不出時，可用唯讀匯出人工審核：在 `logs/` 放 `note-links-export.json`（`{"chatId": "..."}`）並送 `SIGUSR2`，守衛把最近記事本裡的連結、規則分數與仿冒網域判斷寫到 `logs/note-links-export-*.json`（600），審過再加進 `linkAllow`。
- Grok CLI 備援的工作階段（`~/.grok/sessions/%2Ftmp%2Fgrok-guard`）：守衛啟動後與每 7 天清掉超過 7 天的；其他目錄的工作階段不動。
- 另有規則「假紅包」（紅包＋引流／付費）與「仿冒交易所網域」（pi0nex、binance-gift.xyz、bybit.com.evil.io 這類）。派網官方網域含 `pionex.com`、`pionexapp.com`（本身與子網域；尾端比對，`pionexapp.com.evil.xyz`／`pionex-app.com` 仍算仿冒）。

覆核鏈可以接任意層 `fallback`，例如 Meta 之後接 xAI Grok（`"baseUrl": "https://api.x.ai/v1"`, `"apiKeyEnv": "XAI_API_KEY"`）；哪一層回答就記在日誌的 `reviewModel`，判定效力相同；沒金鑰的層直接跳過、不送請求。

## 先試跑再開踢人

新設定一律先 `dryRun: true` 跑幾天：只記錄「會踢誰」，並在主控台顯示「會發的通知」與「會回的內容」，不真的踢、不發通知、不回覆。看 `guard/logs/guard-日期.jsonl`（誰被判定、為什麼）確認沒有誤判（特別是管理員、貼本群連結的人、問「這是詐騙嗎」的人）後再改成 `false`。看圖模型（尤其 2B 這類小模型）容易誤判，建議維持 `vision.action: "report"`。

## 自動運行

```sh
npm run guard:forever   # 看門狗：守衛當掉或結束時自動重啟（5 秒起，最長 5 分鐘）
npm run guard:all       # 同上，並一起看顧 LINE.js 服務
```

守衛和 LINE.js 斷線時會自己重連。LINE 登入失效（例如在手機上把這個裝置登出）時，必須有人重新掃 QR，守衛會在畫面上提示。

## 模型選擇

`llm`（反詐判斷）與 `chat.llm`（小助手，省略則沿用 `llm`）各自可選：

| backend | 說明 |
|---|---|
| `local` | 本機 AI 派工器，免費，只在這台電腦能用 |
| `openai` | OpenAI 相容 API：GPT（`https://api.openai.com/v1`）或 Grok（`https://api.x.ai/v1`），依用量計費、訊息會送到該服務（`llm` 端點不在本機時，送出前一律先去識別化）；也可以是主機上自己跑的免費模型（llama.cpp 的 `llama-server`，`apiKeyEnv` 設空字串、`maxTokensField` 設 `max_tokens`），範本見 `guard.config.cloud-free.example.json` |

例如反詐判斷用本機、聊天用 GPT：

```json
"llm": { "backend": "local", "capability": "text_fast" },
"chat": { "enabled": true, "llm": { "backend": "openai", "baseUrl": "https://api.openai.com/v1", "model": "<模型名稱>", "apiKeyEnv": "OPENAI_API_KEY" } }
```

部署到雲端請看 [DEPLOY.md](DEPLOY.md)。

## 第一次設定（本機）

0. 確認 Node.js ≥ 22：`node -v`。
1. 安裝守衛的套件：`npm install --prefix guard`。
2. 啟動服務並登入：`.\linejs.ps1 start`，開 <http://127.0.0.1:3789>，用手機 LINE 掃 QR 並輸入 PIN。
3. 取得聊天室 ID：在左側聊天清單對要守護的群組／社群按右鍵 →「顯示頻道 ID」→ 複製。
4. 編輯專案根目錄的 `config.yaml`：
   ```yaml
   api:
     enabled: true
     chats:
       - c0123...   # 群組 ID
       - m0123...   # 社群 ID
     moderation: true
   ```
   然後重啟：`.\linejs.ps1 restart`。
5. 產生機器人 Token：`.\linejs.ps1 token`，把顯示的 Token 存成 `guard\token.txt`（只會顯示一次）。
6. 確認本機 AI 派工器在跑（`http://127.0.0.1:11440/health`）。沒開的話，守衛只靠規則分數判斷，小助手不回覆。
7. 啟動：`npm run guard:forever`。

## 設定檔 `guard/guard.config.json`

| 欄位 | 說明 |
|---|---|
| `dryRun` | `true`＝試跑：只記錄「會踢誰」、不真的踢。確認誤判少了再改成 `false` |
| `deleteMessage` | 社群裡同時刪除該則詐騙訊息（一般群組 LINE 不允許刪別人的訊息） |
| `strongScore` | 規則分數門檻，預設 6（越高越保守）。沒設 `review`：模型不確定或不可用時，分數達此值才踢。設了 `review`：分數達此值，且地端、覆核都判 SCAM 才踢 |
| `whitelist` | 永不處理的成員 ID（在網頁訊息上按右鍵 →「顯示寄件者 ID」取得） |
| `protectedMembers` | 常被冒名的人：`[{ "name": "群主暱稱", "ids": ["本人成員 ID"] }]`。社群可不填 ID（靠管理員身分辨別） |
| `localScreenAll` | `true`＝規則 0 分的訊息也交給 `llm` 判斷（較慢、抓得較廣）；預設 `false`＝規則 0 分直接放行。舊名 `checkEveryMessage` 仍有效，兩個都寫時以 `localScreenAll` 為準。訊息積壓超過 `localBacklog`（預設 5）則時，規則 0 分的一律先略過 |
| `llm` | 反詐判斷用的模型（見「模型選擇」）；本機時 `capability` 可選 `text_fast`（CPU、約 5 秒）或 `text_review`（27B GPU，較準但會和產圖、影片排隊） |
| `review` / `reviewScore` | 覆核模型設定（省略＝不覆核，沿用舊流程）／規則分數 ≥ `reviewScore`（預設 3）的訊息才送覆核，見〈分層巡邏〉 |
| `qr.enabled` / `qr.allow` | 圖片 QR 檢查開關／允許的 QR 內容（網址開頭） |
| `vision.enabled` / `vision.action` | 看圖模型開關／`report`（只通知）或 `remove`（判定詐騙就移除） |
| `vision.llm` | 看圖用的模型，必須看得懂圖片（省略則沿用 `llm`） |
| `vision.alertChatId` | 疑似詐騙圖片要通知的聊天室 ID（須列在 `config.yaml` 的 `api.chats`；留空不通知） |
| `vision.maxQueue` / `vision.maxSide` | 背景佇列上限／送給模型的圖片長邊像素 |
| `chat.enabled` | 小助手開關 |
| `chat.triggers` / `chat.onMention` | 觸發詞清單／@ 本帳號是否觸發 |
| `chat.scope` | 小助手可以回答的範圍 |
| `chat.facts` | 社群須知，小助手當成事實引用 |
| `chat.refusal` | 範圍外或被攔截時的固定回覆 |
| `chat.systemPrompt` | 自訂小助手的角色與口吻（範圍、須知與防濫用規則仍會附加） |
| `chat.maxQuestionChars` | 問題字數上限 |
| `chat.dailyPerUser` / `chat.dailyTotal` | 每人每天／全部每天最多回覆幾次 |
| `chat.userCooldownSeconds` / `chat.repliesPerMinute` | 防洗版上限 |
| `chat.allowedLinkDomains` | 回覆中允許保留的網址網域 |
| `chat.training.enabled` | 預設 `false`。`true` 才會把去識別化後的問答與本人發言寫進 `data/chat-training/`（⚠️ 隱私警告見〈聊天應答學習資料庫〉） |
| `replyAudit.enabled` | 預設 `false`。`true` 才把去識別化自動回覆寫進 `guard/logs/reply-audit-日期.jsonl`（見〈自動回覆去識別化保留〉） |

## 紀錄

每個判斷都寫進 `guard/logs/guard-日期.jsonl`，內容含發言者（成員 ID、暱稱）、規則命中項、模型判定、**決策**（`decision`：`none`／`notice`／`delete`／`kick`，判斷結果）與**實際動作**（`action`：`none`＝尚未／未執行；`notified`／`removed`／`scam-link-deleted`／`dry-run`／`failed`／`replied`／`refused`／`quota-exceeded`…＝真的做了）。每日稽核與健康檢查的刪／踢／群內通知計數以實際動作為準，不以 `decision` 或舊日誌誤寫進 `action` 的 `notice`／`delete` 為準。**日誌不記訊息文字**（沒有 `text`、`preview` 之類欄位，被踢的詐騙訊息也一樣；圖片裡的 QR 內容同樣只留雜湊，一般網址型 QR 另記網域 `qrHost`）：訊息只留 `textHash`（內容的 SHA-256 前 12 碼，用來比對是不是同一則）與 `textChars`（字數）；@ 問題同理，欄位是 `askHash`／`askChars`。雜湊無法還原內容，但很短、很常見的句子仍可能被猜中，所以日誌照樣只留本機。誤踢時用這份紀錄找人（成員 ID、時間、聊天室與訊息 ID），再請對方重新加入。

試跑模式（`dryRun: true`）才會在主控台顯示要回的內容與要發的通知，供檢視，不寫進日誌檔。使用 pm2 時主控台輸出由 pm2 另外保存，試跑完可用 `pm2 flush` 清掉。

## 權限

- 一般群組：LINE 的群組成員都能移除他人。
- 社群：登入的帳號必須是管理員或共同管理員，否則會回「無法移除這位成員」。

## 授權與免責

Copyright 2026 TW_MARS（阿軒割割）。本資料夾採 Apache-2.0，屬於 [LINE.js](https://github.com/JS-PACKAGE/LINE.js) 的修改版。使用非官方 LINE API，與 LINE 公司無關；可能違反 LINE 服務條款並導致帳號被限制，自動移除可能誤判，使用者自負風險。

## 處置門檻與斷線補掃（2026-10 調整）

- **通知**：Meta 覆核判 SCAM 且規則 ≥ `notifyScore`（預設 3）；或地端與 Meta 都判 SCAM、且訊息含網址／短網址／LINE 邀請（即使規則只有 1 分）。通知以引用回覆該訊息發出。
- **踢人**不變：規則 ≥ `strongScore`（6）＋地端 SCAM＋Meta SCAM（`kickPolicy: "strict"`）。
- 規則 0 分、40 字以內、沒有網址／LINE／金錢字眼的閒聊不送地端模型（`localSkipNoSignal: false` 可關掉）。
- 看圖判 SCAM 但理由沒有具體的引流或要錢訊號（QR、LINE ID、加好友、匯款、帶單…）時，只記成 `VISION_SCAM_WEAK`。
- 冒名比對以「社群」為單位：只比對同一社群學到的管理員，發言者本身是該社群管理員就不算冒名。
- 斷線補掃 `catchUp`：`scanMinutes`（預設 360，補「上次看到的最新訊息之後」到現在，這是上限）、`retryDelaysSeconds`（預設 `[15, 30, 60]`）、`maxPages`（預設 5 頁 × 100 則）。一次只抓一個聊天室。守衛偵測到主機暫停醒來（時鐘跳 > 40 秒）時，75 秒後自動補掃一次。
- **`scamLink.deleteOnConfirmed`**（預設 `false`）：打開後，在本帳號是管理員的群（不在 `questionRedact.noDeleteChats`、且在 `notify.chats`），地端＋Meta 都判 SCAM 且含外部連結（白名單連結不算；管理員、白名單成員不處理）→ 先引用回覆發「將刪除這則訊息」通知，等 `notify.beforeActionMs`（預設 2 秒）再刪除，不踢人。刪不掉就補發「請發文者自行收回，或請管理員處理」。刪不了的群只通知；Meta 不可用時只記錄（`scam-link-meta-unavailable`）。
- **受保護成員 `protectedIds`**：`[{ "note": "…", "ids": ["<成員 ID>", …] }]`，依成員 ID、所有群適用，永遠不踢、不刪、不提醒、不判冒名（`whitelist` 與 `protectedMembers` 裡登記的 ID 也一樣）。社群成員 ID 每個社群不同，離開再加入會換新 ID，要一併登記。
- **冒名預設只通知**：暱稱相似＋Meta 判 SCAM 只發通知請管理員確認；`impersonation.kick: true` 才會踢。
- **`kickMode: "notify"`**：所有踢人改成只通知（不踢、不刪），出事時的暫時安全模式；預設 `"kick"`。
- **冒名＋邀請／QR**：暱稱冒用同一社群的管理員（名字只跟同社群比對，別的社群有同名管理員不算；依 ID 排除受保護成員、任何群的管理員、本帳號、白名單），而且同一則或同一人前後 2 分鐘內貼外部連結（LINE 群組／社群邀請、引流網址）或外部 QR → 先引用回覆通知，再刪這段時間他的訊息；`impersonation.kickWithInvite: true` 才踢（不受 `kickMode` 影響）。刪不了的群只通知。只有冒名沒有連結：照舊只通知。
- **假冒管理員（暱稱＋頭像）**（`fakeAdmin.enabled`，預設關閉）：一般成員暱稱自稱管理員／官方／客服／小幫手（含「管 理 員」拆字、全形、假字母）、暱稱是空白或夾看不見的字元（零寬字元、Hangul 填充字、點字空白、私用區、疊組合符號）、假徽章符號（皇冠、勾勾、【官方】），或頭像放假的管理員皇冠／官方徽章（`fakeAdmin.avatar`：從 LINE 公開 CDN 唯讀抓頭像，只問地端看圖模型，依頭像 ID 雜湊快取 30 天，檔案 600）。排除：有管理員身分的人、任何受守護群的管理員、受保護成員、本帳號。只有名字／頭像 → 只記錄；兩種以上訊號，或內容有換群／要錢／私聊／LINE ID → 引用回覆通知管理員（不刪不踢，每人冷卻 `cooldownHours`，冷卻期間一般「只通知」結果也不重發）；再加外部引流連結（一般技術網站不算）或外部 QR → 走「冒名＋邀請」（`impersonation.kickWithInvite` 才踢，踢前仍擋管理員與受保護成員）。頭像單獨判定不夠當踢人依據。
- **一頁式詐騙購物站 `scamShop`**（預設全關）：`enabled` 開啟偵測（名牌低價、貨到付款、可疑網域；正規電商與白名單連結不算），`fetchPage` 另外安全抓頁面（不執行 JS、5 秒逾時、限 300 KB、拒絕內網與轉址到內網）。確定 → 第一次引用回覆警告＋刪除；30 天內再犯 → `kickRepeat: true` 才踢（不受 `kickMode` 影響），否則刪除＋警告。不確定只通知。違規紀錄 `logs/scam-shop-offenders.json`（600，只存成員 ID 與時間，30 天過期）。
