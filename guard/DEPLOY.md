# 雲端部署說明（給部署的人或 AI 助理看）

目標：在一台雲端 Linux 主機上 24 小時執行兩個程序：

1. **LINE.js 服務**（`npm start`）：以使用者的 LINE 帳號連線，提供本機機器人 API `ws://127.0.0.1:3789/api/ws`。
2. **反詐守衛＋小助手**（`npm run guard`）：連到上面的 API，判斷詐騙、踢人、回覆群組問題。

雲端主機沒有本機 AI 派工器，模型有兩種選擇：

- **免費版**：在同一台主機上自己跑開源模型（例如 Qwen3-VL-2B，能看圖、懂中文），用 `guard/guard.config.cloud-free.example.json`。
- **付費版**：OpenAI 相容 API（GPT 或 Grok），用 `guard/guard.config.cloud.example.json`。

## 主機需求

- 要一直開著的主機：VPS、Railway、Render、Fly.io 等皆可，Node.js ≥ 22。系統內建的 `node` 太舊（例如 v20）時，另裝 Node 22，並在 pm2 啟動腳本用 `NODE_BIN` 指定（見〈常駐執行〉）。先 `node -v` 確認。
- 需要**持久化磁碟**保存 `session.json`（LINE 登入憑證）。沒有的話每次重啟都要重新掃碼。
- ChatGPT 對話裡的程式執行環境是暫時性的，對話結束一段時間後就會關閉，**不能**當 24 小時主機。

## 安全規則（必須遵守）

