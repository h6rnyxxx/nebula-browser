const { ipcRenderer } = require('electron');

let downloadsList = [];
try {
    const raw = localStorage.getItem('nebula_downloads');
    if (raw) downloadsList = JSON.parse(raw);
    if (!Array.isArray(downloadsList)) downloadsList = [];
} catch (e) {
    downloadsList = [];
}
const activeDownloadsMap = new Map();

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatEta(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `~${Math.max(1, seconds)} сек`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `~${mins} мин${secs > 10 ? ` ${secs} с` : ''}`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `~${hours} ч ${remMins} мин`;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getFileInfo(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (['exe', 'msi', 'bat', 'cmd'].includes(ext)) {
        return { icon: 'fa-solid fa-box', color: '#818cf8', bg: 'rgba(129, 140, 248, 0.15)' };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return { icon: 'fa-solid fa-file-zipper', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
        return { icon: 'fa-solid fa-file-image', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
    }
    if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) {
        return { icon: 'fa-solid fa-file-video', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' };
    }
    if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) {
        return { icon: 'fa-solid fa-file-audio', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' };
    }
    if (['pdf'].includes(ext)) {
        return { icon: 'fa-solid fa-file-pdf', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' };
    }
    if (['csv', 'xlsx', 'xls', 'json', 'txt', 'doc', 'docx'].includes(ext)) {
        return { icon: 'fa-solid fa-file-lines', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' };
    }
    return { icon: 'fa-solid fa-file', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)' };
}

function showNebulaNotification(htmlContent, duration = 4000) {
    const container = document.getElementById('downloads-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'download-toast';
    toast.innerHTML = htmlContent;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

function saveDownloadsToStorage() {
    localStorage.setItem('nebula_downloads', JSON.stringify(downloadsList));
}

let saveStorageTimeout = null;
function debouncedSaveDownloadsToStorage() {
    if (saveStorageTimeout) return;
    saveStorageTimeout = setTimeout(() => {
        saveStorageTimeout = null;
        saveDownloadsToStorage();
    }, 1500);
}

function findCardById(container, id) {
    if (!container || !id) return null;
    const cards = container.querySelectorAll('.dl-card-row');
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].dataset.id === id) return cards[i];
    }
    return null;
}

function updateNavDownloadsIndicator() {
    const btn = document.getElementById('downloads-btn');
    if (!btn) return;

    const activeList = Array.from(activeDownloadsMap.values()).filter(d => 
        d && (d.type === 'progressing' || d.type === 'started')
    );
    const count = activeList.length;

    let badge = btn.querySelector('.dl-nav-badge');
    if (count > 0) {
        btn.classList.add('downloading');
        btn.title = `Идёт загрузка: ${count} файл(ов)... (Ctrl+J)`;
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'dl-nav-badge';
            btn.appendChild(badge);
        }
        badge.textContent = count > 9 ? '9+' : count;
    } else {
        btn.classList.remove('downloading');
        btn.title = 'Загрузки (Ctrl+J)';
        if (badge) badge.remove();
    }
}

function getSingleCardHtml(d, index = 0) {
    const live = d.id ? activeDownloadsMap.get(d.id) : null;
    const isLive = Boolean(live);

    const received = isLive ? (live.receivedBytes || 0) : (d.receivedBytes || 0);
    const total = isLive ? (live.totalBytes || 0) : (d.totalBytes || 0);
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    const status = isLive ? (live.type || 'progressing') : (d.status || 'completed');
    const filename = d.filename || (d.path ? d.path.replace(/\\/g, '/').split('/').pop() : 'download');
    const fInfo = getFileInfo(filename);

    let badgeHtml = '<span class="dl-badge success"><i class="fa-solid fa-check"></i> Скачано</span>';
    let metaDetails = `${formatBytes(total)} • ${d.date || ''}`;

    if (status === 'progressing') {
        const speedStr = (live && live.speed > 0) ? `${formatBytes(live.speed)}/с` : '';
        const etaStr = live ? formatEta(live.etaSeconds) : '';
        badgeHtml = `<span class="dl-badge progress"><i class="fa-solid fa-arrow-down fa-bounce"></i> ${percent}%</span>`;
        metaDetails = `${formatBytes(received)} из ${formatBytes(total)} ${speedStr ? '• ' + speedStr : ''} ${etaStr ? '• ' + etaStr : ''}`;
    } else if (status === 'paused') {
        badgeHtml = `<span class="dl-badge paused"><i class="fa-solid fa-pause"></i> Пауза</span>`;
        metaDetails = `${formatBytes(received)} из ${formatBytes(total)}`;
    } else if (status === 'interrupted') {
        badgeHtml = `<span class="dl-badge paused"><i class="fa-solid fa-triangle-exclamation"></i> Прервано (нет сети)</span>`;
        metaDetails = `${formatBytes(received)} из ${formatBytes(total)} • Ожидание сети`;
    } else if (status === 'cancelled') {
        badgeHtml = `<span class="dl-badge error"><i class="fa-solid fa-xmark"></i> Отменено</span>`;
        metaDetails = `${formatBytes(total)}`;
    } else if (status === 'failed') {
        badgeHtml = `<span class="dl-badge error"><i class="fa-solid fa-circle-exclamation"></i> Ошибка</span>`;
        metaDetails = `${formatBytes(total)}`;
    }

    const safeId = escapeHtml(d.id || `dl_${index}`);
    const safePath = escapeHtml(d.path || '');

    return `
        <div class="dl-card-row" data-id="${safeId}" data-status-mode="${status}">
            <div class="dl-icon-box" style="background: ${fInfo.bg}; color: ${fInfo.color};">
                <i class="${fInfo.icon}"></i>
            </div>
            <div class="dl-info-box">
                <div class="dl-filename-line" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
                <div class="dl-meta-line">
                    ${badgeHtml}
                    <span>•</span>
                    <span class="dl-meta-details">${metaDetails}</span>
                </div>
                ${(status === 'progressing' || status === 'paused' || status === 'interrupted') ? `
                    <div class="dl-progress-track">
                        <div class="dl-progress-fill" style="width: ${percent}%; ${status === 'interrupted' ? 'background: linear-gradient(90deg, #f59e0b, #fbbf24);' : ''}"></div>
                    </div>
                ` : ''}
            </div>
            <div class="dl-actions-box">
                ${(status === 'progressing') ? `
                    <button class="dl-action-icon-btn pause-btn" data-id="${safeId}" title="Приостановить"><i class="fa-solid fa-pause"></i></button>
                    <button class="dl-action-icon-btn danger cancel-btn" data-id="${safeId}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
                ` : ''}
                ${(status === 'paused' || status === 'interrupted') ? `
                    <button class="dl-action-icon-btn resume-btn" data-id="${safeId}" title="Возобновить загрузку"><i class="fa-solid fa-rotate-right"></i></button>
                    <button class="dl-action-icon-btn danger cancel-btn" data-id="${safeId}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
                ` : ''}
                ${(status === 'completed') ? `
                    <button class="dl-action-pill-btn open-file-btn" data-path="${safePath}" title="Открыть файл">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Открыть
                    </button>
                    <button class="dl-action-icon-btn show-folder-btn" data-path="${safePath}" title="Показать в проводнике">
                        <i class="fa-solid fa-folder"></i>
                    </button>
                    <button class="dl-action-icon-btn danger remove-dl-item-btn" data-id="${safeId}" title="Удалить из списка">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                ` : ''}
                ${(status === 'cancelled' || status === 'failed') ? `
                    <button class="dl-action-icon-btn danger remove-dl-item-btn" data-id="${safeId}" title="Удалить из списка">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

function bindSingleCardEvents(card) {
    if (!card) return;

    card.querySelector('.pause-btn')?.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        ipcRenderer.send('pause-download', id);
    });

    card.querySelector('.resume-btn')?.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = downloadsList.find(d => d.id === id);
        ipcRenderer.send('resume-download', id, item ? {
            path: item.path,
            url: item.url,
            urlChain: item.urlChain,
            receivedBytes: item.receivedBytes,
            totalBytes: item.totalBytes,
            filename: item.filename
        } : undefined);
    });

    card.querySelector('.cancel-btn')?.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        ipcRenderer.send('cancel-download', id);
    });

    card.querySelector('.open-file-btn')?.addEventListener('click', (e) => {
        const p = e.currentTarget.dataset.path;
        ipcRenderer.send('open-file', p);
    });

    card.querySelector('.show-folder-btn')?.addEventListener('click', (e) => {
        const p = e.currentTarget.dataset.path;
        ipcRenderer.send('show-in-folder', p);
    });

    card.querySelector('.remove-dl-item-btn')?.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        card.style.opacity = '0';
        card.style.transform = 'translateX(15px)';
        setTimeout(() => {
            card.remove();
            const listContainer = document.getElementById('downloads-items-list');
            if (listContainer && listContainer.children.length === 0) {
                renderDownloadsItems([], listContainer);
            }
        }, 160);
        downloadsList = downloadsList.filter(item => item.id !== id);
        saveDownloadsToStorage();
        const headerBadge = document.querySelector('.pw-header .pw-badge');
        if (headerBadge) headerBadge.textContent = downloadsList.length;
        updateNavDownloadsIndicator();
    });
}

