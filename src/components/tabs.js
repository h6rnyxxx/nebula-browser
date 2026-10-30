const { ipcRenderer } = require('electron');
const autofill = require('../services/autofill');
const extensions = require('../services/extensions');
const historyComp = require('./history');
const bookmarksComp = require('./bookmarks');
const passwordsComp = require('./passwords');
const downloadsService = require('../services/downloads');

let tabs = [];
let activeTabId = null;
let closedTabs = [];

let floatingPlayer = null;
function getFloatingPlayer() {
    if (!floatingPlayer) {
        try {
            floatingPlayer = require('./floating-player');
        } catch (e) {}
    }
    return floatingPlayer;
}

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const GOOGLE_AUTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

function isGoogleAuthUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return (
        u.includes('accounts.google.') ||
        u.includes('myaccount.google.') ||
        u.includes('accounts.youtube.com') ||
        u.includes('google.com/signin') ||
        u.includes('google.com/accounts') ||
        u.includes('oauth2.googleapis.com')
    );
}

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
            if (t.isDormant) return t.url;
            try {
                const cur = t.view ? t.view.getURL() : null;
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
                    // Оптимизация восстановления: только активная (последняя) вкладка загружается сразу,
                    // а фоновые восстанавливаются в спящем (dormant) режиме. Это гарантирует мгновенный запуск
                    // без скачков памяти до 1.5 ГБ и без зависания стартового экрана!
                    const activeIndex = urls.length - 1;
                    urls.forEach((u, idx) => {
                        const isLazy = (idx !== activeIndex);
                        createNewTab(u, callbacks, { isLazy });
                    });
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

let lastMiddleUrl = '';
let lastMiddleTime = 0;
function safeOpenNewTab(targetUrl, callbacks) {
    if (!targetUrl || targetUrl.startsWith('javascript:') || targetUrl === 'about:blank') return;
    const now = Date.now();
    if (targetUrl === lastMiddleUrl && (now - lastMiddleTime) < 500) {
        return;
    }
    lastMiddleUrl = targetUrl;
    lastMiddleTime = now;
    createNewTab(targetUrl, callbacks);
}

function attachWebviewToTab(tabData, callbacks = {}) {
    const webviewContainer = document.getElementById('webview-container');
    const reloadIcon = document.getElementById('reload-icon');
    const tabEl = tabData.element;
    const tabId = tabData.id;
    const url = tabData.url;
    const isNewTab = tabData.isNewTab;

    if (tabData.view) return tabData.view;

    const isInitialGoogle = isGoogleAuthUrl(url);
    const initialUA = isInitialGoogle ? GOOGLE_AUTH_UA : CHROME_UA;

    const webview = document.createElement('webview');
    webview.className = 'browser-page';
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('useragent', initialUA);
    webview.setAttribute('webpreferences', 'contextIsolation=yes, nodeIntegration=no, sandbox=yes');
    webview.setAttribute('src', isNewTab ? 'about:blank' : url);

    webviewContainer?.appendChild(webview);
    tabData.view = webview;
    tabData.isDormant = false;

    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        if (e.url) {
            safeOpenNewTab(e.url, callbacks);
        }
    });

    webview.addEventListener('render-process-gone', (e) => {
        const reason = e.details?.reason;
        console.warn('Webview crash/gone:', reason, tabData.url);
        downloadsService.showNebulaNotification(
            `<i class="fa-solid fa-triangle-exclamation" style="color:#f87171;"></i> Вкладка была перезагружена (${reason || 'ошибка процесса'})`,
            4000
        );
        setTimeout(() => {
            try {
                if (tabData.view && tabData.url && tabData.url !== 'about:blank') {
                    tabData.view.reload();
                }
            } catch(err) {}
        }, 800);
    });

    webview.addEventListener('did-start-navigation', (e) => {
        // Управляем User-Agent исключительно для основного фрейма (mainFrame).
        // Вложенные iframes (about:blank, CheckConnection и т.д.) не должны переключать UA
        // всего вебвью, чтобы не вызывать прерывание навигации и бесконечный релоад!
        if (e.isMainFrame !== false) {
            const navUrl = e.url || '';
            const isGoogle = isGoogleAuthUrl(navUrl);
            if (isGoogle && tabData.currentUaMode !== 'google') {
                tabData.currentUaMode = 'google';
                webview.setUserAgent(GOOGLE_AUTH_UA);
            } else if (!isGoogle && tabData.currentUaMode !== 'chrome' && navUrl !== 'about:blank') {
                tabData.currentUaMode = 'chrome';
                webview.setUserAgent(CHROME_UA);
            }
        }
    });

    webview.addEventListener('enter-html-full-screen', () => ipcRenderer.send('set-fullscreen', true));
    webview.addEventListener('leave-html-full-screen', () => ipcRenderer.send('set-fullscreen', false));
    webview.addEventListener('context-menu', (e) => {
        const p = Object.assign({}, e.params || {});
        if (tabData.lastContextHint && (Date.now() - tabData.lastContextHint.time < 800)) {
            if (!p.srcURL && tabData.lastContextHint.imgUrl) {
                p.srcURL = tabData.lastContextHint.imgUrl;
                p.mediaType = 'image';
            }
            if (!p.linkURL && tabData.lastContextHint.linkUrl) {
                p.linkURL = tabData.lastContextHint.linkUrl;
            }
        }
        ipcRenderer.send('show-context-menu', p);
    });

    webview.addEventListener('did-start-loading', () => {
        tabData.isLoading = true;
        if (tabId === activeTabId && reloadIcon) reloadIcon.className = 'fa-solid fa-xmark';
    });

    webview.addEventListener('did-stop-loading', () => {
        tabData.isLoading = false;
        if (tabId === activeTabId && reloadIcon) reloadIcon.className = 'fa-solid fa-rotate-right';
        saveTabSession();
    });

    webview.addEventListener('media-started-playing', () => {
        tabData.isPlayingMedia = true;
        getFloatingPlayer()?.handleMediaStateChange(tabData, true);
    });

    webview.addEventListener('media-paused', () => {
        tabData.isPlayingMedia = false;
        getFloatingPlayer()?.handleMediaStateChange(tabData, false);
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

        if (typeof e.message === 'string' && e.message.startsWith('NEBULA_CONTEXT_HINT:')) {
            try {
                const hint = JSON.parse(e.message.substring('NEBULA_CONTEXT_HINT:'.length));
                tabData.lastContextHint = { ...hint, time: Date.now() };
            } catch(err) {}
        }

        if (typeof e.message === 'string' && e.message.startsWith('NEBULA_MEDIA_EVENT:')) {
            const evName = e.message.substring('NEBULA_MEDIA_EVENT:'.length);
            getFloatingPlayer()?.handleMediaStateChange(tabData, evName.includes('play'));
        }
    });

    let lastLoadedUrl = '';
    let lastLoadedTime = 0;
    const onPageLoaded = () => {
        const curUrl = tabData.url || '';
        const now = Date.now();
        if (curUrl === lastLoadedUrl && (now - lastLoadedTime < 700)) return;
        lastLoadedUrl = curUrl;
        lastLoadedTime = now;

        autofill.patchChromeEnvironment(webview, tabData.url);
        const passList = passwordsComp.getCachedPasswords();
        const autofillEnabled = localStorage.getItem('nebula_autofill_enabled') !== 'false';
        autofill.setupInteractiveAutofill(webview, tabData.url, passList, autofillEnabled);
        extensions.injectChromeStoreButton(webview, tabData.url);

        // Хук детекции изображений для контекстного меню
        webview.executeJavaScript(`
            if (!window.__nebula_context_hook) {
                window.__nebula_context_hook = true;
                window.addEventListener('contextmenu', function(e) {
                    var el = e.target;
                    var imgUrl = null;
                    var linkUrl = null;
                    var linkEl = el.closest('a');
                    if (linkEl && linkEl.href) linkUrl = linkEl.href;

                    if (el.tagName === 'IMG' && el.src) {
                        imgUrl = el.src;
                    } else if (el.tagName === 'VIDEO' && (el.currentSrc || el.src)) {
                        imgUrl = el.currentSrc || el.src;
                    } else {
                        var nested = el.querySelector('img') || (el.closest('picture') ? el.closest('picture').querySelector('img') : null);
                        if (nested && nested.src) {
                            imgUrl = nested.src;
                        } else {
                            var cur = el;
                            for (var i = 0; i < 4 && cur; i++) {
                                var bg = window.getComputedStyle(cur).backgroundImage;
                                if (bg && bg !== 'none') {
                                    var m = bg.match(/url\\(['"]?(.*?)['"]?\\)/i);
                                    if (m && m[1]) { imgUrl = m[1]; break; }
                                }
                                cur = cur.parentElement;
                            }
                        }
                    }
                    if (imgUrl || linkUrl) {
                        console.log('NEBULA_CONTEXT_HINT:' + JSON.stringify({ imgUrl: imgUrl, linkUrl: linkUrl }));
                    }
                }, true);
            }
        `).catch(() => {});

        // Хук отслеживания медиа (аудио и видео)
        webview.executeJavaScript(`
            if (!window.__nebula_media_hook) {
                window.__nebula_media_hook = true;
                ['play', 'playing', 'pause', 'ended'].forEach(function(ev) {
                    document.addEventListener(ev, function(e) {
                        if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
                            console.log('NEBULA_MEDIA_EVENT:' + ev);
                        }
                    }, true);
                });
            }
        `).catch(() => {});

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

        // Автопропуск рекламы и модалок на YouTube для мгновенного старта видео
        if (tabData.url && (tabData.url.includes('youtube.com') || tabData.url.includes('youtu.be'))) {
            webview.executeJavaScript(`
                if (!window.__nebula_yt_helper) {
                    window.__nebula_yt_helper = true;
                    setInterval(function() {
                        try {
                            // 1. Автоматическое скрытие согласия с куки (Cookie Consent)
                            var consentBtn = document.querySelector('button[aria-label*="Принять"], button[aria-label*="Accept"], ytd-button-renderer#action-button button, ytd-consent-bump-v2-lightbox button');
                            if (consentBtn && consentBtn.offsetParent !== null) {
                                consentBtn.click();
                            }

                            // 2. Мгновенный пропуск рекламы в видео без задержек и зависаний плеера
                            var skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
                            if (skipBtn) {
                                skipBtn.click();
                            } else {
                                var isAd = document.querySelector('.ad-showing, .ad-interrupting');
                                var vid = document.querySelector('video');
                                if (isAd && vid && !isNaN(vid.duration)) {
                                    vid.currentTime = vid.duration;
                                }
                            }
                        } catch (e) {}
                    }, 400);
                }
            `).catch(function() {});
        }
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
                try {
                    ipcRenderer.send('update-active-tab-info', { id: tabData.id, url: tabData.url, title: tabData.title });
                } catch(err) {}
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
                try {
                    ipcRenderer.send('update-active-tab-info', { id: tabData.id, url: tabData.url, title: tabData.title });
                } catch(err) {}
            }
            saveTabSession();
        }
    });

    return webview;
}

