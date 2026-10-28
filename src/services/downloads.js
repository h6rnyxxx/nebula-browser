const { ipcRenderer } = require('electron');

let downloadsList = JSON.parse(localStorage.getItem('nebula_downloads')) || [];
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

function handleDownloadEvent(data) {
    if (data.type === 'started') {
        activeDownloadsMap.set(data.id, data);
        downloadsList.unshift({
            id: data.id,
            filename: data.filename,
            path: data.path,
            totalBytes: data.totalBytes,
            receivedBytes: 0,
            status: 'progressing',
            isPaused: false,
            date: new Date().toLocaleDateString('ru-RU')
        });
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
        }
    } else if (data.type === 'completed') {
        activeDownloadsMap.delete(data.id);
        const item = downloadsList.find(d => d.id === data.id);
        if (item) {
            item.status = 'completed';
            item.receivedBytes = data.totalBytes;
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
    } else if (data.type === 'interrupted' || data.type === 'cancelled' || data.type === 'failed') {
        activeDownloadsMap.delete(data.id);
        const item = downloadsList.find(d => d.id === data.id);
        if (item) {
            item.status = data.type;
            item.isPaused = false;
        }
        saveDownloadsToStorage();
    }
}

let currentDownloadsSearch = '';

function openDownloadsModal(searchTerm = '') {
    const modalContainer = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    if (!modalContainer || !modalBody) return;

    modalContainer.classList.remove('hidden');
    currentDownloadsSearch = searchTerm;

    const filtered = downloadsList.filter(d => {
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
    });
}

function renderDownloadsItems(items, container) {
    if (!container) return;

    if (!items || items.length === 0) {
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

    container.innerHTML = items.map((d, index) => {
        const live = activeDownloadsMap.get(d.id);
        const isLive = Boolean(live);

        const received = isLive ? live.receivedBytes : (d.receivedBytes || 0);
        const total = isLive ? live.totalBytes : (d.totalBytes || 0);
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        const status = isLive ? live.type : (d.status || 'completed');
        const fInfo = getFileInfo(d.filename);

        let badgeHtml = '<span class="dl-badge success"><i class="fa-solid fa-check"></i> Скачано</span>';
        let metaDetails = `${formatBytes(total)} • ${d.date || ''}`;

        if (status === 'progressing') {
            const speedStr = live.speed > 0 ? `${formatBytes(live.speed)}/с` : '';
            const etaStr = formatEta(live.etaSeconds);
            badgeHtml = `<span class="dl-badge progress"><i class="fa-solid fa-arrow-down fa-bounce"></i> ${percent}%</span>`;
            metaDetails = `${formatBytes(received)} из ${formatBytes(total)} ${speedStr ? '• ' + speedStr : ''} ${etaStr ? '• ' + etaStr : ''}`;
        } else if (status === 'paused') {
            badgeHtml = `<span class="dl-badge paused"><i class="fa-solid fa-pause"></i> Пауза</span>`;
            metaDetails = `${formatBytes(received)} из ${formatBytes(total)}`;
        } else if (status === 'cancelled') {
            badgeHtml = `<span class="dl-badge error"><i class="fa-solid fa-xmark"></i> Отменено</span>`;
            metaDetails = `${formatBytes(total)}`;
        } else if (status === 'interrupted' || status === 'failed') {
            badgeHtml = `<span class="dl-badge error"><i class="fa-solid fa-circle-exclamation"></i> Ошибка</span>`;
            metaDetails = `${formatBytes(total)}`;
        }

        return `
            <div class="dl-card-row" data-id="${d.id}" data-index="${index}">
                <div class="dl-icon-box" style="background: ${fInfo.bg}; color: ${fInfo.color};">
                    <i class="${fInfo.icon}"></i>
                </div>
                <div class="dl-info-box">
                    <div class="dl-filename-line" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</div>
                    <div class="dl-meta-line">
                        ${badgeHtml}
                        <span>•</span>
                        <span>${metaDetails}</span>
                    </div>
                    ${(status === 'progressing' || status === 'paused') ? `
                        <div class="dl-progress-track">
                            <div class="dl-progress-fill" style="width: ${percent}%;"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="dl-actions-box">
                    ${(status === 'progressing') ? `
                        <button class="dl-action-icon-btn pause-btn" data-id="${d.id}" title="Приостановить"><i class="fa-solid fa-pause"></i></button>
                        <button class="dl-action-icon-btn danger cancel-btn" data-id="${d.id}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
                    ` : ''}
                    ${(status === 'paused') ? `
                        <button class="dl-action-icon-btn resume-btn" data-id="${d.id}" title="Продолжить"><i class="fa-solid fa-play"></i></button>
                        <button class="dl-action-icon-btn danger cancel-btn" data-id="${d.id}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
                    ` : ''}
                    ${(status === 'completed') ? `
                        <button class="dl-action-pill-btn open-file-btn" data-path="${escapeHtml(d.path)}" title="Открыть файл">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i> Открыть
                        </button>
                        <button class="dl-action-icon-btn show-folder-btn" data-path="${escapeHtml(d.path)}" title="Показать в проводнике">
                            <i class="fa-solid fa-folder"></i>
                        </button>
                        <button class="dl-action-icon-btn danger remove-dl-item-btn" data-id="${d.id}" title="Удалить из списка">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    ` : ''}
                    ${(status === 'cancelled' || status === 'interrupted' || status === 'failed') ? `
                        <button class="dl-action-icon-btn danger remove-dl-item-btn" data-id="${d.id}" title="Удалить из списка">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    bindDownloadEvents(container);
}

function bindDownloadEvents(container) {
    container.querySelectorAll('.pause-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('pause-download', b.dataset.id));
    });
    container.querySelectorAll('.resume-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('resume-download', b.dataset.id));
    });
    container.querySelectorAll('.cancel-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('cancel-download', b.dataset.id));
    });
    container.querySelectorAll('.open-file-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('open-file', b.dataset.path));
    });
    container.querySelectorAll('.show-folder-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('show-in-folder', b.dataset.path));
    });
    container.querySelectorAll('.remove-dl-item-btn').forEach(b => {
        b.addEventListener('click', (e) => {
            const card = e.target.closest('.dl-card-row');
            if (card) {
                card.style.opacity = '0';
                card.style.transform = 'translateX(15px)';
                setTimeout(() => card.remove(), 160);
            }
            downloadsList = downloadsList.filter(item => item.id !== b.dataset.id);
            saveDownloadsToStorage();
        });
    });
}

module.exports = {
    formatBytes,
    formatEta,
    showNebulaNotification,
    handleDownloadEvent,
    openDownloadsModal
};