function updateLiveDownloadCard(card, data) {
    if (!card) return;

    const status = data.type || 'progressing';
    const total = data.totalBytes || 0;
    const received = data.receivedBytes || 0;
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : (data.percent || 0);

    const safeId = escapeHtml(data.id || '');
    const safePath = escapeHtml(data.path || '');

    // 1. Обновляем строку метаданных и бейдж статуса
    const metaLine = card.querySelector('.dl-meta-line');
    if (metaLine) {
        let badgeHtml = '';
        let metaDetails = '';

        if (status === 'progressing') {
            const speedStr = (data.speed > 0) ? `${formatBytes(data.speed)}/с` : '';
            const etaStr = formatEta(data.etaSeconds);
            badgeHtml = `<span class="dl-badge progress"><i class="fa-solid fa-arrow-down fa-bounce"></i> ${percent}%</span>`;
            metaDetails = `${formatBytes(received)} из ${formatBytes(total)} ${speedStr ? '• ' + speedStr : ''} ${etaStr ? '• ' + etaStr : ''}`;
        } else if (status === 'paused') {
            badgeHtml = `<span class="dl-badge paused"><i class="fa-solid fa-pause"></i> Пауза</span>`;
            metaDetails = `${formatBytes(received)} из ${formatBytes(total)}`;
        } else if (status === 'interrupted') {
            badgeHtml = `<span class="dl-badge paused"><i class="fa-solid fa-triangle-exclamation"></i> Прервано (нет сети)</span>`;
            metaDetails = `${formatBytes(received)} из ${formatBytes(total)} • Ожидание сети`;
        } else if (status === 'completed') {
            badgeHtml = `<span class="dl-badge success"><i class="fa-solid fa-check"></i> Скачано</span>`;
            metaDetails = `${formatBytes(total || received)} • ${new Date().toLocaleDateString('ru-RU')}`;
        } else if (status === 'cancelled') {
            badgeHtml = `<span class="dl-badge error"><i class="fa-solid fa-xmark"></i> Отменено</span>`;
            metaDetails = `${formatBytes(total)}`;
        } else if (status === 'failed') {
            badgeHtml = `<span class="dl-badge error"><i class="fa-solid fa-circle-exclamation"></i> Ошибка</span>`;
            metaDetails = `${formatBytes(total)}`;
        }

        metaLine.innerHTML = `
            ${badgeHtml}
            <span>•</span>
            <span class="dl-meta-details">${metaDetails}</span>
        `;
    }

    // 2. Обновляем полосу прогресса
    const infoBox = card.querySelector('.dl-info-box');
    let track = card.querySelector('.dl-progress-track');

    if (status === 'progressing' || status === 'paused' || status === 'interrupted') {
        if (!track && infoBox) {
            track = document.createElement('div');
            track.className = 'dl-progress-track';
            track.innerHTML = '<div class="dl-progress-fill"></div>';
            infoBox.appendChild(track);
        }
        if (track) {
            const fill = track.querySelector('.dl-progress-fill');
            if (fill) {
                fill.style.width = `${percent}%`;
                fill.style.background = (status === 'interrupted')
                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                    : '';
            }
        }
    } else {
        if (track) track.remove();
    }

    // 3. Обновляем кнопки действий при смене статуса
    const actionsBox = card.querySelector('.dl-actions-box');
    if (actionsBox && card.dataset.statusMode !== status) {
        card.dataset.statusMode = status;
        let actionsHtml = '';

        if (status === 'progressing') {
            actionsHtml = `
                <button class="dl-action-icon-btn pause-btn" data-id="${safeId}" title="Приостановить"><i class="fa-solid fa-pause"></i></button>
                <button class="dl-action-icon-btn danger cancel-btn" data-id="${safeId}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
            `;
        } else if (status === 'paused' || status === 'interrupted') {
            actionsHtml = `
                <button class="dl-action-icon-btn resume-btn" data-id="${safeId}" title="Возобновить загрузку"><i class="fa-solid fa-rotate-right"></i></button>
                <button class="dl-action-icon-btn danger cancel-btn" data-id="${safeId}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
            `;
        } else if (status === 'completed') {
            actionsHtml = `
                <button class="dl-action-pill-btn open-file-btn" data-path="${safePath}" title="Открыть файл">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Открыть
                </button>
                <button class="dl-action-icon-btn show-folder-btn" data-path="${safePath}" title="Показать в проводнике">
                    <i class="fa-solid fa-folder"></i>
                </button>
                <button class="dl-action-icon-btn danger remove-dl-item-btn" data-id="${safeId}" title="Удалить из списка">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
        } else if (status === 'cancelled' || status === 'failed') {
            actionsHtml = `
                <button class="dl-action-icon-btn danger remove-dl-item-btn" data-id="${safeId}" title="Удалить из списка">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
        }

        actionsBox.innerHTML = actionsHtml;
        bindSingleCardEvents(card);
    }
}

