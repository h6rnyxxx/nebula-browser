function escapeText(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getCredentialsForUrl(savedPasswords, url) {
    if (!url || url.startsWith('data:') || url === 'about:blank' || !Array.isArray(savedPasswords)) return [];
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        const parts = host.split('.');
        const baseDomain = parts.length > 2 ? parts.slice(-2).join('.') : host;

        return savedPasswords.filter(p => {
            if (!p.site) return false;
            const s = p.site.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            return s === host || s.endsWith('.' + host) || host.endsWith('.' + s) || s.includes(baseDomain) || host.includes(s);
        });
    } catch (e) {
        return [];
    }
}

function patchChromeEnvironment(webview, url) {
    if (url && (url.includes('.google.') || url.includes('google.com') || url.includes('accounts.google.') || url.includes('google.com/signin') || url.includes('myaccount.google.'))) {
        return;
    }
    const patchScript = `
        (function() {
            try {
                var h = (window.location.hostname || '').toLowerCase();
                if (h.endsWith('google.com') || h.includes('.google.') || h === 'google.com') {
                    return;
                }
                if (!window.chrome) window.chrome = {};
                if (!window.chrome.app) {
                    window.chrome.app = {
                        isInstalled: false,
                        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                        getDetails: function() { return null; },
                        getIsInstalled: function() { return false; },
                        installState: function() {}
                    };
                }
                if (!window.chrome.csi) window.chrome.csi = function() {};
                if (!window.chrome.loadTimes) {
                    window.chrome.loadTimes = function() {
                        return {
                            requestTime: performance.now() / 1000,
                            startLoadTime: performance.now() / 1000,
                            commitLoadTime: performance.now() / 1000,
                            finishDocumentLoadTime: performance.now() / 1000,
                            firstPaintTime: performance.now() / 1000,
                            finishLoadTime: performance.now() / 1000,
                            wasFetchedViaSpdy: false,
                            wasNpnNegotiated: false,
                            npnNegotiatedProtocol: '',
                            wasAlternateProtocolAvailable: false,
                            connectionInfo: 'http/1.1'
                        };
                    };
                }
            } catch(e) {}
        })();
    `;
    webview.executeJavaScript(patchScript).catch(() => {});
}

