const { ipcRenderer } = require('electron');

let urlInputEl = null;
let suggestionsContainer = null;
let currentEngineKeyGetter = null;
let searchEnginesMap = null;
let navigateCallback = null;

let currentItems = [];
let activeIndex = -1;
let originalUserQuery = '';
let debounceTimer = null;
let currentAbortController = null;

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatSuggestionHtml(fullText, query) {
    const qLower = query.toLowerCase().trim();
    const tLower = fullText.toLowerCase();

    if (tLower.startsWith(qLower)) {
        const prefix = fullText.slice(0, qLower.length);
        const rest = fullText.slice(qLower.length);
        return `<span class="sugg-matched">${escapeHtml(prefix)}</span><span class="sugg-rest">${escapeHtml(rest)}</span>`;
    }

    const idx = tLower.indexOf(qLower);
    if (idx !== -1) {
        const before = fullText.slice(0, idx);
        const match = fullText.slice(idx, idx + qLower.length);
        const after = fullText.slice(idx + qLower.length);
        return `<span class="sugg-rest">${escapeHtml(before)}</span><span class="sugg-matched">${escapeHtml(match)}</span><span class="sugg-rest">${escapeHtml(after)}</span>`;
    }

    return `<span class="sugg-rest">${escapeHtml(fullText)}</span>`;
}

