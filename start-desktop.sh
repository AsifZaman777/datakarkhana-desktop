#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "========================================================"
echo "         DATAKARKHANA DESKTOP AUTOMATION ENGINE         "
echo "========================================================"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Python 3 is required. Please install Python 3.10+."
    exit 1
fi

# Check Node / npm
if ! command -v npm &> /dev/null; then
    echo "Node.js (npm) is required. Please install Node.js from nodejs.org"
    exit 1
fi

# Auto-install Frontend if node_modules is missing
if [ ! -d "$DIR/../datakarkhana-frontend/node_modules" ]; then
    echo "[First-time Setup] Installing Frontend dependencies..."
    cd "$DIR/../datakarkhana-frontend"
    npm install
fi

# Electron's main.js now handles starting both backend and frontend automatically.
# Just launch Electron — it will spawn Python backend + Next.js frontend dev server,
# show a splash screen while they initialize, and open the main window when ready.

echo "Launching DataKarkhana Desktop (auto-starts backend + frontend)..."
cd "$DIR"
npm start
