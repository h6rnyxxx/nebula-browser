const tabsComp = require('./tabs');

let initialized = false;
let callbacks = {};
let currentMediaTabId = null;
let userDismissedTabId = null;
let monitorInterval = null;
let videoFrameInterval = null;
let currentMediaInfo = null;

const GET_MEDIA_INFO_SCRIPT = `
(() => {
    try {
        let title = '';
        let artist = '';
        let artwork = '';
        let isPlaying = false;
        let currentTime = 0;
        let duration = 0;
        let isVideo = false;
        let hasVideoTrack = false;
        let volume = 1;
        let muted = false;

        const mediaEls = Array.from(document.querySelectorAll('video, audio'));
        let activeEl = mediaEls.find(m => !m.paused && !m.ended && m.currentTime > 0) || mediaEls[0];

        if (activeEl) {
            isPlaying = !activeEl.paused && !activeEl.ended;
            currentTime = activeEl.currentTime || 0;
            duration = activeEl.duration || 0;
            volume = activeEl.volume !== undefined ? activeEl.volume : 1;
            muted = Boolean(activeEl.muted);
            if (activeEl.tagName.toLowerCase() === 'video') {
                isVideo = true;
                hasVideoTrack = (activeEl.videoWidth > 0 && activeEl.videoHeight > 0);
            }
        }

        if (navigator.mediaSession && navigator.mediaSession.metadata) {
            const meta = navigator.mediaSession.metadata;
            if (meta.title) title = meta.title;
            if (meta.artist) artist = meta.artist;
            if (meta.artwork && meta.artwork.length > 0) {
                const best = meta.artwork[meta.artwork.length - 1];
                if (best && best.src) artwork = best.src;
            }
            if (navigator.mediaSession.playbackState === 'playing') {
                isPlaying = true;
            }
        }

        // YouTube
        if (window.location.hostname.includes('youtube.com')) {
            if (!title) {
                const ytTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1')?.textContent;
                if (ytTitle) title = ytTitle.trim();
            }
            if (!artist) {
                const ytChannel = document.querySelector('#owner #channel-name, #upload-info #channel-name')?.textContent;
                if (ytChannel) artist = ytChannel.trim();
            }
            if (!artwork) {
                const thumb = document.querySelector('meta[property="og:image"]')?.content;
                if (thumb) artwork = thumb;
            }
        }

        // Yandex Music
        if (window.location.hostname.includes('music.yandex')) {
            if (!title) {
                const t = document.querySelector('.track__title, .d-track__title, .player-controls .track__title')?.textContent;
                if (t) title = t.trim();
            }
            if (!artist) {
                const a = document.querySelector('.track__artists, .d-track__artists, .player-controls .track__artists')?.textContent;
                if (a) artist = a.trim();
            }
            if (!artwork) {
                const img = document.querySelector('.track-cover img, .d-track__cover img, .player-controls img')?.src;
                if (img) artwork = img;
            }
        }

        // Spotify
        if (window.location.hostname.includes('spotify.com')) {
            if (!title) {
                const t = document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-title"]')?.textContent;
                if (t) title = t.trim();
            }
            if (!artist) {
                const a = document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-subtitles"]')?.textContent;
                if (a) artist = a.trim();
            }
            if (!artwork) {
                const img = document.querySelector('[data-testid="now-playing-widget"] img')?.src;
                if (img) artwork = img;
            }
        }

        // Fallbacks
        if (!title) {
            title = document.title || 'Медиа';
            title = title.replace(/\\s*-\\s*YouTube$/i, '').replace(/\\s*\\|\\s*VK$/i, '').trim();
        }
        if (!artist) {
            const host = window.location.hostname.replace(/^www\\./, '');
            artist = host ? (host.charAt(0).toUpperCase() + host.slice(1)) : 'Nebula';
        }
        if (!artwork) {
            const og = document.querySelector('meta[property="og:image"]')?.content;
            if (og) artwork = og;
            else if (activeEl && activeEl.poster) artwork = activeEl.poster;
        }

        return {
            title,
            artist,
            artwork,
            isPlaying,
            currentTime,
            duration,
            isVideo: isVideo && hasVideoTrack,
            volume,
            muted
        };
    } catch (e) {
        return null;
    }
})()
`;

