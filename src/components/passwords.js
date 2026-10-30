const { ipcRenderer } = require('electron');

let passwordsCache = [];
let currentFilterTerm = '';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadPasswords() {
    try {
        passwordsCache = await ipcRenderer.invoke('db-get-passwords');
        if (!Array.isArray(passwordsCache)) passwordsCache = [];
    } catch (e) {
        console.error('Ошибка загрузки паролей:', e);
        passwordsCache = [];
    }
    return passwordsCache;
}

function getCachedPasswords() {
    return passwordsCache;
}

function generateSecurePassword(length = 16) {
    const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()-_=+';
    let res = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        res += charset[randomValues[i] % charset.length];
    }
    return res;
}

function parsePasswordCSV(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];

    let headerLine = lines[0];
    let delimiter = ',';
    if (!headerLine.includes(',') && headerLine.includes(';')) delimiter = ';';

    function parseCsvRow(rowStr, delim) {
        const result = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < rowStr.length; i++) {
            const ch = rowStr[i];
            if (ch === '"') {
                if (inQuotes && rowStr[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delim && !inQuotes) {
                result.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        result.push(cur.trim());
        return result;
    }

    const headers = parseCsvRow(headerLine, delimiter).map(h => h.toLowerCase().replace(/[\s_-]/g, ''));

    let urlIdx = headers.findIndex(h => h === 'url' || h === 'origin' || h === 'actionurl' || h === 'website' || h === 'site');
    let userIdx = headers.findIndex(h => h === 'username' || h === 'user' || h === 'login' || h === 'name' || h === 'email');
    let passIdx = headers.findIndex(h => h === 'password' || h === 'pass');

    if (urlIdx === -1 || userIdx === -1 || passIdx === -1) {
        if (headers.length >= 3) {
            urlIdx = 0;
            userIdx = 1;
            passIdx = 2;
        } else {
            return [];
        }
    }

    const imported = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i], delimiter);
        if (cols.length <= Math.max(urlIdx, userIdx, passIdx)) continue;

        let rawUrl = cols[urlIdx] || '';
        let rawUser = cols[userIdx] || '';
        let rawPass = cols[passIdx] || '';

        if (!rawUrl || !rawUser || !rawPass) continue;

        let siteDomain = rawUrl;
        try {
            if (!/^https?:\/\//i.test(siteDomain)) siteDomain = 'https://' + siteDomain;
            siteDomain = new URL(siteDomain).hostname.replace(/^www\./i, '');
        } catch (e) {
            siteDomain = siteDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
        }

        imported.push({
            site: siteDomain,
            login: rawUser,
            password: rawPass
        });
    }

    return imported;
}


