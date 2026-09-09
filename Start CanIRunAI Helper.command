#!/bin/zsh
set -e
cd "$(dirname "$0")"
trap 'print "助手遇到错误，请查看上方提示或 docs/HELPER.md。"; read "?按回车关闭。"' ZERR
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  print '本启动器仅支持 Apple Silicon Mac。请使用原生 arm64 终端，而不是 Rosetta 模式。'
  read '?按回车关闭。'
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print '请先从 https://nodejs.org 安装 Node.js 24（最低 22.13），再重新打开助手。'
  read '?按回车关闭。'
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)'; then
  print 'Node.js 版本过旧，请安装 Node.js 24（最低 22.13）。'
  read '?按回车关闭。'
  exit 1
fi
if [[ "$(node -p 'process.arch')" != "arm64" ]]; then
  print '当前 Node.js 不是 arm64 版本，请安装适用于 Apple Silicon 的 Node.js。'
  read '?按回车关闭。'
  exit 1
fi
if ! node --import tsx --input-type=module -e 'await import("zod")' >/dev/null 2>&1; then
  print '首次启动需要联网安装锁定版本的依赖；此步骤不会安装 Ollama 或模型。'
  npm ci --include=dev --no-audit --no-fund
fi
npm run helper
