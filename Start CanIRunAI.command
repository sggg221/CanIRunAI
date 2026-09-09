#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print '请先从 https://nodejs.org 安装 Node.js 24，再重新打开 CanIRunAI。'
  read '?按回车关闭。'
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -d apps/web/node_modules ]]; then npm --prefix apps/web ci; fi
print '正在准备 CanIRunAI 0.2，首次启动需要联网安装依赖。'
npm run build
npm start
