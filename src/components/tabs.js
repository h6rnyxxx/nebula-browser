const { ipcRenderer } = require('electron');
const autofill = require('../services/autofill');
const extensions = require('../services/extensions');
const historyComp = require('./history');
const bookmarksComp = require('./bookmarks');
const passwordsComp = require('./passwords');
const downloadsService = require('../services/downloads');

let tabs = [];
let activeTabId = null;

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getTabs() {
    return tabs;
}


function updateDiscordStatus(tab) {
    try {
        if (!tab) {
            ipcRenderer.send('discord-update-presence', {
                isNewTab: true,
                title: 'Начальная страница',
                url: ''
            });
            return;
        }
        if (tab.isNewTab || !tab.url || tab.url === 'about:blank' || tab.url.startsWith('nebula://')) {
            ipcRenderer.send('discord-update-presence', {
                isNewTab: true,
                title: 'Начальная страница',
                url: ''
            });
        } else {
            ipcRenderer.send('discord-update-presence', {
                isNewTab: false,
                title: tab.title || '',
                url: tab.url || ''
            });
        }
    } catch (e) {}
}

function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
}


function syncTabsWithDom() {
    const tabsContainer = document.getElementById('tabs-container');
    if (!tabsContainer) return;
    const domTabs = Array.from(tabsContainer.querySelectorAll('.tab'));
    const reordered = [];
    domTabs.forEach(el => {
        const found = tabs.find(t => t.element === el);
        if (found) reordered.push(found);
    });
    if (reordered.length === tabs.length) {
        tabs.length = 0;
        tabs.push(...reordered);
        saveTabSession();
    }
}

function saveTabSession() {
    const startupAction = localStorage.getItem('nebula_startup_action') || 'restore';
    if (startupAction !== 'restore') return;

    const urlsToSave = tabs
        .map(t => {
            if (t.isNewTab) return 'nebula://newtab';
            try {
                const cur = t.view.getURL();
                return (cur && cur !== 'about:blank') ? cur : t.url;
            } catch (e) {
                return t.url;
            }
        })
        .filter(u => u && u !== 'about:blank');

    if (urlsToSave.length > 0) {
        localStorage.setItem('nebula_saved_session', JSON.stringify(urlsToSave));
    }
}

function restoreOrStartTabs(callbacks = {}) {
    const startupAction = localStorage.getItem('nebula_startup_action') || 'restore';
    let restored = false;

    if (startupAction === 'restore') {
        try {
            const raw = localStorage.getItem('nebula_saved_session');
            if (raw) {
                const urls = JSON.parse(raw);
                if (Array.isArray(urls) && urls.length > 0) {
                    urls.forEach(u => createNewTab(u, callbacks));
                    restored = true;
                }
            }
        } catch (e) {
            console.error('Ошибка восстановления сессии вкладок:', e);
        }
    }

    if (!restored) {
        createNewTab('nebula://newtab', callbacks);
    }
}

