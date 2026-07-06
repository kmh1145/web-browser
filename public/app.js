/* ═══════════════════════════════════════════
   WebTab Browser — App Logic
   ═══════════════════════════════════════════ */

;(function () {
  'use strict';

  // ─── Search Engines ───
  const ENGINES = [
    { id: 'google',    name: 'Google',    url: 'https://www.google.com/search?q=',         icon: 'https://www.google.com/favicon.ico' },
    { id: 'bing',      name: 'Bing',      url: 'https://www.bing.com/search?q=',           icon: 'https://www.bing.com/favicon.ico' },
    { id: 'baidu',     name: '百度',       url: 'https://www.baidu.com/s?wd=',              icon: 'https://www.baidu.com/favicon.ico' },
    { id: 'duckduckgo',name: 'DuckDuckGo',url: 'https://duckduckgo.com/?q=',               icon: 'https://duckduckgo.com/favicon.ico' },
    { id: 'yandex',    name: 'Yandex',    url: 'https://yandex.com/search/?text=',         icon: 'https://yandex.com/favicon.ico' },
    { id: 'searxng',   name: 'SearXNG',   url: 'https://searx.be/search?q=',               icon: 'https://searx.be/favicon.ico' },
  ];

  // ─── User-Agent Presets ───
  const UA_PRESETS = [
    { id: 'chrome-win',  name: 'Chrome (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    { id: 'chrome-mac',  name: 'Chrome (macOS)',   ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    { id: 'firefox-win', name: 'Firefox (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0' },
    { id: 'safari-mac',  name: 'Safari (macOS)',   ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15' },
    { id: 'edge-win',    name: 'Edge (Windows)',    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0' },
    { id: 'iphone',      name: 'iPhone',           ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1' },
    { id: 'android',     name: 'Android',          ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' },
    { id: 'googlebot',   name: 'Googlebot',        ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  ];

  // ─── Default Shortcuts ───
  const DEFAULT_SHORTCUTS = [
    { name: 'Google',    url: 'https://www.google.com' },
    { name: 'GitHub',    url: 'https://github.com' },
    { name: 'YouTube',   url: 'https://www.youtube.com' },
    { name: 'Twitter',   url: 'https://x.com' },
    { name: 'Wikipedia', url: 'https://www.wikipedia.org' },
    { name: 'Reddit',    url: 'https://www.reddit.com' },
    { name: 'Bilibili',  url: 'https://www.bilibili.com' },
    { name: '知乎',      url: 'https://www.zhihu.com' },
  ];

  // ─── State ───
  let state = {
    tabs: [],
    activeTabId: null,
    nextTabId: 1,
    settings: {
      engineId: 'google',
      customUA: '',
      activeUAPreset: '',
      zoom: 100,
      homepage: '',
      proxyEnabled: true,
    },
    bookmarks: [],
  };

  // ─── Load / Save ───
  function loadState() {
    try {
      const saved = localStorage.getItem('webtab-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        state.settings = { ...state.settings, ...parsed.settings };
        state.bookmarks = parsed.bookmarks || [];
      }
    } catch {}
  }
  function saveState() {
    try {
      localStorage.setItem('webtab-state', JSON.stringify({
        settings: state.settings,
        bookmarks: state.bookmarks,
      }));
    } catch {}
  }

  // ─── Helpers ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const getEngine = () => ENGINES.find(e => e.id === state.settings.engineId) || ENGINES[0];
  const getTab = (id) => state.tabs.find(t => t.id === id);

  function isUrl(str) {
    str = str.trim();
    if (/^https?:\/\//i.test(str)) return true;
    if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}(\/.*)?$/.test(str)) return true;
    if (/^localhost(:\d+)?(\/.*)?$/.test(str)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(str)) return true;
    return false;
  }

  function normalizeUrl(input) {
    input = input.trim();
    if (/^https?:\/\//i.test(input)) return input;
    if (isUrl(input)) return 'https://' + input;
    return getEngine().url + encodeURIComponent(input);
  }

  function getFaviconUrl(url) {
    try {
      const u = new URL(url);
      return `/favicon?domain=${encodeURIComponent(u.hostname)}`;
    } catch {
      return '';
    }
  }

  function getDomain(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  // ─── Tab Management ───
  function createTab(url = '', activate = true) {
    const id = state.nextTabId++;
    const tab = {
      id,
      title: '新标签页',
      url: '',
      history: [],
      historyIndex: -1,
      loading: false,
      pinned: false,
      zoom: state.settings.zoom,
    };
    state.tabs.push(tab);

    // Create iframe
    const container = $('#browser-content');
    const iframe = document.createElement('iframe');
    iframe.id = `iframe-${id}`;
    iframe.style.display = 'none';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
    iframe.referrerPolicy = 'no-referrer';
    container.appendChild(iframe);

    if (activate) switchTab(id);
    if (url) navigateTo(id, url);

    renderTabs();
    return id;
  }

  function closeTab(id) {
    const idx = state.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    // Remove iframe
    const iframe = $(`#iframe-${id}`);
    if (iframe) iframe.remove();

    state.tabs.splice(idx, 1);

    if (state.activeTabId === id) {
      if (state.tabs.length === 0) {
        createTab();
      } else {
        const nextIdx = Math.min(idx, state.tabs.length - 1);
        switchTab(state.tabs[nextIdx].id);
      }
    }
    renderTabs();
  }

  function switchTab(id) {
    const tab = getTab(id);
    if (!tab) return;

    // Hide all iframes, show target only if it has a URL
    state.tabs.forEach(t => {
      const iframe = $(`#iframe-${t.id}`);
      if (iframe) iframe.style.display = (t.id === id && t.url) ? 'block' : 'none';
    });

    state.activeTabId = id;

    // Update URL bar
    const urlBar = $('#url-bar');
    urlBar.value = tab.url || '';

    // Update navbar state
    $('#btn-bookmark').textContent = isBookmarked(tab.url) ? '★' : '☆';
    $('#btn-bookmark').style.color = isBookmarked(tab.url) ? '#ffd700' : '';

    // Update zoom display
    $('#btn-zoom').textContent = `${tab.zoom}%`;
    $('#zoom-value').textContent = `${tab.zoom}%`;

    // Show/hide NTP
    const ntp = $('#ntp');
    if (tab.url) {
      ntp.style.display = 'none';
    } else {
      ntp.style.display = 'flex';
    }

    // Security indicator
    if (tab.url && tab.url.startsWith('https://')) {
      $('#url-security').textContent = '🔒';
    } else if (tab.url) {
      $('#url-security').textContent = '🔓';
    } else {
      $('#url-security').textContent = '';
    }

    // Update title
    $('#window-title').textContent = tab.title || 'WebTab Browser';
    document.title = tab.title ? `${tab.title} — WebTab` : 'WebTab Browser';

    renderTabs();
  }

  function navigateTo(tabId, url) {
    const tab = getTab(tabId);
    if (!tab) return;

    const fullUrl = normalizeUrl(url);
    tab.url = fullUrl;
    tab.loading = true;

    // Push to history
    if (tab.historyIndex < tab.history.length - 1) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
    }
    tab.history.push(fullUrl);
    tab.historyIndex = tab.history.length - 1;

    // Load in iframe
    const iframe = $(`#iframe-${tabId}`);
    if (iframe) {
      iframe.style.display = 'block'; // Show iframe when navigating
      const uaParam = state.settings.customUA || '';

      if (state.settings.proxyEnabled) {
        iframe.src = `/proxy?url=${encodeURIComponent(fullUrl)}${uaParam ? '&ua=' + encodeURIComponent(uaParam) : ''}`;
        iframe.removeAttribute('data-direct-url');
        // Restore sandbox for proxy mode
        iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
      } else {
        // Direct mode — no proxy, use iframe directly
        iframe.src = fullUrl;
        iframe.setAttribute('data-direct-url', 'true');
        // Permissive sandbox for direct mode — allow everything needed for modern sites
        iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation allow-presentation';
      }

      // Hide NTP when navigating
      if (state.activeTabId === tabId) {
        $('#ntp').style.display = 'none';
      }
      iframe.onload = () => {
        tab.loading = false;
        // Try to get title
        try {
          const title = iframe.contentDocument?.title;
          if (title) {
            tab.title = title;
            if (state.activeTabId === tabId) {
              $('#window-title').textContent = title;
              document.title = `${title} — WebTab`;
            }
            renderTabs();
          }
        } catch {}
      };
      iframe.onerror = () => { tab.loading = false; };
    }

    if (state.activeTabId === tabId) {
      $('#url-bar').value = fullUrl;
      $('#ntp').style.display = 'none';
      $('#btn-bookmark').textContent = isBookmarked(fullUrl) ? '★' : '☆';
      $('#btn-bookmark').style.color = isBookmarked(fullUrl) ? '#ffd700' : '';
      if (fullUrl.startsWith('https://')) {
        $('#url-security').textContent = '🔒';
      } else {
        $('#url-security').textContent = '🔓';
      }
    }

    tab.title = getDomain(fullUrl) || '加载中...';
    renderTabs();
  }

  // ─── Render Tabs ───
  function renderTabs() {
    const container = $('#tabs-container');
    container.innerHTML = '';
    state.tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = `tab${tab.id === state.activeTabId ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`;
      el.dataset.tabId = tab.id;

      // Favicon
      if (tab.url) {
        const favicon = document.createElement('img');
        favicon.className = 'tab-favicon';
        favicon.src = getFaviconUrl(tab.url);
        favicon.onerror = () => {
          const letter = document.createElement('div');
          letter.className = 'tab-favicon-letter';
          letter.textContent = (tab.title || '?')[0].toUpperCase();
          favicon.replaceWith(letter);
        };
        el.appendChild(favicon);
      } else {
        const letter = document.createElement('div');
        letter.className = 'tab-favicon-letter';
        letter.textContent = '⊕';
        el.appendChild(letter);
      }

      // Title
      if (!tab.pinned) {
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title || '新标签页';
        el.appendChild(title);

        // Close button
        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '✕';
        close.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
        el.appendChild(close);
      }

      // Loading indicator
      if (tab.loading) {
        el.style.borderTop = '2px solid var(--accent)';
      } else {
        el.style.borderTop = '';
      }

      el.onclick = () => switchTab(tab.id);
      el.oncontextmenu = (e) => showTabContextMenu(e, tab.id);
      el.ondblclick = () => {
        if (!tab.pinned) {
          const url = prompt('输入网址:', tab.url || '');
          if (url) navigateTo(tab.id, url);
        }
      };

      // Drag & drop
      el.draggable = true;
      el.ondragstart = (e) => e.dataTransfer.setData('text/plain', tab.id);
      el.ondragover = (e) => e.preventDefault();
      el.ondrop = (e) => {
        e.preventDefault();
        const fromId = parseInt(e.dataTransfer.getData('text/plain'));
        const fromIdx = state.tabs.findIndex(t => t.id === fromId);
        const toIdx = state.tabs.findIndex(t => t.id === tab.id);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const [moved] = state.tabs.splice(fromIdx, 1);
          state.tabs.splice(toIdx, 0, moved);
          renderTabs();
        }
      };

      container.appendChild(el);
    });
  }

  // ─── Tab Context Menu ───
  let contextTabId = null;
  function showTabContextMenu(e, tabId) {
    e.preventDefault();
    contextTabId = tabId;
    const menu = $('#tab-context-menu');
    menu.style.display = 'block';
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 160)}px`;

    const tab = getTab(tabId);
    const pinItem = menu.querySelector('[data-action="pin"]');
    if (pinItem) pinItem.textContent = tab?.pinned ? '取消固定' : '固定标签页';
  }

  function hideContextMenu() {
    $('#tab-context-menu').style.display = 'none';
    contextTabId = null;
  }

  // ─── Bookmarks ───
  function isBookmarked(url) {
    return state.bookmarks.some(b => b.url === url);
  }

  function addBookmark(title, url) {
    if (isBookmarked(url)) return;
    state.bookmarks.push({ title, url, createdAt: Date.now() });
    saveState();
    renderBookmarkBar();
  }

  function removeBookmark(url) {
    state.bookmarks = state.bookmarks.filter(b => b.url !== url);
    saveState();
    renderBookmarkBar();
  }

  function renderBookmarkBar() {
    const bar = $('#bookmark-bar');
    bar.innerHTML = '';
    state.bookmarks.forEach(bm => {
      const el = document.createElement('div');
      el.className = 'bm-item';
      el.onclick = () => {
        const tab = getTab(state.activeTabId);
        if (tab && !tab.url) {
          navigateTo(tab.id, bm.url);
        } else {
          createTab(bm.url);
        }
      };

      const img = document.createElement('img');
      img.src = getFaviconUrl(bm.url);
      img.onerror = () => { img.style.display = 'none'; };
      el.appendChild(img);

      const span = document.createElement('span');
      span.textContent = bm.title;
      el.appendChild(span);

      bar.appendChild(el);
    });
  }

  function renderBookmarkManager() {
    const list = $('#bm-list');
    list.innerHTML = '';
    if (state.bookmarks.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;font-size:13px">暂无书签</div>';
      return;
    }
    state.bookmarks.forEach((bm, i) => {
      const el = document.createElement('div');
      el.className = 'bm-list-item';
      el.innerHTML = `
        <img src="${getFaviconUrl(bm.url)}" onerror="this.style.display='none'">
        <span class="bm-item-title">${escapeHtml(bm.title)}</span>
        <span class="bm-item-url">${escapeHtml(bm.url)}</span>
        <div class="bm-item-actions">
          <button class="bm-item-action" data-idx="${i}" data-action="goto" title="打开">↗</button>
          <button class="bm-item-action" data-idx="${i}" data-action="delete" title="删除">🗑</button>
        </div>
      `;
      list.appendChild(el);
    });

    // Event delegation
    list.onclick = (e) => {
      const btn = e.target.closest('.bm-item-action');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      if (action === 'goto') {
        createTab(state.bookmarks[idx].url);
        $('#bm-overlay').style.display = 'none';
      } else if (action === 'delete') {
        state.bookmarks.splice(idx, 1);
        saveState();
        renderBookmarkManager();
        renderBookmarkBar();
      }
    };
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  // ─── Settings ───
  function renderEngineGrid() {
    const grid = $('#engine-grid');
    grid.innerHTML = '';
    ENGINES.forEach(eng => {
      const card = document.createElement('div');
      card.className = `engine-card${eng.id === state.settings.engineId ? ' active' : ''}`;
      card.innerHTML = `<img src="${eng.icon}" onerror="this.style.display='none'"><span>${eng.name}</span>`;
      card.onclick = () => {
        state.settings.engineId = eng.id;
        saveState();
        renderEngineGrid();
        updateNTPSearch();
      };
      grid.appendChild(card);
    });
  }

  function renderUAPresets() {
    const container = $('#ua-presets');
    container.innerHTML = '';
    const nonePreset = document.createElement('div');
    nonePreset.className = `ua-preset${!state.settings.activeUAPreset && !state.settings.customUA ? ' active' : ''}`;
    nonePreset.textContent = '默认';
    nonePreset.onclick = () => {
      state.settings.customUA = '';
      state.settings.activeUAPreset = '';
      saveState();
      renderUAPresets();
      $('#ua-custom-input').value = '';
    };
    container.appendChild(nonePreset);

    UA_PRESETS.forEach(preset => {
      const el = document.createElement('div');
      el.className = `ua-preset${state.settings.activeUAPreset === preset.id ? ' active' : ''}`;
      el.textContent = preset.name;
      el.onclick = () => {
        state.settings.customUA = preset.ua;
        state.settings.activeUAPreset = preset.id;
        saveState();
        renderUAPresets();
        $('#ua-custom-input').value = preset.ua;
      };
      container.appendChild(el);
    });
  }

  function updateNTPSearch() {
    const engine = getEngine();
    $('#ntp-engine-icon').src = engine.icon;
    $('#ntp-engine-icon').onerror = function() { this.style.display = 'none'; };
    $('#ntp-engine-name').textContent = engine.name;
    $('#ntp-search-input').placeholder = `用 ${engine.name} 搜索或输入网址...`;
  }

  function renderNTPShortcuts() {
    const container = $('#ntp-shortcuts');
    container.innerHTML = '';
    DEFAULT_SHORTCUTS.forEach(sc => {
      const card = document.createElement('div');
      card.className = 'shortcut-card';
      card.onclick = () => {
        const tab = getTab(state.activeTabId);
        if (tab && !tab.url) {
          navigateTo(tab.id, sc.url);
        } else {
          createTab(sc.url);
        }
      };
      card.innerHTML = `
        <div class="shortcut-icon"><img src="${getFaviconUrl(sc.url)}" onerror="this.parentElement.textContent='🌐'"></div>
        <div class="shortcut-name">${escapeHtml(sc.name)}</div>
      `;
      container.appendChild(card);
    });
  }

  // ─── Engine Dropdown ───
  function showEngineDropdown() {
    const dropdown = $('#engine-dropdown');
    const selector = $('#ntp-engine-selector');
    const rect = selector.getBoundingClientRect();
    dropdown.style.display = 'block';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;

    const list = $('#engine-dropdown-list');
    list.innerHTML = '';
    ENGINES.forEach(eng => {
      const item = document.createElement('div');
      item.className = 'engine-dropdown-item';
      item.innerHTML = `<img src="${eng.icon}" onerror="this.style.display='none'"><span>${eng.name}</span>`;
      item.onclick = () => {
        state.settings.engineId = eng.id;
        saveState();
        updateNTPSearch();
        renderEngineGrid();
        dropdown.style.display = 'none';
      };
      list.appendChild(item);
    });
  }

  // ─── Zoom ───
  function setZoom(level) {
    level = Math.max(25, Math.min(300, level));
    const tab = getTab(state.activeTabId);
    if (tab) {
      tab.zoom = level;
      const iframe = $(`#iframe-${tab.id}`);
      if (iframe) {
        iframe.style.transform = `scale(${level / 100})`;
        iframe.style.transformOrigin = 'top left';
        iframe.style.width = `${10000 / level}%`;
        iframe.style.height = `${10000 / level}%`;
      }
    }
    state.settings.zoom = level;
    $('#btn-zoom').textContent = `${level}%`;
    $('#zoom-value').textContent = `${level}%`;
    $('#zoom-slider').value = level;
    $('#zoom-slider-value').textContent = `${level}%`;
    saveState();
  }

  // ─── Navigation History ───
  function goBack() {
    const tab = getTab(state.activeTabId);
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex--;
    const url = tab.history[tab.historyIndex];
    tab.url = url;
    tab.loading = true;
    const iframe = $(`#iframe-${tab.id}`);
    if (iframe) {
      const uaParam = state.settings.customUA || '';
      iframe.src = `/proxy?url=${encodeURIComponent(url)}${uaParam ? '&ua=' + encodeURIComponent(uaParam) : ''}`;
    }
    $('#url-bar').value = url;
    renderTabs();
  }

  function goForward() {
    const tab = getTab(state.activeTabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    tab.historyIndex++;
    const url = tab.history[tab.historyIndex];
    tab.url = url;
    tab.loading = true;
    const iframe = $(`#iframe-${tab.id}`);
    if (iframe) {
      const uaParam = state.settings.customUA || '';
      iframe.src = `/proxy?url=${encodeURIComponent(url)}${uaParam ? '&ua=' + encodeURIComponent(uaParam) : ''}`;
    }
    $('#url-bar').value = url;
    renderTabs();
  }

  function refresh() {
    const tab = getTab(state.activeTabId);
    if (!tab || !tab.url) return;
    tab.loading = true;
    const iframe = $(`#iframe-${tab.id}`);
    if (iframe) {
      const uaParam = state.settings.customUA || '';
      iframe.src = `/proxy?url=${encodeURIComponent(tab.url)}${uaParam ? '&ua=' + encodeURIComponent(uaParam) : ''}`;
    }
    renderTabs();
  }

  function goHome() {
    const tab = getTab(state.activeTabId);
    if (!tab) return;
    if (state.settings.homepage) {
      navigateTo(tab.id, state.settings.homepage);
    } else {
      tab.url = '';
      tab.title = '新标签页';
      const iframe = $(`#iframe-${tab.id}`);
      if (iframe) iframe.src = 'about:blank';
      $('#ntp').style.display = 'flex';
      $('#url-bar').value = '';
      $('#url-security').textContent = '';
      $('#window-title').textContent = 'WebTab Browser';
      document.title = 'WebTab Browser';
      renderTabs();
    }
  }

  // ─── Event Binding ───
  function bindEvents() {
    // Add tab
    $('#btn-add-tab').onclick = () => createTab();

    // Navigation
    $('#btn-back').onclick = goBack;
    $('#btn-forward').onclick = goForward;
    $('#btn-refresh').onclick = refresh;
    $('#btn-home').onclick = goHome;

    // URL bar
    const urlBar = $('#url-bar');
    urlBar.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const val = urlBar.value.trim();
        if (val) {
          const tab = getTab(state.activeTabId);
          if (tab) navigateTo(tab.id, val);
        }
      }
    };
    urlBar.onfocus = () => { urlBar.select(); };
    $('#btn-go').onclick = () => {
      const val = urlBar.value.trim();
      if (val) {
        const tab = getTab(state.activeTabId);
        if (tab) navigateTo(tab.id, val);
      }
    };

    // NTP Search
    const ntpInput = $('#ntp-search-input');
    ntpInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const val = ntpInput.value.trim();
        if (val) {
          const tab = getTab(state.activeTabId);
          if (tab) navigateTo(tab.id, val);
          ntpInput.value = '';
        }
      }
    };
    $('#ntp-search-btn').onclick = () => {
      const val = ntpInput.value.trim();
      if (val) {
        const tab = getTab(state.activeTabId);
        if (tab) navigateTo(tab.id, val);
        ntpInput.value = '';
      }
    };
    $('#ntp-engine-selector').onclick = (e) => {
      e.stopPropagation();
      const dd = $('#engine-dropdown');
      if (dd.style.display === 'block') {
        dd.style.display = 'none';
      } else {
        showEngineDropdown();
      }
    };

    // Proxy toggle
    function updateProxyButton() {
      const btn = $('#btn-proxy');
      if (state.settings.proxyEnabled) {
        btn.textContent = '🔄';
        btn.title = '代理模式：已开启（点击切换）';
        btn.style.color = 'var(--accent)';
      } else {
        btn.textContent = '🔗';
        btn.title = '直连模式：已开启（点击切换）';
        btn.style.color = 'var(--text-dim)';
      }
    }
    updateProxyButton();

    $('#btn-proxy').onclick = () => {
      state.settings.proxyEnabled = !state.settings.proxyEnabled;
      saveState();
      updateProxyButton();
      // Reload current tab if it has a URL
      const tab = getTab(state.activeTabId);
      if (tab && tab.url) {
        navigateTo(tab.id, tab.url);
      }
    };

    // Bookmark
    $('#btn-bookmark').onclick = () => {
      const tab = getTab(state.activeTabId);
      if (!tab || !tab.url) return;
      if (isBookmarked(tab.url)) {
        removeBookmark(tab.url);
      } else {
        addBookmark(tab.title || getDomain(tab.url), tab.url);
      }
      $('#btn-bookmark').textContent = isBookmarked(tab.url) ? '★' : '☆';
      $('#btn-bookmark').style.color = isBookmarked(tab.url) ? '#ffd700' : '';
    };

    // Zoom
    $('#btn-zoom').onclick = (e) => {
      e.stopPropagation();
      const ctrl = $('#zoom-controls');
      ctrl.style.display = ctrl.style.display === 'none' ? 'flex' : 'none';
    };
    $('#btn-zoom-in').onclick = () => {
      const tab = getTab(state.activeTabId);
      if (tab) setZoom(tab.zoom + 10);
    };
    $('#btn-zoom-out').onclick = () => {
      const tab = getTab(state.activeTabId);
      if (tab) setZoom(tab.zoom - 10);
    };
    $('#btn-zoom-reset').onclick = () => setZoom(100);
    $('#zoom-slider').oninput = (e) => setZoom(parseInt(e.target.value));

    // Settings
    $('#btn-settings').onclick = () => {
      $('#settings-overlay').style.display = 'flex';
      renderEngineGrid();
      renderUAPresets();
      $('#ua-custom-input').value = state.settings.customUA;
      $('#zoom-slider').value = state.settings.zoom;
      $('#zoom-slider-value').textContent = `${state.settings.zoom}%`;
      $('#homepage-input').value = state.settings.homepage;
    };
    $('#settings-close').onclick = () => { $('#settings-overlay').style.display = 'none'; };
    $('#settings-overlay').onclick = (e) => {
      if (e.target === $('#settings-overlay')) $('#settings-overlay').style.display = 'none';
    };
    $('#btn-ua-apply').onclick = () => {
      state.settings.customUA = $('#ua-custom-input').value;
      state.settings.activeUAPreset = '';
      saveState();
      renderUAPresets();
    };
    $('#btn-homepage-apply').onclick = () => {
      state.settings.homepage = $('#homepage-input').value.trim();
      saveState();
    };

    // Bookmark Manager
    $('#btn-bookmark-manager').onclick = () => {
      $('#bm-overlay').style.display = 'flex';
      renderBookmarkManager();
    };
    $('#bm-close').onclick = () => { $('#bm-overlay').style.display = 'none'; };
    $('#bm-overlay').onclick = (e) => {
      if (e.target === $('#bm-overlay')) $('#bm-overlay').style.display = 'none';
    };
    $('#btn-bm-add').onclick = () => {
      const title = $('#bm-add-title').value.trim();
      const url = $('#bm-add-url').value.trim();
      if (title && url) {
        addBookmark(title, url);
        $('#bm-add-title').value = '';
        $('#bm-add-url').value = '';
        renderBookmarkManager();
      }
    };

    // Context menu
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) hideContextMenu();
      if (!e.target.closest('.engine-dropdown') && !e.target.closest('#ntp-engine-selector')) {
        $('#engine-dropdown').style.display = 'none';
      }
      if (!e.target.closest('.zoom-controls') && !e.target.closest('#btn-zoom')) {
        $('#zoom-controls').style.display = 'none';
      }
    });

    // Context menu actions
    $('#tab-context-menu').onclick = (e) => {
      const item = e.target.closest('.context-item');
      if (!item || contextTabId === null) return;
      const action = item.dataset.action;
      const tab = getTab(contextTabId);
      if (!tab) return;

      switch (action) {
        case 'duplicate':
          createTab(tab.url);
          break;
        case 'pin':
          tab.pinned = !tab.pinned;
          renderTabs();
          break;
        case 'close':
          closeTab(contextTabId);
          break;
        case 'close-others':
          [...state.tabs].filter(t => t.id !== contextTabId).forEach(t => closeTab(t.id));
          break;
        case 'close-right': {
          const idx = state.tabs.findIndex(t => t.id === contextTabId);
          state.tabs.slice(idx + 1).forEach(t => closeTab(t.id));
          break;
        }
      }
      hideContextMenu();
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 't') { e.preventDefault(); createTab(); }
      if (ctrl && e.key === 'w') { e.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId); }
      if (ctrl && e.key === 'l') { e.preventDefault(); urlBar.focus(); urlBar.select(); }
      if (ctrl && e.key === 'r') { e.preventDefault(); refresh(); }
      if (ctrl && e.key === 'd') {
        e.preventDefault();
        const tab = getTab(state.activeTabId);
        if (tab && tab.url) {
          if (isBookmarked(tab.url)) removeBookmark(tab.url);
          else addBookmark(tab.title || getDomain(tab.url), tab.url);
          $('#btn-bookmark').textContent = isBookmarked(tab.url) ? '★' : '☆';
          $('#btn-bookmark').style.color = isBookmarked(tab.url) ? '#ffd700' : '';
        }
      }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
      if (ctrl && e.key === '=') { e.preventDefault(); const t = getTab(state.activeTabId); if (t) setZoom(t.zoom + 10); }
      if (ctrl && e.key === '-') { e.preventDefault(); const t = getTab(state.activeTabId); if (t) setZoom(t.zoom - 10); }
      if (ctrl && e.key === '0') { e.preventDefault(); setZoom(100); }
      // Tab switching: Ctrl+1..9
      if (ctrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (state.tabs[idx]) switchTab(state.tabs[idx].id);
      }
      if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
        const next = e.shiftKey ? (idx - 1 + state.tabs.length) % state.tabs.length : (idx + 1) % state.tabs.length;
        switchTab(state.tabs[next].id);
      }
    });

    // URL bar focus shortcut from anywhere
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F4' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
        // Ctrl+K is also a common search shortcut
      }
    });
  }

  // ─── Init ───
  function init() {
    loadState();
    updateNTPSearch();
    renderNTPShortcuts();
    renderBookmarkBar();
    bindEvents();
    createTab();
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