const VIDEO_FRAME_SCRIPT = `
(() => {
    try {
        const v = document.querySelector('video');
        if (!v || v.paused || v.ended || v.videoWidth === 0) return null;
        if (!window.__nfp_canvas) {
            window.__nfp_canvas = document.createElement('canvas');
            window.__nfp_ctx = window.__nfp_canvas.getContext('2d');
        }
        const c = window.__nfp_canvas;
        const ctx = window.__nfp_ctx;
        const w = 340;
        const h = Math.round(340 * (v.videoHeight / v.videoWidth)) || 192;
        if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
        }
        ctx.drawImage(v, 0, 0, w, h);
        return c.toDataURL('image/jpeg', 0.65);
    } catch (e) {
        return null;
    }
})()
`;

function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function initFloatingPlayer(cbs = {}) {
    if (initialized) return;
    initialized = true;
    callbacks = cbs;

    const playerEl = document.getElementById('nebula-floating-player');
    const dragBar = document.getElementById('nfp-drag-bar');
    const resizeHandle = document.getElementById('nfp-resize-handle');
    if (!playerEl || !dragBar) return;

    setupDraggable(playerEl, dragBar);
    if (resizeHandle) {
        setupResizable(playerEl, resizeHandle);
    }
    setupControls();

    // Запускаем периодический мониторинг медиа (разгруженная частота)
    if (!monitorInterval) {
        monitorInterval = setInterval(() => checkActiveMedia(), 2000);
    }
}

function setupDraggable(playerEl, dragBar) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    // Восстанавливаем позицию и размер из localStorage
    try {
        const savedPos = JSON.parse(localStorage.getItem('nebula_floating_player_pos'));
        if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
            const clampedLeft = Math.max(10, Math.min(window.innerWidth - 380, savedPos.left));
            const clampedTop = Math.max(60, Math.min(window.innerHeight - 260, savedPos.top));
            playerEl.style.left = `${clampedLeft}px`;
            playerEl.style.top = `${clampedTop}px`;
            playerEl.style.right = 'auto';
            playerEl.style.bottom = 'auto';
        }

        const savedSize = JSON.parse(localStorage.getItem('nebula_floating_player_size'));
        if (savedSize && typeof savedSize.width === 'number') {
            const clampedW = Math.max(260, Math.min(window.innerWidth - 40, savedSize.width));
            playerEl.style.width = `${clampedW}px`;
        }
    } catch (e) {}

    const onPointerDown = (e) => {
        if (e.target.closest('button, input, .nfp-timeline-container, .nfp-sub-btn')) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = playerEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        playerEl.classList.add('is-dragging');
        document.body.style.userSelect = 'none';

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const maxLeft = Math.max(10, window.innerWidth - playerEl.offsetWidth - 10);
        const maxTop = Math.max(60, window.innerHeight - playerEl.offsetHeight - 10);

        const newLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
        const newTop = Math.max(60, Math.min(maxTop, initialTop + dy));

        playerEl.style.left = `${newLeft}px`;
        playerEl.style.top = `${newTop}px`;
        playerEl.style.right = 'auto';
        playerEl.style.bottom = 'auto';
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        playerEl.classList.remove('is-dragging');
        document.body.style.userSelect = '';

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        const rect = playerEl.getBoundingClientRect();
        try {
            localStorage.setItem('nebula_floating_player_pos', JSON.stringify({
                left: Math.round(rect.left),
                top: Math.round(rect.top)
            }));
        } catch (e) {}
    };

    dragBar.addEventListener('pointerdown', onPointerDown);

    window.addEventListener('resize', () => {
        if (playerEl.style.left) {
            const rect = playerEl.getBoundingClientRect();
            const maxLeft = Math.max(10, window.innerWidth - playerEl.offsetWidth - 10);
            const maxTop = Math.max(60, window.innerHeight - playerEl.offsetHeight - 10);
            playerEl.style.left = `${Math.min(maxLeft, Math.max(10, rect.left))}px`;
            playerEl.style.top = `${Math.min(maxTop, Math.max(60, rect.top))}px`;
        }
    });
}