async function fetchRemoteSuggestions(query, engineKey) {
    if (currentAbortController) {
        currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const encoded = encodeURIComponent(query);
    let url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encoded}`;

    if (engineKey === 'yandex') {
        url = `https://suggest.yandex.ru/suggest-ya.cgi?v=4&part=${encoded}`;
    } else if (engineKey === 'duckduckgo') {
        url = `https://duckduckgo.com/ac/?q=${encoded}&type=list`;
    }

    try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (engineKey === 'yandex') {
            const text = await res.text();
            const match = text.match(/\[.*\]/s);
            if (match) {
                const data = JSON.parse(match[0]);
                return Array.isArray(data[1]) ? data[1] : [];
            }
            return [];
        } else {
            const data = await res.json();
            return Array.isArray(data[1]) ? data[1] : [];
        }
    } catch (err) {
        if (err.name === 'AbortError') return null; // superseded by newer query
        // Fallback to Google suggest if engine failed
        if (engineKey !== 'google') {
            try {
                const fbRes = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encoded}`);
                const fbData = await fbRes.json();
                return Array.isArray(fbData[1]) ? fbData[1] : [];
            } catch (e) {}
        }
        return [];
    }
}

async function fetchLocalMatches(query) {
    const qLower = query.toLowerCase().trim();
    if (!qLower) return [];

    const results = [];

    // 1. Check bookmarks
    try {
        const bookmarks = await ipcRenderer.invoke('db-get-bookmarks');
        if (Array.isArray(bookmarks)) {
            for (const b of bookmarks) {
                if ((b.title && b.title.toLowerCase().includes(qLower)) || 
                    (b.url && b.url.toLowerCase().includes(qLower))) {
                    results.push({
                        type: 'bookmark',
                        title: b.title || b.url,
                        url: b.url,
                        text: b.url
                    });
                    if (results.length >= 2) break;
                }
            }
        }
    } catch(e) {}

    // 2. Check history
    try {
        const historyItems = await ipcRenderer.invoke('db-get-history', query, 5);
        if (Array.isArray(historyItems)) {
            for (const h of historyItems) {
                if (!results.some(r => r.url === h.url)) {
                    results.push({
                        type: 'history',
                        title: h.title || h.url,
                        url: h.url,
                        text: h.url
                    });
                    if (results.length >= 4) break;
                }
            }
        }
    } catch(e) {}

    return results;
}

async function updateSuggestions(query) {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
        hideSuggestions();
        return;
    }

    originalUserQuery = query;

    const engineKey = currentEngineKeyGetter ? currentEngineKeyGetter() : 'google';
    const engineInfo = (searchEnginesMap && searchEnginesMap[engineKey]) ? searchEnginesMap[engineKey] : { name: 'Google' };

    // Fetch remote search suggestions + local history/bookmarks in parallel
    const [remoteList, localList] = await Promise.all([
        fetchRemoteSuggestions(cleanQuery, engineKey),
        fetchLocalMatches(cleanQuery)
    ]);

    if (remoteList === null) {
        // Aborted request, do not touch current rendering
        return;
    }

    const items = [];

    // 1. Top verbatim search query (always first, matching the screenshot)
    items.push({
        type: 'search-query',
        query: cleanQuery,
        text: cleanQuery,
        engineName: engineInfo.name
    });

    // 2. Add local bookmarks and history matches (if any)
    if (Array.isArray(localList)) {
        for (const loc of localList) {
            items.push(loc);
        }
    }

    // 3. Add remote search suggestions (up to 9 items)
    if (Array.isArray(remoteList)) {
        for (const sugg of remoteList) {
            if (typeof sugg === 'string' && sugg.trim().toLowerCase() !== cleanQuery.toLowerCase()) {
                items.push({
                    type: 'suggestion',
                    text: sugg.trim()
                });
                if (items.length >= 10) break;
            }
        }
    }

    currentItems = items;
    activeIndex = 0; // Highlight first item by default, exactly as shown in screenshot
    renderSuggestions(cleanQuery);
}

function renderSuggestions(query) {
    if (!suggestionsContainer) return;

    if (!currentItems || currentItems.length === 0) {
        hideSuggestions();
        return;
    }

    suggestionsContainer.innerHTML = currentItems.map((item, index) => {
        const isActive = index === activeIndex;
        const activeClass = isActive ? 'active' : '';

        if (item.type === 'search-query') {
            return `
                <div class="sugg-row ${activeClass}" data-index="${index}">
                    <i class="fa-solid fa-magnifying-glass sugg-icon"></i>
                    <div class="sugg-content">
                        <span class="sugg-main-text">${escapeHtml(item.query)}</span>
                        <span class="sugg-meta-label">• Поиск через ${escapeHtml(item.engineName)}</span>
                    </div>
                </div>
            `;
        }

        if (item.type === 'bookmark' || item.type === 'history') {
            const iconClass = item.type === 'bookmark' ? 'fa-solid fa-star' : 'fa-solid fa-clock-rotate-left';
            const metaTag = item.type === 'bookmark' ? 'Закладка' : 'История';
            return `
                <div class="sugg-row ${activeClass}" data-index="${index}">
                    <i class="${iconClass} sugg-icon" style="color: ${item.type === 'bookmark' ? '#fbbf24' : '#818cf8'};"></i>
                    <div class="sugg-content">
                        <span class="sugg-main-text">${escapeHtml(item.title)}</span>
                        <span class="sugg-url-text">${escapeHtml(item.url)}</span>
                        <span class="sugg-meta-label">• ${metaTag}</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="sugg-row ${activeClass}" data-index="${index}">
                <i class="fa-solid fa-magnifying-glass sugg-icon"></i>
                <div class="sugg-content">
                    <span class="sugg-main-text">${formatSuggestionHtml(item.text, query)}</span>
                </div>
            </div>
        `;
    }).join('');

    suggestionsContainer.classList.remove('hidden');
    document.getElementById('url-bar-container')?.classList.add('has-suggestions');

    // Add click listeners to rows
    suggestionsContainer.querySelectorAll('.sugg-row').forEach(row => {
        row.addEventListener('mousedown', (e) => {
            // Prevent input blur before click finishes
            e.preventDefault();
        });

        row.addEventListener('click', () => {
            const idx = parseInt(row.dataset.index, 10);
            selectItem(idx);
        });

        row.addEventListener('mouseenter', () => {
            const idx = parseInt(row.dataset.index, 10);
            setActiveIndex(idx, false);
        });
    });
}

function setActiveIndex(newIndex, updateInput = true) {
    if (newIndex < -1) newIndex = currentItems.length - 1;
    if (newIndex >= currentItems.length) newIndex = -1;

    activeIndex = newIndex;

    const rows = suggestionsContainer?.querySelectorAll('.sugg-row');
    if (rows) {
        rows.forEach((row, i) => {
            if (i === activeIndex) {
                row.classList.add('active');
                row.scrollIntoView({ block: 'nearest' });
            } else {
                row.classList.remove('active');
            }
        });
    }

    if (updateInput && urlInputEl) {
        if (activeIndex === -1) {
            urlInputEl.value = originalUserQuery;
        } else if (currentItems[activeIndex]) {
            const item = currentItems[activeIndex];
            urlInputEl.value = item.text || item.query || item.url;
        }
    }
}

function selectItem(index) {
    const item = currentItems[index];
    if (!item) return;

    hideSuggestions();

    const target = item.url || item.text || item.query;
    if (navigateCallback && target) {
        navigateCallback(target);
    }
}

function hideSuggestions() {
    if (suggestionsContainer) {
        suggestionsContainer.classList.add('hidden');
        suggestionsContainer.innerHTML = '';
    }
    document.getElementById('url-bar-container')?.classList.remove('has-suggestions');
    currentItems = [];
    activeIndex = -1;
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
}

function initSuggestions(inputElement, enginesMap, getEngineKeyFn, onNavigate) {
    urlInputEl = inputElement;
    searchEnginesMap = enginesMap;
    currentEngineKeyGetter = getEngineKeyFn;
    navigateCallback = onNavigate;

    suggestionsContainer = document.getElementById('omnibox-suggestions');
    if (!urlInputEl || !suggestionsContainer) return;

    // 1. Input listener with debounce
    urlInputEl.addEventListener('input', (e) => {
        const val = e.target.value;
        clearTimeout(debounceTimer);
        if (!val || !val.trim()) {
            hideSuggestions();
            return;
        }

        debounceTimer = setTimeout(() => {
            updateSuggestions(val);
        }, 220);
    });

    // 2. Keyboard navigation in URL input
    urlInputEl.addEventListener('keydown', (e) => {
        const isVisible = !suggestionsContainer.classList.contains('hidden') && currentItems.length > 0;

        if (e.key === 'ArrowDown') {
            if (!isVisible) {
                if (urlInputEl.value.trim()) {
                    updateSuggestions(urlInputEl.value);
                }
                return;
            }
            e.preventDefault();
            setActiveIndex(activeIndex + 1, true);
            return;
        }

        if (e.key === 'ArrowUp') {
            if (!isVisible) return;
            e.preventDefault();
            setActiveIndex(activeIndex - 1, true);
            return;
        }

        if (e.key === 'Enter') {
            if (isVisible && activeIndex >= 0 && currentItems[activeIndex]) {
                e.preventDefault();
                e.stopImmediatePropagation();
                selectItem(activeIndex);
                return;
            }
            hideSuggestions();
            return;
        }

        if (e.key === 'Escape') {
            if (isVisible) {
                e.preventDefault();
                e.stopImmediatePropagation();
                hideSuggestions();
                if (originalUserQuery) {
                    urlInputEl.value = originalUserQuery;
                }
            }
        }
    });

    // 3. Close on click outside
    document.addEventListener('pointerdown', (e) => {
        const urlBar = document.getElementById('url-bar-container');
        if (urlBar && !urlBar.contains(e.target)) {
            hideSuggestions();
        }
    });
}

module.exports = {
    initSuggestions,
    hideSuggestions
};
