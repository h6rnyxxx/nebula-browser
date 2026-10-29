const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');

let db = null;
let dbPath = null;
let saveTimeout = null;

let isSaving = false;
let pendingSave = false;

function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveDatabaseAsync();
    }, 800);
}

async function saveDatabaseAsync() {
    if (!db || !dbPath) return;
    if (isSaving) {
        pendingSave = true;
        return;
    }
    isSaving = true;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        await fs.promises.writeFile(dbPath, buffer);
    } catch (e) {
        console.error('[DB] Async save error:', e);
    } finally {
        isSaving = false;
        if (pendingSave) {
            pendingSave = false;
            scheduleSave();
        }
    }
}

function saveDatabaseNow() {
    if (!db || !dbPath) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    } catch (e) {
        console.error('[DB] Save error:', e);
    }
}

async function initDatabase() {
    if (db) return db;

    const dbDir = app.getPath('userData');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    dbPath = path.join(dbDir, 'nebula.sqlite');

    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
        try {
            const fileBuffer = fs.readFileSync(dbPath);
            db = new SQL.Database(fileBuffer);
        } catch (err) {
            console.error('[DB] Failed to load existing SQLite file, creating new:', err);
            db = new SQL.Database();
        }
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            visit_time INTEGER NOT NULL,
            formatted_time TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS passwords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site TEXT NOT NULL,
            login TEXT NOT NULL,
            password TEXT NOT NULL,
            is_encrypted INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS speed_dial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            icon TEXT DEFAULT 'fa-solid fa-globe',
            color TEXT DEFAULT '#6366f1'
        );
    `);

    // Начальные плитки speed_dial, если таблица пуста
    const dialRows = queryAll('SELECT count(*) as count FROM speed_dial');
    if (dialRows.length === 0 || dialRows[0].count === 0) {
        const defaultTiles = [
            ['YouTube', 'https://www.youtube.com', 'fa-brands fa-youtube', '#ff0000'],
            ['Яндекс', 'https://ya.ru', 'fa-solid fa-y', '#fc3f1d'],
            ['GitHub', 'https://github.com', 'fa-brands fa-github', '#24292e'],
            ['Telegram', 'https://web.telegram.org', 'fa-brands fa-telegram', '#229ed9'],
            ['Twitch', 'https://www.twitch.tv', 'fa-brands fa-twitch', '#9146ff'],
            ['Reddit', 'https://www.reddit.com', 'fa-brands fa-reddit', '#ff4500'],
            ['Discord', 'https://discord.com', 'fa-brands fa-discord', '#5865f2']
        ];
        for (const tile of defaultTiles) {
            db.run('INSERT INTO speed_dial (name, url, icon, color) VALUES (?, ?, ?, ?)', tile);
        }
        scheduleSave();
    }

    // Начальные закладки, если таблица пуста
    const bmRows = queryAll('SELECT count(*) as count FROM bookmarks');
    if (bmRows.length === 0 || bmRows[0].count === 0) {
        db.run('INSERT INTO bookmarks (title, url, created_at) VALUES (?, ?, ?)', ['YouTube', 'https://www.youtube.com', Date.now()]);
        db.run('INSERT INTO bookmarks (title, url, created_at) VALUES (?, ?, ?)', ['GitHub', 'https://github.com', Date.now()]);
        scheduleSave();
    }

    app.on('before-quit', () => {
        saveDatabaseNow();
    });

    return db;
}

function queryAll(sql, params = []) {
    if (!db) return [];
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    } catch (e) {
        console.error('[DB] queryAll error:', e, sql);
        return [];
    }
}

function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

function encryptPassword(plainText) {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
            const encrypted = safeStorage.encryptString(plainText);
            return { data: encrypted.toString('base64'), isEncrypted: 1 };
        } catch (e) {
            console.error('[DB] SafeStorage encrypt error:', e);
        }
    }
    return { data: plainText, isEncrypted: 0 };
}

function decryptPassword(data, isEncrypted) {
    if (isEncrypted && safeStorage && safeStorage.isEncryptionAvailable()) {
        try {
            const buf = Buffer.from(data, 'base64');
            return safeStorage.decryptString(buf);
        } catch (e) {
            console.error('[DB] SafeStorage decrypt error:', e);
        }
    }
    return data;
}

// =================== HISTORY ===================
function getHistory(searchTerm = '', limit = 200) {
    if (searchTerm && searchTerm.trim()) {
        const q = `%${searchTerm.trim()}%`;
        return queryAll('SELECT * FROM history WHERE title LIKE ? OR url LIKE ? ORDER BY visit_time DESC LIMIT ?', [q, q, limit]);
    }
    return queryAll('SELECT * FROM history ORDER BY visit_time DESC LIMIT ?', [limit]);
}

function addHistory(title, url, visitTime = Date.now(), formattedTime = '') {
    if (!url || url.startsWith('data:') || url === 'about:blank' || url.startsWith('nebula://')) return;

    if (!formattedTime) {
        const now = new Date(visitTime);
        formattedTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} (${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')})`;
    }

    db.run('DELETE FROM history WHERE url = ? AND visit_time > ?', [url, visitTime - 300000]);
    db.run('INSERT INTO history (title, url, visit_time, formatted_time) VALUES (?, ?, ?, ?)', [title || url, url, visitTime, formattedTime]);
    scheduleSave();
}

