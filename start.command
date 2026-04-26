#!/bin/bash
# ============================================
# 植物资料库 - Mac 一键启动
# 双击此文件即可启动应用
# ============================================

cd "$(dirname "$0")"

PORT=8080

# 检查端口是否被占用，自动换一个
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo ""
echo "  🌿 植物资料库"
echo "  ─────────────────────"
echo "  地址: http://localhost:$PORT"
echo "  按 Ctrl+C 停止服务器"
echo ""

# 自动打开浏览器
open "http://localhost:$PORT" &

# 启动 API 服务器
python3 tools/server.py $PORT
