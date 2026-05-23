#!/usr/bin/env bash
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "→ Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
fi

export NVM_DIR
\. "$NVM_DIR/nvm.sh"

echo "→ Switching to Node 22..."
nvm install 22
nvm use 22
nvm alias default 22

echo "→ Installing build tools (required for better-sqlite3)..."
if command -v apt-get &>/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y build-essential python3
elif command -v dnf &>/dev/null; then
  sudo dnf groupinstall -y "Development Tools" && sudo dnf install -y python3
elif command -v yum &>/dev/null; then
  sudo yum groupinstall -y "Development Tools" && sudo yum install -y python3
elif command -v pacman &>/dev/null; then
  sudo pacman -S --noconfirm base-devel python
elif command -v brew &>/dev/null; then
  xcode-select --install 2>/dev/null || true
else
  echo "WARNING: Could not install build tools automatically. better-sqlite3 may fail to compile." >&2
fi

if ! command -v iperf3 &>/dev/null; then
  echo "→ Installing iperf3..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y iperf3
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y iperf3
  elif command -v yum &>/dev/null; then
    sudo yum install -y iperf3
  elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm iperf3
  elif command -v brew &>/dev/null; then
    brew install iperf3
  else
    echo "ERROR: No supported package manager found. Install iperf3 manually." >&2
    exit 1
  fi
else
  echo "→ iperf3 already installed ($(iperf3 --version 2>&1 | head -1))"
fi

if ! command -v pm2 &>/dev/null; then
  echo "→ Installing pm2..."
  npm install -g pm2
else
  echo "→ pm2 already installed ($(pm2 --version))"
fi

echo "→ Installing dependencies (clean install)..."
npm ci

echo "→ Building frontend..."
npm run build

echo "→ Ensuring db/ directory exists..."
mkdir -p db

echo "→ Starting app with pm2..."
pm2 startOrRestart ecosystem.config.js --update-env

echo "→ Saving pm2 process list..."
pm2 save

echo "→ Configuring pm2 to start on boot..."
STARTUP_CMD=$(pm2 startup 2>&1 | grep -E "^\s*sudo ")
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD"
  pm2 save
else
  echo "  Could not auto-run startup command."
  echo "  Run 'pm2 startup' manually and paste the printed sudo command."
fi

echo ""
pm2 status
echo ""
echo "Done. Velocity 9 is running on port 3000."
