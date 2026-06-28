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

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18+ first." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm first." >&2
  exit 1
fi

ELECTRON_VERSION="$(node -p "require('./package.json').devDependencies.electron")"

install_dependencies() {
  env \
    -u NODE_ENV \
    -u ELECTRON_SKIP_BINARY_DOWNLOAD \
    -u npm_config_ignore_scripts \
    -u npm_config_omit \
    -u npm_config_production \
    npm install --include=dev --ignore-scripts=false --package-lock=false "$@"
}

download_electron_binary() {
  env \
    -u NODE_ENV \
    -u ELECTRON_SKIP_BINARY_DOWNLOAD \
    -u npm_config_ignore_scripts \
    -u npm_config_omit \
    -u npm_config_production \
    node "$ROOT_DIR/node_modules/electron/install.js"
}

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
  echo "Node: $(node --version 2>/dev/null || echo unknown)" >&2
  echo "npm: $(npm --version 2>/dev/null || echo unknown)" >&2
  echo "npm registry: $(npm config get registry 2>/dev/null || echo unknown)" >&2
  echo "npm omit: $(npm config get omit 2>/dev/null || echo unknown)" >&2
  echo "npm ignore-scripts: $(npm config get ignore-scripts 2>/dev/null || echo unknown)" >&2
  echo "Check access to the npm registry and GitHub, then rerun:" >&2
  echo "  ./scripts/install-electron.sh" >&2
  exit 1
fi

echo "Electron runtime is ready: $ELECTRON_BINARY"
