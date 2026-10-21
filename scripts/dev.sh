#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f dist/index.html ]; then
  npm run build
fi

mkdir -p data

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

(
  cd server
  exec go run . -addr 127.0.0.1:8787 -web "$ROOT/dist" -data "$ROOT/data"
) &
SERVER_PID=$!

printf 'Backend:  http://127.0.0.1:8787  (data: %s/data)\n' "$ROOT"
printf 'Frontend: run `npm run dev` in another terminal  (http://localhost:5173)\n'
printf 'Press Ctrl+C to stop both.\n\n'

wait "$SERVER_PID"
