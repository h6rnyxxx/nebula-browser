const { ipcRenderer } = require('electron');

const CHROME_STORE_URL = 'https://chromewebstore.google.com/';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function injectChromeStoreButton(webview, url) {
    if (!url || !url.includes('chromewebstore.google.com')) return;

    const injectScript = `
        (function() {
            if (window.__nebulaStoreObserverActive) return;
            window.__nebulaStoreObserverActive = true;

            function checkAndPatchStore() {
                const curUrl = window.location.href;
                const match = curUrl.match(/\\/detail\\/(?:[^\\/]+\\/)?([a-p]{32})/i);

                const allDivs = document.querySelectorAll('div');
                allDivs.forEach(d => {
                    if (d.innerText && d.innerText.includes('Продукт недоступен') && d.innerText.length < 220) {
                        d.style.display = 'none';
                    }
                });

                if (!match) return;
                const extId = match[1];

                const buttons = document.querySelectorAll('button');
                buttons.forEach(b => {
                    const text = (b.innerText || '').trim();
                    if (
                        text === 'Установить' || 
                        text === 'Add to Chrome' || 
                        text === 'Установить в Chrome' || 
                        text === 'Установить в Nebula' ||
                        text.includes('Установить')
                    ) {
                        if (!b.dataset.nebulaPatched) {
                            b.dataset.nebulaPatched = 'true';
                            b.disabled = false;
                            b.style.opacity = '1';
                            b.style.pointerEvents = 'auto';
                            b.style.cursor = 'pointer';
                            b.style.background = 'linear-gradient(90deg, #6366f1, #c084fc)';
                            b.style.color = '#ffffff';
                            b.style.fontWeight = 'bold';
                            b.innerText = '✨ Установить в Nebula';

                            b.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                b.disabled = true;
                                b.innerText = '⏳ Установка...';
                                console.log('NEBULA_INSTALL_EXTENSION:' + extId);
                            };
                        }
                    }
                });
            }

            setInterval(checkAndPatchStore, 350);
            checkAndPatchStore();
        })();
    `;

    webview.executeJavaScript(injectScript).catch(() => {});
}

async function getInstalledExtensions() {
    try {
        return await ipcRenderer.invoke('get-installed-extensions');
    } catch (e) {
        console.error('Ошибка получения расширений:', e);
        return [];
    }
}

function renderExtensionsList(extensions, container, notifyCallback) {
    if (!container) return;
    container.innerHTML = '';

    if (!extensions || extensions.length === 0) {
        container.innerHTML = `
            <div class="ext-popup-empty">
                <i class="fa-solid fa-puzzle-piece" style="font-size: 28px; opacity: 0.35; margin-bottom: 8px;"></i>
                <p>Нет установленных расширений</p>
                <span style="font-size: 11px; opacity: 0.6;">Установите их из Chrome Web Store</span>
            </div>
        `;
        return;
    }

    extensions.forEach(ext => {
        const item = document.createElement('div');
        item.className = 'ext-popup-item';

        const iconHtml = ext.icon
            ? `<img src="${ext.icon}" class="ext-icon" alt="">`
            : `<div class="ext-icon-fallback"><i class="fa-solid fa-puzzle-piece"></i></div>`;

        item.innerHTML = `
            ${iconHtml}
            <div class="ext-info">
                <div class="ext-name" title="${escapeHtml(ext.name)}">${escapeHtml(ext.name)}</div>
                <div class="ext-ver">v${escapeHtml(ext.version)}</div>
            </div>
            <div class="ext-actions">
                ${ext.hasPopup ? `<button class="ext-action-btn run-popup" title="Открыть меню"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : ''}
                ${ext.hasOptions ? `<button class="ext-action-btn run-options" title="Настройки"><i class="fa-solid fa-gear"></i></button>` : ''}
                <button class="ext-action-btn remove-ext" title="Удалить"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;

        if (ext.hasPopup) {
            item.querySelector('.run-popup')?.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('extensions-popup')?.classList.add('hidden');
                ipcRenderer.send('open-extension-window', { extId: ext.id, pageType: 'popup' });
            });
        }

        if (ext.hasOptions) {
            item.querySelector('.run-options')?.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('extensions-popup')?.classList.add('hidden');
                ipcRenderer.send('open-extension-window', { extId: ext.id, pageType: 'options' });
            });
        }

        item.querySelector('.remove-ext')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Удалить расширение «${ext.name}»?`)) {
                const res = await ipcRenderer.invoke('remove-extension', ext.id);
                if (res.success) {
                    item.remove();
                    if (notifyCallback) notifyCallback(`Расширение «${ext.name}» удалено`);
                    const updated = await getInstalledExtensions();
                    if (updated.length === 0) renderExtensionsList([], container, notifyCallback);
                }
            }
        });

        item.addEventListener('click', () => {
            document.getElementById('extensions-popup')?.classList.add('hidden');
            if (ext.hasPopup) {
                ipcRenderer.send('open-extension-window', { extId: ext.id, pageType: 'popup' });
            } else if (ext.hasOptions) {
                ipcRenderer.send('open-extension-window', { extId: ext.id, pageType: 'options' });
            }
        });

        container.appendChild(item);
    });
}

module.exports = {
    CHROME_STORE_URL,
    injectChromeStoreButton,
    getInstalledExtensions,
    renderExtensionsList
};
