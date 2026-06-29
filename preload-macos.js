'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  invoke(action, payload = {}) {
    return ipcRenderer.invoke('SOPHIAVPN_MACOS', action, payload);
  },
  onWindowVisibility(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('SOPHIAVPN_WINDOW_VISIBILITY', handler);
    return () => ipcRenderer.removeListener('SOPHIAVPN_WINDOW_VISIBILITY', handler);
  }
};

contextBridge.exposeInMainWorld('sophiaVPN', api);
// Backward-compatible alias for the migrated UI code.
contextBridge.exposeInMainWorld('silverVPN', api);
