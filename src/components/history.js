const { ipcRenderer } = require('electron');

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function addHistory(title, url) {
    if (!url || url.startsWith('data:') || url === 'about:blank' || url.startsWith('nebula://')) return;
    try {
        await ipcRenderer.invoke('db-add-history', title || url, url);
    } catch (e) {
        console.error('Ошибка записи истории:', e);
    }
}

async function openHistoryModal(searchTerm = '', onNavigate) {
    const modalContainer = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    if (!modalContainer || !modalBody) return;

    modalContainer.classList.remove('hidden');

    let historyItems = [];
    try {
        historyItems = await ipcRenderer.invoke('db-get-history', searchTerm, 300);
    } catch (e) {
        console.error('Ошибка чтения истории:', e);
    }

    let listHtml = '';
    if (historyItems.length === 0) {
        listHtml = `<div class="empty-state">История посещений пуста</div>`;
    } else {
        listHtml = historyItems.map(item => `
            <div class="history-item-row" data-id="${item.id}">
                <div class="history-info">
                    <span class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
                    <span class="history-url">${escapeHtml(item.url)}</span>
                </div>
                <div class="history-time-col">
                    <span class="history-time">${escapeHtml(item.formatted_time || '')}</span>
                    <button class="delete-history-btn" title="Удалить из истории"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `).join('');
    }

    modalBody.innerHTML = `
        <div class="history-header">
            <h2><i class="fa-solid fa-clock-rotate-left"></i> История браузера</h2>
            <div class="history-search-row">
                <input type="text" id="history-search-input" class="modal-input" placeholder="Поиск в истории..." value="${escapeHtml(searchTerm)}">
                <button id="clear-all-history-btn" class="modal-btn danger">Очистить всю историю</button>
            </div>
        </div>
        <div class="history-list">${listHtml}</div>
    `;

    const searchInput = document.getElementById('history-search-input');
    searchInput?.focus();
    searchInput?.addEventListener('input', (e) => {
        openHistoryModal(e.target.value, onNavigate);
    });

    document.getElementById('clear-all-history-btn')?.addEventListener('click', async () => {
        if (confirm('Вы действительно хотите удалить ВСЮ историю просмотров?')) {
            await ipcRenderer.invoke('db-clear-history');
            openHistoryModal('', onNavigate);
        }
    });

    modalBody.querySelectorAll('.history-item-row').forEach(row => {
        const id = row.dataset.id;
        const url = row.querySelector('.history-url')?.textContent;

        row.addEventListener('click', (e) => {
            if (e.target.closest('.delete-history-btn')) return;
            modalContainer.classList.add('hidden');
            if (onNavigate && url) onNavigate(url);
        });

        row.querySelector('.delete-history-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await ipcRenderer.invoke('db-delete-history', id);
            row.remove();
            if (modalBody.querySelectorAll('.history-item-row').length === 0) {
                openHistoryModal(searchTerm, onNavigate);
            }
        });
    });
}

module.exports = {
    addHistory,
    openHistoryModal
};