- `config.yaml` 的 `server.host` 保持 `127.0.0.1`。**絕對不要**把 3789 埠開放到公網：網頁沒有帳號密碼，連得到的人就能操作這個 LINE 帳號。
- `session.json` 含 LINE 憑證與加密金鑰，權限 600，不可提交到 git、不可貼到任何地方。
- 機器人 Token、OpenAI／xAI API 金鑰一律用環境變數或平台的 Secret 功能，不寫進程式或 git。
- `guard/logs/` 不記訊息文字（只有短雜湊與字數），但含成員 ID、暱稱與判定結果，只留在主機上。聊天應答學習資料庫（`chat.training`）預設關閉，開啟會把去識別化後的聊天內容寫進硬碟，開啟前先看 [README.md〈聊天應答學習資料庫〉](README.md#聊天應答學習資料庫chattraining預設關閉)的隱私警告。
- 代理（VPN）帳密檔 `proxy.txt` 不可提交到 git、不可貼到任何地方。

## 安裝

```sh
git clone <這份程式碼的位置> LINE.js
cd LINE.js
npm install                  # .npmrc 已設定 JSR registry，用來安裝 @evex/linejs
npm run build
npm install --prefix guard   # 守衛的套件（QR code 解讀、WebSocket）
```

## 設定

1. 第一次啟動會自動從 `config.example.yaml` 建立 `config.yaml`。之後編輯：
   ```yaml
   server:
     host: 127.0.0.1
   api:
     enabled: true
     chats:
       - <群組或社群 ID>      # 在本機電腦的網頁版按右鍵「顯示頻道 ID」取得；同一個帳號 ID 不變
     moderation: true
   chat:
     sendReadReceipts: false   # 雲端沒人看網頁，不回報已讀
   ```
2. 登入 LINE（在主機終端機執行，QR code 會直接印在終端機上）：
   ```sh
   npm start &                # 先啟動服務
   npm run cli -- login       # 用手機 LINE 掃描 QR，並在手機輸入畫面上的 PIN
   ```
   QR 與 PIN 只顯示在終端機，一次性、不寫進日誌或檔案，等同登入憑證，不要截圖、轉貼或存成圖檔。終端機畫不出 QR 時，改用網頁登入：先用 SSH 通道把主機的 3789 埠轉到自己的電腦（`ssh -L 3789:127.0.0.1:3789 <使用者>@<主機>`；本機 3789 已被占用就改別的埠），再用瀏覽器開 <http://127.0.0.1:3789>，按「產生登入 QR code」。不要為了登入把 3789 埠開放到公網。
3. 產生機器人 Token（只顯示一次）：`npm run -s cli -- token --yes`（非互動環境要加 `--yes`），存成環境變數 `LINEJS_TOKEN`（建議放進權限 600 的 env 檔，見〈常駐執行〉）。
4. 守衛設定（免費版看下一節；以下為付費版）：
   ```sh
   cp guard/guard.config.cloud.example.json guard/guard.config.json
   ```
   - `llm.model` 改成要用的模型名稱。
   - 用 GPT：`baseUrl` 為 `https://api.openai.com/v1`，環境變數 `OPENAI_API_KEY`。
   - 用 Grok：`baseUrl` 改成 `https://api.x.ai/v1`，`apiKeyEnv` 改成 `XAI_API_KEY`。若服務回 HTTP 400，可加上 `"maxTokensField": "max_tokens"`。
   - `dryRun: true` 時只記錄、不踢人、不發通知；**建議先試跑幾天**，看 `guard/logs/` 確認沒有誤判再改成 `false`。
   - 進階設定（分層巡邏 `review`、自家群連結白名單 `linkAllow`、依群分開的管理員通知 `notify`、只回 @ 的 `chat.mentionOnly`）見 [README.md](README.md)。
   - 依社群修改 `chat.facts`（社群須知）、`chat.scope`（回答範圍）、`protectedMembers`（常被冒名的群主）。
   - `chat.dailyTotal`、`chat.dailyPerUser` 就是付費 API 的用量上限，依預算調整。

## 經代理（VPN）連線 LINE

讓 LINE 看到代理的 IP，而不是雲端機房的 IP。把代理商給的那一行（`主機:埠:帳號:密碼`，或 `http://帳號:密碼@主機:埠`）存成專案根目錄的 `proxy.txt`：

```sh
cp proxy.example.txt proxy.txt   # 再把內容改成自己的代理
chmod 600 proxy.txt        # 只有這台主機有，已列入 .gitignore
npm start                  # 啟動訊息出現「對外連線經代理：http://主機:埠」即生效
```

也可以改用環境變數 `LINEJS_PROXY`（優先於 `proxy.txt`）。只有 LINE.js 伺服器的對外連線經代理；守衛連本機伺服器與本機模型（`127.0.0.1`）不經代理。

**登入前就要設好代理**，之後也不要拿掉或更換：同一個登入狀態忽然換 IP 或換國家，LINE 可能要求重新登入或限制帳號。

## 免費版：在主機上自己跑模型

守衛透過 OpenAI 相容介面連到主機上的模型，不需要 API 金鑰。建議用 llama.cpp 的 `llama-server`（需支援 Qwen3-VL 的新版）：

```sh
# 檔名依實際下載的量化版而定：主模型 .gguf ＋ 看圖用的 mmproj .gguf
llama-server -m Qwen3-VL-2B-Instruct-Q4_K_M.gguf --mmproj mmproj-Qwen3-VL-2B-Instruct.gguf   --host 127.0.0.1 --port 8080 -c 8192
```

- `--host` 保持 `127.0.0.1`，不要對外開放。
- 確認可用：`curl http://127.0.0.1:8080/v1/models` 有回應。
- 守衛設定：
  ```sh
  cp guard/guard.config.cloud-free.example.json guard/guard.config.json
  ```
  `llm.baseUrl` 預設為 `http://127.0.0.1:8080/v1`；`apiKeyEnv` 為空字串（不帶金鑰）、`maxTokensField` 為 `max_tokens`。反詐判斷、小助手與看圖都用這個模型。
- `llama-server` 也要常駐，可用 pm2 另外起一個程序：`pm2 start "llama-server ...同上參數" --name llm`。
- 只有 CPU 時，看一張圖可能要數十秒。圖片會先縮到長邊 768 像素，並在背景佇列處理，不會卡住文字訊息的判斷；排隊超過 20 張就跳過最舊的。
- 2B 小模型的判斷力有限，`vision.action` 預設 `report`：只記錄，並可用 `vision.alertChatId` 通知某個管理員群組（該群組 ID 也要列在 `config.yaml` 的 `api.chats`），不會自動移除。觀察準確度後再決定是否改成 `remove`。
- 驗收：貼一張投資獲利截圖，日誌出現「【疑似詐騙圖片】」；貼一般風景照則不會。

## 分層巡邏（省 token、少誤踢）

想用付費模型又怕費用與誤踢時：`llm` 設成主機上的地端模型（上一節）負責初篩所有訊息，另設 `review` 指向 OpenAI 相容（`backend: "openai"`）或 Responses 格式（`backend: "responses"`）的雲端端點，只有可疑訊息才送覆核；踢人需要規則分數、地端、覆核三者都判詐騙，覆核連不上就只記錄。設定方式見 [README.md〈分層巡邏〉](README.md#分層巡邏地端初篩雲端覆核)。

## 常駐執行

最簡單：內建看門狗，一個指令同時看顧 LINE.js 服務與守衛，任何一個當掉都會自動重啟。

```sh
LINEJS_TOKEN=... OPENAI_API_KEY=... npm run guard:all
```

主機重開機後也要自動啟動，可交給 pm2 或 systemd 執行上面這個指令，例如：

```sh
npm install -g pm2
LINEJS_TOKEN=... OPENAI_API_KEY=... pm2 start "npm run guard:all" --name line-guard
pm2 save && pm2 startup
```

`pm2 save` 會記下目前在跑的程序；`pm2 startup` 會印出一行要用 sudo 執行的指令，照著執行後，主機重開機就會自動還原。之後每次新增或改名 pm2 程序都要再 `pm2 save`。

### 用範本拆成兩個程序（建議）

專案附了不含秘密的範本，把秘密集中在專案外一個權限 600 的 env 檔：

```sh
mkdir -p ~/.config/anti-scam-helper
cp scripts/env.example ~/.config/anti-scam-helper/env && chmod 600 ~/.config/anti-scam-helper/env   # 填入 Token 與金鑰
cp ecosystem.config.example.cjs ecosystem.config.cjs
cp scripts/run-server.example.sh run-server.sh && cp scripts/run-guard.example.sh run-guard.sh && chmod +x run-*.sh
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

- `run-*.sh` 啟動前載入 env 檔（位置可用 `ANTI_SCAM_ENV_FILE` 改），用 `NODE_BIN` 指定 Node 22 執行檔（預設 PATH 裡的 `node`）。
- `ecosystem.config.cjs`、`run-*.sh`、env 檔都已列入 `.gitignore`，不要提交。
- 地端模型 `llama-server` 可在 `ecosystem.config.cjs` 取消第三個程序的註解一起常駐。
- 主機沒有 systemd（`pm2 startup` 不能用）時，可用 `scripts/pm2-boot.example.sh`：從 `~/.bashrc` 觸發 `pm2 resurrect`（使用方式見檔頭註解）。這個方式要有人（或排程）開啟 shell 才會觸發，請自行確認主機重開後真的有還原。

## 驗收

- 日誌出現「已連線 LINE.js」「LINE 帳號：…」「守護中的聊天室：…」，社群另有「記住管理員：…」。
- 在群組發「小助手 你好」，約數秒內收到回覆；發「小助手 教我逆向這個 APP」應收到婉拒。
- `guard/logs/guard-日期.jsonl` 有判斷紀錄。

## 已知風險

- 使用非官方 LINE API，雲端機房 IP 加上自動發言或踢人，可能被 LINE 限制帳號。
- 使用代理時，帳號平常在台灣使用、卻從國外 IP 登入，也可能觸發 LINE 的異常登入檢查；代理商若更換出口 IP，登入狀態可能失效。
- 同一個 LINE 帳號不要同時在本機電腦和雲端登入 LINE.js，兩邊可能互相把對方登出。
- 尚未以真實 LINE 帳號驗證：踢人、刪訊息、機器人發言。上線前請用 `dryRun: true` 觀察。