function setupResizable(playerEl, handle) {
    if (!playerEl || !handle) return;
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const onPointerDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startWidth = playerEl.offsetWidth;

        playerEl.classList.add('is-resizing');
        document.body.style.userSelect = 'none';

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    const onPointerMove = (e) => {
        if (!isResizing) return;
        const dx = e.clientX - startX;
        const maxWidth = Math.max(260, window.innerWidth - playerEl.offsetLeft - 20);
        const newWidth = Math.max(260, Math.min(maxWidth, Math.min(680, startWidth + dx)));
        playerEl.style.width = `${newWidth}px`;
    };

    const onPointerUp = () => {
        if (!isResizing) return;
        isResizing = false;
        playerEl.classList.remove('is-resizing');
        document.body.style.userSelect = '';

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        try {
            localStorage.setItem('nebula_floating_player_size', JSON.stringify({
                width: Math.round(playerEl.offsetWidth)
            }));
        } catch (e) {}
    };

    handle.addEventListener('pointerdown', onPointerDown);
}
    // 1. Play / Pause
    document.getElementById('nfp-music-play-btn')?.addEventListener('click', () => togglePlayPause());
    document.getElementById('nfp-video-play-btn')?.addEventListener('click', () => togglePlayPause());

    // 2. Next / Prev
    document.getElementById('nfp-music-next-btn')?.addEventListener('click', () => nextTrack());
    document.getElementById('nfp-video-next-btn')?.addEventListener('click', () => nextTrack());
    document.getElementById('nfp-music-prev-btn')?.addEventListener('click', () => prevTrack());
    document.getElementById('nfp-video-prev-btn')?.addEventListener('click', () => prevTrack());

    // 3. Mute
    document.getElementById('nfp-music-mute-btn')?.addEventListener('click', () => toggleMute());
    document.getElementById('nfp-video-mute-btn')?.addEventListener('click', () => toggleMute());

    // 4. Timelines (Seeking)
    const setupTimelineClick = (wrapId) => {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        wrap.addEventListener('click', (e) => {
            const rect = wrap.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seek(pct);
        });
    };
    setupTimelineClick('nfp-music-timeline-wrap');
    setupTimelineClick('nfp-video-timeline-wrap');

    // 5. Jump to Tab
    document.getElementById('nfp-jump-btn')?.addEventListener('click', () => jumpToMediaTab());

    // 6. Close / Dismiss
    document.getElementById('nfp-close-btn')?.addEventListener('click', () => {
        userDismissedTabId = currentMediaTabId;
        hidePlayer();
    });
}

function getMediaTab() {
    if (!currentMediaTabId) return null;
    const allTabs = tabsComp.getTabs() || [];
    return allTabs.find(t => t.id === currentMediaTabId) || null;
}

async function executeInMediaTab(code) {
    const tab = getMediaTab();
    if (tab && tab.view) {
        return tab.view.executeJavaScript(code).catch(() => null);
    }
    return null;
}

async function togglePlayPause() {
    await executeInMediaTab(`
        (() => {
            const el = document.querySelector('video, audio');
            if (el) {
                if (el.paused) el.play(); else el.pause();
                return;
            }
            if (window.location.hostname.includes('youtube.com')) {
                const btn = document.querySelector('.ytp-play-button');
                if (btn) btn.click();
            } else if (window.location.hostname.includes('music.yandex')) {
                const btn = document.querySelector('.player-controls__btn_play, .d-icon_play, [data-action="play"]');
                if (btn) btn.click();
            }
        })()
    `);
    setTimeout(() => checkActiveMedia(), 150);
}

async function nextTrack() {
    await executeInMediaTab(`
        (() => {
            if (window.location.hostname.includes('youtube.com')) {
                const btn = document.querySelector('.ytp-next-button');
                if (btn) btn.click();
                else { const v = document.querySelector('video'); if (v) v.currentTime += 10; }
            } else if (window.location.hostname.includes('music.yandex')) {
                const btn = document.querySelector('.d-icon_track-next, [data-action="next"]');
                if (btn) btn.click();
            } else if (window.location.hostname.includes('spotify.com')) {
                const btn = document.querySelector('[data-testid="control-button-skip-forward"]');
                if (btn) btn.click();
            } else {
                const el = document.querySelector('video, audio');
                if (el) el.currentTime += 10;
            }
        })()
    `);
    setTimeout(() => checkActiveMedia(), 200);
}

