const { ipcRenderer } = require('electron');

// Подключаем модули сервисов и компонентов
const dbService = require('./services/db');
const autofillService = require('./services/autofill');
const extensionsService = require('./services/extensions');
const downloadsService = require('./services/downloads');

const tabsComp = require('./components/tabs');
const bookmarksComp = require('./components/bookmarks');
const historyComp = require('./components/history');
const passwordsComp = require('./components/passwords');
const speedDialComp = require('./components/speed-dial');
const settingsComp = require('./components/settings');

// Элементы верхней панели и навигации
const appSplash = document.getElementById('app-splash');
const urlInput = document.getElementById('url-input');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const searchEngineSelect = document.getElementById('search-engine-select');

// Кнопки управления окном
const winMinBtn = document.getElementById('win-min-btn');
const winMaxBtn = document.getElementById('win-max-btn');
const winCloseBtn = document.getElementById('win-close-btn');
const winMaxIcon = document.getElementById('win-max-icon');

// Кнопки инструментов
const newTabBtn = document.getElementById('new-tab-btn');
const extensionsBtn = document.getElementById('extensions-btn');
const extensionsPopup = document.getElementById('extensions-popup');
const extensionsPopupList = document.getElementById('extensions-popup-list');
const closeExtPopupBtn = document.getElementById('close-ext-popup-btn');
const openWebstoreFromPopup = document.getElementById('open-webstore-from-popup');

const bookmarkCurrentBtn = document.getElementById('bookmark-current-btn');
const bookmarkPopover = document.getElementById('bookmark-popover');
const bookmarkSaveBtn = document.getElementById('bookmark-save-btn');
const bookmarkRemoveBtn = document.getElementById('bookmark-remove-btn');
const closeBookmarkPopoverBtn = document.getElementById('close-bookmark-popover-btn');

const downloadsBtn = document.getElementById('downloads-btn');
const adblockBtn = document.getElementById('adblock-btn');
const bookmarksBar = document.getElementById('bookmarks-bar');
const passwordsBtn = document.getElementById('passwords-btn');
const historyBtn = document.getElementById('history-btn');
const settingsNavBtn = document.getElementById('settings-nav-btn');
const customizeStartBtn = document.getElementById('customize-start-btn');

// Поиск на странице
const findBar = document.getElementById('find-in-page-bar');
const findInput = document.getElementById('find-input');
const findCounter = document.getElementById('find-counter');
const findPrevBtn = document.getElementById('find-prev-btn');
const findNextBtn = document.getElementById('find-next-btn');
const findCloseBtn = document.getElementById('find-close-btn');

// Баннер автообновления
const updateBanner = document.getElementById('update-banner');
const updateTitle = document.getElementById('update-title');
const updateSubtitle = document.getElementById('update-subtitle');
const updateActionBtn = document.getElementById('update-action-btn');
const updateCloseBtn = document.getElementById('update-close-btn');

const searchEngines = {
    google: { name: 'Google', search: 'https://www.google.com/search?q=' },
    yandex: { name: 'Яндекс', search: 'https://yandex.ru/search/?text=' },
    duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=' },
    bing: { name: 'Bing', search: 'https://www.bing.com/search?q=' },
    ecosia: { name: 'Ecosia', search: 'https://www.ecosia.org/search?q=' }
};

let currentEngineKey = localStorage.getItem('nebula_engine') || 'yandex';

function getCallbacks() {
    return {
        getCurrentEngineName: () => (searchEngines[currentEngineKey] || searchEngines['yandex']).name,
        onSearchEngineChange: (newKey) => {
            currentEngineKey = newKey;
            if (searchEngineSelect) searchEngineSelect.value = newKey;
        },
        onAdblockToggle: (state) => {
            if (adblockBtn) {
                if (state) {
                    adblockBtn.classList.add('active-tool');
                    adblockBtn.title = 'Блокировщик рекламы (AdBlock: ВКЛ)';
                } else {
                    adblockBtn.classList.remove('active-tool');
                    adblockBtn.title = 'Блокировщик рекламы (AdBlock: ВЫКЛ)';
                }
            }
        },
        onOpenStore: () => {
            tabsComp.createNewTab(extensionsService.CHROME_STORE_URL, getCallbacks());
        }
    };
}

