#!/bin/bash
# =============================================================
# SMAP - AI Attendance System Startup Script
# =============================================================
# Usage:
#   ./start.sh              → Start pipeline only
#   ./start.sh enroll       → Clear templates + re-enroll + start pipeline
#   ./start.sh enroll-only  → Clear templates + re-enroll (no pipeline)
#   ./start.sh clear        → Clear templates only
#   ./start.sh check        → Health check (test DB, models, detector)
# =============================================================

set -e

# Propagate active Node.js version to background subshells (fixes system node/NVM mismatches)
if command -v node &>/dev/null; then
    NODE_BIN_DIR="$(dirname "$(which node)")"
    export PATH="$NODE_BIN_DIR:$PATH"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Project directory (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  SMAP - Smart Monitoring & Attendance      ${NC}"
echo -e "${CYAN}  AI Attendance System                      ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ---- HEALTH CHECK FUNCTION ----
health_check() {
    echo -e "${BLUE}[1/5] Checking Python...${NC}"
    if command -v python3 &>/dev/null; then
        PYTHON_VER=$(python3 --version 2>&1)
        echo -e "  ${GREEN}✅ $PYTHON_VER${NC}"
    else
        echo -e "  ${RED}❌ Python3 not found${NC}"
        exit 1
    fi

    echo -e "${BLUE}[2/5] Checking models...${NC}"
    if [ -f "Models/arcface_r100.onnx" ]; then
        SIZE=$(du -h "Models/arcface_r100.onnx" | cut -f1)
        echo -e "  ${GREEN}✅ ArcFace model: $SIZE${NC}"
    else
        echo -e "  ${RED}❌ ArcFace model not found at Models/arcface_r100.onnx${NC}"
        exit 1
    fi

    if [ -f "Models/face_detection_yunet_2023mar.onnx" ]; then
        SIZE=$(du -h "Models/face_detection_yunet_2023mar.onnx" | cut -f1)
        echo -e "  ${GREEN}✅ YuNet face detector: $SIZE${NC}"
    else
        echo -e "  ${RED}❌ YuNet model not found. Downloading...${NC}"
        wget -q -O "Models/face_detection_yunet_2023mar.onnx" \
            "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        echo -e "  ${GREEN}✅ YuNet model downloaded${NC}"
    fi

    echo -e "${BLUE}[3/5] Checking database connection...${NC}"
    python3 -c "
import yaml, sys
with open('config.yaml') as f:
    config = yaml.safe_load(f)
db_url = config.get('DB_URL', '')
print(f'  DB URL: {db_url}')

try:
    import asyncio, asyncpg
    async def test_db():
        conn = await asyncpg.connect(db_url)
        ver = await conn.fetchval('SELECT version()')
        count = await conn.fetchval('SELECT COUNT(*) FROM facial_templates')
        await conn.close()
        return ver.split(',')[0], count
    ver, count = asyncio.run(test_db())
    print(f'  \033[0;32m✅ Connected: {ver}\033[0m')
    print(f'  \033[0;32m✅ Facial templates in DB: {count}\033[0m')
except Exception as e:
    print(f'  \033[0;31m❌ Database error: {e}\033[0m')
    sys.exit(1)
" 2>&1

    echo -e "${BLUE}[4/5] Checking face detector...${NC}"
    python3 -c "
from face_detector import FaceDetector
d = FaceDetector()
print('  \033[0;32m✅ YuNet FaceDetector initialized\033[0m')
" 2>&1

    echo -e "${BLUE}[5/5] Checking InsightFace extractor...${NC}"
    python3 -c "
from embedding_utils import get_extractor
e = get_extractor()
print('  \033[0;32m✅ InsightFace buffalo_l loaded (w600k_r50 ArcFace)\033[0m')
" 2>&1

    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  Health check passed! System ready.        ${NC}"
    echo -e "${GREEN}============================================${NC}"
}

# ---- CLEAR TEMPLATES ----
clear_templates() {
    echo -e "${YELLOW}🧹 Clearing existing facial templates...${NC}"
    python3 clear_templates.py
    echo ""
}

# ---- ENROLL FACES ----
enroll_faces() {
    ENROLL_DIR="${1:-Test_Face}"
    
    if [ ! -d "$ENROLL_DIR" ]; then
        echo -e "${RED}❌ Enrollment directory not found: $ENROLL_DIR${NC}"
        echo -e "  Create folders under $ENROLL_DIR/ with person names, each containing face images."
        exit 1
    fi

    # Count people and images
    PEOPLE=$(find "$ENROLL_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)
    IMAGES=$(find "$ENROLL_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) | wc -l)

    echo -e "${BLUE}📸 Enrolling faces from: $ENROLL_DIR${NC}"
    echo -e "  People: $PEOPLE"
    echo -e "  Images: $IMAGES"
    echo ""

    python3 face_enrollment.py
    echo ""
    echo -e "${GREEN}✅ Enrollment complete${NC}"
}

# Helper to check if a local port is listening
is_port_open() {
    python3 -c "import socket; s=socket.socket(); s.settimeout(0.5); exit(0 if s.connect_ex(('127.0.0.1', $1)) == 0 else 1)"
}

# ---- START PIPELINE ----
start_pipeline() {
    # Ensure logs directory exists
    mkdir -p ../logs

    # Check and start Backend (port 8080) if closed
    if is_port_open 8080; then
        echo -e "${GREEN}✅ Backend API is already running on port 8080.${NC}"
    else
        echo -e "${YELLOW}⚡ Backend API is not running. Starting backend in background...${NC}"
        (cd "$SCRIPT_DIR/../backend" && ./venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8080 > ../logs/backend.log 2>&1) &
        sleep 1.5
    fi

    # Check and start Frontend Next.js (port 3000) if closed
    if is_port_open 3000; then
        echo -e "${GREEN}✅ Frontend UI is already running on port 3000.${NC}"
    else
        echo -e "${YELLOW}⚡ Frontend UI is not running. Starting Next.js in background...${NC}"
        (cd "$SCRIPT_DIR/../attendance-ui" && npm run dev > ../logs/frontend.log 2>&1) &
        sleep 2.5
    fi

    # Check and start ONVIF Service (port 5001) if closed
    if is_port_open 5001; then
        echo -e "${GREEN}✅ ONVIF service is already running on port 5001.${NC}"
    else
        echo -e "${YELLOW}⚡ ONVIF service is not running. Starting in background...${NC}"
        python3 onvif_service.py > ../logs/onvif.log 2>&1 &
    fi

    echo -e "${BLUE}🚀 Starting AI Attendance Pipeline...${NC}"
    echo -e "  Config: config.yaml"
    echo -e "  Cameras: cameras.json"
    echo ""
    
    # Open frontend web browser in the background once Next.js is fully running
    echo -e "${BLUE}🌐 Waiting for Frontend UI on port 3000 to respond...${NC}"
    (
        for i in {1..30}; do
            if is_port_open 3000; then
                echo -e "\n${GREEN}🌐 Frontend UI is ready! Opening in web browser...${NC}"
                python3 -c "import webbrowser; webbrowser.open('http://localhost:3000')"
                exit 0
            fi
            sleep 0.5
        done
        echo -e "\n${RED}❌ Timeout: Frontend UI did not start within 15 seconds.${NC}"
    ) &
    
    python3 main.py
}

# ---- MAIN ----
case "${1:-}" in
    check|health)
        health_check
        ;;
    clear)
        health_check
        echo ""
        clear_templates
        ;;
    enroll-only)
        health_check
        echo ""
        clear_templates
        enroll_faces "${2:-Test_Face}"
        ;;
    enroll)
        health_check
        echo ""
        clear_templates
        enroll_faces "${2:-Test_Face}"
        echo ""
        start_pipeline
        ;;
    ""|start|run)
        health_check
        echo ""
        start_pipeline
        ;;
    *)
        echo "Usage: $0 {start|enroll|enroll-only|clear|check}"
        echo ""
        echo "Commands:"
        echo "  start        Start the pipeline (default)"
        echo "  enroll       Clear + re-enroll + start pipeline"
        echo "  enroll-only  Clear + re-enroll (no pipeline)"
        echo "  clear        Clear all facial templates"
        echo "  check        Run health check only"
        exit 1
        ;;
esac