function insertLiveDownloadCard(listContainer, data) {
    if (!listContainer) return;

    const emptyState = listContainer.querySelector('.pw-empty-state');
    if (emptyState) emptyState.remove();

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = getSingleCardHtml(data, 0);
    const newCard = tempDiv.firstElementChild;
    if (newCard) {
        listContainer.insertBefore(newCard, listContainer.firstChild);
        bindSingleCardEvents(newCard);
    }

    const headerBadge = document.querySelector('.pw-header .pw-badge');
    if (headerBadge) {
        headerBadge.textContent = downloadsList.length;
    }
}

function updateLiveDownloadsModal(data) {
    const modalContainer = document.getElementById('modal-container');
    const listContainer = document.getElementById('downloads-items-list');

    if (!modalContainer || modalContainer.classList.contains('hidden') || !listContainer) {
        return;
    }

    const card = findCardById(listContainer, data.id);
    if (card) {
        updateLiveDownloadCard(card, data);
    } else {
        const filename = data.filename || '';
        const matches = !currentDownloadsSearch || filename.toLowerCase().includes(currentDownloadsSearch.toLowerCase());
        if (matches) {
            insertLiveDownloadCard(listContainer, data);
        }
    }

    const headerBadge = document.querySelector('.pw-header .pw-badge');
    if (headerBadge) {
        headerBadge.textContent = downloadsList.length;
    }
}

