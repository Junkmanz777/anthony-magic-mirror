#!/bin/bash

set -e

PROJECT_DIR="$HOME/anthony-magic-mirror"
MM_DIR="$HOME/MagicMirror"

echo "Updating Anthony Magic Mirror..."

cd "$PROJECT_DIR"
git pull

echo "Updating custom modules..."

rsync -av \
  "$PROJECT_DIR/modules/" \
  "$MM_DIR/modules/"

echo "Checking configuration..."

cd "$MM_DIR"
node --run config:check

echo "Restarting MagicMirror..."

systemctl --user restart magicmirror.service

echo "Update complete."
