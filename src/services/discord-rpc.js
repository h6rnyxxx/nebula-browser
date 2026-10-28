const net = require('net');

class DiscordRpcService {
    constructor() {
        this.enabled = true;
        this.showDetails = true;
        this.showTimer = true;
        this.clientId = '953533453100527626'; // Application name: "Nebula"
        this.socket = null;
        this.connected = false;
        this.sessionStartTime = Math.floor(Date.now() / 1000);
        this.currentPresenceData = { isNewTab: true, title: 'Начальная страница', url: '' };
        this.retryTimer = null;
        this.lastSetTime = 0;
        this.throttleTimer = null;
        this.discordUser = null;
        this.statusCallback = null;
    }

    init(options = {}, statusCallback = null) {
        if (options.clientId) this.clientId = String(options.clientId).trim();
        if (typeof options.enabled === 'boolean') this.enabled = options.enabled;
        if (typeof options.showDetails === 'boolean') this.showDetails = options.showDetails;
        if (typeof options.showTimer === 'boolean') this.showTimer = options.showTimer;
        this.statusCallback = statusCallback;

        if (this.enabled) {
            this.connect();
        }
    }

    setStatusCallback(cb) {
        this.statusCallback = cb;
        this.notifyStatus();
    }

    notifyStatus() {
        if (typeof this.statusCallback === 'function') {
            this.statusCallback(this.getStatus());
        }
    }

    connect() {
        if (this.socket || !this.enabled) return;
        this.tryConnectPipe(0);
    }

    tryConnectPipe(index) {
        if (index > 9 || !this.enabled) {
            this.scheduleRetry();
            return;
        }

        const pipePath = process.platform === 'win32'
            ? `\\\\.\\pipe\\discord-ipc-${index}`
            : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp'}/discord-ipc-${index}`;

        let connectedSuccessfully = false;
        const socket = net.connect(pipePath);

        const onConnect = () => {
            connectedSuccessfully = true;
            socket.removeListener('error', onError);
            this.socket = socket;
            this.setupSocketListeners(socket);
            this.send(0, { v: 1, client_id: this.clientId });
        };

        const onError = () => {
            if (!connectedSuccessfully) {
                try { socket.destroy(); } catch (e) {}
                this.tryConnectPipe(index + 1);
            }
        };

        socket.once('connect', onConnect);
        socket.once('error', onError);
    }

