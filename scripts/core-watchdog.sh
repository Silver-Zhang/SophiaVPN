#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: core-watchdog.sh PARENT_PID CORE [ARG ...]" >&2
  exit 2
fi

parent_pid="$1"
shift

"$@" &
core_pid=$!

stop_core() {
  if kill -0 "$core_pid" 2>/dev/null; then
    kill -TERM "$core_pid" 2>/dev/null || true
    for _ in {1..40}; do
      kill -0 "$core_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$core_pid" 2>/dev/null || true
  fi
}

trap 'stop_core; exit 0' INT TERM EXIT

while kill -0 "$parent_pid" 2>/dev/null && kill -0 "$core_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$parent_pid" 2>/dev/null; then
  stop_core
fi

wait "$core_pid"
