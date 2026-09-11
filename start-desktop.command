#!/usr/bin/env bash
set -e

# Change directory to where this .command file is located
cd "$( dirname "${BASH_SOURCE[0]}" )"
DIR="$( pwd )"

echo "========================================================"
echo "         DATAKARKHANA DESKTOP AUTOMATION ENGINE         "
echo "========================================================"

# Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required. Please install Python 3.10+ from python.org"
    read -n 1 -s -r -p "Press any key to exit..."
    exit 1
fi

# Check Node / npm
if ! command -v npm &> /dev/null; then
    echo "❌ Node.js (npm) is required. Please install Node.js from nodejs.org"
    read -n 1 -s -r -p "Press any key to exit..."
    exit 1
fi

# Auto-install Electron if node_modules is missing
if [ ! -d "$DIR/node_modules/electron" ]; then
    echo "📦 [First-time Setup] Installing Desktop Electron dependencies..."
    cd "$DIR"
    npm install
fi

# Auto-install Frontend if node_modules is missing
if [ ! -d "$DIR/../datakarkhana-frontend/node_modules" ]; then
    echo "📦 [First-time Setup] Installing Frontend dependencies..."
    cd "$DIR/../datakarkhana-frontend"
    npm install
fi

# Electron's main.js now handles starting both backend and frontend automatically.
# Just launch Electron — it will spawn Python backend + Next.js frontend dev server,
# show a splash screen while they initialize, and open the main window when ready.

echo "🚀 Launching DataKarkhana Desktop (auto-starts backend + frontend)..."
cd "$DIR"
npm start
