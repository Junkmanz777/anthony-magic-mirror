#!/usr/bin/env bash

set -Eeuo pipefail

MM_DIR="${MM_DIR:-$HOME/MagicMirror}"
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
NODE_SETUP="/tmp/nodesource_setup.sh"

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

node_is_supported() {
  command -v node >/dev/null 2>&1 || return 1

  local version major
  version="$(node -p 'process.versions.node')"
  major="${version%%.*}"

  if [ "$major" -eq 22 ]; then
    [ "$(printf '%s\n%s\n' '22.21.1' "$version" | sort -V | head -n1)" = "22.21.1" ]
    return
  fi

  [ "$major" -ge 24 ]
}

log "Anthony Magic Mirror installer"

if [ "${EUID}" -eq 0 ]; then
  fail "Run this installer as your normal Raspberry Pi user, not as root."
fi

command -v sudo >/dev/null 2>&1 || fail "sudo is required."

ARCH="$(dpkg --print-architecture 2>/dev/null || true)"

if [ "$ARCH" != "arm64" ] && [ "$ARCH" != "amd64" ]; then
  fail "Unsupported architecture: ${ARCH:-unknown}. Use 64-bit Raspberry Pi OS on a Pi 5."
fi

log "Updating package lists"
sudo apt-get update

log "Installing system dependencies"
sudo apt-get install -y \
  git \
  curl \
  ca-certificates \
  build-essential \
  rsync \
  python3-gpiozero

if ! node_is_supported; then
  log "Installing a supported Node.js 22 release"

  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$NODE_SETUP"
  sudo -E bash "$NODE_SETUP"
  sudo apt-get install -y nodejs
  rm -f "$NODE_SETUP"
fi

node_is_supported || fail "Node.js is installed, but its version is not supported by the current MagicMirror release."

log "Using Node.js $(node --version)"

if [ ! -d "$MM_DIR/.git" ]; then
  log "Cloning MagicMirror"
  git clone https://github.com/MagicMirrorOrg/MagicMirror.git "$MM_DIR"
else
  log "Existing MagicMirror installation found; keeping its current Git revision"
fi

log "Installing MagicMirror production dependencies"
cd "$MM_DIR"
node --run install-mm

log "Installing Anthony Magic Mirror modules"
mkdir -p "$MM_DIR/modules"

if [ -d "$PROJECT_DIR/modules" ]; then
  rsync -a \
    --exclude='.gitkeep' \
    "$PROJECT_DIR/modules/" \
    "$MM_DIR/modules/"
fi

log "Installing default configuration"
mkdir -p "$MM_DIR/config"

if [ ! -f "$MM_DIR/config/config.js" ]; then
  cp "$PROJECT_DIR/config/config.example.js" "$MM_DIR/config/config.js"
else
  echo "Keeping existing $MM_DIR/config/config.js"
fi

log "Installing user startup service"
mkdir -p "$HOME/.config/systemd/user"

cp \
  "$PROJECT_DIR/system/magicmirror.service" \
  "$HOME/.config/systemd/user/magicmirror.service"

systemctl --user daemon-reload
systemctl --user enable magicmirror.service

log "Checking MagicMirror configuration"
cd "$MM_DIR"
node --run config:check

log "Installation complete"

echo "Reboot the Raspberry Pi, or start it now with:"
echo "  systemctl --user start magicmirror.service"