    setupSocketListeners(socket) {
        let buffer = Buffer.alloc(0);

        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 8) {
                const opcode = buffer.readInt32LE(0);
                const length = buffer.readInt32LE(4);
                if (buffer.length < 8 + length) break;
                const bodyStr = buffer.subarray(8, 8 + length).toString('utf8');
                buffer = buffer.subarray(8 + length);
                this.handleMessage(opcode, bodyStr);
            }
        });

        socket.on('error', () => {
            this.disconnect();
            this.scheduleRetry();
        });

        socket.on('close', () => {
            this.disconnect();
            this.scheduleRetry();
        });
    }

    handleMessage(opcode, bodyStr) {
        try {
            const data = JSON.parse(bodyStr);
            if (data.evt === 'READY') {
                this.connected = true;
                this.discordUser = data.data?.user || null;
                this.notifyStatus();
                this.pushCurrentActivity();
            } else if (data.cmd === 'SET_ACTIVITY') {
                // Activity successfully applied
            }
        } catch (e) {}
    }

    send(opcode, payloadObj) {
        if (!this.socket) return;
        try {
            const json = JSON.stringify(payloadObj);
            const data = Buffer.from(json, 'utf8');
            const header = Buffer.alloc(8);
            header.writeInt32LE(opcode, 0);
            header.writeInt32LE(data.length, 4);
            this.socket.write(Buffer.concat([header, data]));
        } catch (e) {}
    }

    scheduleRetry() {
        if (this.retryTimer || !this.enabled) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.enabled && !this.connected) {
                this.connect();
            }
        }, 15000);
    }

    disconnect() {
        if (this.socket) {
            try { this.socket.destroy(); } catch (e) {}
            this.socket = null;
        }
        if (this.connected) {
            this.connected = false;
            this.discordUser = null;
            this.notifyStatus();
        }
    }

    updatePresence(data) {
        this.currentPresenceData = data || { isNewTab: true, title: 'Начальная страница', url: '' };
        if (!this.enabled || !this.connected) return;

        const now = Date.now();
        if (now - this.lastSetTime < 2000) {
            if (this.throttleTimer) clearTimeout(this.throttleTimer);
            this.throttleTimer = setTimeout(() => {
                this.pushCurrentActivity();
            }, 2000);
            return;
        }

        this.pushCurrentActivity();
    }

    pushCurrentActivity() {
        if (!this.connected || !this.enabled) return;
        this.lastSetTime = Date.now();
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }

        const data = this.currentPresenceData;
        let details = 'Просматривает сайт';
        let state = 'В сети';

        if (data.isNewTab || !data.url || data.url === 'about:blank') {
            details = 'Начальная страница';
            state = 'Быстрый доступ';
        } else {
            try {
                const u = new URL(data.url);
                const host = u.hostname.replace(/^www\./i, '');

                if (host.includes('youtube.com') || host.includes('youtu.be')) {
                    const cleanTitle = (data.title || '').replace(/\s*-\s*YouTube$/i, '').trim();
                    details = cleanTitle ? `Смотрит: ${cleanTitle}` : 'Смотрит YouTube';
                    state = 'youtube.com';
                } else if (host.includes('twitch.tv')) {
                    const cleanTitle = (data.title || '').replace(/\s*-\s*Twitch$/i, '').trim();
                    details = cleanTitle ? `Смотрит стрим: ${cleanTitle}` : 'Смотрит Twitch';
                    state = 'twitch.tv';
                } else if (host.includes('github.com')) {
                    const cleanTitle = (data.title || '').replace(/\s*·\s*GitHub$/i, '').replace(/\s*-\s*GitHub$/i, '').trim();
                    details = cleanTitle ? `GitHub: ${cleanTitle}` : 'GitHub';
                    state = 'github.com';
                } else if (host.includes('vk.com')) {
                    details = data.title || 'ВКонтакте';
                    state = 'vk.com';
                } else if (host.includes('reddit.com')) {
                    details = (data.title || '').replace(/\s*:\s*r\/.*$/i, '').trim() || 'Reddit';
                    state = 'reddit.com';
                } else if (host.includes('google.')) {
                    if (u.pathname.includes('/search')) {
                        const q = u.searchParams.get('q');
                        details = q ? `Поиск: ${q}` : 'Поиск в Google';
                    } else {
                        details = 'Google';
                    }
                    state = host;
                } else if (host.includes('yandex.')) {
                    if (u.pathname.includes('/search')) {
                        const q = u.searchParams.get('text');
                        details = q ? `Поиск: ${q}` : 'Поиск в Яндексе';
                    } else {
                        details = 'Яндекс';
                    }
                    state = host;
                } else {
                    const cleanTitle = (data.title || '').trim();
                    details = cleanTitle || `Сайт: ${host}`;
                    state = host;
                }
            } catch (err) {
                details = data.title || 'Веб-серфинг';
                state = 'Nebula Browser';
            }
        }

        if (details.length > 120) details = details.substring(0, 117) + '...';
        if (state.length > 120) state = state.substring(0, 117) + '...';

        const activity = {
            details: this.showDetails ? details : 'Nebula Browser',
            state: this.showDetails ? state : 'Серфинг в интернете',
            assets: {
                large_text: 'Nebula Browser'
            }
        };

        if (this.showTimer) {
            activity.timestamps = {
                start: this.sessionStartTime
            };
        }

        this.send(1, {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: activity
            },
            nonce: String(Date.now())
        });
    }

    clearActivity() {
        if (!this.connected) return;
        this.send(1, {
            cmd: 'SET_ACTIVITY',
            args: {
                pid: process.pid,
                activity: null
            },
            nonce: String(Date.now())
        });
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.enabled) {
            this.clearActivity();
            this.disconnect();
            if (this.retryTimer) {
                clearTimeout(this.retryTimer);
                this.retryTimer = null;
            }
        } else {
            this.connect();
        }
        this.notifyStatus();
    }

    setClientId(clientId) {
        const clean = (clientId || '').trim();
        if (clean && clean !== this.clientId) {
            this.clientId = clean;
            if (this.enabled) {
                this.disconnect();
                this.connect();
            }
        }
    }

    setShowDetails(show) {
        this.showDetails = Boolean(show);
        this.pushCurrentActivity();
        this.notifyStatus();
    }

    setShowTimer(show) {
        this.showTimer = Boolean(show);
        this.pushCurrentActivity();
        this.notifyStatus();
    }

    getStatus() {
        return {
            enabled: this.enabled,
            connected: this.connected,
            clientId: this.clientId,
            showDetails: this.showDetails,
            showTimer: this.showTimer,
            user: this.discordUser ? {
                username: this.discordUser.username,
                global_name: this.discordUser.global_name
            } : null
        };
    }

    destroy() {
        this.clearActivity();
        this.disconnect();
        if (this.retryTimer) clearTimeout(this.retryTimer);
        if (this.throttleTimer) clearTimeout(this.throttleTimer);
    }
}

module.exports = new DiscordRpcService();