function handleDownloadEvent(data) {
    if (data.type === 'started') {
        activeDownloadsMap.set(data.id, data);
        const existingIdx = downloadsList.findIndex(d => d.id === data.id);
        const entry = {
            id: data.id,
            filename: data.filename,
            path: data.path,
            url: data.url,
            urlChain: data.urlChain,
            totalBytes: data.totalBytes,
            receivedBytes: data.receivedBytes || 0,
            status: 'progressing',
            isPaused: false,
            date: new Date().toLocaleDateString('ru-RU')
        };
        if (existingIdx !== -1) {
            downloadsList[existingIdx] = Object.assign(downloadsList[existingIdx], entry);
        } else {
            downloadsList.unshift(entry);
        }
        saveDownloadsToStorage();

        showNebulaNotification(`
            <i class="fa-solid fa-cloud-arrow-down" style="color: #818cf8; font-size: 18px;"></i>
            <div style="flex-grow:1; overflow:hidden;">
                <b style="display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(data.filename)}</b>
                <span style="font-size:12px; color:#a496c8;">Загрузка начата...</span>
            </div>
        `);
    } else if (data.type === 'progressing' || data.type === 'paused') {
        activeDownloadsMap.set(data.id, data);
        const item = downloadsList.find(d => d.id === data.id);
        if (item) {
            item.receivedBytes = data.receivedBytes;
            item.totalBytes = data.totalBytes;
            item.status = data.type;
            item.isPaused = data.isPaused;
            if (data.url) item.url = data.url;
            if (data.urlChain) item.urlChain = data.urlChain;
        }
        debouncedSaveDownloadsToStorage();
    } else if (data.type === 'interrupted') {
        activeDownloadsMap.set(data.id, data);
        const item = downloadsList.find(d => d.id === data.id);
        if (item) {
            item.status = 'interrupted';
            item.receivedBytes = data.receivedBytes;
            item.totalBytes = data.totalBytes;
            item.isPaused = false;
            if (data.url) item.url = data.url;
            if (data.urlChain) item.urlChain = data.urlChain;
        }
        saveDownloadsToStorage();

        showNebulaNotification(`
            <i class="fa-solid fa-triangle-exclamation" style="color: #fbbf24; font-size: 18px;"></i>
            <div style="flex-grow:1; overflow:hidden;">
                <b style="display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(data.filename)}</b>
                <span style="font-size:12px; color:#fbbf24;">Связь прервана. Нажмите «Возобновить» при подключении к сети.</span>
            </div>
        `, 6000);
    } else if (data.type === 'completed') {
        activeDownloadsMap.delete(data.id);
        const item = downloadsList.find(d => d.id === data.id);
        if (item) {
            item.status = 'completed';
            item.receivedBytes = data.totalBytes || (item.totalBytes || 0);
            item.isPaused = false;
        }
        saveDownloadsToStorage();

        showNebulaNotification(`
            <i class="fa-solid fa-circle-check" style="color: #34d399; font-size: 18px;"></i>
            <div style="flex-grow:1; overflow:hidden;">
                <b style="display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(data.filename)}</b>
                <span style="font-size:12px; color:#34d399;">Файл успешно скачан</span>
            </div>
        `, 6000);
    } else if (data.type === 'cancelled' || data.type === 'failed') {
        activeDownloadsMap.delete(data.id);
        const item = downloadsList.find(d => d.id === data.id);
        if (item) {
            item.status = data.type;
            item.isPaused = false;
        }
        saveDownloadsToStorage();
    }

    // Мгновенное обновление UI в реальном времени
    updateNavDownloadsIndicator();
    updateLiveDownloadsModal(data);
}