async function init() {
    // 1. Миграция старых данных из localStorage в новую базу данных SQLite
    try {
        const oldHistory = JSON.parse(localStorage.getItem('nebula_history'));
        const oldPasswords = JSON.parse(localStorage.getItem('nebula_passwords'));
        if (oldHistory || oldPasswords) {
            await ipcRenderer.invoke('db-migrate-localstorage', {
                history: oldHistory,
                passwords: oldPasswords
            });
            localStorage.removeItem('nebula_history');
            localStorage.removeItem('nebula_passwords');
        }
    } catch (e) {}

    // 2. Инициализация тем и фонов
    settingsComp.applyTheme(localStorage.getItem('nebula_theme') || 'nebula-purple');

    // 3. Загрузка данных из SQLite
    await bookmarksComp.loadBookmarks();
    await passwordsComp.loadPasswords();
    await speedDialComp.loadSpeedDial();

    // 4. Отрисовка закладок и плиток
    const onNav = (url) => tabsComp.navigateTo(url, searchEngines, currentEngineKey);
    bookmarksComp.renderBookmarks(onNav);
    speedDialComp.renderSpeedDial(onNav);
    speedDialComp.setupSpeedDialModal(onNav);

    // 5. Видимость панели закладок
    const isBmVisible = localStorage.getItem('nebula_bookmarks_visible') !== 'false';
    if (bookmarksBar) bookmarksBar.style.display = isBmVisible ? 'flex' : 'none';

    // 6. Поисковик
    if (searchEngineSelect) {
        searchEngineSelect.value = currentEngineKey;
        searchEngineSelect.addEventListener('change', (e) => {
            currentEngineKey = e.target.value;
            localStorage.setItem('nebula_engine', e.target.value);
            const activeTab = tabsComp.getActiveTab();
            if (activeTab && activeTab.isNewTab && urlInput) {
                urlInput.placeholder = `Поиск в ${searchEngines[currentEngineKey].name} или ввод адреса...`;
            }
        });
    }

    // 7. Кнопки навигации
    backBtn?.addEventListener('click', () => {
        const t = tabsComp.getActiveTab();
        if (t && t.view && t.view.canGoBack()) t.view.goBack();
    });

    forwardBtn?.addEventListener('click', () => {
        const t = tabsComp.getActiveTab();
        if (t && t.view && t.view.canGoForward()) t.view.goForward();
    });

    reloadBtn?.addEventListener('click', () => {
        const t = tabsComp.getActiveTab();
        if (t && t.view) {
            if (t.isLoading) t.view.stop();
            else t.view.reload();
        }
    });

    urlInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            tabsComp.navigateTo(urlInput.value, searchEngines, currentEngineKey);
        }
    });

    urlInput?.addEventListener('focus', () => urlInput.select());

    // 8. Кнопки управления окном
    winMinBtn?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
    winMaxBtn?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
    winCloseBtn?.addEventListener('click', () => ipcRenderer.send('window-close'));

    // 9. Вкладки
    newTabBtn?.addEventListener('click', () => tabsComp.createNewTab('nebula://newtab', getCallbacks()));

    // 10. Кнопка и меню закладок
    bookmarkCurrentBtn?.addEventListener('click', () => {
        const active = tabsComp.getActiveTab();
        if (active) bookmarksComp.toggleBookmarkDialog(active, onNav);
    });

    bookmarkSaveBtn?.addEventListener('click', () => bookmarksComp.saveCustomBookmark(onNav));
    closeBookmarkPopoverBtn?.addEventListener('click', () => bookmarkPopover?.classList.add('hidden'));
    bookmarkRemoveBtn?.addEventListener('click', () => {
        const active = tabsComp.getActiveTab();
        if (active) bookmarksComp.removeBookmark(active.url, onNav);
    });

    // 11. Расширения
    extensionsBtn?.addEventListener('click', async () => {
        if (!extensionsPopup.classList.contains('hidden')) {
            extensionsPopup.classList.add('hidden');
            return;
        }
        extensionsPopup.classList.remove('hidden');
        const exts = await extensionsService.getInstalledExtensions();
        extensionsService.renderExtensionsList(exts, extensionsPopupList, (msg) => downloadsService.showNebulaNotification(msg));
    });

    closeExtPopupBtn?.addEventListener('click', () => extensionsPopup?.classList.add('hidden'));
    openWebstoreFromPopup?.addEventListener('click', () => {
        extensionsPopup?.classList.add('hidden');
        tabsComp.createNewTab(extensionsService.CHROME_STORE_URL, getCallbacks());
    });

    // 12. Модальные окна (Загрузки, Пароли, История, Настройки)
    downloadsBtn?.addEventListener('click', () => downloadsService.openDownloadsModal());
    passwordsBtn?.addEventListener('click', () => passwordsComp.openPasswordsModal((msg) => downloadsService.showNebulaNotification(msg)));
    historyBtn?.addEventListener('click', () => historyComp.openHistoryModal('', onNav));
    settingsNavBtn?.addEventListener('click', () => settingsComp.openSettings('general'));
    customizeStartBtn?.addEventListener('click', () => settingsComp.openSettings('appearance'));

    passwordsComp.setupPasswordCsvImport((msg) => downloadsService.showNebulaNotification(msg));
    settingsComp.setupSettingsModal(getCallbacks());

    // 13. Блокировщик рекламы
    const isAdblockOn = localStorage.getItem('nebula_adblock_enabled') !== 'false';
    ipcRenderer.send('toggle-adblock', isAdblockOn);
    adblockBtn?.addEventListener('click', () => {
        const current = localStorage.getItem('nebula_adblock_enabled') !== 'false';
        const next = !current;
        localStorage.setItem('nebula_adblock_enabled', next);
        ipcRenderer.send('toggle-adblock', next);
        getCallbacks().onAdblockToggle(next);
        downloadsService.showNebulaNotification(next ? '🛡️ AdBlock включен' : '🛡️ AdBlock отключен');
    });

    // 14. Закрытие универсального модального окна
    document.getElementById('close-modal')?.addEventListener('click', () => {
        document.getElementById('modal-container')?.classList.add('hidden');
    });

    document.getElementById('modal-container')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal-container') {
            document.getElementById('modal-container')?.classList.add('hidden');
        }
    });

    // 15. Поиск по странице (Find in page)
    setupFindInPage();

    // 16. Глобальные горячие клавиши
    setupGlobalShortcuts(onNav);

    // 17. Обработчики IPC от главного процесса
    setupIpcListeners();

    // 18. Восстановление вкладок
    tabsComp.restoreOrStartTabs(getCallbacks());

    // Плавное скрытие заставки сплеш-скрина
    setTimeout(() => {
        if (appSplash) {
            appSplash.classList.add('fade-out');
            setTimeout(() => appSplash.remove(), 550);
        }
    }, 600);
}

