#!/bin/bash
# Botanical Database - Smart Launcher
cd "$(dirname "$0")"
PORT=8080
PYTHON_CMD=""

echo "=========================================="
echo "  Botanical Database"
echo "=========================================="
echo ""

# ---- Step 1: Find Python ----
echo "[1/4] Checking Python..."
if command -v python3 &>/dev/null; then
    PYTHON_CMD=python3
elif command -v python &>/dev/null; then
    PYTHON_CMD=python
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "[!] Python not found."
    echo ""
    if command -v brew &>/dev/null; then
        read -p "Install Python via Homebrew? (y/n): " choice
        if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
            echo "Installing Python..."
            brew install python3
            PYTHON_CMD=python3
        else
            echo "Please install Python and try again."
            exit 1
        fi
    else
        echo "Please install Python:"
        echo "  - macOS: brew install python3"
        echo "  - Ubuntu: sudo apt install python3"
        exit 1
    fi
fi
echo "[OK] Found: $PYTHON_CMD"

# ---- Step 2: Check port ----
echo "[2/4] Checking port $PORT..."
if lsof -i :$PORT -sTCP:LISTEN &>/dev/null; then
    echo "[!] Port $PORT is already in use."
    echo ""
    echo "  1) Use port 8081 instead"
    echo "  2) Use port 9000 instead"
    echo "  3) Kill the process on port $PORT"
    echo "  4) Exit"
    read -p "Choose (1/2/3/4): " choice
    case $choice in
        1) PORT=8081 ;;
        2) PORT=9000 ;;
        3)
            PID=$(lsof -ti :$PORT -sTCP:LISTEN)
            if [ -n "$PID" ]; then
                kill $PID 2>/dev/null
                sleep 1
                echo "[OK] Port $PORT freed."
            fi
            ;;
        *) exit 0 ;;
    esac
fi
echo "[OK] Port $PORT available."

# ---- Step 3: Check data ----
echo "[3/4] Checking data..."
if [ ! -f "data/botanical.db" ]; then
    if ls data/images/*.jpg data/images/*.png data/images/*.jpeg &>/dev/null 2>&1; then
        echo "[i] Images found but no database. Building..."
        $PYTHON_CMD tools/import.py
        echo ""
    else
        echo "[i] No data found. You can:"
        echo "      - Put PPBC photos in data/images/ then run: $PYTHON_CMD tools/import.py"
        echo "      - Or use the Import button in the web UI"
        echo ""
    fi
else
    echo "[OK] Database found."
fi

# ---- Step 4: Start server ----
echo "[4/4] Starting server..."
echo ""
echo "=========================================="
echo "  Open: http://localhost:$PORT"
echo "  Press Ctrl+C to stop"
echo "=========================================="
echo ""

# Open browser after short delay
(sleep 2 && {
    if command -v open &>/dev/null; then
        open "http://localhost:$PORT"
    elif command -v xdg-open &>/dev/null; then
        xdg-open "http://localhost:$PORT"
    fi
}) &

$PYTHON_CMD -m http.server $PORT
echo ""
echo "[Server stopped]"