function createNewTab(url = 'nebula://newtab', callbacks = {}) {
    const tabsContainer = document.getElementById('tabs-container');
    const webviewContainer = document.getElementById('webview-container');
    const reloadIcon = document.getElementById('reload-icon');

    const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const isNewTab = (url === 'nebula://newtab');

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.setAttribute('draggable', 'true');
    tabEl.innerHTML = `
        <img class="tab-favicon ${isNewTab ? 'hidden' : ''}" src="" alt="">
        <i class="fa-solid fa-compass tab-icon-fallback ${isNewTab ? '' : 'hidden'}"></i>
        <span class="tab-title">${isNewTab ? 'Начальная' : 'Загрузка...'}</span>
        <button class="tab-close" title="Закрыть (Ctrl+W)"><i class="fa-solid fa-xmark"></i></button>
    `;

    // Перетаскивание вкладки (Drag & Drop)
    tabEl.addEventListener('dragstart', (e) => {
        if (e.target.closest('.tab-close')) {
            e.preventDefault();
            return;
        }
        tabEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tabId);
    });

    tabEl.addEventListener('dragend', () => {
        tabEl.classList.remove('dragging');
        syncTabsWithDom();
    });

    tabEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dragged = tabsContainer?.querySelector('.tab.dragging');
        if (!dragged || dragged === tabEl) return;

        const rect = tabEl.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
            tabsContainer.insertBefore(dragged, tabEl);
        } else {
            tabsContainer.insertBefore(dragged, tabEl.nextSibling);
        }
    });

    tabEl.addEventListener('drop', (e) => {
        e.preventDefault();
        syncTabsWithDom();
    });

    const webview = document.createElement('webview');
    webview.className = 'browser-page';
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('useragent', CHROME_UA);
    webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes');
    webview.setAttribute('src', isNewTab ? 'about:blank' : url);

    webviewContainer?.appendChild(webview);
    tabsContainer?.appendChild(tabEl);

    const tabData = {
        id: tabId,
        element: tabEl,
        view: webview,
        url: url,
        title: isNewTab ? 'Начальная' : 'Вкладка',
        isNewTab: isNewTab,
        isLoading: false,
        zoomLevel: 0
    };
    tabs.push(tabData);

    tabEl.addEventListener('click', (e) => {
        if (!e.target.closest('.tab-close')) switchTab(tabId, callbacks);
    });

    // Закрытие вкладки кликом на колесико (средняя кнопка мыши)
    tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            closeTab(tabId, callbacks);
        }
    });

    let lastMiddleUrl = '';
    let lastMiddleTime = 0;
    const safeOpenNewTab = (targetUrl) => {
        if (!targetUrl || targetUrl.startsWith('javascript:') || targetUrl === 'about:blank') return;
        const now = Date.now();
        if (targetUrl === lastMiddleUrl && (now - lastMiddleTime) < 500) {
            return;
        }
        lastMiddleUrl = targetUrl;
        lastMiddleTime = now;
        createNewTab(targetUrl, callbacks);
    };

    tabEl.querySelector('.tab-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tabId, callbacks);
    });

    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        if (e.url) {
            safeOpenNewTab(e.url);
        }
    });

    webview.addEventListener('enter-html-full-screen', () => ipcRenderer.send('set-fullscreen', true));
    webview.addEventListener('leave-html-full-screen', () => ipcRenderer.send('set-fullscreen', false));
    webview.addEventListener('context-menu', () => ipcRenderer.send('show-context-menu'));

    webview.addEventListener('did-start-loading', () => {
        tabData.isLoading = true;
        if (tabId === activeTabId && reloadIcon) reloadIcon.className = 'fa-solid fa-xmark';
    });

    webview.addEventListener('did-stop-loading', () => {
        tabData.isLoading = false;
        if (tabId === activeTabId && reloadIcon) reloadIcon.className = 'fa-solid fa-rotate-right';
        saveTabSession();
    });

    webview.addEventListener('console-message', async (e) => {
        if (e.message && e.message.startsWith('NEBULA_INSTALL_EXTENSION:')) {
            const extId = e.message.split(':')[1].trim();
            downloadsService.showNebulaNotification('<i class="fa-solid fa-puzzle-piece" style="color:#818cf8;"></i> Загрузка расширения...');

            const res = await ipcRenderer.invoke('install-extension-from-store', extId);
            if (res.success) {
                downloadsService.showNebulaNotification(`<i class="fa-solid fa-check" style="color:#34d399;"></i> Расширение <b>«${escapeHtml(res.name)}»</b> успешно установлено!`, 6000);
                webview.executeJavaScript(`
                    const buttons = document.querySelectorAll('button');
                    buttons.forEach(b => {
                        if (b.dataset.nebulaPatched) {
                            b.innerText = '✅ Установлено';
                            b.style.background = '#10b981';
                        }
                    });
                `).catch(() => {});
            } else {
                downloadsService.showNebulaNotification(`<i class="fa-solid fa-triangle-exclamation" style="color:#f43f5e;"></i> Ошибка установки: ${escapeHtml(res.error)}`, 6000);
            }
        }

        if (e.message === 'NEBULA_OPEN_PASSWORDS_MODAL') {
            passwordsComp.openPasswordsModal((msg) => downloadsService.showNebulaNotification(msg));
        }

        if (typeof e.message === 'string' && e.message.startsWith('NEBULA_OPEN_TAB:')) {
            const targetUrl = e.message.substring('NEBULA_OPEN_TAB:'.length).trim();
            if (targetUrl) {
                safeOpenNewTab(targetUrl);
            }
        }
    });

    const onPageLoaded = () => {
        autofill.patchChromeEnvironment(webview);
        const passList = passwordsComp.getCachedPasswords();
        const autofillEnabled = localStorage.getItem('nebula_autofill_enabled') !== 'false';
        autofill.setupInteractiveAutofill(webview, tabData.url, passList, autofillEnabled);
        extensions.injectChromeStoreButton(webview, tabData.url);

        // Перехват клика колесиком мыши по ссылке для открытия в новой вкладке
        webview.executeJavaScript(`
            if (!window.__nebula_middle_click_hook) {
                window.__nebula_middle_click_hook = true;
                window.addEventListener('auxclick', function(e) {
                    if (e.button === 1) {
                        var a = e.target.closest('a');
                        if (a && a.href && /^https?:\\/\\//i.test(a.href)) {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('NEBULA_OPEN_TAB:' + a.href);
                        }
                    }
                }, true);
            }
        `).catch(() => {});
    };

    webview.addEventListener('dom-ready', onPageLoaded);
    webview.addEventListener('did-finish-load', onPageLoaded);

    webview.addEventListener('page-favicon-updated', (e) => {
        if (e.favicons && e.favicons.length > 0 && !tabData.isNewTab) {
            const faviconImg = tabEl.querySelector('.tab-favicon');
            const fallbackIcon = tabEl.querySelector('.tab-icon-fallback');
            if (faviconImg) {
                faviconImg.src = e.favicons[0];
                faviconImg.classList.remove('hidden');
            }
            fallbackIcon?.classList.add('hidden');
        }
    });

    webview.addEventListener('page-title-updated', (e) => {
        if (!tabData.isNewTab && e.title) {
            const titleEl = tabEl.querySelector('.tab-title');
            if (titleEl) titleEl.textContent = e.title;
            tabData.title = e.title;
            saveTabSession();
            if (activeTabId === tabId) {
                updateDiscordStatus(tabData);
            }
        }
    });

    webview.addEventListener('did-navigate', (e) => {
        if (e.url !== 'about:blank') {
            tabData.url = e.url;
            tabData.isNewTab = false;
            if (activeTabId === tabId) {
                const urlInput = document.getElementById('url-input');
                if (urlInput) urlInput.value = e.url;
                bookmarksComp.updateBookmarkBtnState(e.url);
                document.getElementById('bookmark-popover')?.classList.add('hidden');
                updateDiscordStatus(tabData);
            }
            onPageLoaded();
            historyComp.addHistory(tabData.title || e.url, e.url);
            saveTabSession();
        }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        if (e.url !== 'about:blank') {
            tabData.url = e.url;
            if (activeTabId === tabId) {
                const urlInput = document.getElementById('url-input');
                if (urlInput) urlInput.value = e.url;
            }
            onPageLoaded();
            saveTabSession();
        }
    });

    switchTab(tabId, callbacks);
    saveTabSession();
    return tabData;
}

