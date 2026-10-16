#!/bin/sh
# 反詐小幫手：沒有 systemd／cron 的主機用的開機自啟範本（有 systemd 請改用 `pm2 startup`）。
# 用法：
#   mkdir -p ~/.local/bin && cp scripts/pm2-boot.example.sh ~/.local/bin/anti-scam-helper-boot && chmod +x ~/.local/bin/anti-scam-helper-boot
#   在 ~/.bashrc 最前面加一行：
#   [ -x "$HOME/.local/bin/anti-scam-helper-boot" ] && ( "$HOME/.local/bin/anti-scam-helper-boot" >/dev/null 2>&1 & )
# 主機開機後第一個 shell 啟動時執行 `pm2 resurrect`（還原 `pm2 save` 存下的程序）；pm2 已在跑就什麼都不做。
# NODE_DIR：Node 22 的 bin 目錄（選用，系統 node 太舊時設定）。
[ -n "$NODE_DIR" ] && PATH="$NODE_DIR:$PATH"
pgrep -u "$(id -u)" -f 'PM2 v.*God Daemon' >/dev/null 2>&1 && exit 0
exec >>"$HOME/.pm2-boot.log" 2>&1
echo "[$(date)] pm2 resurrect"
pm2 resurrect