function deleteHistoryItem(id) {
    db.run('DELETE FROM history WHERE id = ?', [id]);
    scheduleSave();
    return true;
}

function clearHistory() {
    db.run('DELETE FROM history');
    scheduleSave();
    return true;
}

// =================== BOOKMARKS ===================
function getBookmarks() {
    return queryAll('SELECT * FROM bookmarks ORDER BY id ASC');
}

function addBookmark(title, url) {
    if (!url) return false;
    const existing = queryOne('SELECT id FROM bookmarks WHERE url = ?', [url]);
    if (existing) {
        db.run('UPDATE bookmarks SET title = ? WHERE id = ?', [title || url, existing.id]);
    } else {
        db.run('INSERT INTO bookmarks (title, url, created_at) VALUES (?, ?, ?)', [title || url, url, Date.now()]);
    }
    scheduleSave();
    return true;
}

function removeBookmark(url) {
    db.run('DELETE FROM bookmarks WHERE url = ?', [url]);
    scheduleSave();
    return true;
}

function isBookmarked(url) {
    if (!url) return false;
    const item = queryOne('SELECT id FROM bookmarks WHERE url = ?', [url]);
    return Boolean(item);
}

// =================== PASSWORDS ===================
function getPasswords() {
    const rows = queryAll('SELECT * FROM passwords ORDER BY id DESC');
    return rows.map(r => ({
        id: r.id,
        site: r.site,
        login: r.login,
        password: decryptPassword(r.password, r.is_encrypted),
        createdAt: r.created_at
    }));
}

