#!/bin/sh
# 反詐小幫手：反詐守衛＋@回覆啟動腳本範本（給 pm2 用；不含任何秘密）。
# 用法：cp scripts/run-guard.example.sh run-guard.sh && chmod +x run-guard.sh
# 可設定：
#   ANTI_SCAM_ENV_FILE  秘密變數檔（預設 $HOME/.config/anti-scam-helper/env，權限 600）
#   NODE_BIN            Node.js 22 以上的執行檔（預設 PATH 裡的 node）
#   GUARD_CONFIG        守衛設定檔（預設 guard/guard.config.json）
ENV_FILE="${ANTI_SCAM_ENV_FILE:-$HOME/.config/anti-scam-helper/env}"
NODE_BIN="${NODE_BIN:-node}"
set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a
# Token 留空時改讀設定檔的 tokenFile
[ -z "$LINEJS_TOKEN" ] && unset LINEJS_TOKEN
cd "$(dirname "$0")" && exec "$NODE_BIN" guard/guard.mjs
