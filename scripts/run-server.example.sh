#!/bin/sh
# 反詐小幫手：LINE.js 服務啟動腳本範本（給 pm2 用；不含任何秘密）。
# 用法：cp scripts/run-server.example.sh run-server.sh && chmod +x run-server.sh
# 可設定：
#   ANTI_SCAM_ENV_FILE  秘密變數檔（預設 $HOME/.config/anti-scam-helper/env，權限 600）
#   NODE_BIN            Node.js 22 以上的執行檔（預設 PATH 裡的 node；系統 node 太舊時指到 Node 22）
ENV_FILE="${ANTI_SCAM_ENV_FILE:-$HOME/.config/anti-scam-helper/env}"
NODE_BIN="${NODE_BIN:-node}"
set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a
# 代理留空時當作沒設，改為直連
[ -z "$LINEJS_PROXY" ] && unset LINEJS_PROXY
cd "$(dirname "$0")" && exec "$NODE_BIN" dist/main.js
