const { ipcRenderer } = require('electron');

let bookmarksList = [];
let currentOnNavigate = null;
let currentCallbacks = {};

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadBookmarks() {
    try {
        bookmarksList = await ipcRenderer.invoke('db-get-bookmarks');
    } catch (e) {
        console.error('Ошибка загрузки закладок:', e);
        bookmarksList = [];
    }
    return bookmarksList;
}


async function syncBookmarksOrderWithDom() {
    const bookmarksBar = document.getElementById('bookmarks-bar');
    if (!bookmarksBar) return;
    const domItems = Array.from(bookmarksBar.querySelectorAll('.bookmark-item'));
    const reordered = [];
    domItems.forEach(el => {
        const id = el.dataset.id;
        const found = bookmarksList.find(b => String(b.id) === String(id));
        if (found) reordered.push(found);
    });
    if (reordered.length === bookmarksList.length) {
        bookmarksList = reordered;
        await ipcRenderer.invoke('db-update-bookmarks-order', bookmarksList);
    }
}

function renderBookmarks(onNavigate, callbacks = {}) {
    if (onNavigate) currentOnNavigate = onNavigate;
    if (callbacks && typeof callbacks === 'object' && Object.keys(callbacks).length > 0) {
        currentCallbacks = Object.assign({}, currentCallbacks, callbacks);
    }
    const navCallback = onNavigate || currentOnNavigate;
    const activeCallbacks = currentCallbacks;

    const bookmarksBar = document.getElementById('bookmarks-bar');
    if (!bookmarksBar) return;

    bookmarksBar.innerHTML = '';
    bookmarksList.forEach(bm => {
        const item = document.createElement('div');
        item.className = 'bookmark-item';
        item.setAttribute('draggable', 'true');
        item.dataset.id = bm.id;
        item.dataset.url = bm.url;

        let iconSrc = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(bm.url)}&sz=32`;
        item.innerHTML = `
            <img class="bookmark-icon" src="${iconSrc}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
            <i class="fa-solid fa-globe" style="display: none; font-size: 13px;"></i>
            <span>${escapeHtml(bm.title)}</span>
        `;

        // Перетаскивание закладок (Drag & Drop)
        item.addEventListener('dragstart', (e) => {
            item.classList.add('dragging-bookmark');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(bm.id));
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging-bookmark');
            syncBookmarksOrderWithDom();
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragged = bookmarksBar.querySelector('.bookmark-item.dragging-bookmark');
            if (!dragged || dragged === item) return;

            const rect = item.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            if (e.clientX < midX) {
                bookmarksBar.insertBefore(dragged, item);
            } else {
                bookmarksBar.insertBefore(dragged, item.nextSibling);
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            syncBookmarksOrderWithDom();
        });

        item.addEventListener('click', () => {
            if (navCallback) navCallback(bm.url);
        });

        item.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                if (activeCallbacks && activeCallbacks.onOpenNewTab) {
                    activeCallbacks.onOpenNewTab(bm.url);
                } else if (navCallback) {
                    navCallback(bm.url);
                }
            }
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm(`Удалить закладку «${bm.title}»?`)) {
                removeBookmark(bm.url, navCallback);
            }
        });

        bookmarksBar.appendChild(item);
    });
}

async function updateBookmarkBtnState(currentUrl) {
    const btn = document.getElementById('bookmark-current-btn');
    if (!btn) return;
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('nebula://')) {
        btn.classList.remove('bookmarked');
        return;
    }
    // Быстрая синхронная проверка по кэшу закладок в памяти (0 IPC на переключение таба)
    if (bookmarksList && bookmarksList.length > 0) {
        const isBm = bookmarksList.some(b => b.url === currentUrl);
        if (isBm) btn.classList.add('bookmarked');
        else btn.classList.remove('bookmarked');
        return;
    }
    try {
        const isBm = await ipcRenderer.invoke('db-is-bookmarked', currentUrl);
        if (isBm) {
            btn.classList.add('bookmarked');
        } else {
            btn.classList.remove('bookmarked');
        }
    } catch (e) {
        btn.classList.remove('bookmarked');
    }
}

async function toggleBookmarkDialog(activeTab, onNavigate) {
    const popover = document.getElementById('bookmark-popover');
    const nameInput = document.getElementById('bookmark-name-input');
    const urlInput = document.getElementById('bookmark-url-input');
    const popoverTitle = document.getElementById('bookmark-popover-title');
    const removeBtn = document.getElementById('bookmark-remove-btn');
    if (!popover || !activeTab) return;

    if (!popover.classList.contains('hidden')) {
        popover.classList.add('hidden');
        return;
    }

    const curUrl = activeTab.url;
    if (!curUrl || curUrl.startsWith('nebula://') || curUrl === 'about:blank') return;

    const curTitle = activeTab.title || 'Новая страница';
    const isBm = await ipcRenderer.invoke('db-is-bookmarked', curUrl);

    if (urlInput) urlInput.value = curUrl;
    if (nameInput) nameInput.value = curTitle;

    if (isBm) {
        if (popoverTitle) popoverTitle.textContent = 'Редактировать закладку';
        removeBtn?.classList.remove('hidden');
    } else {
        if (popoverTitle) popoverTitle.textContent = 'Закладка сохранена';
        removeBtn?.classList.add('hidden');
        await ipcRenderer.invoke('db-add-bookmark', curTitle, curUrl);
        await loadBookmarks();
        renderBookmarks(currentOnNavigate, currentCallbacks);
        updateBookmarkBtnState(curUrl);
    }

    popover.classList.remove('hidden');
    nameInput?.focus();
    nameInput?.select();
}

async function saveCustomBookmark(onNavigate) {
    const popover = document.getElementById('bookmark-popover');
    const nameInput = document.getElementById('bookmark-name-input');
    const urlInput = document.getElementById('bookmark-url-input');
    if (!popover || !nameInput || !urlInput) return;

    const url = urlInput.value.trim();
    const title = nameInput.value.trim() || url;
    if (url) {
        await ipcRenderer.invoke('db-add-bookmark', title, url);
        await loadBookmarks();
        renderBookmarks(currentOnNavigate, currentCallbacks);
        updateBookmarkBtnState(url);
    }
    popover.classList.add('hidden');
}

async function removeBookmark(url, onNavigate) {
    const popover = document.getElementById('bookmark-popover');
    if (url) {
        await ipcRenderer.invoke('db-remove-bookmark', url);
        await loadBookmarks();
        renderBookmarks(currentOnNavigate, currentCallbacks);
        updateBookmarkBtnState(url);
    }
    popover?.classList.add('hidden');
}

module.exports = {
    loadBookmarks,
    renderBookmarks,
    updateBookmarkBtnState,
    toggleBookmarkDialog,
    saveCustomBookmark,
    removeBookmark
};