function createNewTab(url = 'nebula://newtab', callbacks = {}, options = {}) {
    const tabsContainer = document.getElementById('tabs-container');
    const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const isNewTab = (url === 'nebula://newtab');

    let initialTitle = isNewTab ? 'Начальная' : 'Вкладка';
    if (!isNewTab && url) {
        try {
            const parsed = new URL(url);
            initialTitle = parsed.hostname.replace(/^www\./, '');
        } catch (e) {
            initialTitle = 'Загрузка...';
        }
    }

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.setAttribute('draggable', 'true');
    tabEl.innerHTML = `
        <img class="tab-favicon ${isNewTab ? 'hidden' : ''}" src="" alt="">
        <i class="fa-solid fa-compass tab-icon-fallback ${isNewTab ? '' : 'hidden'}"></i>
        <span class="tab-title">${escapeHtml(initialTitle)}</span>
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

    tabEl.querySelector('.tab-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tabId, callbacks);
    });

    tabsContainer?.appendChild(tabEl);

    const isInitialGoogle = isGoogleAuthUrl(url);
    const tabData = {
        id: tabId,
        element: tabEl,
        view: null,
        url: url,
        title: initialTitle,
        isNewTab: isNewTab,
        isDormant: false,
        isPlayingMedia: false,
        isLoading: false,
        zoomLevel: 0,
        currentUaMode: isInitialGoogle ? 'google' : 'chrome'
    };
    tabs.push(tabData);

    if (options.isLazy && !isNewTab) {
        tabData.isDormant = true;
        tabEl.classList.add('dormant');
        return tabData;
    }

    attachWebviewToTab(tabData, callbacks);
    switchTab(tabId, callbacks);
    saveTabSession();
    return tabData;
}

function hibernateInactiveTabs() {
    let count = 0;
    tabs.forEach(t => {
        if (t.id !== activeTabId && !t.isNewTab && !t.isDormant && !t.isPlayingMedia && t.view) {
            try {
                t.view.stop();
                t.view.src = 'about:blank';
                t.view.remove();
            } catch (e) {}
            t.view = null;
            t.isDormant = true;
            t.element?.classList.add('dormant');
            count++;
        }
    });
    return count;
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
            if (t.isDormant) {
                t.isDormant = false;
                t.element.classList.remove('dormant');
                attachWebviewToTab(t, callbacks);
            }

            if (t.isNewTab) {
                startPage?.classList.remove('hidden');
                t.view?.classList.remove('active-page');
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
                t.view?.classList.add('active-page');
                if (urlInput) urlInput.value = t.url;
                bookmarksComp.updateBookmarkBtnState(t.url);
            }

            if (reloadIcon) {
                reloadIcon.className = t.isLoading ? 'fa-solid fa-xmark' : 'fa-solid fa-rotate-right';
            }
            updateDiscordStatus(t);
            try {
                ipcRenderer.send('update-active-tab-info', { id: t.id, url: t.url || '', title: t.title || '' });
            } catch(err) {}
        } else {
            t.element.classList.remove('active');
            t.view?.classList.remove('active-page');
        }
    });

    getFloatingPlayer()?.onActiveTabChanged(tabId);
}

function closeTab(tabId, callbacks = {}) {
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    getFloatingPlayer()?.onTabClosed(tabId);

    const [tabToRemove] = tabs.splice(index, 1);
    if (tabToRemove) {
        if (!tabToRemove.isNewTab && tabToRemove.url && tabToRemove.url !== 'about:blank' && !tabToRemove.url.startsWith('nebula://')) {
            closedTabs.push({ url: tabToRemove.url, title: tabToRemove.title });
            if (closedTabs.length > 25) closedTabs.shift();
        }

        if (tabToRemove.view) {
            try {
                tabToRemove.view.stop();
                tabToRemove.view.src = 'about:blank';
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

function reopenLastClosedTab(callbacks = {}) {
    if (!closedTabs || closedTabs.length === 0) {
        downloadsService.showNebulaNotification('<i class="fa-solid fa-clock-rotate-left"></i> Нет закрытых вкладок для восстановления', 2000);
        return null;
    }
    const last = closedTabs.pop();
    if (last && last.url) {
        return createNewTab(last.url, callbacks);
    }
    return null;
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

    if (activeTab.isDormant) {
        activeTab.isDormant = false;
        activeTab.element?.classList.remove('dormant');
        attachWebviewToTab(activeTab);
    }

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
    restoreOrStartTabs,
    hibernateInactiveTabs,
    reopenLastClosedTab
};
