#!/bin/bash

# 颜色定义
FRONTEND_COLOR="\033[36m"  # 青色
BACKEND_COLOR="\033[33m"   # 黄色
ERROR_COLOR="\033[31m"     # 红色
SUCCESS_COLOR="\033[32m"   # 绿色
RESET_COLOR="\033[0m"

# 日志目录
LOG_DIR="./logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

# 检查目录
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo -e "${ERROR_COLOR}错误: 请在项目根目录运行此脚本${RESET_COLOR}"
    exit 1
fi

# 创建日志目录
mkdir -p "$LOG_DIR"

# 清理日志文件（保存旧日志为备份）
if [ -f "$BACKEND_LOG" ]; then
    mv "$BACKEND_LOG" "$BACKEND_LOG.$(date +%Y%m%d_%H%M%S)"
fi
if [ -f "$FRONTEND_LOG" ]; then
    mv "$FRONTEND_LOG" "$FRONTEND_LOG.$(date +%Y%m%d_%H%M%S)"
fi

# 清理函数
cleanup() {
    echo -e "\n${ERROR_COLOR}正在停止服务...${RESET_COLOR}"
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo -e "${BACKEND_COLOR}[BACKEND]${RESET_COLOR} 后端服务已停止 | 日志: $BACKEND_LOG"
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        echo -e "${FRONTEND_COLOR}[FRONTEND]${RESET_COLOR} 前端服务已停止 | 日志: $FRONTEND_LOG"
    fi
    exit 0
}

# 捕获退出信号
trap cleanup SIGINT SIGTERM EXIT

# 清屏
clear

echo -e "${SUCCESS_COLOR}========================================${RESET_COLOR}"
echo -e "${SUCCESS_COLOR}  D&D Platform 开发环境启动${RESET_COLOR}"
echo -e "${SUCCESS_COLOR}========================================${RESET_COLOR}\n"

# 启动后端
echo -e "${BACKEND_COLOR}[BACKEND]${RESET_COLOR} 启动后端服务 (端口 8174)..."
cd backend
# 激活虚拟环境并启动后端
source venv/bin/activate && python -m uvicorn app.main:app --reload --port 8174 2>&1 | while IFS= read -r line; do
    # 同时输出到终端和日志文件
    echo -e "${BACKEND_COLOR}[BACKEND]${RESET_COLOR} $line"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line" >> "../$BACKEND_LOG"
done &
BACKEND_PID=$!
cd ..

# 等待一秒让后端先启动
sleep 1

# 启动前端
echo -e "${FRONTEND_COLOR}[FRONTEND]${RESET_COLOR} 启动前端服务 (端口 5174)..."
cd frontend
npm run dev 2>&1 | while IFS= read -r line; do
    # 同时输出到终端和日志文件
    echo -e "${FRONTEND_COLOR}[FRONTEND]${RESET_COLOR} $line"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line" >> "../$FRONTEND_LOG"
done &
FRONTEND_PID=$!
cd ..

# 显示启动信息
echo -e "\n${SUCCESS_COLOR}========================================${RESET_COLOR}"
echo -e "${SUCCESS_COLOR}  ✓ 服务已启动${RESET_COLOR}"
echo -e "${SUCCESS_COLOR}========================================${RESET_COLOR}"
echo -e "  ${FRONTEND_COLOR}前端:${RESET_COLOR} http://localhost:5174"
echo -e "  ${BACKEND_COLOR}后端:${RESET_COLOR} http://localhost:8174"
echo -e "  ${BACKEND_COLOR}API文档:${RESET_COLOR} http://localhost:8174/docs"
echo -e "\n  进程 ID:"
echo -e "    ${FRONTEND_COLOR}Frontend PID:${RESET_COLOR} $FRONTEND_PID"
echo -e "    ${BACKEND_COLOR}Backend PID:${RESET_COLOR} $BACKEND_PID"
echo -e "\n  日志文件:"
echo -e "    ${FRONTEND_COLOR}前端日志:${RESET_COLOR} $FRONTEND_LOG"
echo -e "    ${BACKEND_COLOR}后端日志:${RESET_COLOR} $BACKEND_LOG"
echo -e "\n  ${ERROR_COLOR}按 Ctrl+C 停止所有服务${RESET_COLOR}\n"

# 等待进程
wait
