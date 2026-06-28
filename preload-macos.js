'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  invoke(action, payload = {}) {
    return ipcRenderer.invoke('SOPHIAVPN_MACOS', action, payload);
  }
};

contextBridge.exposeInMainWorld('sophiaVPN', api);
// Backward-compatible alias for the migrated UI code.
contextBridge.exposeInMainWorld('silverVPN', api);
