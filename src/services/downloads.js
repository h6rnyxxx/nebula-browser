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
    if (seconds < 60) return `осталось ~${Math.max(1, seconds)} сек`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `осталось ~${mins} мин${secs > 10 ? ` ${secs} с` : ''}`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `осталось ~${hours} ч ${remMins} мин`;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

function openDownloadsModal(searchTerm = '') {
    const modalContainer = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    if (!modalContainer || !modalBody) return;

    modalContainer.classList.remove('hidden');

    const filtered = downloadsList.filter(d => {
        if (!searchTerm) return true;
        return (d.filename || '').toLowerCase().includes(searchTerm.toLowerCase());
    });

    let listHtml = '';
    if (filtered.length === 0) {
        listHtml = `<div class="empty-state">Нет загруженных файлов</div>`;
    } else {
        listHtml = filtered.map((d, index) => renderDownloadRowHtml(d, index)).join('');
    }

    modalBody.innerHTML = `
        <div class="history-header">
            <h2><i class="fa-solid fa-download"></i> Загрузки</h2>
            <div class="history-search-row">
                <input type="text" id="downloads-search-input" class="modal-input" placeholder="Поиск по файлам..." value="${escapeHtml(searchTerm)}">
                <button id="open-dl-folder-btn" class="modal-btn secondary" title="Открыть папку Загрузки"><i class="fa-solid fa-folder-open"></i> Папка</button>
                <button id="clear-downloads-btn" class="modal-btn danger">Очистить список</button>
            </div>
        </div>
        <div class="history-list" id="downloads-items-list">${listHtml}</div>
    `;

    const searchInput = document.getElementById('downloads-search-input');
    searchInput?.focus();
    searchInput?.addEventListener('input', (e) => {
        openDownloadsModal(e.target.value);
    });

    document.getElementById('open-dl-folder-btn')?.addEventListener('click', () => {
        ipcRenderer.send('open-downloads-folder');
    });

    document.getElementById('clear-downloads-btn')?.addEventListener('click', () => {
        downloadsList = downloadsList.filter(d => activeDownloadsMap.has(d.id));
        saveDownloadsToStorage();
        openDownloadsModal(searchTerm);
    });

    bindDownloadRowEvents(modalBody, searchTerm);
}

function renderDownloadRowHtml(d, index) {
    const live = activeDownloadsMap.get(d.id);
    const isLive = Boolean(live);

    const received = isLive ? live.receivedBytes : (d.receivedBytes || 0);
    const total = isLive ? live.totalBytes : (d.totalBytes || 0);
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    const status = isLive ? live.type : (d.status || 'completed');
    const isPaused = isLive ? live.isPaused : (d.isPaused || false);

    let statusText = 'Завершено';
    let statusClass = 'dl-status-completed';

    if (status === 'progressing') {
        const speedStr = live.speed > 0 ? `${formatBytes(live.speed)}/с` : '';
        const etaStr = formatEta(live.etaSeconds);
        statusText = `Загрузка: ${percent}% • ${formatBytes(received)} из ${formatBytes(total)} ${speedStr ? '• ' + speedStr : ''} ${etaStr ? '• ' + etaStr : ''}`;
        statusClass = 'dl-status-progress';
    } else if (status === 'paused') {
        statusText = `Приостановлено: ${percent}% • ${formatBytes(received)} из ${formatBytes(total)}`;
        statusClass = 'dl-status-paused';
    } else if (status === 'cancelled') {
        statusText = 'Отменено пользователем';
        statusClass = 'dl-status-error';
    } else if (status === 'interrupted' || status === 'failed') {
        statusText = 'Ошибка загрузки';
        statusClass = 'dl-status-error';
    } else {
        statusText = `Скачано (${formatBytes(total)}) • ${d.date || ''}`;
    }

    return `
        <div class="download-item-card" data-id="${d.id}" data-index="${index}">
            <div class="dl-icon-col">
                <i class="fa-solid fa-file-lines"></i>
            </div>
            <div class="dl-details-col">
                <div class="dl-name" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</div>
                <div class="dl-status-line ${statusClass}">${statusText}</div>
                ${(status === 'progressing' || status === 'paused') ? `
                    <div class="dl-progress-bar-bg">
                        <div class="dl-progress-bar-fill" style="width: ${percent}%;"></div>
                    </div>
                ` : ''}
            </div>
            <div class="dl-controls-col">
                ${(status === 'progressing') ? `
                    <button class="dl-btn-action pause-btn" data-id="${d.id}" title="Пауза"><i class="fa-solid fa-pause"></i></button>
                    <button class="dl-btn-action cancel-btn" data-id="${d.id}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
                ` : ''}
                ${(status === 'paused') ? `
                    <button class="dl-btn-action resume-btn" data-id="${d.id}" title="Возобновить"><i class="fa-solid fa-play"></i></button>
                    <button class="dl-btn-action cancel-btn" data-id="${d.id}" title="Отменить"><i class="fa-solid fa-xmark"></i></button>
                ` : ''}
                ${(status === 'completed') ? `
                    <button class="dl-btn-action open-file-btn" data-path="${escapeHtml(d.path)}" title="Открыть файл"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                    <button class="dl-btn-action show-folder-btn" data-path="${escapeHtml(d.path)}" title="Показать в папке"><i class="fa-solid fa-folder"></i></button>
                    <button class="dl-btn-action remove-dl-item-btn" data-id="${d.id}" title="Удалить из списка"><i class="fa-solid fa-trash-can"></i></button>
                ` : ''}
            </div>
        </div>
    `;
}

function bindDownloadRowEvents(modalBody, searchTerm) {
    modalBody.querySelectorAll('.pause-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('pause-download', b.dataset.id));
    });
    modalBody.querySelectorAll('.resume-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('resume-download', b.dataset.id));
    });
    modalBody.querySelectorAll('.cancel-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('cancel-download', b.dataset.id));
    });
    modalBody.querySelectorAll('.open-file-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('open-file', b.dataset.path));
    });
    modalBody.querySelectorAll('.show-folder-btn').forEach(b => {
        b.addEventListener('click', () => ipcRenderer.send('show-in-folder', b.dataset.path));
    });
    modalBody.querySelectorAll('.remove-dl-item-btn').forEach(b => {
        b.addEventListener('click', () => {
            downloadsList = downloadsList.filter(item => item.id !== b.dataset.id);
            saveDownloadsToStorage();
            openDownloadsModal(searchTerm);
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
