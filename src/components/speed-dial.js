const { ipcRenderer } = require('electron');

let speedDialTiles = [];

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadSpeedDial() {
    try {
        speedDialTiles = await ipcRenderer.invoke('db-get-speeddial');
    } catch (e) {
        console.error('Ошибка загрузки speed dial:', e);
        speedDialTiles = [];
    }
    return speedDialTiles;
}


async function syncSpeedDialWithDom() {
    const grid = document.getElementById('speed-dial-grid');
    if (!grid) return;
    const domTiles = Array.from(grid.querySelectorAll('.dial-tile[data-id]'));
    const reordered = [];
    domTiles.forEach(el => {
        const id = el.dataset.id;
        const found = speedDialTiles.find(t => String(t.id) === String(id));
        if (found) reordered.push(found);
    });
    if (reordered.length === speedDialTiles.length) {
        speedDialTiles = reordered;
        await ipcRenderer.invoke('db-update-speeddial-order', speedDialTiles);
    }
}

function renderSpeedDial(onNavigate) {
    const grid = document.getElementById('speed-dial-grid');
    if (!grid) return;

    grid.innerHTML = '';

    speedDialTiles.forEach(tile => {
        const item = document.createElement('div');
        item.className = 'dial-tile';
        item.dataset.id = tile.id;
        item.setAttribute('draggable', 'true');

        const initialLetter = (tile.name || '?')[0].toUpperCase();
        item.innerHTML = `
            <div class="tile-icon-box" style="background-color: ${escapeHtml(tile.color || '#6366f1')};">
                ${tile.icon ? `<i class="${escapeHtml(tile.icon)}"></i>` : `<span>${escapeHtml(initialLetter)}</span>`}
            </div>
            <span class="tile-title" title="${escapeHtml(tile.name)}">${escapeHtml(tile.name)}</span>
            <button class="tile-delete-btn" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
        `;

        // Перетаскивание плиток (Drag & Drop)
        item.addEventListener('dragstart', (e) => {
            if (e.target.closest('.tile-delete-btn')) {
                e.preventDefault();
                return;
            }
            item.classList.add('dragging-tile');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(tile.id));
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging-tile');
            syncSpeedDialWithDom();
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragged = grid.querySelector('.dial-tile.dragging-tile');
            if (!dragged || dragged === item) return;

            const rect = item.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            if (e.clientX < midX) {
                grid.insertBefore(dragged, item);
            } else {
                grid.insertBefore(dragged, item.nextSibling);
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            syncSpeedDialWithDom();
        });

        item.addEventListener('click', (e) => {
            if (e.target.closest('.tile-delete-btn')) return;
            if (onNavigate) onNavigate(tile.url);
        });

        item.querySelector('.tile-delete-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await ipcRenderer.invoke('db-remove-speeddial', tile.id);
            await loadSpeedDial();
            renderSpeedDial(onNavigate);
        });

        grid.appendChild(item);
    });

    const addTileBtn = document.createElement('div');
    addTileBtn.className = 'dial-tile';
    addTileBtn.id = 'add-speed-dial-btn';
    addTileBtn.innerHTML = `
        <div class="add-tile-btn">
            <i class="fa-solid fa-plus"></i>
        </div>
        <span class="tile-title">Добавить</span>
    `;

    addTileBtn.addEventListener('click', () => {
        const modal = document.getElementById('add-tile-modal');
        const nameInput = document.getElementById('tile-name-input');
        const urlInput = document.getElementById('tile-url-input');
        if (modal) {
            modal.classList.remove('hidden');
            if (nameInput) nameInput.value = '';
            if (urlInput) urlInput.value = '';
            nameInput?.focus();
        }
    });

    grid.appendChild(addTileBtn);
}

function setupSpeedDialModal(onNavigate) {
    const modal = document.getElementById('add-tile-modal');
    const nameInput = document.getElementById('tile-name-input');
    const urlInput = document.getElementById('tile-url-input');
    const colorInput = document.getElementById('tile-color-input');
    const saveBtn = document.getElementById('save-tile-btn');
    const cancelBtn = document.getElementById('cancel-tile-btn');

    if (!modal || !saveBtn || !cancelBtn) return;

    cancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        let url = urlInput.value.trim();
        const color = colorInput.value;

        if (!url) return;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        let icon = 'fa-solid fa-globe';
        if (url.includes('youtube.com')) icon = 'fa-brands fa-youtube';
        else if (url.includes('github.com')) icon = 'fa-brands fa-github';
        else if (url.includes('t.me') || url.includes('telegram.org')) icon = 'fa-brands fa-telegram';
        else if (url.includes('twitch.tv')) icon = 'fa-brands fa-twitch';
        else if (url.includes('vk.com')) icon = 'fa-brands fa-vk';
        else if (url.includes('ya.ru') || url.includes('yandex.ru')) icon = 'fa-solid fa-y';

        await ipcRenderer.invoke('db-add-speeddial', name || url, url, color, icon);
        modal.classList.add('hidden');
        await loadSpeedDial();
        renderSpeedDial(onNavigate);
    });
}

module.exports = {
    loadSpeedDial,
    renderSpeedDial,
    setupSpeedDialModal
};