function setupFindInPage() {
    let lastSearchText = '';

    const executeFind = (forward = true) => {
        const active = tabsComp.getActiveTab();
        const text = findInput?.value.trim() || '';
        if (!active || !active.view || !text) {
            if (findCounter) findCounter.textContent = '';
            return;
        }
        if (text !== lastSearchText) {
            active.view.findInPage(text, { forward: true, findNext: false });
            lastSearchText = text;
        } else {
            active.view.findInPage(text, { forward, findNext: true });
        }
    };

    findInput?.addEventListener('input', () => executeFind(true));
    findNextBtn?.addEventListener('click', () => executeFind(true));
    findPrevBtn?.addEventListener('click', () => executeFind(false));
    findCloseBtn?.addEventListener('click', () => closeFindBar());

    const active = tabsComp.getActiveTab();
    if (active && active.view) {
        active.view.addEventListener('found-in-page', (e) => {
            if (findCounter) {
                if (e.result.matches > 0) {
                    findCounter.textContent = `${e.result.activeMatchOrdinal} из ${e.result.matches}`;
                } else {
                    findCounter.textContent = 'Не найдено';
                }
            }
        });
    }
}

function closeFindBar() {
    if (findBar) findBar.classList.add('hidden');
    const active = tabsComp.getActiveTab();
    if (active && active.view) {
        active.view.stopFindInPage('clearSelection');
    }
}

