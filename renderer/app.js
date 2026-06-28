(function () {
  'use strict';

  const panda = window.panda || {
    invoke: mockInvoke,
    copyText(value) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(String(value || '')).catch(() => {});
      }
    }
  };
  const state = {
    dashboard: null,
    delays: new Map(),
    filter: '',
    language: 'zh-CN',
    tunRequestPending: false,
    tunPendingEnabled: false,
    tunError: '',
    toastTimer: null
  };

  const messages = {
    'zh-CN': {
      smart: '智能代理',
      global: '全局代理',
      direct: '直连模式',
      coreRunning: '核心运行中',
      coreStopped: '核心未运行',
      noNode: '未选择',
      noRows: '没有可显示的节点',
      selected: '已选择',
      switchNode: '切换',
      refreshed: '状态已刷新',
      startOk: '核心已启动',
      stopOk: '核心已停止',
      configOpened: '已打开配置目录',
      logsOpened: '已打开日志目录',
      systemProxyOn: '系统与终端代理已启用；已有程序需重启',
      systemProxyOff: '系统与终端代理已关闭',
      tunEnabled: 'TUN 模式已启用',
      tunDisabled: 'TUN 模式已关闭',
      tunEnabling: '正在启用',
      tunDisabling: '正在关闭',
      tunActive: '运行中',
      tunReady: '预检通过',
      tunUnavailable: '不可用',
      tunConflict: '存在冲突',
      tunWaiting: '等待启动',
      tunUnchecked: '尚未预检',
      tunDefaultMessage: 'TUN 默认关闭；开启前会检查其他 VPN、隧道网卡和路由冲突。',
      tunReadyMessage: '预检通过，可以按需启用 TUN 模式。',
      tunActiveMessage: 'TUN 正在接管需要路由的流量。',
      tunConflictPrefix: '无法启用 TUN：',
      tunRefreshed: 'TUN 状态已重新检测',
      networkRestored: 'SilverVPN 默认网络已恢复',
      restoreConfirm: '确认停止 SilverVPN 代理和 TUN，并恢复默认网络？不会修改其他 VPN。',
      modeSwitched: '已切换到',
      noDelayNodes: '没有可测试的节点',
      delayDone: '延迟测试完成',
      importing: '正在下载并验证订阅，请稍候…',
      imported: '订阅已导入',
      fileImported: '文件已导入',
      loginDone: '账号已登录，节点已更新',
      refreshedUser: '账号订阅已刷新',
      bypassSaved: '绕过地址已保存',
      profileSwitched: '配置方案已切换',
      networkRefreshed: '网络状态已刷新',
      detectingIp: 'Detecting outbound IP',
      testing: 'Testing',
      accountMissing: '未登录',
      testingState: '测试中',
      pass: '通过',
      fail: '失败'
    },
    en: {
      smart: 'Smart',
      global: 'Global',
      direct: 'Direct',
      coreRunning: 'Core running',
      coreStopped: 'Core stopped',
      noNode: 'Not selected',
      noRows: 'No nodes',
      selected: 'Selected',
      switchNode: 'Switch',
      refreshed: 'Status refreshed',
      startOk: 'Core started',
      stopOk: 'Core stopped',
      configOpened: 'Config opened',
      logsOpened: 'Logs opened',
      systemProxyOn: 'System and terminal proxy enabled; restart existing apps',
      systemProxyOff: 'System and terminal proxy disabled',
      tunEnabled: 'TUN mode enabled',
      tunDisabled: 'TUN mode disabled',
      tunEnabling: 'Enabling',
      tunDisabling: 'Disabling',
      tunActive: 'Active',
      tunReady: 'Preflight passed',
      tunUnavailable: 'Unavailable',
      tunConflict: 'Conflict detected',
      tunWaiting: 'Waiting to start',
      tunUnchecked: 'Not checked',
      tunDefaultMessage: 'TUN is off by default. Other VPNs, tunnel interfaces, and route conflicts are checked before enabling it.',
      tunReadyMessage: 'Preflight passed. TUN mode can be enabled when needed.',
      tunActiveMessage: 'TUN is routing traffic that requires system-level interception.',
      tunConflictPrefix: 'Unable to enable TUN: ',
      tunRefreshed: 'TUN status refreshed',
      networkRestored: 'SilverVPN default network restored',
      restoreConfirm: 'Stop SilverVPN proxy and TUN and restore the default network? Other VPNs will not be modified.',
      modeSwitched: 'Switched to ',
      noDelayNodes: 'No nodes to test',
      delayDone: 'Delay test complete',
      importing: 'Downloading and validating subscription…',
      imported: 'Subscription imported',
      fileImported: 'File imported',
      loginDone: 'Logged in and updated',
      refreshedUser: 'Account subscription refreshed',
      bypassSaved: 'Bypass list saved',
      profileSwitched: 'Profile switched',
      networkRefreshed: 'Network status refreshed',
      detectingIp: 'Detecting outbound IP',
      testing: 'Testing',
      accountMissing: 'Not signed in',
      testingState: 'Testing',
      pass: 'Passed',
      fail: 'Failed'
    }
  };

  function t(key) {
    const language = state.language === 'en' ? 'en' : 'zh-CN';
    return (messages[language] && messages[language][key]) || messages['zh-CN'][key] || key;
  }

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  function modeKey(mode) {
    const value = String(mode || '').toLowerCase();
    if (value === 'global') {
      return 'global';
    }
    if (value === 'direct') {
      return 'direct';
    }
    return 'rule';
  }

  function modeText(mode) {
    const key = modeKey(mode);
    if (key === 'global') {
      return t('global');
    }
    if (key === 'direct') {
      return t('direct');
    }
    return t('smart');
  }

  function applyLanguage() {
    const english = state.language === 'en';
    document.documentElement.lang = english ? 'en' : 'zh-CN';
    const pairs = [
      ['#connectionTitle', english ? 'Connection' : '连接'],
      ['#startCore', english ? 'Start' : '启动'],
      ['#stopCore', english ? 'Stop' : '停止'],
      ['.mode-button[data-mode="rule"]', modeText('rule')],
      ['.mode-button[data-mode="global"]', modeText('global')],
      ['.mode-button[data-mode="direct"]', modeText('direct')],
      ['#systemProxyLabel', english ? 'System and terminal proxy' : '系统与终端代理'],
      ['#tunModeLabel', english ? 'TUN mode' : 'TUN 模式'],
      ['#refreshTunStatus', english ? 'Recheck' : '重新检测'],
      ['#restoreDefaultNetwork', english ? 'Restore network' : '恢复默认网络'],
      ['#accountTitle', english ? 'Account' : '账号'],
      ['#refreshUser', english ? 'Refresh' : '刷新'],
      ['#subscriptionTitle', english ? 'Profiles' : '订阅'],
      ['#importFile', english ? 'Import file' : '导入文件'],
      ['#importForm button[type="submit"]', english ? 'Import subscription' : '导入订阅'],
      ['label[for="profileSelect"]', english ? 'Profile' : '配置方案'],
      ['#bypassTitle', english ? 'Direct bypass' : '直连/绕过地址'],
      ['#saveBypass', english ? 'Save' : '保存'],
      ['#testsTitle', english ? 'Connectivity' : '连通性测试'],
      ['#detectIp', english ? 'Outbound IP' : '出口 IP'],
      ['#pathsTitle', english ? 'Paths' : '路径'],
      ['#openConfig', english ? 'Open config' : '打开配置'],
      ['#logTitle', english ? 'Core log' : '核心日志'],
      ['#openLogs', english ? 'Open logs' : '打开目录'],
      ['#delayAll', english ? 'Delay test' : '延迟测试'],
      ['#networkTitle', english ? 'Network status' : '网络状态']
    ];
    pairs.forEach(([selector, value]) => setText(selector, value));
    $('#apiBase').placeholder = english ? 'Optional API base URL' : '服务端 URL（可选）';
    $('#username').placeholder = english ? 'Account email' : '账号';
    $('#password').placeholder = english ? 'Password' : '密码';
    $('#nodeSearch').placeholder = english ? 'Search nodes' : '搜索节点';
    $('#subscriptionSource').placeholder = english ? 'Subscription URL / sub://...' : '订阅 URL / sub://...';
    $('#customTestUrl').placeholder = 'https://example.com';
    $('#bypassHosts').placeholder = english
      ? 'One host or CIDR per line, for example:\ngitlab.example.org\n*.example.org\n192.168.0.0/16'
      : '每行一个域名或网段，例如：\ngitlab.example.org\n*.example.org\n192.168.0.0/16';
    if (state.dashboard) {
      renderTunStatus(state.dashboard.settings || {}, state.dashboard.tun || {});
    }
  }

  function shortPath(value) {
    const text = String(value || '');
    if (text.length <= 48) {
      return text || '-';
    }
    return `${text.slice(0, 20)}...${text.slice(-24)}`;
  }

  function formatDate(value) {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node) {
      node.textContent = value == null || value === '' ? '-' : String(value);
    }
  }

  function setBadge(selector, text, tone) {
    const node = $(selector);
    if (!node) {
      return;
    }
    node.textContent = text;
    node.className = 'badge';
    if (tone === 'muted') {
      node.classList.add('badge-muted');
    }
    if (tone === 'warn') {
      node.classList.add('badge-warn');
    }
    if (tone === 'danger') {
      node.classList.add('badge-danger');
    }
  }

  function normalizeTunConflicts(conflicts) {
    if (!Array.isArray(conflicts)) {
      return conflicts ? [String(conflicts)] : [];
    }
    return conflicts
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          return item.message || item.reason || item.name || JSON.stringify(item);
        }
        return String(item || '');
      })
      .filter(Boolean);
  }

  function renderTunStatus(settings, tun) {
    const control = $('#tunControl');
    const input = $('#tunMode');
    const messageNode = $('#tunMessage');
    const conflictNode = $('#tunConflicts');
    if (!control || !input || !messageNode || !conflictNode) {
      return;
    }

    const reportedConflicts = normalizeTunConflicts(tun.conflicts);
    const conflicts = reportedConflicts.length ? reportedConflicts : state.tunError ? [state.tunError] : [];
    const active = Boolean(tun.active);
    const enabled = Boolean(settings.tunEnabled);
    const available = tun.available;
    const effectiveEnabled = state.tunError ? false : active || (enabled && conflicts.length === 0 && available !== false);

    input.checked = state.tunRequestPending ? state.tunPendingEnabled : effectiveEnabled;
    input.disabled = state.tunRequestPending || (available === false && !effectiveEnabled);
    control.classList.toggle('has-conflict', conflicts.length > 0);
    control.classList.toggle('is-active', active);
    control.classList.toggle('is-pending', state.tunRequestPending);

    if (state.tunRequestPending) {
      setBadge('#tunState', state.tunPendingEnabled ? t('tunEnabling') : t('tunDisabling'), 'warn');
    } else if (conflicts.length) {
      setBadge('#tunState', t('tunConflict'), 'danger');
    } else if (active) {
      setBadge('#tunState', t('tunActive'));
    } else if (enabled) {
      setBadge('#tunState', t('tunWaiting'), 'warn');
    } else if (available === true) {
      setBadge('#tunState', t('tunReady'));
    } else if (available === false) {
      setBadge('#tunState', t('tunUnavailable'), 'warn');
    } else {
      setBadge('#tunState', t('tunUnchecked'), 'muted');
    }

    messageNode.textContent =
      (state.tunError ? `${t('tunConflictPrefix')}${state.tunError}` : tun.message) ||
      (active
        ? t('tunActiveMessage')
        : available === true
          ? t('tunReadyMessage')
          : t('tunDefaultMessage'));
    conflictNode.hidden = conflicts.length === 0;
    conflictNode.innerHTML = conflicts.map(item => `<div>${escapeHtml(item)}</div>`).join('');
  }

  function toast(message) {
    const node = $('#toast');
    if (!node) {
      return;
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  function setLoading(enabled) {
    $('#app').classList.toggle('is-loading', Boolean(enabled));
  }

  function getRows() {
    const rows = state.dashboard && state.dashboard.proxies ? state.dashboard.proxies.rows || [] : [];
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter(row => row.name.toLowerCase().includes(query));
  }

  function renderNodes() {
    const list = $('#nodeList');
    if (!list) {
      return;
    }
    const dashboard = state.dashboard || {};
    const rows = getRows();
    if (!rows.length) {
      list.innerHTML = `<div class="node-empty">${t('noRows')}</div>`;
      return;
    }
    list.innerHTML = rows
      .map(row => {
        const delay = state.delays.get(row.name);
        const delayClass = delay == null ? '' : delay >= 0 && delay < 800 ? 'good' : 'bad';
        const delayText = delay == null ? '-' : delay >= 0 ? `${delay} ms` : '失败';
        const selected = row.name === dashboard.proxies.current || row.selected;
        return `
          <div class="node-row${selected ? ' selected' : ''}" data-node="${escapeHtml(row.name)}">
            <div class="node-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
            <div class="node-type">${escapeHtml(row.type || '-')}</div>
            <div class="node-delay ${delayClass}">${delayText}</div>
            <button class="button button-small switch-node" type="button" data-node="${escapeHtml(row.name)}">${selected ? t('selected') : t('switchNode')}</button>
          </div>
        `;
      })
      .join('');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDashboard(dashboard) {
    state.dashboard = dashboard;
    state.tunError = '';
    const config = dashboard.config || {};
    const core = dashboard.core || {};
    const settings = dashboard.settings || {};
    const proxies = dashboard.proxies || {};
    const account = dashboard.account || {};
    const profile = dashboard.activeProfile || account.profile || {};
    const auth = account.auth || {};
    const mode = modeKey(config.mode);
    state.language = settings.language || 'zh-CN';
    $('#languageSelect').value = state.language;
    applyLanguage();

    setText('#coreState', core.running ? t('coreRunning') : t('coreStopped'));
    setText('#currentProxy', proxies.current || t('noNode'));
    setText('#httpPort', config.httpPort || '-');
    setText('#socksPort', config.socksPort || '-');
    setText('#proxyCount', proxies.count || 0);
    setText('#profileSource', profile.name || profile.sourceType || settings.currentProfile || '-');
    setText('#profileCount', profile.proxyCount == null ? proxies.count || '-' : profile.proxyCount);
    setText('#profileUpdated', formatDate(profile.importedAt));
    setText('#dataDir', shortPath(config.dataDir));
    setText('#configFile', shortPath(config.activeConfigFile));
    setText('#controlApi', core.control || '-');
    setText('#coreLog', core.logTail ? core.logTail.trim() : '暂无日志');
    setBadge('#modeBadge', modeText(mode), core.running ? undefined : 'warn');
    setBadge('#accountState', auth && auth.username ? auth.username : t('accountMissing'), auth && auth.username ? undefined : 'muted');

    $('#systemProxy').checked = Boolean(settings.systemProxy);
    renderTunStatus(settings, dashboard.tun || {});
    $$('.mode-button').forEach(button => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });

    const usernameInput = $('#username');
    if (usernameInput && document.activeElement !== usernameInput && !usernameInput.value && auth && auth.username) {
      usernameInput.value = auth.username;
    }

    renderProfiles(dashboard);
    renderBypass(settings);
    renderNodes();
  }

  function renderProfiles(dashboard) {
    const select = $('#profileSelect');
    const profiles = dashboard.subscriptions || [];
    const currentId = dashboard.activeProfile && dashboard.activeProfile.id ? dashboard.activeProfile.id : dashboard.settings.currentProfileId || '';
    select.innerHTML = [
      `<option value="">${state.language === 'en' ? 'Current config' : '当前配置'}</option>`,
      ...profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.kind || profile.id)}</option>`)
    ].join('');
    select.value = currentId;
  }

  function renderBypass(settings) {
    const custom = settings.bypassHosts || [];
    const textarea = $('#bypassHosts');
    if (document.activeElement !== textarea) {
      textarea.value = custom.join('\n');
    }
    setText('#defaultBypassHosts', (settings.defaultBypassHosts || []).join(', '));
  }

  function formatEgress(value) {
    if (!value || !value.ok) {
      return value && value.inactive ? (state.language === 'en' ? 'Core stopped' : '核心未启动') : '-';
    }
    return [value.ip, value.country, value.city].filter(Boolean).join(' · ');
  }

  function renderNetworkStatus(status) {
    const silver = status.silverVPN || {};
    const gnome = status.gnomeProxy || {};
    const route = status.routes || {};
    const tunnels = status.tunnelInterfaces || [];
    const ports = status.listeningPorts || [];
    const warnings = status.conflicts || [];
    const checkedAt = status.checkedAt ? new Date(status.checkedAt).toLocaleTimeString() : '-';

    setText('#networkCheckedAt', `${state.language === 'en' ? 'Updated' : '更新'} ${checkedAt}`);
    setBadge(
      '#silverState',
      silver.coreRunning ? `${modeText(silver.mode)} · ${silver.node || t('noNode')}` : (state.language === 'en' ? 'Disconnected' : '未连接'),
      silver.coreRunning ? undefined : 'muted'
    );
    setText('#directEgress', formatEgress(status.directEgress));
    setText('#silverEgress', formatEgress(status.silverEgress));
    setText(
      '#systemProxyActual',
      gnome.mode === 'manual'
        ? `${gnome.http || gnome.https || 'manual'}${gnome.ownedBySilverVPN ? ' · SilverVPN' : ''}`
        : gnome.mode || '-'
    );
    setText('#defaultRoute', route.ipv4 || route.ipv6 || '-');
    setText('#tunnelInterfaces', tunnels.length ? tunnels.map(item => item.name).join(', ') : (state.language === 'en' ? 'None' : '无'));
    setText(
      '#listeningPorts',
      ports.filter(item => item.listening).map(item => item.port).join(', ') || (state.language === 'en' ? 'None' : '无')
    );

    const warningNode = $('#networkWarnings');
    warningNode.hidden = warnings.length === 0;
    warningNode.innerHTML = warnings.map(item => `<div>${escapeHtml(item)}</div>`).join('');
  }

  async function loadNetworkStatus(showToast) {
    try {
      const status = await panda.invoke('network-status');
      renderNetworkStatus(status);
      if (showToast) {
        toast(t('networkRefreshed'));
      }
    } catch (error) {
      setText('#networkCheckedAt', error.message || String(error));
    }
  }

  async function loadDashboard(quiet) {
    try {
      const dashboard = await panda.invoke('dashboard');
      renderDashboard(dashboard);
      if (!quiet) {
        toast(t('refreshed'));
      }
    } catch (error) {
      toast(error.message || String(error));
    }
  }

  async function callAction(action, payload, successMessage) {
    setLoading(true);
    try {
      const result = await panda.invoke(action, payload || {});
      if (result && result.dashboard) {
        renderDashboard(result.dashboard);
      } else if (result && result.appName) {
        renderDashboard(result);
      } else {
        await loadDashboard(true);
      }
      if (successMessage) {
        toast(successMessage);
      }
      return result;
    } catch (error) {
      toast(error.message || String(error));
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function setTunMode(enabled) {
    state.tunError = '';
    state.tunRequestPending = true;
    state.tunPendingEnabled = enabled;
    if (state.dashboard) {
      renderTunStatus(state.dashboard.settings || {}, state.dashboard.tun || {});
    }
    setLoading(true);

    try {
      const result = await panda.invoke('set-tun-mode', { enabled });
      const dashboard = result && result.dashboard
        ? result.dashboard
        : result && result.appName
          ? result
          : await panda.invoke('dashboard');
      renderDashboard(dashboard);

      const settings = dashboard.settings || {};
      const tun = dashboard.tun || {};
      const conflicts = normalizeTunConflicts(tun.conflicts);
      const accepted = !enabled || Boolean(settings.tunEnabled || tun.active);
      if (enabled && (conflicts.length || tun.available === false || !accepted)) {
        const reason = conflicts.join('；') || tun.message || t('tunUnavailable');
        toast(`${t('tunConflictPrefix')}${reason}`);
        return;
      }
      toast(enabled ? t('tunEnabled') : t('tunDisabled'));
    } catch (error) {
      const reason = (error && error.message ? error.message : String(error))
        .replace(/^Error invoking remote method 'PANDA_GUI': Error:\s*/i, '')
        .replace(/^无法开启 TUN：\s*/i, '');
      state.tunError = reason;
      toast(`${t('tunConflictPrefix')}${reason}`);
    } finally {
      state.tunRequestPending = false;
      setLoading(false);
      if (state.dashboard) {
        renderTunStatus(state.dashboard.settings || {}, state.dashboard.tun || {});
      }
    }
  }

  async function runUrlTest(url) {
    setBadge('#testState', t('testingState'), 'warn');
    setText('#testOutput', `${t('testing')} ${url}`);
    try {
      const result = await panda.invoke('test-url', { url });
      setBadge('#testState', result.ok ? t('pass') : t('fail'), result.ok ? undefined : 'danger');
      setText(
        '#testOutput',
        [
          `url=${result.url}`,
          `ok=${result.ok}`,
          `http=${result.httpCode}`,
          `remote_ip=${result.remoteIp || '-'}`,
          `time=${result.timeTotal || '-'}s`,
          `proxy=${result.proxy}`,
          result.stderr ? `stderr=${result.stderr}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (error) {
      setBadge('#testState', t('fail'), 'danger');
      setText('#testOutput', error.message || String(error));
    }
  }

  async function runIpTest() {
    setBadge('#testState', t('testingState'), 'warn');
    setText('#testOutput', t('detectingIp'));
    try {
      const result = await panda.invoke('detect-ip');
      setBadge('#testState', result.ok ? t('pass') : t('fail'), result.ok ? undefined : 'danger');
      setText(
        '#testOutput',
        [
          `ip=${result.ip || '-'}`,
          `country=${result.country || '-'}`,
          `region=${result.region || '-'}`,
          `city=${result.city || '-'}`,
          `org=${result.org || '-'}`,
          `source=${result.source || '-'}`,
          `proxy=${result.proxy || '-'}`
        ].join('\n')
      );
    } catch (error) {
      setBadge('#testState', t('fail'), 'danger');
      setText('#testOutput', error.message || String(error));
    }
  }

  async function runLanTest() {
    setBadge('#testState', t('testingState'), 'warn');
    setText('#testOutput', `${t('testing')} 192.168.9.27:22`);
    try {
      const result = await panda.invoke('test-tcp', { host: '192.168.9.27', port: 22 });
      setBadge('#testState', result.ok ? t('pass') : t('fail'), result.ok ? undefined : 'danger');
      setText(
        '#testOutput',
        [
          `host=${result.host}`,
          `port=${result.port}`,
          `ok=${result.ok}`,
          `elapsed=${result.elapsedMs}ms`,
          result.error ? `error=${result.error}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (error) {
      setBadge('#testState', t('fail'), 'danger');
      setText('#testOutput', error.message || String(error));
    }
  }

  function bindEvents() {
    $('#refreshDashboard').addEventListener('click', () => loadDashboard(false));
    $('#refreshNetwork').addEventListener('click', () => loadNetworkStatus(true));
    $('#refreshTunStatus').addEventListener('click', async () => {
      await loadDashboard(true);
      toast(t('tunRefreshed'));
    });
    $('#restoreDefaultNetwork').addEventListener('click', () => {
      if (!window.confirm(t('restoreConfirm'))) {
        return;
      }
      callAction('restore-default-network', {}, t('networkRestored'));
    });
    $('#startCore').addEventListener('click', () => callAction('start-core', {}, t('startOk')));
    $('#stopCore').addEventListener('click', () => callAction('stop-core', {}, t('stopOk')));
    $('#openConfig').addEventListener('click', () => callAction('open-config-dir', {}, t('configOpened')));
    $('#openLogs').addEventListener('click', () => callAction('open-logs-dir', {}, t('logsOpened')));
    $('#languageSelect').addEventListener('change', event => {
      callAction('set-language', { language: event.target.value }, null).then(() => {
        applyLanguage();
      });
    });
    $('#systemProxy').addEventListener('change', event => {
      callAction('set-system-proxy', { enabled: event.target.checked }, event.target.checked ? t('systemProxyOn') : t('systemProxyOff')).catch(() => {
        event.target.checked = !event.target.checked;
      });
    });
    $('#tunMode').addEventListener('change', event => {
      setTunMode(event.target.checked);
    });

    $$('.mode-button').forEach(button => {
      button.addEventListener('click', () => callAction('set-mode', { mode: button.dataset.mode }, `${t('modeSwitched')}${modeText(button.dataset.mode)}`));
    });

    $('#nodeSearch').addEventListener('input', event => {
      state.filter = event.target.value;
      renderNodes();
    });

    $('#nodeList').addEventListener('click', event => {
      const button = event.target.closest('.switch-node');
      if (!button || !state.dashboard) {
        return;
      }
      callAction(
        'switch-proxy',
        {
          selector: state.dashboard.proxies.selector || 'Proxy',
          proxy: button.dataset.node
        },
        '节点已切换'
      );
    });

    $('#delayAll').addEventListener('click', async () => {
      const names = getRows()
        .slice(0, 60)
        .map(row => row.name);
      if (!names.length) {
        toast(t('noDelayNodes'));
        return;
      }
      setLoading(true);
      try {
        const results = await panda.invoke('check-delays', { names });
        results.forEach(item => state.delays.set(item.name, item.delay));
        renderNodes();
        toast(t('delayDone'));
      } catch (error) {
        toast(error.message || String(error));
      } finally {
        setLoading(false);
      }
    });

    $('#importForm').addEventListener('submit', event => {
      event.preventDefault();
      const source = $('#subscriptionSource').value.trim();
      const button = $('#importForm button[type="submit"]');
      const originalText = button.textContent;
      button.textContent = t('importing');
      button.disabled = true;
      callAction('import-source', { source }, t('imported'))
        .then(() => {
          $('#subscriptionSource').value = '';
        })
        .finally(() => {
          button.textContent = originalText;
          button.disabled = false;
        });
    });

    $('#importFile').addEventListener('click', () => callAction('import-file', {}, t('fileImported')));
    $('#profileSelect').addEventListener('change', event => {
      if (event.target.value) {
        callAction('switch-profile', { id: event.target.value }, t('profileSwitched'));
      }
    });
    $('#saveBypass').addEventListener('click', () => {
      callAction('set-bypass-hosts', { text: $('#bypassHosts').value }, t('bypassSaved'));
    });

    $('#loginForm').addEventListener('submit', event => {
      event.preventDefault();
      callAction(
        'login',
        {
          base: $('#apiBase').value.trim(),
          username: $('#username').value.trim(),
          password: $('#password').value
        },
        t('loginDone')
      ).then(() => {
        $('#password').value = '';
      });
    });

    $('#refreshUser').addEventListener('click', () => {
      callAction('refresh-user', { base: $('#apiBase').value.trim() }, t('refreshedUser'));
    });

    $$('[data-test-url]').forEach(button => {
      button.addEventListener('click', () => runUrlTest(button.dataset.testUrl));
    });
    $('#detectIp').addEventListener('click', runIpTest);
    $('#testLan').addEventListener('click', runLanTest);
    $('#customTestForm').addEventListener('submit', event => {
      event.preventDefault();
      runUrlTest($('#customTestUrl').value.trim());
    });
  }

  function mockDashboard() {
    return {
      appName: 'SilverVPN',
      core: {
        running: true,
        binary: '/usr/local/bin/mihomo',
        control: 'http://127.0.0.1:4788',
        logTail: '[info] dashboard preview mode\n[info] proxy selector ready'
      },
      config: {
        dataDir: '/home/silver/.config/SilverVPN',
        activeConfigFile: '/home/silver/.config/SilverVPN/clash-configs/config.yaml',
        httpPort: 4780,
        socksPort: 4781,
        mode: 'Rule',
        modeLabel: '智能代理'
      },
      settings: {
        systemProxy: false,
        tunEnabled: false,
        language: state.language,
        defaultBypassHosts: ['localhost', '127.0.0.0/8', '192.168.0.0/16'],
        bypassHosts: ['gitlab.example.org'],
        currentProfileId: 'account-preview',
        currentSelector: 'Proxy',
        currentProxy: '香港 01'
      },
      tun: {
        available: true,
        active: false,
        conflicts: [],
        message: '预检通过，可以按需启用 TUN 模式。'
      },
      account: {
        auth: { username: 'preview@example.com', hasCookie: true },
        profile: { name: 'account subscription', proxyCount: 31, importedAt: new Date().toISOString() }
      },
      activeProfile: { id: 'account-preview', name: 'SilverVPN Account (preview@example.com)', proxyCount: 5, importedAt: new Date().toISOString() },
      subscriptions: [
        { id: 'account-preview', name: 'SilverVPN Account (preview@example.com)', kind: 'account', proxyCount: 5 },
        { id: 'custom-preview', name: 'Custom Subscription', kind: 'custom', proxyCount: 2 }
      ],
      proxies: {
        selector: 'Proxy',
        current: '香港 01',
        count: 5,
        rows: [
          { name: '香港 01', type: 'Vmess', selected: true },
          { name: '日本 02', type: 'SSR', selected: false },
          { name: '新加坡 03', type: 'Vmess', selected: false },
          { name: '美国 04', type: 'Vmess', selected: false },
          { name: '台湾 05', type: 'SSR', selected: false }
        ]
      }
    };
  }

  async function mockInvoke(action, payload) {
    if (!state.dashboard) {
      state.dashboard = mockDashboard();
    }
    if (action === 'set-mode') {
      state.dashboard.config.mode = payload.mode;
      state.dashboard.config.modeLabel = modeText(payload.mode);
      return state.dashboard;
    }
    if (action === 'set-language') {
      state.dashboard.settings.language = payload.language;
      return state.dashboard;
    }
    if (action === 'set-tun-mode') {
      const conflicts = normalizeTunConflicts(state.dashboard.tun.conflicts);
      if (payload.enabled && (state.dashboard.tun.available === false || conflicts.length)) {
        state.dashboard.settings.tunEnabled = false;
        state.dashboard.tun.active = false;
        return state.dashboard;
      }
      state.dashboard.settings.tunEnabled = Boolean(payload.enabled);
      state.dashboard.tun.active = Boolean(payload.enabled);
      state.dashboard.tun.message = payload.enabled
        ? 'TUN 正在接管需要路由的流量。'
        : '预检通过，可以按需启用 TUN 模式。';
      return state.dashboard;
    }
    if (action === 'set-bypass-hosts') {
      state.dashboard.settings.bypassHosts = String(payload.text || '').split(/\r?\n/).filter(Boolean);
      return state.dashboard;
    }
    if (action === 'switch-profile') {
      state.dashboard.activeProfile = state.dashboard.subscriptions.find(item => item.id === payload.id) || state.dashboard.activeProfile;
      state.dashboard.settings.currentProfileId = payload.id;
      return state.dashboard;
    }
    if (action === 'switch-proxy') {
      state.dashboard.proxies.current = payload.proxy;
      state.dashboard.settings.currentProxy = payload.proxy;
      state.dashboard.proxies.rows.forEach(row => {
        row.selected = row.name === payload.proxy;
      });
      return state.dashboard;
    }
    if (action === 'check-delays') {
      return (payload.names || []).map((name, index) => ({ name, delay: 96 + index * 47 }));
    }
    if (action === 'test-url') {
      return {
        ok: true,
        url: payload.url,
        httpCode: 200,
        remoteIp: '142.250.72.36',
        timeTotal: '0.218',
        proxy: 'http://127.0.0.1:4780'
      };
    }
    if (action === 'detect-ip') {
      return {
        ok: true,
        ip: '203.0.113.8',
        country: 'JP',
        region: 'Tokyo',
        city: 'Tokyo',
        org: 'Example Transit',
        source: 'ipinfo.io',
        proxy: 'http://127.0.0.1:4780'
      };
    }
    if (action === 'network-status') {
      return {
        checkedAt: new Date().toISOString(),
        silverVPN: {
          coreRunning: true,
          mode: state.dashboard.config.mode,
          selector: state.dashboard.proxies.selector,
          node: state.dashboard.proxies.current,
          httpProxy: '127.0.0.1:4780',
          socksProxy: '127.0.0.1:4781'
        },
        gnomeProxy: {
          mode: 'manual',
          http: '127.0.0.1:4780',
          ownedBySilverVPN: true
        },
        directEgress: { ok: true, ip: '198.51.100.21', country: 'CN', city: 'Beijing' },
        silverEgress: { ok: true, ip: '203.0.113.8', country: 'JP', city: 'Tokyo' },
        routes: { ipv4: 'default via 192.168.9.1 dev enp3s0' },
        tunnelInterfaces: [{ name: 'tun0', addresses: ['10.8.0.2'], tunnel: true }],
        listeningPorts: [
          { port: 4780, listening: true },
          { port: 4781, listening: true },
          { port: 4788, listening: true }
        ],
        conflicts: ['检测到隧道网卡：tun0']
      };
    }
    if (action === 'test-tcp') {
      return { ok: true, host: payload.host, port: payload.port, elapsedMs: 18 };
    }
    return state.dashboard;
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadDashboard(true);
    loadNetworkStatus(false);
    setInterval(() => loadDashboard(true), 10000);
    setInterval(() => loadNetworkStatus(false), 15000);
  });
})();