function switchTab(tabId, callbacks = {}) {
    activeTabId = tabId;
    const startPage = document.getElementById('start-page');
    const urlInput = document.getElementById('url-input');
    const bookmarkCurrentBtn = document.getElementById('bookmark-current-btn');
    const reloadIcon = document.getElementById('reload-icon');

    tabs.forEach(t => {
        if (t.id === tabId) {
            t.element.classList.add('active');
            if (t.isNewTab) {
                startPage?.classList.remove('hidden');
                t.view.classList.remove('active-page');
                if (urlInput) {
                    urlInput.value = '';
                    if (callbacks.getCurrentEngineName) {
                        urlInput.placeholder = `Поиск в ${callbacks.getCurrentEngineName()} или ввод адреса...`;
                    } else {
                        urlInput.placeholder = 'Поиск или ввод веб-адреса...';
                    }
                }
                bookmarkCurrentBtn?.classList.remove('bookmarked');
            } else {
                startPage?.classList.add('hidden');
                t.view.classList.add('active-page');
                if (urlInput) urlInput.value = t.url;
                bookmarksComp.updateBookmarkBtnState(t.url);
            }

            if (reloadIcon) {
                reloadIcon.className = t.isLoading ? 'fa-solid fa-xmark' : 'fa-solid fa-rotate-right';
            }
            updateDiscordStatus(t);
        } else {
            t.element.classList.remove('active');
            t.view.classList.remove('active-page');
        }
    });
}

function closeTab(tabId, callbacks = {}) {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const [tabToRemove] = tabs.splice(index, 1);
    if (tabToRemove) {
        if (tabToRemove.view) {
            try {
                tabToRemove.view.stop();
                tabToRemove.view.loadURL('about:blank');
            } catch (e) {}
            tabToRemove.view.remove();
            tabToRemove.view = null;
        }
        if (tabToRemove.element) {
            tabToRemove.element.remove();
            tabToRemove.element = null;
        }
    }

    if (activeTabId === tabId) {
        if (tabs.length > 0) {
            const nextIndex = Math.max(0, index - 1);
            switchTab(tabs[nextIndex].id, callbacks);
        } else {
            createNewTab('nebula://newtab', callbacks);
        }
    }
    saveTabSession();
}

function navigateTo(input, searchEngines, currentEngineKey) {
    const activeTab = getActiveTab();
    if (!activeTab || !input) return;

    let targetUrl = input.trim();
    const hasProtocol = /^https?:\/\//i.test(targetUrl);
    const hasDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(targetUrl) && !targetUrl.includes(' ');

    if (hasProtocol) {
        // Оставляем как есть
    } else if (hasDomain) {
        targetUrl = 'https://' + targetUrl;
    } else {
        const engine = searchEngines[currentEngineKey] || searchEngines['yandex'];
        targetUrl = engine.search + encodeURIComponent(targetUrl);
    }

    activeTab.url = targetUrl;
    activeTab.isNewTab = false;

    const faviconImg = activeTab.element.querySelector('.tab-favicon');
    const fallbackIcon = activeTab.element.querySelector('.tab-icon-fallback');
    const titleEl = activeTab.element.querySelector('.tab-title');

    faviconImg?.classList.add('hidden');
    fallbackIcon?.classList.remove('hidden');
    if (titleEl) titleEl.textContent = 'Загрузка...';

    activeTab.view.loadURL(targetUrl);
    document.getElementById('start-page')?.classList.add('hidden');
    activeTab.view.classList.add('active-page');
    updateDiscordStatus(activeTab);

    saveTabSession();
}

module.exports = {
    getTabs,
    getActiveTab,
    createNewTab,
    switchTab,
    closeTab,
    navigateTo,
    saveTabSession,
    restoreOrStartTabs
};