function setupGlobalShortcuts(onNav) {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 't') {
            e.preventDefault();
            tabsComp.createNewTab('nebula://newtab', getCallbacks());
        } else if (e.ctrlKey && e.key.toLowerCase() === 'w') {
            e.preventDefault();
            const active = tabsComp.getActiveTab();
            if (active) tabsComp.closeTab(active.id, getCallbacks());
        } else if (e.ctrlKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            const active = tabsComp.getActiveTab();
            if (active && active.view) active.view.reload();
        } else if (e.ctrlKey && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            historyComp.openHistoryModal('', onNav);
        } else if (e.ctrlKey && e.key.toLowerCase() === 'j') {
            e.preventDefault();
            downloadsService.openDownloadsModal();
        } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            if (findBar) {
                findBar.classList.remove('hidden');
                findInput?.focus();
                findInput?.select();
            }
        } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            urlInput?.focus();
            urlInput?.select();
        } else if (e.key === 'Escape') {
            document.getElementById('modal-container')?.classList.add('hidden');
            document.getElementById('settings-modal')?.classList.add('hidden');
            document.getElementById('add-tile-modal')?.classList.add('hidden');
            document.getElementById('bookmark-popover')?.classList.add('hidden');
            document.getElementById('extensions-popup')?.classList.add('hidden');
            closeFindBar();
        }
    });
}

function setupIpcListeners() {
    ipcRenderer.on('download-event', (event, data) => {
        downloadsService.handleDownloadEvent(data);
    });

    ipcRenderer.on('open-url-in-tab', (event, url) => {
        if (!url) return;
        const active = tabsComp.getActiveTab();
        if (active && active.view) {
            try {
                const curHost = new URL(active.view.getURL()).hostname;
                const newHost = new URL(url).hostname;
                if (curHost === newHost || url.includes('login') || url.includes('auth')) {
                    active.view.loadURL(url);
                    return;
                }
            } catch (e) {}
        }
        tabsComp.createNewTab(url, getCallbacks());
    });

    ipcRenderer.on('open-external-url', (event, url) => {
        if (url) tabsComp.createNewTab(url, getCallbacks());
    });

    ipcRenderer.on('window-max-changed', (event, isMax) => {
        if (winMaxIcon) {
            winMaxIcon.className = isMax ? 'fa-regular fa-clone' : 'fa-regular fa-square';
        }
        if (isMax) document.body.classList.add('maximized');
        else document.body.classList.remove('maximized');
    });

    ipcRenderer.on('exec-nav', (event, action) => {
        const active = tabsComp.getActiveTab();
        if (!active || !active.view) return;
        if (action === 'back' && active.view.canGoBack()) active.view.goBack();
        else if (action === 'forward' && active.view.canGoForward()) active.view.goForward();
        else if (action === 'reload') active.view.reload();
    });

    ipcRenderer.on('exec-devtools', () => {
        const active = tabsComp.getActiveTab();
        if (active && active.view) active.view.openDevTools();
    });

    ipcRenderer.on('updater-event', (event, data) => {
        const manualStatus = document.getElementById('manual-update-status');
        if (data.status === 'checking') {
            if (manualStatus) manualStatus.textContent = 'Проверка обновлений на GitHub...';
        } else if (data.status === 'available') {
            if (manualStatus) manualStatus.textContent = `Доступна новая версия v${data.version}!`;
            if (updateBanner) {
                updateBanner.classList.remove('hidden');
                if (updateTitle) updateTitle.textContent = `Доступно обновление Nebula v${data.version}!`;
                if (updateSubtitle) updateSubtitle.textContent = 'Скачивание обновления в фоне...';
            }
        } else if (data.status === 'downloading') {
            if (updateSubtitle) updateSubtitle.textContent = `Загрузка: ${data.percent}%`;
            if (manualStatus) manualStatus.textContent = `Загрузка обновления: ${data.percent}%`;
        } else if (data.status === 'ready') {
            if (manualStatus) manualStatus.textContent = 'Обновление готово к установке!';
            if (updateBanner) {
                updateBanner.classList.remove('hidden');
                if (updateTitle) updateTitle.textContent = 'Обновление готово!';
                if (updateSubtitle) updateSubtitle.textContent = 'Перезапустите браузер для завершения установки.';
                if (updateActionBtn) {
                    updateActionBtn.classList.remove('hidden');
                    updateActionBtn.onclick = () => ipcRenderer.send('restart-and-install-update');
                }
            }
        } else if (data.status === 'not-available') {
            if (manualStatus) manualStatus.textContent = 'У вас установлена самая актуальная версия Nebula.';
        } else if (data.status === 'error') {
            if (manualStatus) manualStatus.textContent = `Информация: ${data.error}`;
        }
    });

    updateCloseBtn?.addEventListener('click', () => updateBanner?.classList.add('hidden'));
}

document.addEventListener('DOMContentLoaded', init);
