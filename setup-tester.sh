#!/usr/bin/env bash
set -e

echo "================================================================"
echo "  🚀 PLAYWRIGHT QA TESTING & COPILOT STARTER - SETUP 1-CLICK"
echo "================================================================"

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found! Please install Node.js LTS from https://nodejs.org/"
    exit 1
fi

echo "✅ [1/3] Found Node.js: $(node -v)"
echo "📦 [2/3] Installing dependencies..."
npm install

echo "🌐 [3/3] Installing Playwright Chromium browser..."
npx playwright install chromium

echo ""
echo "🎉 Setup complete! Open this directory in VSCode and press F5 to run tests."