async function prevTrack() {
    await executeInMediaTab(`
        (() => {
            if (window.location.hostname.includes('youtube.com')) {
                const btn = document.querySelector('.ytp-prev-button');
                if (btn) btn.click();
                else { const v = document.querySelector('video'); if (v) v.currentTime = Math.max(0, v.currentTime - 10); }
            } else if (window.location.hostname.includes('music.yandex')) {
                const btn = document.querySelector('.d-icon_track-prev, [data-action="prev"]');
                if (btn) btn.click();
            } else if (window.location.hostname.includes('spotify.com')) {
                const btn = document.querySelector('[data-testid="control-button-skip-back"]');
                if (btn) btn.click();
            } else {
                const el = document.querySelector('video, audio');
                if (el) el.currentTime = Math.max(0, el.currentTime - 10);
            }
        })()
    `);
    setTimeout(() => checkActiveMedia(), 200);
}

async function seek(pct) {
    await executeInMediaTab(`
        (() => {
            const el = document.querySelector('video, audio');
            if (el && el.duration) {
                el.currentTime = el.duration * ${pct};
            }
        })()
    `);
}

async function toggleMute() {
    await executeInMediaTab(`
        (() => {
            const el = document.querySelector('video, audio');
            if (el) {
                el.muted = !el.muted;
            }
        })()
    `);
    setTimeout(() => checkActiveMedia(), 150);
}

function jumpToMediaTab() {
    if (currentMediaTabId && callbacks.switchTab) {
        callbacks.switchTab(currentMediaTabId);
    }
}

function hidePlayer() {
    const playerEl = document.getElementById('nebula-floating-player');
    if (playerEl) playerEl.classList.add('hidden');
    stopVideoLoop();
}

function showPlayer() {
    const playerEl = document.getElementById('nebula-floating-player');
    if (playerEl) playerEl.classList.remove('hidden');
}

function startVideoLoop(tab) {
    stopVideoLoop();
    const frameImg = document.getElementById('nfp-video-frame');
    const posterImg = document.getElementById('nfp-video-poster');

    if (currentMediaInfo?.artwork && posterImg) {
        posterImg.src = currentMediaInfo.artwork;
        posterImg.classList.remove('hidden');
        frameImg?.classList.add('hidden');
    }

    // Разовый забор качественного превью-кадра без циклического пожирания CPU
    if (tab && tab.view && currentMediaInfo?.isVideo) {
        tab.view.executeJavaScript(VIDEO_FRAME_SCRIPT).then(frame => {
            if (frame && frameImg) {
                frameImg.src = frame;
                frameImg.classList.remove('hidden');
                posterImg?.classList.add('hidden');
            }
        }).catch(() => {});
    }
}

function stopVideoLoop() {
    if (videoFrameInterval) {
        clearInterval(videoFrameInterval);
        videoFrameInterval = null;
    }
}

async function checkActiveMedia() {
    const allTabs = tabsComp.getTabs() || [];
    const activeTab = tabsComp.getActiveTab();

    // Ищем фоновую вкладку с активным медиапотоком
    let candidateTab = null;
    let candidateInfo = null;

    for (const t of allTabs) {
        // Проверяем только если вкладка НЕ является активной или активная вкладка - это стартовая страница
        const isBackground = !activeTab || (t.id !== activeTab.id) || activeTab.isNewTab;
        if (!isBackground || !t.view || t.isNewTab) continue;

        try {
            const info = await t.view.executeJavaScript(GET_MEDIA_INFO_SCRIPT).catch(() => null);
            if (info && (info.isPlaying || (t.id === currentMediaTabId && info.currentTime > 0))) {
                candidateTab = t;
                candidateInfo = info;
                break;
            }
        } catch (e) {}
    }

    if (!candidateTab || !candidateInfo) {
        // Если медиа больше нигде не играет, скрываем плеер
        if (currentMediaTabId) {
            currentMediaTabId = null;
            currentMediaInfo = null;
            hidePlayer();
        }
        return;
    }

    // Если пользователь закрыл плеер именно для этого таба и он все еще играет тот же трек
    if (userDismissedTabId === candidateTab.id && candidateInfo.title === currentMediaInfo?.title) {
        return;
    }
    userDismissedTabId = null;

    currentMediaTabId = candidateTab.id;
    currentMediaInfo = candidateInfo;

    updatePlayerUI(candidateTab, candidateInfo);
    showPlayer();
}

