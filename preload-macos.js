'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('silverVPN', {
  invoke(action, payload = {}) {
    return ipcRenderer.invoke('SILVERVPN_MACOS', action, payload);
  }
});