let currentDownloadsSearch = '';

function openDownloadsModal(searchTerm = '') {
    const modalContainer = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    if (!modalContainer || !modalBody) return;

    modalContainer.classList.remove('hidden');
    currentDownloadsSearch = searchTerm;

    const filtered = (downloadsList || []).filter(d => {
        if (!d || typeof d !== 'object') return false;
        if (!searchTerm) return true;
        return (d.filename || '').toLowerCase().includes(searchTerm.toLowerCase());
    });

    modalBody.innerHTML = `
        <div class="pw-header" style="margin-bottom: 14px;">
            <div class="pw-header-left">
                <div class="pw-title">
                    <i class="fa-solid fa-cloud-arrow-down pw-header-icon"></i>
                    <span>Загрузки</span>
                    <span class="pw-badge">${downloadsList.length}</span>
                </div>
                <div class="pw-subtitle">Список скачанных файлов и текущих загрузок браузера</div>
            </div>
            <div class="pw-header-actions">
                <button id="open-dl-folder-btn" class="modal-btn secondary" style="padding: 7px 14px; font-size: 12.5px;">
                    <i class="fa-solid fa-folder-open"></i> Папка загрузок
                </button>
                <button id="clear-downloads-btn" class="modal-btn danger" style="padding: 7px 14px; font-size: 12.5px;">
                    <i class="fa-solid fa-trash-can"></i> Очистить список
                </button>
            </div>
        </div>

        <div class="pw-search-bar" style="margin-bottom: 14px;">
            <i class="fa-solid fa-magnifying-glass pw-search-icon"></i>
            <input type="text" id="downloads-search-input" class="pw-search-input" placeholder="Поиск по имени файла..." value="${escapeHtml(searchTerm)}">
            ${searchTerm ? `<button id="clear-dl-search" class="pw-clear-search-btn" title="Сбросить"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>

        <div class="dl-list-container" id="downloads-items-list"></div>
    `;

    const listContainer = document.getElementById('downloads-items-list');
    renderDownloadsItems(filtered, listContainer);

    const searchInput = document.getElementById('downloads-search-input');
    searchInput?.focus();
    if (searchTerm) {
        searchInput.setSelectionRange(searchTerm.length, searchTerm.length);
    }

    searchInput?.addEventListener('input', (e) => {
        currentDownloadsSearch = e.target.value;
        const matches = downloadsList.filter(d => {
            if (!currentDownloadsSearch) return true;
            return (d.filename || '').toLowerCase().includes(currentDownloadsSearch.toLowerCase());
        });
        renderDownloadsItems(matches, listContainer);
    });

    document.getElementById('clear-dl-search')?.addEventListener('click', () => {
        openDownloadsModal('');
    });

    document.getElementById('open-dl-folder-btn')?.addEventListener('click', () => {
        ipcRenderer.send('open-downloads-folder');
    });

    document.getElementById('clear-downloads-btn')?.addEventListener('click', () => {
        downloadsList = downloadsList.filter(d => activeDownloadsMap.has(d.id));
        saveDownloadsToStorage();
        openDownloadsModal(searchTerm);
        updateNavDownloadsIndicator();
    });
}

function renderDownloadsItems(items, container) {
    if (!container) return;

    const safeItems = (Array.isArray(items) ? items : []).filter(d => d && typeof d === 'object');

    if (safeItems.length === 0) {
        if (currentDownloadsSearch) {
            container.innerHTML = `
                <div class="pw-empty-state">
                    <div class="pw-empty-icon-circle"><i class="fa-solid fa-magnifying-glass"></i></div>
                    <h3>Файлы не найдены</h3>
                    <p>По запросу «${escapeHtml(currentDownloadsSearch)}» ничего не найдено.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="pw-empty-state">
                    <div class="pw-empty-icon-circle"><i class="fa-solid fa-cloud-arrow-down"></i></div>
                    <h3>Список загрузок пуст</h3>
                    <p>Скачанные файлы и документы появятся в этом списке.</p>
                </div>
            `;
        }
        return;
    }

    container.innerHTML = safeItems.map((d, index) => {
        try {
            return getSingleCardHtml(d, index);
        } catch (err) {
            console.error('Error rendering download item:', err, d);
            return '';
        }
    }).join('');

    bindDownloadEvents(container);
}

function bindDownloadEvents(container) {
    if (!container) return;
    const cards = container.querySelectorAll('.dl-card-row');
    cards.forEach(card => bindSingleCardEvents(card));
}

// Автоматическое возобновление загрузок при смене или повторном подключении к сети
window.addEventListener('online', () => {
    const interruptedItems = (downloadsList || []).filter(d => d && d.status === 'interrupted');
    if (interruptedItems.length > 0) {
        showNebulaNotification(`
            <i class="fa-solid fa-wifi" style="color: #34d399; font-size: 18px;"></i>
            <div style="flex-grow:1; overflow:hidden;">
                <b style="display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">Сеть восстановлена!</b>
                <span style="font-size:12px; color:#34d399;">Возобновляем прерванные загрузки (${interruptedItems.length} ф.)...</span>
            </div>
        `, 5000);

        for (const item of interruptedItems) {
            ipcRenderer.send('resume-download', item.id, {
                path: item.path,
                url: item.url,
                urlChain: item.urlChain,
                receivedBytes: item.receivedBytes,
                totalBytes: item.totalBytes,
                filename: item.filename
            });
        }
    }
});

setTimeout(() => updateNavDownloadsIndicator(), 500);

module.exports = {
    formatBytes,
    formatEta,
    showNebulaNotification,
    handleDownloadEvent,
    openDownloadsModal,
    updateNavDownloadsIndicator
};
