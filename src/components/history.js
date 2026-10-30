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

let currentHistorySearch = '';

async function openHistoryModal(searchTerm = '', onNavigate) {
    const modalContainer = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    if (!modalContainer || !modalBody) return;

    modalContainer.classList.remove('hidden');
    currentHistorySearch = searchTerm;

    let historyItems = [];
    try {
        historyItems = await ipcRenderer.invoke('db-get-history', searchTerm, 300);
    } catch (e) {
        console.error('Ошибка чтения истории:', e);
    }

    renderHistoryModalView(historyItems, modalBody, modalContainer, onNavigate);
}

function renderHistoryModalView(items, modalBody, modalContainer, onNavigate) {
    const totalCount = items.length;

    modalBody.innerHTML = `
        <div class="pw-header" style="margin-bottom: 14px;">
            <div class="pw-header-left">
                <div class="pw-title">
                    <i class="fa-solid fa-clock-rotate-left pw-header-icon"></i>
                    <span>История просмотров</span>
                    <span class="pw-badge">${totalCount}</span>
                </div>
                <div class="pw-subtitle">Список посещенных сайтов, поисковых запросов и веб-страниц</div>
            </div>
            <div class="pw-header-actions">
                <button id="clear-all-history-btn" class="modal-btn danger" style="padding: 7px 14px; font-size: 12.5px;">
                    <i class="fa-solid fa-trash-can"></i> Очистить историю
                </button>
            </div>
        </div>

        <div class="pw-search-bar" style="margin-bottom: 14px;">
            <i class="fa-solid fa-magnifying-glass pw-search-icon"></i>
            <input type="text" id="history-search-input" class="pw-search-input" placeholder="Поиск в истории по заголовку или ссылке..." value="${escapeHtml(currentHistorySearch)}">
            ${currentHistorySearch ? `<button id="clear-history-search" class="pw-clear-search-btn" title="Сбросить поиск"><i class="fa-solid fa-xmark"></i></button>` : ''}
        </div>

        <div class="hist-list-container" id="history-list-items"></div>
    `;

    const listContainer = document.getElementById('history-list-items');
    renderHistoryRows(items, listContainer, modalContainer, onNavigate);

    const searchInput = document.getElementById('history-search-input');
    searchInput?.focus();
    if (currentHistorySearch) {
        searchInput.setSelectionRange(currentHistorySearch.length, currentHistorySearch.length);
    }

    let searchDebounceTimer = null;
    let searchSeq = 0;
    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value;
        currentHistorySearch = query;
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const thisSeq = ++searchSeq;
        searchDebounceTimer = setTimeout(async () => {
            const filtered = await ipcRenderer.invoke('db-get-history', query, 300);
            if (thisSeq === searchSeq) {
                renderHistoryRows(filtered, listContainer, modalContainer, onNavigate);
            }
        }, 150);
    });

    document.getElementById('clear-history-search')?.addEventListener('click', () => {
        openHistoryModal('', onNavigate);
    });

    document.getElementById('clear-all-history-btn')?.addEventListener('click', async () => {
        if (confirm('Вы уверены, что хотите удалить ВСЮ историю просмотров?')) {
            await ipcRenderer.invoke('db-clear-history');
            openHistoryModal('', onNavigate);
        }
    });
}

let renderedHistoryCount = 0;
const HISTORY_BATCH_SIZE = 35;
let cachedHistoryItems = [];
let currentNavigateCallback = null;
let currentModalContainer = null;
let isContainerBound = false;

function buildHistoryCardHtml(item) {
    let domain = '';
    try {
        domain = new URL(item.url).hostname.replace(/^www\./i, '');
    } catch(e) {
        domain = item.url || '';
    }

    const faviconSrc = domain && !domain.startsWith('nebula') ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : '';

    return `
        <div class="hist-card-row" data-id="${item.id}" data-url="${escapeHtml(item.url)}">
            <div class="hist-icon-box">
                ${faviconSrc ? `
                    <img class="hist-favicon" src="${faviconSrc}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <i class="fa-solid fa-globe" style="display:none;"></i>
                ` : `
                    <i class="fa-solid fa-globe"></i>
                `}
            </div>
            <div class="hist-info-box">
                <div class="hist-title-line">
                    <span class="hist-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title || domain || 'Без названия')}</span>
                    <span class="hist-domain-badge">${escapeHtml(domain)}</span>
                </div>
                <div class="hist-url-line" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
            </div>
            <div class="hist-actions-box">
                <span class="hist-time-tag">${escapeHtml(item.formatted_time || '')}</span>
                <button class="hist-delete-btn" data-id="${item.id}" title="Удалить запись">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `;
}

function appendHistoryBatch(container) {
    if (!container || renderedHistoryCount >= cachedHistoryItems.length) return;
    const nextBatch = cachedHistoryItems.slice(renderedHistoryCount, renderedHistoryCount + HISTORY_BATCH_SIZE);
    if (!nextBatch.length) return;

    const fragmentHtml = nextBatch.map(item => buildHistoryCardHtml(item)).join('');
    container.insertAdjacentHTML('beforeend', fragmentHtml);
    renderedHistoryCount += nextBatch.length;
}

function renderHistoryRows(items, container, modalContainer, onNavigate) {
    if (!container) return;

    cachedHistoryItems = items || [];
    renderedHistoryCount = 0;
    currentNavigateCallback = onNavigate;
    currentModalContainer = modalContainer;
    container.innerHTML = '';

    if (!items || items.length === 0) {
        if (currentHistorySearch) {
            container.innerHTML = `
                <div class="pw-empty-state">
                    <div class="pw-empty-icon-circle"><i class="fa-solid fa-magnifying-glass"></i></div>
                    <h3>Ничего не найдено</h3>
                    <p>По запросу «${escapeHtml(currentHistorySearch)}» записей в истории нет.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="pw-empty-state">
                    <div class="pw-empty-icon-circle"><i class="fa-solid fa-clock-rotate-left"></i></div>
                    <h3>История просмотров пуста</h3>
                    <p>Здесь будут отображаться веб-сайты и страницы, которые вы посещали.</p>
                </div>
            `;
        }
        return;
    }

    // Рендерим только первую пачку (35 записей) - моментально без Long Task
    appendHistoryBatch(container);

    // Догрузка при скролле
    container.onscroll = () => {
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 120) {
            appendHistoryBatch(container);
        }
    };

    // Делегирование событий на контейнер (0 лишних замыканий)
    if (!isContainerBound) {
        isContainerBound = true;
        container.addEventListener('click', async (e) => {
            const deleteBtn = e.target.closest('.hist-delete-btn');
            if (deleteBtn) {
                e.stopPropagation();
                const row = deleteBtn.closest('.hist-card-row');
                if (row) {
                    const id = row.dataset.id;
                    row.style.opacity = '0';
                    row.style.transform = 'translateX(15px)';
                    setTimeout(() => row.remove(), 160);
                    await ipcRenderer.invoke('db-delete-history', id);
                    cachedHistoryItems = cachedHistoryItems.filter(h => String(h.id) !== String(id));
                }
                return;
            }

            const card = e.target.closest('.hist-card-row');
            if (card && card.dataset.url) {
                currentModalContainer?.classList.add('hidden');
                if (currentNavigateCallback) {
                    currentNavigateCallback(card.dataset.url);
                }
            }
        });
    }
}

module.exports = {
    addHistory,
    openHistoryModal
};
