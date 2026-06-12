#!/usr/bin/env bash
# ============================================================
#  enrollment_startup.sh
#  Starts ONLY the Backend API and Frontend UI.
#  No AI pipeline, no ONVIF — just what you need for enrollment.
# ============================================================

set -e

# ── Colours ──────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"   # script lives at the SMAP project root
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

# ── Load nvm + enforce Node 20 (Next.js 14 requires it, Node 25 breaks it) ──
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"
    nvm use 20 --silent 2>/dev/null || nvm use 20 2>&1
else
    echo -e "${YELLOW}⚠️  nvm not found — using system node ($(node --version))${NC}"
fi

# ── Helpers ───────────────────────────────────────────────────
is_port_open() {
    python3 -c "import socket; s=socket.socket(); s.settimeout(0.5); exit(0 if s.connect_ex(('127.0.0.1', $1)) == 0 else 1)"
}

print_header() {
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}  VisageAI — Enrollment Mode               ${NC}"
    echo -e "${CYAN}  Backend + Frontend only                  ${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""
}

# ── Stop services ────────────────────────────────────────────
stop_all() {
    echo -e "${YELLOW}🛑 Stopping services...${NC}"
    pkill -f "uvicorn main:app" 2>/dev/null || true
    pkill -f "next dev"          2>/dev/null || true
    pkill -f "next-server"       2>/dev/null || true
    sleep 1
    echo -e "${GREEN}✅ Services stopped.${NC}"
    exit 0
}

trap stop_all SIGINT SIGTERM

# ── Start Backend ─────────────────────────────────────────────
start_backend() {
    if is_port_open 8080; then
        echo -e "${GREEN}✅ Backend already running on port 8080${NC}"
    else
        echo -e "${YELLOW}⚡ Starting Backend API (port 8080)...${NC}"
        (
            cd "$PROJECT_ROOT/backend"
            ./venv/bin/python3 -m uvicorn main:app \
                --host 0.0.0.0 \
                --port 8080 \
                > "$LOG_DIR/backend.log" 2>&1
        ) &
        BACKEND_PID=$!

        # Wait up to 15s for backend to come up
        for i in {1..30}; do
            if is_port_open 8080; then
                echo -e "${GREEN}✅ Backend is up!  (PID $BACKEND_PID)${NC}"
                echo -e "   Log: $LOG_DIR/backend.log"
                return
            fi
            sleep 0.5
        done
        echo -e "${RED}❌ Backend did not start within 15 s. Check: $LOG_DIR/backend.log${NC}"
    fi
}

# ── Start Frontend ────────────────────────────────────────────
start_frontend() {
    if is_port_open 3000; then
        echo -e "${GREEN}✅ Frontend already running on port 3000${NC}"
    else
        echo -e "${YELLOW}⚡ Starting Frontend UI (port 3000)...${NC}"
        (
            cd "$PROJECT_ROOT/attendance-ui"
            npm run dev > "$LOG_DIR/frontend.log" 2>&1
        ) &
        FRONTEND_PID=$!

        # Wait up to 45s — Next.js first build can take a while
        for i in {1..90}; do
            if is_port_open 3000; then
                echo -e "${GREEN}✅ Frontend is up!  (PID $FRONTEND_PID)${NC}"
                echo -e "   Log: $LOG_DIR/frontend.log"
                return
            fi
            sleep 0.5
        done
        echo -e "${YELLOW}⚠️  Frontend taking longer than expected.${NC}"
        echo -e "   It may still be compiling — open http://localhost:3000 in a minute."
        echo -e "   Log: $LOG_DIR/frontend.log"
    fi
}

# ── Open browser ──────────────────────────────────────────────
open_browser() {
    echo ""
    echo -e "${BLUE}🌐 Opening http://localhost:3000 in your browser...${NC}"
    python3 -c "import webbrowser; webbrowser.open('http://localhost:3000')" 2>/dev/null || true
}

# ── Main ──────────────────────────────────────────────────────
print_header

echo -e "${BLUE}[1/2] Backend API${NC}"
start_backend
echo ""

echo -e "${BLUE}[2/2] Frontend UI${NC}"
start_frontend
echo ""

open_browser

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  Services running!                        ${NC}"
echo -e "${CYAN}  Frontend : http://localhost:3000          ${NC}"
echo -e "${CYAN}  Backend  : http://localhost:8080          ${NC}"
echo -e "${CYAN}  Docs     : http://localhost:8080/docs     ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop both services."
echo ""

# Keep script alive so Ctrl+C triggers stop_all cleanly
wait
