#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"

if [[ "$OS" == "Darwin" ]]; then
  ELECTRON_BINARY="$ROOT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
else
  ELECTRON_BINARY="$ROOT_DIR/node_modules/electron/dist/electron"
fi

cd "$ROOT_DIR"

if [[ -z "${SOPHIA_NODE:-}" || ! -x "${SOPHIA_NODE:-}" || -z "${SOPHIA_NPM:-}" || ! -x "${SOPHIA_NPM:-}" ]]; then
  bash "$ROOT_DIR/scripts/install-node-runtime.sh"
  export SOPHIA_NODE="$ROOT_DIR/resources/node-runtime/bin/node"
  export SOPHIA_NPM="$ROOT_DIR/resources/node-runtime/bin/npm"
fi

NODE_BIN="$SOPHIA_NODE"
NPM_BIN="$SOPHIA_NPM"
RUNTIME_PATH="$(dirname "$NODE_BIN"):$PATH"

ELECTRON_VERSION="$("$NODE_BIN" -p "require('./package.json').devDependencies.electron")"
PNPM_ELECTRON_DIR="$ROOT_DIR/node_modules/.pnpm/electron@$ELECTRON_VERSION/node_modules/electron"

install_dependencies() {
  env \
    -u NODE_ENV \
    -u ELECTRON_SKIP_BINARY_DOWNLOAD \
    -u npm_config_ignore_scripts \
    -u npm_config_omit \
    -u npm_config_production \
    PATH="$RUNTIME_PATH" \
    "$NPM_BIN" install --include=dev --ignore-scripts=false --package-lock=false "$@"
}

download_electron_binary() {
  env \
    -u NODE_ENV \
    -u ELECTRON_SKIP_BINARY_DOWNLOAD \
    -u npm_config_ignore_scripts \
    -u npm_config_omit \
    -u npm_config_production \
    PATH="$RUNTIME_PATH" \
    "$NODE_BIN" "$ROOT_DIR/node_modules/electron/install.js"
}

restore_existing_electron() {
  if [[ ! -e "$ROOT_DIR/node_modules/electron" && -d "$PNPM_ELECTRON_DIR" ]]; then
    ln -sfn ".pnpm/electron@$ELECTRON_VERSION/node_modules/electron" "$ROOT_DIR/node_modules/electron"
  fi
  if [[ ! -x "$ELECTRON_BINARY" && -f "$ROOT_DIR/node_modules/electron/install.js" ]]; then
    download_electron_binary || true
  fi
  [[ -x "$ELECTRON_BINARY" ]]
}

if restore_existing_electron; then
  echo "Electron runtime is ready: $ELECTRON_BINARY"
  exit 0
fi

echo "Installing npm dependencies (including Electron)"
initial_install_failed=false
if ! install_dependencies; then
  initial_install_failed=true
  echo "Initial npm install failed; removing the incomplete Electron package and retrying." >&2
fi

if [[ "$initial_install_failed" == true || ! -x "$ELECTRON_BINARY" ]]; then
  echo "Reinstalling the Electron package after an incomplete installation."
  rm -rf "$ROOT_DIR/node_modules/electron"
  if ! install_dependencies --no-save "electron@$ELECTRON_VERSION"; then
    echo "Electron retry failed." >&2
  fi
fi

if [[ ! -x "$ELECTRON_BINARY" && -f "$ROOT_DIR/node_modules/electron/install.js" ]]; then
  echo "Running the Electron binary downloader directly."
  if ! download_electron_binary; then
    echo "Electron binary download failed." >&2
  fi
fi

if [[ ! -x "$ELECTRON_BINARY" ]]; then
  echo "Electron runtime was not installed correctly: $ELECTRON_BINARY" >&2
  echo "Node: $("$NODE_BIN" --version 2>/dev/null || echo unknown)" >&2
  echo "npm: $("$NPM_BIN" --version 2>/dev/null || echo unknown)" >&2
  echo "npm registry: $("$NPM_BIN" config get registry 2>/dev/null || echo unknown)" >&2
  echo "npm omit: $("$NPM_BIN" config get omit 2>/dev/null || echo unknown)" >&2
  echo "npm ignore-scripts: $("$NPM_BIN" config get ignore-scripts 2>/dev/null || echo unknown)" >&2
  echo "Check access to the npm registry and GitHub, then rerun:" >&2
  echo "  ./scripts/install-electron.sh" >&2
  exit 1
fi

echo "Electron runtime is ready: $ELECTRON_BINARY"
