#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"
FUNCTION_APP_NAME="${1:-Neural-Chat}"

if ! command -v func >/dev/null 2>&1; then
  echo "Missing required command: func"
  exit 1
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Backend directory not found: $BACKEND_DIR"
  exit 1
fi

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  echo "Backend virtualenv not found: $BACKEND_PYTHON"
  echo "Run ./start-backend.sh once or create backend/.venv first."
  exit 1
fi

if ! "$BACKEND_PYTHON" -c "import fastapi" >/dev/null 2>&1; then
  echo "Backend dependencies are missing in .venv. Installing requirements now..."
  cd "$BACKEND_DIR"
  "$BACKEND_PYTHON" -m pip install --upgrade pip
  "$BACKEND_PYTHON" -m pip install -r requirements.txt
fi

echo "Publishing backend to Azure Function App: $FUNCTION_APP_NAME"
cd "$BACKEND_DIR"
export VIRTUAL_ENV="$BACKEND_DIR/.venv"
export PATH="$VIRTUAL_ENV/bin:$PATH"
func azure functionapp publish "$FUNCTION_APP_NAME"
