#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build

rm -rf server/web
mkdir -p server/web
cp -r dist/. server/web/

mkdir -p bin
(
  cd server
  CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$ROOT/bin/penclone" .
)

printf 'built bin/penclone (%s)\n' "$(du -h bin/penclone | cut -f1)"
