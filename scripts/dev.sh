#!/usr/bin/env bash
# Runs the backend and frontend together. Ctrl+C stops both.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -x "$root/backend/.venv/bin/uvicorn" || ! -d "$root/frontend/node_modules" ]]; then
  echo "Dependencies are missing. Run 'make setup' first." >&2
  exit 1
fi

pids=()
cleanup() {
  trap - EXIT INT TERM
  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$root/backend" && exec .venv/bin/uvicorn app.main:app --reload --port 8000) &
pids+=("$!")
(cd "$root/frontend" && exec npm run dev) &
pids+=("$!")

echo "Frontend: http://localhost:3000"
echo "API:      http://localhost:8000/docs"

# Stop everything as soon as either process exits (macOS ships bash 3.2, so no `wait -n`).
while kill -0 "${pids[0]}" 2>/dev/null && kill -0 "${pids[1]}" 2>/dev/null; do
  sleep 1
done
