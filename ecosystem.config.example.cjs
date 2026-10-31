// 反詐小幫手：pm2 設定範本（不含任何秘密）。
// 用法：
//   cp ecosystem.config.example.cjs ecosystem.config.cjs
//   cp scripts/run-server.example.sh run-server.sh && cp scripts/run-guard.example.sh run-guard.sh && chmod +x run-*.sh
//   pm2 start ecosystem.config.cjs && pm2 save
// 秘密（LINEJS_TOKEN、模型金鑰、代理）放在 env 檔（範本 scripts/env.example，權限 600），由 run-*.sh 載入，不寫進這裡。
// ecosystem.config.cjs、run-server.sh、run-guard.sh 已列入 .gitignore。
module.exports = { apps: [
  // ① LINE.js 服務（機器人 API：ws://127.0.0.1:3789/api/ws）
  { name: "anti-scam-helper", script: "./run-server.sh", interpreter: "none", cwd: __dirname,
    kill_timeout: 20000, restart_delay: 5000, exp_backoff_restart_delay: 5000, max_restarts: 50 },
  // ② 反詐守衛＋@回覆
  { name: "anti-scam-helper-guard", script: "./run-guard.sh", interpreter: "none", cwd: __dirname,
    restart_delay: 5000, exp_backoff_restart_delay: 5000, max_restarts: 50, autorestart: true },
  // ③（選用）地端模型 llama-server，只綁 127.0.0.1。路徑與參數依實際下載的模型修改後取消註解。
  // { name: "local-vlm", script: "/path/to/llama-server", interpreter: "none",
  //   args: "-m /path/to/model.gguf --mmproj /path/to/mmproj.gguf --host 127.0.0.1 --port 8080 -c 8192",
  //   restart_delay: 5000, max_restarts: 50 },
]};
