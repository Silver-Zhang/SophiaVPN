'use strict';

const { ipcRenderer, remote, clipboard } = require('electron');

function seedLocalMode() {
  const defaultUser = {
    username: 'local',
    true_name: '本地模式',
    balance: 0,
    traffic: {
      used: 0,
      total: 1024 * 1024 * 1024 * 1024
    },
    level: 1,
    level_expire: '2099-12-31',
    class: 1,
    class_expire: '2099-12-31'
  };

  try {
    if (!window.localStorage.getItem('isLogin')) {
      window.localStorage.setItem('isLogin', 'true');
    }
    if (!window.localStorage.getItem('account')) {
      window.localStorage.setItem('account', 'local');
    }
    if (!window.localStorage.getItem('userinfo')) {
      window.localStorage.setItem('userinfo', JSON.stringify(defaultUser));
    }
  } catch (error) {
    console.warn('Unable to seed local mode:', error);
  }
}

function installInputContextMenu() {
  if (!remote || !remote.Menu) {
    return;
  }

  const menu = remote.Menu.buildFromTemplate([
    { label: 'Cut', role: 'cut' },
    { label: 'Copy', role: 'copy' },
    { label: 'Paste', role: 'paste' },
    { type: 'separator' },
    { label: 'Select all', role: 'selectall' }
  ]);

  document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('contextmenu', event => {
      let node = event.target;
      while (node) {
        if (node.nodeName && node.nodeName.match(/^(input|textarea)$/i)) {
          event.preventDefault();
          event.stopPropagation();
          menu.popup({ window: remote.getCurrentWindow() });
          break;
        }
        node = node.parentNode;
      }
    });
  });
}

window.electronIPC = ipcRenderer;
window.electronRemote = remote;
window.panda = {
  invoke(action, payload = {}) {
    return ipcRenderer.invoke('PANDA_GUI', action, payload);
  },
  copyText(value) {
    clipboard.writeText(String(value || ''));
  }
};

seedLocalMode();
installInputContextMenu();
