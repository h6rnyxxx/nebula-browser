const { ipcRenderer } = require('electron');

const THEMES = {
    'nebula-purple': 'linear-gradient(180deg, #180f2d 0%, #2b174d 50%, #431f6a 100%)',
    'midnight-blue': 'linear-gradient(180deg, #090e17 0%, #101c30 50%, #162b4c 100%)',
    'sunset-mars': 'linear-gradient(180deg, #240c1d 0%, #4a1525 50%, #631c2d 100%)',
    'cyberpunk-neon': 'linear-gradient(180deg, #0d0221 0%, #19053b 50%, #0f3854 100%)',
    'emerald-forest': 'linear-gradient(180deg, #071a12 0%, #0d281e 50%, #164233 100%)',
    'matrix-dark': 'linear-gradient(180deg, #0a0a0a 0%, #111411 50%, #0f1c12 100%)',
    'cherry-blossom': 'linear-gradient(180deg, #1f0d1b 0%, #3b1432 50%, #521c45 100%)',
    'nordic-frost': 'linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%)'
};

let currentTheme = localStorage.getItem('nebula_theme') || 'nebula-purple';
let customBgData = localStorage.getItem('nebula_custom_bg') || null;

function applyTheme(themeKey) {
    if (!THEMES[themeKey]) themeKey = 'nebula-purple';
    currentTheme = themeKey;
    localStorage.setItem('nebula_theme', themeKey);

    document.querySelectorAll('.theme-card').forEach(c => {
        if (c.dataset.theme === themeKey) c.classList.add('active');
        else c.classList.remove('active');
    });

    applyBackground();
}

function applyBackground() {
    const startPage = document.getElementById('start-page');
    if (!startPage) return;

    if (customBgData) {
        startPage.style.backgroundImage = `url(${customBgData})`;
        startPage.style.backgroundSize = 'cover';
        startPage.style.backgroundPosition = 'center';
        startPage.style.backgroundRepeat = 'no-repeat';
    } else {
        startPage.style.backgroundImage = THEMES[currentTheme] || THEMES['nebula-purple'];
        startPage.style.backgroundSize = 'auto';
        startPage.style.backgroundPosition = '0% 0%';
    }
}

function setupCustomBackgroundHandlers() {
    const customBgInput = document.getElementById('custom-bg-input');
    const uploadBgBtn = document.getElementById('upload-bg-btn');
    const removeBgBtn = document.getElementById('remove-bg-btn');
    const customBgFilename = document.getElementById('custom-bg-filename');

    if (customBgData && removeBgBtn && customBgFilename) {
        removeBgBtn.classList.remove('hidden');
        customBgFilename.textContent = 'Пользовательские обои активны';
    }

    uploadBgBtn?.addEventListener('click', () => customBgInput?.click());

    customBgInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 15 * 1024 * 1024) {
            alert('Файл слишком большой. Выберите изображение размером до 15 МБ.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
            customBgData = evt.target.result;
            try {
                localStorage.setItem('nebula_custom_bg', customBgData);
            } catch (err) {
                alert('Не удалось сохранить обои в память: файл слишком тяжелый.');
                customBgData = null;
                return;
            }
            applyBackground();
            if (removeBgBtn) removeBgBtn.classList.remove('hidden');
            if (customBgFilename) customBgFilename.textContent = file.name;
        };
        reader.readAsDataURL(file);
    });

    removeBgBtn?.addEventListener('click', () => {
        customBgData = null;
        localStorage.removeItem('nebula_custom_bg');
        if (customBgInput) customBgInput.value = '';
        if (removeBgBtn) removeBgBtn.classList.add('hidden');
        if (customBgFilename) customBgFilename.textContent = '';
        applyBackground();
    });

    document.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
            if (customBgData && confirm('Сбросить ваши пользовательские обои и применить выбранную тему?')) {
                customBgData = null;
                localStorage.removeItem('nebula_custom_bg');
                if (removeBgBtn) removeBgBtn.classList.add('hidden');
                if (customBgFilename) customBgFilename.textContent = '';
            }
            applyTheme(card.dataset.theme);
        });
    });
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let perfTimer = null;
function startPerformanceMonitoring() {
    stopPerformanceMonitoring();
    updatePerformanceMetrics();
    perfTimer = setInterval(updatePerformanceMetrics, 1200);
}

function stopPerformanceMonitoring() {
    if (perfTimer) {
        clearInterval(perfTimer);
        perfTimer = null;
    }
}