function cleanDomain(site) {
    if (!site) return '';
    try {
        let s = site.trim();
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        return new URL(s).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (e) {
        return site.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    }
}

function savePassword(site, login, password) {
    if (!db || !site || !login) return false;

    const cleanSite = cleanDomain(site);
    const cleanLogin = login.trim();
    const existing = queryOne('SELECT id FROM passwords WHERE site = ? AND login = ?', [cleanSite, cleanLogin]);
    const { data, isEncrypted } = encryptPassword(password || '');

    if (existing) {
        db.run('UPDATE passwords SET password = ?, is_encrypted = ? WHERE id = ?', [data, isEncrypted, existing.id]);
    } else {
        db.run('INSERT INTO passwords (site, login, password, is_encrypted, created_at) VALUES (?, ?, ?, ?, ?)', [cleanSite, cleanLogin, data, isEncrypted, Date.now()]);
    }
    saveDatabaseNow();
    return true;
}

function clearAllPasswords() {
    if (!db) return false;
    db.run('DELETE FROM passwords');
    saveDatabaseNow();
    return true;
}

function deletePassword(id, site, login) {
    if (!db) return false;
    const numId = parseInt(id, 10);
    if (!isNaN(numId) && numId > 0) {
        db.run('DELETE FROM passwords WHERE id = ?', [numId]);
    }
    if (site && login) {
        const cleanSite = cleanDomain(site);
        db.run('DELETE FROM passwords WHERE (site = ? OR site = ?) AND login = ?', [cleanSite, String(site).trim(), String(login).trim()]);
    }
    saveDatabaseNow();
    return true;
}

function importPasswordsList(passwordsList) {
    if (!db || !Array.isArray(passwordsList) || passwordsList.length === 0) return 0;

    let addedCount = 0;
    for (const item of passwordsList) {
        if (!item.site || !item.login) continue;
        const cleanSite = cleanDomain(item.site);
        const cleanLogin = item.login.trim();
        const { data, isEncrypted } = encryptPassword(item.password || '');
        const existing = queryOne('SELECT id FROM passwords WHERE site = ? AND login = ?', [cleanSite, cleanLogin]);
        if (existing) {
            db.run('UPDATE passwords SET password = ?, is_encrypted = ? WHERE id = ?', [data, isEncrypted, existing.id]);
        } else {
            db.run('INSERT INTO passwords (site, login, password, is_encrypted, created_at) VALUES (?, ?, ?, ?, ?)', [cleanSite, cleanLogin, data, isEncrypted, Date.now()]);
            addedCount++;
        }
    }
    saveDatabaseNow();
    return addedCount;
}

// =================== SPEED DIAL ===================
function getSpeedDial() {
    return queryAll('SELECT * FROM speed_dial ORDER BY id ASC');
}

function addSpeedDialTile(name, url, color = '#6366f1', icon = 'fa-solid fa-globe') {
    if (!url) return null;
    db.run('INSERT INTO speed_dial (name, url, color, icon) VALUES (?, ?, ?, ?)', [name || url, url, color, icon]);
    scheduleSave();
    const row = queryOne('SELECT id FROM speed_dial WHERE url = ? ORDER BY id DESC', [url]);
    return row ? row.id : null;
}

function removeSpeedDialTile(id) {
    db.run('DELETE FROM speed_dial WHERE id = ?', [id]);
    scheduleSave();
    return true;
}


function updateBookmarksOrder(orderedList) {
    if (!db || !Array.isArray(orderedList)) return false;
    db.run('DELETE FROM bookmarks');
    orderedList.forEach((bm, idx) => {
        db.run('INSERT INTO bookmarks (id, title, url, created_at) VALUES (?, ?, ?, ?)', [
            idx + 1,
            bm.title,
            bm.url,
            bm.created_at || (Date.now() + idx)
        ]);
    });
    saveDatabaseNow();
    return true;
}

function updateSpeedDialOrder(orderedList) {
    if (!db || !Array.isArray(orderedList)) return false;
    db.run('DELETE FROM speed_dial');
    orderedList.forEach((tile, idx) => {
        db.run('INSERT INTO speed_dial (id, name, url, icon, color) VALUES (?, ?, ?, ?, ?)', [
            idx + 1,
            tile.name,
            tile.url,
            tile.icon,
            tile.color
        ]);
    });
    saveDatabaseNow();
    return true;
}

// =================== MIGRATION ===================
function migrateFromLocalStorage(data) {
    if (!data) return;

    try {
        if (Array.isArray(data.history) && data.history.length > 0) {
            const hRows = queryAll('SELECT count(*) as count FROM history');
            if (hRows.length > 0 && hRows[0].count === 0) {
                for (const h of data.history) {
                    db.run('INSERT INTO history (title, url, visit_time, formatted_time) VALUES (?, ?, ?, ?)', [
                        h.title || h.url,
                        h.url,
                        h.time || Date.now(),
                        h.timeStr || ''
                    ]);
                }
                scheduleSave();
            }
        }

        if (Array.isArray(data.passwords) && data.passwords.length > 0) {
            const pRows = queryAll('SELECT count(*) as count FROM passwords');
            if (pRows.length > 0 && pRows[0].count === 0) {
                importPasswordsList(data.passwords);
            }
        }
    } catch (e) {
        console.error('[DB] Migration error:', e);
    }
}

module.exports = {
    initDatabase,
    saveDatabaseNow,
    getHistory,
    addHistory,
    deleteHistoryItem,
    clearHistory,
    getBookmarks,
    addBookmark,
    removeBookmark,
    isBookmarked,
    getPasswords,
    savePassword,
    deletePassword,
    clearAllPasswords,
    importPasswordsList,
    getSpeedDial,
    addSpeedDialTile,
    removeSpeedDialTile,
    updateBookmarksOrder,
    updateSpeedDialOrder,
    migrateFromLocalStorage
};