function exportPasswordsToCSV() {
    if (!passwordsCache || passwordsCache.length === 0) return null;
    const header = 'name,url,username,password\r\n';
    const rows = passwordsCache.map(p => {
        const name = (p.site || '').replace(/"/g, '""');
        const siteStr = p.site || '';
        const url = (siteStr.startsWith('http') ? siteStr : 'https://' + siteStr).replace(/"/g, '""');
        const username = (p.login || '').replace(/"/g, '""');
        const password = (p.password || '').replace(/"/g, '""');
        return `"${name}","${url}","${username}","${password}"`;
    }).join('\r\n');
    return header + rows;
}

function downloadPasswordsCsvFile(showToastCallback) {
    if (!passwordsCache || passwordsCache.length === 0) {
        if (showToastCallback) showToastCallback('Нет сохраненных паролей для экспорта');
        return;
    }
    const csvContent = exportPasswordsToCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    link.download = `nebula_passwords_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);

    if (showToastCallback) {
        showToastCallback(`Пароли успешно экспортированы в <b>nebula_passwords_${dateStr}.csv</b>`);
    }
}

async function clearAllPasswords(showToastCallback, listContainer) {
    if (!passwordsCache || passwordsCache.length === 0) {
        if (showToastCallback) showToastCallback('Список сохраненных паролей уже пуст');
        return;
    }

    if (confirm('Вы уверены, что хотите удалить ВСЕ сохраненные пароли?')) {
        await ipcRenderer.invoke('db-clear-passwords');
        passwordsCache = [];
        try { localStorage.removeItem('nebula_passwords'); } catch(e) {}
        const countBadge = document.getElementById('pw-count-badge');
        if (countBadge) countBadge.textContent = '0';
        renderPasswordItems([], listContainer, showToastCallback);
        if (showToastCallback) {
            showToastCallback('Все сохраненные пароли успешно удалены');
        }
    }
}

function renderPasswordItems(items, container, showToastCallback) {
    if (!container) return;

    if (!items || items.length === 0) {
        if (currentFilterTerm) {
            container.innerHTML = `
                <div class="pw-empty-state">
                    <div class="pw-empty-icon-circle"><i class="fa-solid fa-magnifying-glass"></i></div>
                    <h3>Ничего не найдено</h3>
                    <p>По запросу «${escapeHtml(currentFilterTerm)}» паролей не обнаружено.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="pw-empty-state">
                    <div class="pw-empty-icon-circle"><i class="fa-solid fa-shield-halved"></i></div>
                    <h3>Нет сохраненных паролей</h3>
                    <p>Добавьте пароль вручную с помощью кнопки «Добавить» выше или импортируйте их из Google Chrome, Edge или Яндекс.Браузера в формате CSV.</p>
                </div>
            `;
        }
        return;
    }

    container.innerHTML = items.map(p => {
        const encodedSite = encodeURIComponent(p.site);
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodedSite}&sz=32`;
        return `
            <div class="pw-item-row" data-id="${p.id}" data-site="${escapeHtml(p.site)}" data-login="${escapeHtml(p.login)}">
                <div class="pw-item-icon-box">
                    <img src="${faviconUrl}" class="pw-favicon" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='inline-block';">
                    <i class="fa-solid fa-globe" style="display:none;"></i>
                </div>
                <div class="pw-item-main-info">
                    <div class="pw-item-site-row">
                        <span class="pw-item-site" title="${escapeHtml(p.site)}">${escapeHtml(p.site)}</span>
                    </div>
                    <div class="pw-item-login-row">
                        <i class="fa-regular fa-user pw-subicon"></i>
                        <span class="pw-item-login" title="${escapeHtml(p.login)}">${escapeHtml(p.login)}</span>
                    </div>
                </div>
                <div class="pw-item-pass-field">
                    <input type="password" class="pw-val-input" value="${escapeHtml(p.password)}" readonly spellcheck="false">
                </div>
                <div class="pw-item-actions">
                    <button class="pw-action-btn pw-toggle-visibility-btn" title="Показать / скрыть пароль">
                        <i class="fa-regular fa-eye"></i>
                    </button>
                    <button class="pw-action-btn pw-copy-pass-btn" title="Скопировать пароль">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                    <button class="pw-action-btn pw-copy-login-btn" title="Скопировать логин">
                        <i class="fa-regular fa-user"></i>
                    </button>
                    <button class="pw-action-btn danger pw-delete-item-btn" title="Удалить пароль">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Attach row events
    container.querySelectorAll('.pw-item-row').forEach(row => {
        const id = row.dataset.id;
        const site = row.dataset.site;
        const login = row.dataset.login;
        const passInput = row.querySelector('.pw-val-input');
        const toggleBtn = row.querySelector('.pw-toggle-visibility-btn');
        const copyPassBtn = row.querySelector('.pw-copy-pass-btn');
        const copyLoginBtn = row.querySelector('.pw-copy-login-btn');
        const deleteBtn = row.querySelector('.pw-delete-item-btn');

        // 1. Показать / скрыть пароль
        toggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (passInput.type === 'password') {
                passInput.type = 'text';
                toggleBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
            } else {
                passInput.type = 'password';
                toggleBtn.innerHTML = '<i class="fa-regular fa-eye"></i>';
            }
        });

        // 2. Скопировать пароль
        copyPassBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const item = passwordsCache.find(x => String(x.id) === String(id));
                const textToCopy = item ? item.password : passInput.value;
                await navigator.clipboard.writeText(textToCopy);
                copyPassBtn.innerHTML = '<i class="fa-solid fa-check" style="color: #34d399;"></i>';
                setTimeout(() => {
                    copyPassBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                }, 1200);
                if (showToastCallback) showToastCallback(`Пароль для <b>${escapeHtml(site)}</b> скопирован`);
            } catch (err) {
                console.error('Ошибка копирования пароля:', err);
            }
        });

        // 3. Скопировать логин
        copyLoginBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                await navigator.clipboard.writeText(login);
                copyLoginBtn.innerHTML = '<i class="fa-solid fa-check" style="color: #34d399;"></i>';
                setTimeout(() => {
                    copyLoginBtn.innerHTML = '<i class="fa-regular fa-user"></i>';
                }, 1200);
                if (showToastCallback) showToastCallback(`Логин скопирован: <b>${escapeHtml(login)}</b>`);
            } catch (err) {
                console.error('Ошибка копирования логина:', err);
            }
        });

        // 4. Удалить пароль (мгновенное удаление в 1 клик)
        deleteBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            row.style.opacity = '0';
            row.style.transform = 'translateX(20px)';
            setTimeout(() => row.remove(), 180);

            await ipcRenderer.invoke('db-delete-password', id, site, login);
            passwordsCache = passwordsCache.filter(x => String(x.id) !== String(id) && !(x.site === site && x.login === login));

            try {
                const raw = localStorage.getItem('nebula_passwords');
                if (raw) {
                    const list = JSON.parse(raw);
                    if (Array.isArray(list)) {
                        localStorage.setItem('nebula_passwords', JSON.stringify(list.filter(x => x.site !== site || x.login !== login)));
                    }
                }
            } catch(e) {}

            const countBadge = document.getElementById('pw-count-badge');
            if (countBadge) countBadge.textContent = passwordsCache.length;

            if (showToastCallback) {
                showToastCallback(`Пароль для <b>${escapeHtml(site)}</b> удален`);
            }

            if (passwordsCache.length === 0) {
                renderPasswordItems([], container, showToastCallback);
            }
        });
    });
}

async function openPasswordsModal(showToastCallback) {
    const modalContainer = document.getElementById('modal-container');
    const modalBody = document.getElementById('modal-body');
    if (!modalContainer || !modalBody) return;

    modalContainer.classList.remove('hidden');
    currentFilterTerm = '';
    await loadPasswords();

    modalBody.innerHTML = `
        <div class="passwords-manager-wrapper">
            <div class="pw-header">
                <div class="pw-header-left">
                    <div class="pw-title">
                        <i class="fa-solid fa-key pw-header-icon"></i>
                        <span>Менеджер паролей</span>
                        <span class="pw-badge" id="pw-count-badge">${passwordsCache.length}</span>
                    </div>
                    <div class="pw-subtitle">Безопасное хранилище учетных записей с локальным шифрованием DPAPI</div>
                </div>
                <div class="pw-header-actions">
                    <button id="import-passwords-modal-btn" class="modal-btn secondary" title="Импорт паролей из Chrome, Edge, Яндекс (CSV)">
                        <i class="fa-solid fa-file-import"></i> Импорт
                    </button>
                    <button id="export-passwords-modal-btn" class="modal-btn secondary" title="Скачать файл всех моих паролей (.csv)">
                        <i class="fa-solid fa-file-export"></i> Экспорт CSV
                    </button>
                    <button id="clear-all-passwords-btn" class="modal-btn danger" title="Удалить все сохраненные пароли">
                        <i class="fa-solid fa-trash-can"></i> Удалить все
                    </button>
                    <button id="add-password-manual-btn" class="modal-btn" title="Добавить учетную запись">
                        <i class="fa-solid fa-plus"></i> Добавить
                    </button>
                </div>
            </div>

            <div class="pw-search-bar">
                <i class="fa-solid fa-magnifying-glass pw-search-icon"></i>
                <input type="text" id="pw-search-input" class="pw-search-input" placeholder="Поиск по сайту или логину..." autocomplete="off">
                <button id="pw-clear-search-btn" class="pw-clear-search-btn hidden" title="Очистить поиск">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div id="add-password-form-box" class="pw-add-card hidden">
                <div class="pw-add-card-header">
                    <i class="fa-solid fa-plus-circle"></i>
                    <span>Новая учетная запись</span>
                </div>
                <div class="pw-add-grid">
                    <div class="pw-input-group">
                        <label><i class="fa-solid fa-globe"></i> Сайт или сервис</label>
                        <input type="text" id="manual-pw-site" class="pw-modal-input" placeholder="например: google.com, vk.com" autocomplete="off">
                    </div>
                    <div class="pw-input-group">
                        <label><i class="fa-solid fa-user"></i> Логин или Email</label>
                        <input type="text" id="manual-pw-login" class="pw-modal-input" placeholder="Логин или почта" autocomplete="off">
                    </div>
                    <div class="pw-input-group">
                        <label><i class="fa-solid fa-lock"></i> Пароль</label>
                        <div class="pw-input-with-action">
                            <input type="password" id="manual-pw-pass" class="pw-modal-input" placeholder="Пароль" autocomplete="off">
                            <button type="button" id="toggle-manual-pw-visibility" class="pw-input-icon-btn" title="Показать/скрыть">
                                <i class="fa-regular fa-eye"></i>
                            </button>
                            <button type="button" id="generate-pw-btn" class="pw-input-icon-btn" title="Сгенерировать надежный пароль">
                                <i class="fa-solid fa-wand-magic-sparkles"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="pw-add-footer">
                    <button id="cancel-manual-pw-btn" class="modal-btn secondary">Отмена</button>
                    <button id="save-manual-pw-btn" class="modal-btn"><i class="fa-solid fa-check"></i> Сохранить</button>
                </div>
            </div>

            <div class="pw-list-container" id="passwords-scroll-list"></div>
        </div>
    `;

    const listContainer = document.getElementById('passwords-scroll-list');
    renderPasswordItems(passwordsCache, listContainer, showToastCallback);

    // CSV import click
    document.getElementById('import-passwords-modal-btn')?.addEventListener('click', () => {
        document.getElementById('passwords-csv-input')?.click();
    });

    // CSV export click
    document.getElementById('export-passwords-modal-btn')?.addEventListener('click', () => {
        downloadPasswordsCsvFile(showToastCallback);
    });

    // Clear all click
    document.getElementById('clear-all-passwords-btn')?.addEventListener('click', async () => {
        await clearAllPasswords(showToastCallback, listContainer);
    });

    // Toggle add form
    const addBox = document.getElementById('add-password-form-box');
    const siteInput = document.getElementById('manual-pw-site');
    const loginInput = document.getElementById('manual-pw-login');
    const passInput = document.getElementById('manual-pw-pass');

    document.getElementById('add-password-manual-btn')?.addEventListener('click', () => {
        if (!addBox) return;
        addBox.classList.toggle('hidden');
        if (!addBox.classList.contains('hidden')) {
            siteInput?.focus();
        }
    });

    document.getElementById('cancel-manual-pw-btn')?.addEventListener('click', () => {
        addBox?.classList.add('hidden');
    });

    // Password generator in add form
    document.getElementById('generate-pw-btn')?.addEventListener('click', () => {
        if (passInput) {
            const newPass = generateSecurePassword(16);
            passInput.value = newPass;
            passInput.type = 'text';
            const toggleIcon = document.querySelector('#toggle-manual-pw-visibility i');
            if (toggleIcon) toggleIcon.className = 'fa-regular fa-eye-slash';
            if (showToastCallback) showToastCallback('Сгенерирован надежный 16-значный пароль');
        }
    });

    // Toggle visibility in add form
    document.getElementById('toggle-manual-pw-visibility')?.addEventListener('click', () => {
        if (passInput) {
            const isText = passInput.type === 'text';
            passInput.type = isText ? 'password' : 'text';
            const icon = document.querySelector('#toggle-manual-pw-visibility i');
            if (icon) icon.className = isText ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
        }
    });

    // Save action function
    const handleSavePassword = async () => {
        const site = siteInput?.value.trim();
        const login = loginInput?.value.trim();
        const pass = passInput?.value;

        if (!site) {
            siteInput?.focus();
            if (showToastCallback) showToastCallback('Пожалуйста, укажите адрес сайта (например, google.com)');
            return;
        }
        if (!login) {
            loginInput?.focus();
            if (showToastCallback) showToastCallback('Пожалуйста, введите логин или email');
            return;
        }
        if (!pass) {
            passInput?.focus();
            if (showToastCallback) showToastCallback('Пожалуйста, введите пароль');
            return;
        }

        await ipcRenderer.invoke('db-save-password', site, login, pass);
        await loadPasswords();

        // Clear and hide form
        if (siteInput) siteInput.value = '';
        if (loginInput) loginInput.value = '';
        if (passInput) {
            passInput.value = '';
            passInput.type = 'password';
        }
        addBox?.classList.add('hidden');

        // Update badge and list
        const countBadge = document.getElementById('pw-count-badge');
        if (countBadge) countBadge.textContent = passwordsCache.length;

        // Apply current filter if any
        const filtered = currentFilterTerm
            ? passwordsCache.filter(p => (p.site || '').toLowerCase().includes(currentFilterTerm) || (p.login || '').toLowerCase().includes(currentFilterTerm))
            : passwordsCache;
        renderPasswordItems(filtered, listContainer, showToastCallback);

        if (showToastCallback) showToastCallback(`Пароль для <b>${escapeHtml(site)}</b> сохранен`);
    };

    document.getElementById('save-manual-pw-btn')?.addEventListener('click', handleSavePassword);

    // Save on Enter in form inputs
    [siteInput, loginInput, passInput].forEach(inp => {
        inp?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSavePassword();
            }
        });
    });

    // Live search
    const searchInput = document.getElementById('pw-search-input');
    const clearSearchBtn = document.getElementById('pw-clear-search-btn');

    searchInput?.addEventListener('input', (e) => {
        currentFilterTerm = (e.target.value || '').trim().toLowerCase();
        if (currentFilterTerm) {
            clearSearchBtn?.classList.remove('hidden');
        } else {
            clearSearchBtn?.classList.add('hidden');
        }
        const filtered = currentFilterTerm
            ? passwordsCache.filter(p => (p.site || '').toLowerCase().includes(currentFilterTerm) || (p.login || '').toLowerCase().includes(currentFilterTerm))
            : passwordsCache;
        renderPasswordItems(filtered, listContainer, showToastCallback);
    });

    clearSearchBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        currentFilterTerm = '';
        clearSearchBtn.classList.add('hidden');
        renderPasswordItems(passwordsCache, listContainer, showToastCallback);
        searchInput?.focus();
    });
}

function setupPasswordCsvImport(showToastCallback) {
    const csvInput = document.getElementById('passwords-csv-input');
    if (!csvInput) return;

    csvInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const text = evt.target.result;
                const parsed = parsePasswordCSV(text);
                if (parsed.length > 0) {
                    const count = await ipcRenderer.invoke('db-import-passwords', parsed);
                    await loadPasswords();
                    if (showToastCallback) {
                        showToastCallback(`<i class="fa-solid fa-check" style="color:#34d399;"></i> Импортировано паролей: <b>${count}</b>`);
                    }
                    const modalContainer = document.getElementById('modal-container');
                    if (modalContainer && !modalContainer.classList.contains('hidden')) {
                        openPasswordsModal(showToastCallback);
                    }
                } else {
                    alert('Не удалось распознать формат CSV. Убедитесь, что файл экспортирован из Chrome, Edge, Яндекс или Opera.');
                }
            } catch (err) {
                alert('Ошибка при чтении файла паролей: ' + err.message);
            }
            csvInput.value = '';
        };
        reader.readAsText(file, 'utf-8');
    });
}

module.exports = {
    loadPasswords,
    getCachedPasswords,
    openPasswordsModal,
    setupPasswordCsvImport
};