async function updatePerformanceMetrics() {
    try {
        const data = await ipcRenderer.invoke('get-system-performance');
        if (!data) return;

        const cpuValEl = document.getElementById('perf-cpu-value');
        const cpuBarEl = document.getElementById('perf-cpu-bar');
        const cpuSubEl = document.getElementById('perf-cpu-sub');
        const ramValEl = document.getElementById('perf-ram-value');
        const ramBarEl = document.getElementById('perf-ram-bar');
        const ramSubEl = document.getElementById('perf-ram-sub');
        const procsCountEl = document.getElementById('perf-procs-count');
        const procsListEl = document.getElementById('perf-process-list');

        if (cpuValEl) cpuValEl.textContent = `${data.appCpuPercent}%`;
        if (cpuBarEl) {
            cpuBarEl.style.width = `${Math.min(100, Math.max(2, data.appCpuPercent))}%`;
            if (data.appCpuPercent > 60) cpuBarEl.style.background = '#ef4444';
            else if (data.appCpuPercent > 30) cpuBarEl.style.background = '#f59e0b';
            else cpuBarEl.style.background = 'linear-gradient(90deg, #6366f1, #a855f7)';
        }
        if (cpuSubEl) cpuSubEl.textContent = `${data.cpuModel} (${data.cpuCores} ядер)`;

        if (ramValEl) ramValEl.textContent = `${data.appMemoryMB} МБ`;
        if (ramBarEl) {
            const totalSysMB = parseFloat(data.totalSystemRAM_GB) * 1024;
            const ramPercent = totalSysMB > 0 ? Math.round((data.appMemoryMB / totalSysMB) * 100) : 5;
            ramBarEl.style.width = `${Math.min(100, Math.max(3, ramPercent))}%`;
        }
        if (ramSubEl) {
            const mainMB = data.mainProcMemoryMB ? `Главный: ${data.mainProcMemoryMB} МБ · ` : '';
            ramSubEl.textContent = `${mainMB}из ${data.totalSystemRAM_GB} ГБ (свободно ${data.freeSystemRAM_GB} ГБ)`;
        }

        if (procsCountEl) procsCountEl.textContent = data.processCount;

        if (procsListEl && Array.isArray(data.processes)) {
            procsListEl.innerHTML = data.processes.map(p => `
                <tr>
                    <td>
                        <span class="proc-type-badge ${p.rawType ? p.rawType.toLowerCase() : ''}">${escapeHtml(p.type)}</span>
                    </td>
                    <td class="mono-num">${p.pid}</td>
                    <td class="mono-num">${p.cpuPercent}%</td>
                    <td class="mono-num font-bold">${p.memoryMB} МБ</td>
                </tr>
            `).join('');
        }
    } catch (e) {}
}