function updatePlayerUI(tab, info) {
    const playerEl = document.getElementById('nebula-floating-player');
    const badgeEl = document.getElementById('nfp-type-badge');
    const videoSection = document.getElementById('nfp-video-section');
    const musicSection = document.getElementById('nfp-music-section');
    if (!playerEl || !videoSection || !musicSection) return;

    const isVideo = Boolean(info.isVideo);

    if (isVideo) {
        // --- РЕЖИМ ВИДЕО ---
        badgeEl.innerHTML = '<i class="fa-solid fa-film"></i> Видео';
        videoSection.classList.remove('hidden');
        musicSection.classList.add('hidden');

        document.getElementById('nfp-video-title').textContent = info.title || 'Видеоролик';
        document.getElementById('nfp-video-channel').textContent = info.artist || '';

        const playBtn = document.getElementById('nfp-video-play-btn');
        if (playBtn) {
            playBtn.innerHTML = info.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        }

        const muteBtn = document.getElementById('nfp-video-mute-btn');
        if (muteBtn) {
            muteBtn.innerHTML = info.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
        }

        document.getElementById('nfp-video-current-time').textContent = formatTime(info.currentTime);
        document.getElementById('nfp-video-duration').textContent = formatTime(info.duration);

        const pct = (info.duration > 0) ? Math.min(100, (info.currentTime / info.duration) * 100) : 0;
        const fill = document.getElementById('nfp-video-timeline-fill');
        if (fill) fill.style.width = `${pct}%`;

        startVideoLoop(tab);
    } else {
        // --- РЕЖИМ МУЗЫКИ ---
        stopVideoLoop();
        badgeEl.innerHTML = '<i class="fa-solid fa-music"></i> Музыка';
        musicSection.classList.remove('hidden');
        videoSection.classList.add('hidden');

        document.getElementById('nfp-track-title').textContent = info.title || 'Аудиозапись';
        document.getElementById('nfp-track-artist').textContent = info.artist || 'Неизвестный исполнитель';

        const coverImg = document.getElementById('nfp-cover-img');
        const fallback = document.getElementById('nfp-cover-fallback');

        if (info.artwork) {
            coverImg.src = info.artwork;
            coverImg.classList.remove('hidden');
            fallback?.classList.add('hidden');
        } else {
            coverImg.classList.add('hidden');
            fallback?.classList.remove('hidden');
        }

        if (info.isPlaying) {
            musicSection.classList.add('is-playing');
        } else {
            musicSection.classList.remove('is-playing');
        }

        const playBtn = document.getElementById('nfp-music-play-btn');
        if (playBtn) {
            playBtn.innerHTML = info.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        }

        const muteBtn = document.getElementById('nfp-music-mute-btn');
        if (muteBtn) {
            muteBtn.innerHTML = info.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
        }

        document.getElementById('nfp-music-current-time').textContent = formatTime(info.currentTime);
        document.getElementById('nfp-music-duration').textContent = formatTime(info.duration);

        const pct = (info.duration > 0) ? Math.min(100, (info.currentTime / info.duration) * 100) : 0;
        const fill = document.getElementById('nfp-music-timeline-fill');
        if (fill) fill.style.width = `${pct}%`;
    }
}

// Хуки из tabs.js
function onActiveTabChanged(activeTabId) {
    const activeTab = tabsComp.getActiveTab();
    // Если пользователь перешел на сам таб с медиа (и это не новая вкладка) - скрываем мини-плеер
    if (activeTab && activeTab.id === currentMediaTabId && !activeTab.isNewTab) {
        hidePlayer();
    } else {
        checkActiveMedia();
    }
}

function onTabClosed(closedTabId) {
    if (closedTabId === currentMediaTabId) {
        currentMediaTabId = null;
        currentMediaInfo = null;
        hidePlayer();
    }
}

function handleMediaStateChange(tabData, isPlaying) {
    checkActiveMedia();
}

module.exports = {
    initFloatingPlayer,
    onActiveTabChanged,
    onTabClosed,
    handleMediaStateChange,
    checkActiveMedia
};
