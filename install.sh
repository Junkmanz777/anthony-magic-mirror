#!/bin/bash

set -e

echo "========================================"
echo " Anthony Magic Mirror Installer"
echo "========================================"

REPO_URL="https://github.com/Junkmanz777/anthony-magic-mirror.git"
MM_DIR="$HOME/MagicMirror"
PROJECT_DIR="$HOME/anthony-magic-mirror"

echo "[1/7] Updating Raspberry Pi OS..."
sudo apt update
sudo apt upgrade -y

echo "[2/7] Installing system dependencies..."
sudo apt install -y \
  git \
  curl \
  ca-certificates \
  build-essential \
  rsync

echo "[3/7] Checking Node.js..."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found."
  echo "Please install Node.js 22.21.1+ before continuing."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")

if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js is too old: $(node --version)"
  echo "MagicMirror currently requires Node 22.21.1+ or Node 24+."
  exit 1
fi

echo "Node version: $(node --version)"

echo "[4/7] Installing MagicMirror..."

if [ ! -d "$MM_DIR/.git" ]; then
  git clone https://github.com/MagicMirrorOrg/MagicMirror.git "$MM_DIR"
fi

cd "$MM_DIR"
node --run install-mm

echo "[5/7] Installing Anthony Magic Mirror files..."

mkdir -p "$MM_DIR/modules"

if [ -d "$PROJECT_DIR/modules" ]; then
  rsync -av "$PROJECT_DIR/modules/" "$MM_DIR/modules/"
fi

if [ ! -f "$MM_DIR/config/config.js" ]; then
  cp "$PROJECT_DIR/config/config.example.js" "$MM_DIR/config/config.js"
fi

echo "[6/7] Installing startup service..."

mkdir -p "$HOME/.config/systemd/user"

cp \
  "$PROJECT_DIR/system/magicmirror.service" \
  "$HOME/.config/systemd/user/magicmirror.service"

systemctl --user daemon-reload
systemctl --user enable magicmirror.service

echo "[7/7] Checking configuration..."

cd "$MM_DIR"
node --run config:check

echo
echo "========================================"
echo " Installation complete."
echo " Reboot the Raspberry Pi to start."
echo "========================================"