function setupInteractiveAutofill(webview, pageUrl, savedPasswords, isAutofillEnabled = true) {
    if (!isAutofillEnabled || !pageUrl || pageUrl.startsWith('data:') || pageUrl === 'about:blank') return;
    const creds = getCredentialsForUrl(savedPasswords, pageUrl);
    if (!creds || creds.length === 0) return;

    const credsJson = JSON.stringify(creds);

    const script = `
    (function() {
        window.__nebulaCreds = ${credsJson};

        if (window.__nebulaAutofillListenerActive) return;
        window.__nebulaAutofillListenerActive = true;

        function escapeText(str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function removeAutofillPopup() {
            const existing = document.getElementById('nebula-autofill-popup');
            if (existing) existing.remove();
        }

        function showAutofillPopup(inputEl) {
            removeAutofillPopup();
            const creds = window.__nebulaCreds;
            if (!creds || !creds.length) return;

            const rect = inputEl.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            const popup = document.createElement('div');
            popup.id = 'nebula-autofill-popup';
            popup.style.cssText = [
                'position: fixed',
                'left: ' + Math.max(10, rect.left) + 'px',
                'top: ' + (rect.bottom + 6) + 'px',
                'min-width: ' + Math.max(rect.width, 260) + 'px',
                'max-width: 380px',
                'background: #140d24',
                'border: 1px solid rgba(255, 255, 255, 0.16)',
                'border-radius: 12px',
                'box-shadow: 0 12px 36px rgba(0, 0, 0, 0.85)',
                'z-index: 2147483647',
                'padding: 6px',
                'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                'user-select: none',
                'box-sizing: border-box',
                'animation: nebulaFadeIn 0.15s ease-out'
            ].join(';');

            let itemsHtml = creds.map((c, i) => {
                const displayTitle = c.login || 'Логин';
                const subtitle = c.site || 'С этого веб-сайта';
                return \`
                    <div class="nebula-af-item" data-idx="\${i}" style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; cursor:pointer; transition:background 0.15s;">
                        <div style="width:28px; height:28px; border-radius:50%; background:rgba(99,102,241,0.2); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </div>
                        <div style="flex-grow:1; overflow:hidden; display:flex; flex-direction:column;">
                            <span style="font-size:13px; font-weight:500; color:#f1edfd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${escapeText(displayTitle)}</span>
                            <span style="font-size:11px; color:#9d92b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${escapeText(subtitle)}</span>
                        </div>
                    </div>
                \`;
            }).join('');

            popup.innerHTML = \`
                <div style="padding:4px 8px 6px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#a496c8; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
                    <span>✨ Nebula Автозаполнение</span>
                    <span style="font-size:10px; opacity:0.7;">Esc - закрыть</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:2px; margin-top:4px;">
                    \${itemsHtml}
                </div>
                <div id="nebula-af-manage" style="margin-top:4px; padding:6px 8px; border-top:1px solid rgba(255,255,255,0.08); font-size:11px; color:#818cf8; cursor:pointer; text-align:center; border-radius:6px;">
                    Управление сохраненными паролями...
                </div>
            \`;

            document.body.appendChild(popup);

            popup.querySelectorAll('.nebula-af-item').forEach(item => {
                item.addEventListener('mouseenter', () => item.style.background = 'rgba(255, 255, 255, 0.08)');
                item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const idx = parseInt(item.dataset.idx, 10);
                    const selected = creds[idx];
                    if (selected) {
                        applyCredentials(inputEl, selected.login, selected.password);
                    }
                    removeAutofillPopup();
                });
            });

            const manageBtn = document.getElementById('nebula-af-manage');
            if (manageBtn) {
                manageBtn.addEventListener('mouseenter', () => manageBtn.style.background = 'rgba(129, 140, 248, 0.1)');
                manageBtn.addEventListener('mouseleave', () => manageBtn.style.background = 'transparent');
                manageBtn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeAutofillPopup();
                    console.log('NEBULA_OPEN_PASSWORDS_MODAL');
                });
            }
        }

        function applyCredentials(currentInput, login, password) {
            let passInput = null;
            let logInput = null;

            if (currentInput.type === 'password') {
                passInput = currentInput;
                const form = currentInput.form || currentInput.closest('form');
                if (form) {
                    const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="password"])'));
                    logInput = inputs[inputs.length - 1];
                }
            } else {
                logInput = currentInput;
                const form = currentInput.form || currentInput.closest('form');
                if (form) {
                    passInput = form.querySelector('input[type="password"]');
                } else {
                    passInput = document.querySelector('input[type="password"]');
                }
            }

            if (logInput && login) {
                logInput.value = login;
                logInput.dispatchEvent(new Event('input', { bubbles: true }));
                logInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            if (passInput && password) {
                passInput.value = password;
                passInput.dispatchEvent(new Event('input', { bubbles: true }));
                passInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        function isLoginOrPassField(el) {
            if (!el || el.tagName !== 'INPUT') return false;
            const type = (el.type || 'text').toLowerCase();
            if (type === 'password') return true;
            if (type === 'text' || type === 'email') {
                const name = (el.name || '').toLowerCase();
                const id = (el.id || '').toLowerCase();
                const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
                const placeholder = (el.placeholder || '').toLowerCase();

                if (autocomplete.includes('username') || autocomplete.includes('email')) return true;
                if (name.includes('user') || name.includes('login') || name.includes('email') || name.includes('account')) return true;
                if (id.includes('user') || id.includes('login') || id.includes('email') || id.includes('account')) return true;
                if (placeholder.includes('логин') || placeholder.includes('email') || placeholder.includes('почта') || placeholder.includes('пароль') || placeholder.includes('username')) return true;
            }
            return false;
        }

        document.addEventListener('focusin', (e) => {
            if (isLoginOrPassField(e.target)) {
                showAutofillPopup(e.target);
            } else {
                removeAutofillPopup();
            }
        }, true);

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#nebula-autofill-popup') && !isLoginOrPassField(e.target)) {
                removeAutofillPopup();
            }
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') removeAutofillPopup();
        }, true);

        window.addEventListener('scroll', () => removeAutofillPopup(), true);
    })();
    `;

    webview.executeJavaScript(script).catch(() => {});
}

function attemptPasswordAutofill(webview, pageUrl, savedPasswords) {
    const creds = getCredentialsForUrl(savedPasswords, pageUrl);
    if (!creds || creds.length === 0) return;

    const singleCred = creds[0];
    const script = `
        (function() {
            try {
                const passwordInput = document.querySelector('input[type="password"]');
                if (passwordInput && !passwordInput.value) {
                    passwordInput.value = ${JSON.stringify(singleCred.password)};
                    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
                    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

                    let loginInput = null;
                    const form = passwordInput.form || passwordInput.closest('form');
                    if (form) {
                        const textInputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="submit"])'));
                        loginInput = textInputs[textInputs.length - 1];
                    }

                    if (loginInput && !loginInput.value) {
                        loginInput.value = ${JSON.stringify(singleCred.login)};
                        loginInput.dispatchEvent(new Event('input', { bubbles: true }));
                        loginInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            } catch(e) {}
        })();
    `;
    webview.executeJavaScript(script).catch(() => {});
}

module.exports = {
    getCredentialsForUrl,
    patchChromeEnvironment,
    setupInteractiveAutofill,
    attemptPasswordAutofill
};
