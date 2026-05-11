#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

need_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name"
    exit 1
  fi
}

ensure_file() {
  local file_path="$1"
  local help_text="$2"
  if [[ ! -f "$file_path" ]]; then
    echo "Missing required file: $file_path"
    echo "$help_text"
    exit 1
  fi
}

need_command npm

ensure_file "$FRONTEND_DIR/.env" "Create it from frontend/.env.example first."

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Frontend node_modules not found. Installing dependencies now..."
  (
    cd "$FRONTEND_DIR"
    npm install
  )
fi

echo "Starting frontend on http://localhost:5173 ..."
cd "$FRONTEND_DIR"
npm run dev -- --host 0.0.0.0
