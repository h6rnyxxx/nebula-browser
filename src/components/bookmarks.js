const { ipcRenderer } = require('electron');

let bookmarksList = [];

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

function renderBookmarks(onNavigate) {
    const bookmarksBar = document.getElementById('bookmarks-bar');
    if (!bookmarksBar) return;

    bookmarksBar.innerHTML = '';
    bookmarksList.forEach(bm => {
        const item = document.createElement('div');
        item.className = 'bookmark-item';

        let iconSrc = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(bm.url)}&sz=32`;
        item.innerHTML = `
            <img class="bookmark-icon" src="${iconSrc}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
            <i class="fa-solid fa-globe" style="display: none; font-size: 13px;"></i>
            <span>${escapeHtml(bm.title)}</span>
        `;

        item.addEventListener('click', () => {
            if (onNavigate) onNavigate(bm.url);
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (confirm(`Удалить закладку «${bm.title}»?`)) {
                removeBookmark(bm.url, onNavigate);
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
        renderBookmarks(onNavigate);
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
        renderBookmarks(onNavigate);
        updateBookmarkBtnState(url);
    }
    popover.classList.add('hidden');
}

async function removeBookmark(url, onNavigate) {
    const popover = document.getElementById('bookmark-popover');
    if (url) {
        await ipcRenderer.invoke('db-remove-bookmark', url);
        await loadBookmarks();
        renderBookmarks(onNavigate);
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