function setupSettingsModal(callbacks = {}) {
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const autostartToggle = document.getElementById('setting-autostart-toggle');
    const startupSelect = document.getElementById('setting-startup-select');
    const searchSelect = document.getElementById('setting-search-select');
    const bookmarksToggle = document.getElementById('setting-bookmarks-toggle');
    const autofillToggle = document.getElementById('setting-autofill-toggle');
    const adblockToggle = document.getElementById('setting-adblock-toggle');
    const openStoreBtn = document.getElementById('open-extensions-store-btn');
    const checkUpdatesBtn = document.getElementById('check-updates-manual-btn');
    const clearAllDataBtn = document.getElementById('clear-all-data-btn');
    const clearCacheOnlyBtn = document.getElementById('clear-cache-only-btn');
    const aboutVersionDisplay = document.getElementById('about-version-display');

    const askDownloadToggle = document.getElementById('setting-ask-download-toggle');
    const downloadPathLabel = document.getElementById('setting-download-path-label');
    const chooseDownloadDirBtn = document.getElementById('setting-choose-download-dir-btn');

    closeSettingsBtn?.addEventListener('click', () => {
        stopPerformanceMonitoring();
        settingsModal?.classList.add('hidden');
    });

    // Навигация по вкладкам настроек
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetPane = document.getElementById('pane-' + tab.dataset.tab);
            targetPane?.classList.add('active');

            if (tab.dataset.tab === 'performance') {
                startPerformanceMonitoring();
            } else {
                stopPerformanceMonitoring();
            }
        });
    });

    // Настройки загрузок
    let currentCustomDownloadPath = localStorage.getItem('nebula_download_path') || '';
    let currentAskDownload = localStorage.getItem('nebula_ask_download') === 'true';

    if (askDownloadToggle) {
        askDownloadToggle.checked = currentAskDownload;
        askDownloadToggle.addEventListener('change', (e) => {
            currentAskDownload = e.target.checked;
            localStorage.setItem('nebula_ask_download', currentAskDownload ? 'true' : 'false');
            ipcRenderer.send('set-download-settings', {
                askWhereToSave: currentAskDownload,
                customPath: currentCustomDownloadPath
            });
        });
    }

    ipcRenderer.invoke('get-download-settings').then(cfg => {
        if (!currentCustomDownloadPath && cfg?.defaultPath) {
            if (downloadPathLabel) downloadPathLabel.textContent = cfg.defaultPath;
        } else if (currentCustomDownloadPath && downloadPathLabel) {
            downloadPathLabel.textContent = currentCustomDownloadPath;
        }
        ipcRenderer.send('set-download-settings', {
            askWhereToSave: currentAskDownload,
            customPath: currentCustomDownloadPath
        });
    }).catch(() => {});

    chooseDownloadDirBtn?.addEventListener('click', async () => {
        const chosen = await ipcRenderer.invoke('select-download-directory');
        if (chosen) {
            currentCustomDownloadPath = chosen;
            localStorage.setItem('nebula_download_path', chosen);
            if (downloadPathLabel) downloadPathLabel.textContent = chosen;
            ipcRenderer.send('set-download-settings', {
                askWhereToSave: currentAskDownload,
                customPath: currentCustomDownloadPath
            });
        }
    });

    // Очистить только кэш браузера
    clearCacheOnlyBtn?.addEventListener('click', async () => {
        clearCacheOnlyBtn.disabled = true;
        clearCacheOnlyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Очистка...';
        await ipcRenderer.invoke('clear-browser-cache');
        clearCacheOnlyBtn.disabled = false;
        clearCacheOnlyBtn.innerHTML = '<i class="fa-solid fa-check" style="color:#10b981;"></i> Кэш очищен!';
        setTimeout(() => {
            clearCacheOnlyBtn.innerHTML = '<i class="fa-solid fa-broom"></i> Очистить кэш';
        }, 2500);
    });

    // Автозапуск
    ipcRenderer.invoke('get-autostart-status').then(status => {
        if (autostartToggle) autostartToggle.checked = Boolean(status);
    }).catch(() => {});

    autostartToggle?.addEventListener('change', async (e) => {
        await ipcRenderer.invoke('set-autostart-status', e.target.checked);
    });

    // При запуске
    if (startupSelect) {
        startupSelect.value = localStorage.getItem('nebula_startup_action') || 'restore';
        startupSelect.addEventListener('change', (e) => {
            localStorage.setItem('nebula_startup_action', e.target.value);
        });
    }

    // Поисковик
    if (searchSelect) {
        searchSelect.value = localStorage.getItem('nebula_engine') || 'yandex';
        searchSelect.addEventListener('change', (e) => {
            localStorage.setItem('nebula_engine', e.target.value);
            if (callbacks.onSearchEngineChange) callbacks.onSearchEngineChange(e.target.value);
        });
    }

    // Панель закладок
    if (bookmarksToggle) {
        bookmarksToggle.checked = localStorage.getItem('nebula_bookmarks_visible') !== 'false';
        bookmarksToggle.addEventListener('change', (e) => {
            localStorage.setItem('nebula_bookmarks_visible', e.target.checked);
            const bar = document.getElementById('bookmarks-bar');
            if (bar) bar.style.display = e.target.checked ? 'flex' : 'none';
        });
    }

    // Автозаполнение
    if (autofillToggle) {
        autofillToggle.checked = localStorage.getItem('nebula_autofill_enabled') !== 'false';
        autofillToggle.addEventListener('change', (e) => {
            localStorage.setItem('nebula_autofill_enabled', e.target.checked);
        });
    }

    // AdBlock
    if (adblockToggle) {
        adblockToggle.checked = localStorage.getItem('nebula_adblock_enabled') !== 'false';
        adblockToggle.addEventListener('change', (e) => {
            localStorage.setItem('nebula_adblock_enabled', e.target.checked);
            ipcRenderer.send('toggle-adblock', e.target.checked);
            if (callbacks.onAdblockToggle) callbacks.onAdblockToggle(e.target.checked);
        });
    }

    // Магазин Chrome Web Store
    openStoreBtn?.addEventListener('click', () => {
        settingsModal?.classList.add('hidden');
        if (callbacks.onOpenStore) callbacks.onOpenStore();
    });

    // Проверка обновлений вручную
    checkUpdatesBtn?.addEventListener('click', () => {
        const statusEl = document.getElementById('manual-update-status');
        if (statusEl) statusEl.textContent = 'Проверка наличия обновлений...';
        ipcRenderer.send('manual-check-update');
    });

    // Очистить все данные
    clearAllDataBtn?.addEventListener('click', async () => {
        if (confirm('Вы уверены? Будут удалены кэш, куки, история и данные сессий.')) {
            ipcRenderer.send('clear-session-data');
            await ipcRenderer.invoke('db-clear-history');
            alert('Все данные сессии и история успешно очищены!');
        }
    });

    // Версия браузера
    ipcRenderer.invoke('get-app-version').then(ver => {
        if (aboutVersionDisplay) aboutVersionDisplay.textContent = `Версия ${ver}`;
    }).catch(() => {});

    
    // Настройки Discord RPC
    const discordToggle = document.getElementById('setting-discord-toggle');
    const discordDetailsToggle = document.getElementById('setting-discord-details-toggle');
    const discordTimerToggle = document.getElementById('setting-discord-timer-toggle');
    const discordClientIdInput = document.getElementById('setting-discord-client-id');
    const discordSaveIdBtn = document.getElementById('setting-discord-save-id-btn');
    const discordStatusEl = document.getElementById('discord-connection-status');

    function updateDiscordStatusUI(status) {
        if (!discordStatusEl) return;
        if (!status || !status.enabled) {
            discordStatusEl.innerHTML = '<i class="fa-solid fa-circle" style="font-size: 9px; color: #ef4444;"></i> Rich Presence отключен в настройках';
        } else if (status.connected) {
            const userName = status.user ? (status.user.global_name || status.user.username) : '';
            discordStatusEl.innerHTML = '<i class="fa-solid fa-circle" style="font-size: 9px; color: #10b981;"></i> Подключено к Discord ' + (userName ? '(<b>' + userName + '</b>)' : '');
        } else {
            discordStatusEl.innerHTML = '<i class="fa-solid fa-circle" style="font-size: 9px; color: #f59e0b;"></i> Ожидание запуска Discord...';
        }
    }

    if (discordToggle) {
        discordToggle.checked = localStorage.getItem('nebula_discord_enabled') !== 'false';
        discordToggle.addEventListener('change', (e) => {
            localStorage.setItem('nebula_discord_enabled', e.target.checked);
            ipcRenderer.send('discord-set-enabled', e.target.checked);
        });
    }

    if (discordDetailsToggle) {
        discordDetailsToggle.checked = localStorage.getItem('nebula_discord_details') !== 'false';
        discordDetailsToggle.addEventListener('change', (e) => {
            localStorage.setItem('nebula_discord_details', e.target.checked);
            ipcRenderer.send('discord-set-show-details', e.target.checked);
        });
    }

    if (discordTimerToggle) {
        discordTimerToggle.checked = localStorage.getItem('nebula_discord_timer') !== 'false';
        discordTimerToggle.addEventListener('change', (e) => {
            localStorage.setItem('nebula_discord_timer', e.target.checked);
            ipcRenderer.send('discord-set-show-timer', e.target.checked);
        });
    }

    if (discordClientIdInput) {
        const savedId = localStorage.getItem('nebula_discord_client_id') || '953533453100527626';
        discordClientIdInput.value = savedId;

        discordSaveIdBtn?.addEventListener('click', () => {
            const val = discordClientIdInput.value.trim() || '953533453100527626';
            localStorage.setItem('nebula_discord_client_id', val);
            ipcRenderer.send('discord-set-client-id', val);
            alert('Discord Client ID сохранен и применен!');
        });
    }

    ipcRenderer.invoke('discord-get-status').then(status => {
        updateDiscordStatusUI(status);
    }).catch(() => {});

    ipcRenderer.on('discord-status-changed', (event, status) => {
        updateDiscordStatusUI(status);
    });

    setupCustomBackgroundHandlers();
}

function openSettings(activeTabName = 'general') {
    const settingsModal = document.getElementById('settings-modal');
    if (!settingsModal) return;

    settingsModal.classList.remove('hidden');

    document.querySelectorAll('.settings-tab').forEach(t => {
        if (t.dataset.tab === activeTabName) t.classList.add('active');
        else t.classList.remove('active');
    });

    document.querySelectorAll('.settings-pane').forEach(p => {
        if (p.id === 'pane-' + activeTabName) p.classList.add('active');
        else p.classList.remove('active');
    });
}

module.exports = {
    THEMES,
    applyTheme,
    applyBackground,
    setupSettingsModal,
    openSettings
};
