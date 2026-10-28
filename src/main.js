const { app, BrowserWindow, session, ipcMain, Menu, shell, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const db = require('./services/db');

// Скрываем признаки автоматизации Chromium для проверки Google
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

let mainWindow;
let activeExtPopup = null;
let activeExtPopupId = null;
let appIconGlobal;
let adBlockActive = true;
let urlToOpenOnStartup = null;

const activeDownloads = new Map();
const downloadStartTimes = new Map();

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const BLOCKED_DOMAINS = [
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'adservice.google.com',
  'an.yandex.ru',
  'adriver.ru',
  'scorecardresearch.com',
  'outbrain.com',
  'taboola.com',
  'adnxs.com',
  'smartadserver.com',
  'pagead2.googlesyndication.com'
];

function getUrlFromArgs(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg === 'string' && /^https?:\/\//i.test(arg.trim())) {
      return arg.trim();
    }
  }
  return null;
}

function registerWindowsDefaultBrowser() {
  if (process.platform !== 'win32') return;

  const exePath = process.execPath;
  const appName = 'Nebula Browser';
  const progId = 'NebulaHTML';

  const regCommands = [
    `reg add "HKCU\\Software\\Classes\\${progId}" /ve /t REG_SZ /d "${appName} HTML Document" /f`,
    `reg add "HKCU\\Software\\Classes\\${progId}\\DefaultIcon" /ve /t REG_SZ /d "${exePath},0" /f`,
    `reg add "HKCU\\Software\\Classes\\${progId}\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exePath}\\" \\"%1\\"" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}" /ve /t REG_SZ /d "${appName}" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\DefaultIcon" /ve /t REG_SZ /d "${exePath},0" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\shell\\open\\command" /ve /t REG_SZ /d "\\"${exePath}\\"" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities" /v "ApplicationName" /t REG_SZ /d "${appName}" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities" /v "ApplicationDescription" /t REG_SZ /d "Nebula Web Browser" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities" /v "ApplicationIcon" /t REG_SZ /d "${exePath},0" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities\\FileAssociations" /v ".htm" /t REG_SZ /d "${progId}" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities\\FileAssociations" /v ".html" /t REG_SZ /d "${progId}" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities\\URLAssociations" /v "http" /t REG_SZ /d "${progId}" /f`,
    `reg add "HKCU\\Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities\\URLAssociations" /v "https" /t REG_SZ /d "${progId}" /f`,
    `reg add "HKCU\\Software\\RegisteredApplications" /v "${appName}" /t REG_SZ /d "Software\\Clients\\StartMenuInternet\\${appName}\\Capabilities" /f`
  ];

  regCommands.forEach(cmd => {
    exec(cmd, () => {});
  });

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
      app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  urlToOpenOnStartup = getUrlFromArgs(process.argv);

  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      const externalUrl = getUrlFromArgs(commandLine);
      if (externalUrl) {
        mainWindow.webContents.send('open-external-url', externalUrl);
      }
    }
  });

  app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler((details) => {
      mainWindow?.webContents.send('open-url-in-tab', details.url);
      return { action: 'deny' };
    });
  });

  app.whenReady().then(async () => {
    registerWindowsDefaultBrowser();
    try { await db.initDatabase(); } catch(e) { console.error('DB init error:', e); }
    createWindow();
  });
}

function downloadWithNetRequest(url, dest) {
  return new Promise((resolve, reject) => {
    try {
      const request = net.request({
        url: url,
        session: session.defaultSession,
        redirect: 'follow'
      });

      request.setHeader('User-Agent', CHROME_UA);
      request.setHeader('Accept', '*/*');

      request.on('response', (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const loc = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
          const nextUrl = new URL(loc, url).href;
          return downloadWithNetRequest(nextUrl, dest).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        const fileStream = fs.createWriteStream(dest);
        response.on('data', (chunk) => {
          fileStream.write(chunk);
        });

        response.on('end', () => {
          fileStream.end(resolve);
        });

        response.on('error', (err) => {
          fileStream.close(() => {
            try { fs.unlinkSync(dest); } catch(e) {}
            reject(err);
          });
        });
      });

      request.on('error', (err) => {
        try { fs.unlinkSync(dest); } catch(e) {}
        reject(err);
      });

      request.end();
    } catch (err) {
      reject(err);
    }
  });
}

function downloadWithNodeHttps(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (curUrl) => {
      const parsedUrl = new URL(curUrl);
      const protocol = parsedUrl.protocol === 'http:' ? http : https;

      // maxCachedSessions: 0 prevents BoringSSL BAD_DECRYPT TLS 1.3 session ticket errors
      const agent = (parsedUrl.protocol === 'https:') 
        ? new https.Agent({ maxCachedSessions: 0, keepAlive: false }) 
        : undefined;

      const options = {
        agent: agent,
        headers: {
          'User-Agent': CHROME_UA,
          'Accept': '*/*'
        }
      };

      protocol.get(curUrl, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (!nextUrl.startsWith('http')) {
            nextUrl = new URL(nextUrl, curUrl).href;
          }
          return request(nextUrl);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(dest, () => reject(err));
        });
      }).on('error', reject);
    };
    request(url);
  });
}

async function downloadFileWithRedirects(url, dest) {
  try {
    await downloadWithNetRequest(url, dest);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
      return;
    }
  } catch (err) {
    console.warn('[Download] net.request failed, trying fallback Node https:', err.message);
  }

  await downloadWithNodeHttps(url, dest);
}

function parseExtensionPages(extDir, manifest) {
  let optionsPage = null;
  let popupPage = null;

  if (typeof manifest.options_page === 'string') {
    optionsPage = manifest.options_page;
  } else if (manifest.options_ui && typeof manifest.options_ui.page === 'string') {
    optionsPage = manifest.options_ui.page;
  }

  if (manifest.action && typeof manifest.action.default_popup === 'string') {
    popupPage = manifest.action.default_popup;
  } else if (manifest.browser_action && typeof manifest.browser_action.default_popup === 'string') {
    popupPage = manifest.browser_action.default_popup;
  } else if (manifest.page_action && typeof manifest.page_action.default_popup === 'string') {
    popupPage = manifest.page_action.default_popup;
  }

  if (!optionsPage && extDir) {
    const possibleOptions = ['options.html', 'pages/options.html', 'ui/options.html', 'settings.html', 'options/index.html'];
    for (const opt of possibleOptions) {
      if (fs.existsSync(path.join(extDir, opt))) {
        optionsPage = opt;
        break;
      }
    }
  }

  if (!popupPage && extDir) {
    const possiblePopups = ['popup.html', 'pages/popup.html', 'ui/popup.html', 'popup/index.html', 'index.html'];
    for (const pop of possiblePopups) {
      if (fs.existsSync(path.join(extDir, pop))) {
        popupPage = pop;
        break;
      }
    }
  }

  return { optionsPage, popupPage };
}

const SW_POLYFILL_CODE = `
if (typeof self !== 'undefined') {
  if (!self.chrome) self.chrome = {};

  if (!self.chrome.action) {
    self.chrome.action = {
      onClicked: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      setTitle: function() {},
      setIcon: function() {},
      setBadgeText: function() {},
      setBadgeBackgroundColor: function() {},
      setPopup: function() {}
    };
  }

  if (!self.chrome.notifications) {
    self.chrome.notifications = {
      onClicked: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onClosed: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      create: function(id, opts, cb) { if (cb) cb(id || '1'); return Promise.resolve(id || '1'); },
      clear: function(id, cb) { if (cb) cb(true); return Promise.resolve(true); },
      getAll: function(cb) { if (cb) cb({}); return Promise.resolve({}); }
    };
  }

  if (!self.chrome.privacy) self.chrome.privacy = {};
  if (!self.chrome.privacy.network) {
    self.chrome.privacy.network = {
      webRTCIPHandlingPolicy: {
        get: function(d, cb) { const r = { levelOfControl: 'controllable_by_this_extension', value: 'default' }; if (cb) cb(r); return Promise.resolve(r); },
        set: function(d, cb) { if (cb) cb(); return Promise.resolve(); },
        clear: function(d, cb) { if (cb) cb(); return Promise.resolve(); },
        onChange: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
      },
      networkPredictionEnabled: {
        get: function(d, cb) { const r = { levelOfControl: 'controllable_by_this_extension', value: true }; if (cb) cb(r); return Promise.resolve(r); },
        set: function(d, cb) { if (cb) cb(); return Promise.resolve(); },
        clear: function(d, cb) { if (cb) cb(); return Promise.resolve(); },
        onChange: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
      }
    };
  }

  if (!self.chrome.proxy) {
    self.chrome.proxy = {
      settings: {
        get: function(d, cb) { const r = { levelOfControl: 'controllable_by_this_extension', value: { mode: 'direct' } }; if (cb) cb(r); return Promise.resolve(r); },
        set: function(d, cb) { if (cb) cb(); return Promise.resolve(); },
        clear: function(d, cb) { if (cb) cb(); return Promise.resolve(); },
        onChange: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
      }
    };
  }

  if (!self.chrome.tabs) {
    self.chrome.tabs = {
      query: function(q, cb) { const r = [{ id: 1, active: true, url: 'https://www.google.com', title: 'Google' }]; if (cb) cb(r); return Promise.resolve(r); },
      get: function(id, cb) { const r = { id: 1, active: true, url: 'https://www.google.com', title: 'Google' }; if (cb) cb(r); return Promise.resolve(r); },
      sendMessage: function(id, msg, opts, cb) { if (typeof opts === 'function') cb = opts; if (cb) cb({}); return Promise.resolve({}); },
      create: function(p, cb) { if (cb) cb({}); return Promise.resolve({}); },
      reload: function() {},
      onUpdated: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onActivated: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
    };
  }

  if (self.chrome.storage && !self.chrome.storage.session) {
    const mem = {};
    self.chrome.storage.session = {
      get: function(k, cb) { const r = {}; if (typeof k === 'string') r[k] = mem[k]; else if (Array.isArray(k)) k.forEach(x => r[x] = mem[x]); else Object.assign(r, mem); if (cb) cb(r); return Promise.resolve(r); },
      set: function(i, cb) { Object.assign(mem, i); if (cb) cb(); return Promise.resolve(); },
      remove: function(k, cb) { (Array.isArray(k) ? k : [k]).forEach(x => delete mem[x]); if (cb) cb(); return Promise.resolve(); },
      clear: function(cb) { Object.keys(mem).forEach(x => delete mem[x]); if (cb) cb(); return Promise.resolve(); },
      onChanged: { addListener: function() {}, removeListener: function() {} }
    };
  }
}
`;

function patchExtensionServiceWorker(extDir) {
  try {
    const manifestPath = path.join(extDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (manifest.background && manifest.background.service_worker) {
      const swRelative = manifest.background.service_worker;
      const swPath = path.join(extDir, swRelative);
      if (fs.existsSync(swPath)) {
        const swDir = path.dirname(swPath);
        const polyfillPath = path.join(swDir, 'sw-polyfill.js');
        fs.writeFileSync(polyfillPath, SW_POLYFILL_CODE, 'utf8');

        let swContent = fs.readFileSync(swPath, 'utf8');
        if (!swContent.includes('sw-polyfill.js')) {
          const isModule = manifest.background.type === 'module' || swContent.includes('import ');
          if (isModule) {
            swContent = `import './sw-polyfill.js';\n` + swContent;
          } else {
            swContent = `importScripts('./sw-polyfill.js');\n` + swContent;
          }
          fs.writeFileSync(swPath, swContent, 'utf8');
        }
      }
    }
  } catch (err) {
    console.error('Ошибка патчинга service worker расширения:', err);
  }
}

async function loadInstalledExtensions() {
  const extensionsDir = path.join(app.getPath('userData'), 'NebulaExtensions');
  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
    return;
  }
  const folders = fs.readdirSync(extensionsDir);
  for (const folder of folders) {
    const extPath = path.join(extensionsDir, folder);
    if (fs.statSync(extPath).isDirectory()) {
      try {
        patchExtensionServiceWorker(extPath);
        await session.defaultSession.loadExtension(extPath, { allowFileAccess: true });
        console.log(`[Nebula] Расширение ${folder} загружено.`);
      } catch (err) {
        console.error(`Ошибка загрузки расширения ${folder}:`, err.message);
      }
    }
  }
}

function createWindow() {
  const iconPng = path.join(__dirname, '..', 'build', 'icon.png');
  const iconIco = path.join(__dirname, '..', 'build', 'icon.ico');
  appIconGlobal = fs.existsSync(iconPng) ? iconPng : (fs.existsSync(iconIco) ? iconIco : undefined);

  session.defaultSession.setUserAgent(CHROME_UA);

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    icon: appIconGlobal,
    frame: false,
    transparent: false,
    autoHideMenuBar: true,
    backgroundColor: '#19122c',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  mainWindow.setMenu(null);

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-max-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-max-changed', false));
  mainWindow.on('move', () => {
    if (activeExtPopup && !activeExtPopup.isDestroyed()) {
      activeExtPopup.close();
      activeExtPopup = null;
      activeExtPopupId = null;
    }
  });
  mainWindow.on('resize', () => {
    if (activeExtPopup && !activeExtPopup.isDestroyed()) {
      activeExtPopup.close();
      activeExtPopup = null;
      activeExtPopupId = null;
    }
  });

  // Синхронизация чистых заголовков Chrome 131 во всех исходящих сетевых запросах
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = Object.assign({}, details.requestHeaders);
    requestHeaders['User-Agent'] = CHROME_UA;
    requestHeaders['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
    requestHeaders['sec-ch-ua-mobile'] = '?0';
    requestHeaders['sec-ch-ua-platform'] = '"Windows"';
    callback({ cancel: false, requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*/*'], types: ['mainFrame', 'subFrame'] },
    (details, callback) => {
      const responseHeaders = Object.assign({}, details.responseHeaders);
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['X-Frame-Options'];
      delete responseHeaders['content-security-policy'];
      delete responseHeaders['Content-Security-Policy'];
      callback({ cancel: false, responseHeaders });
    }
  );

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (adBlockActive) {
        try {
          const host = new URL(details.url).hostname.toLowerCase();
          if (BLOCKED_DOMAINS.some(domain => host.endsWith(domain))) {
            return callback({ cancel: true });
          }
        } catch (e) {}
      }
      callback({ cancel: false });
    }
  );

  session.defaultSession.on('will-download', (event, item) => {
    const defaultPath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(defaultPath);

    const downloadId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    activeDownloads.set(downloadId, item);
    downloadStartTimes.set(downloadId, Date.now());

    mainWindow.webContents.send('download-event', {
      type: 'started',
      id: downloadId,
      filename: item.getFilename(),
      path: defaultPath,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      percent: 0,
      speed: 0,
      etaSeconds: null,
      isPaused: false
    });

    item.on('updated', (event, state) => {
      const total = item.getTotalBytes();
      const received = item.getReceivedBytes();
      const startTime = downloadStartTimes.get(downloadId) || Date.now();
      const elapsedSec = (Date.now() - startTime) / 1000;
      
      const speed = elapsedSec > 0.5 ? Math.round(received / elapsedSec) : 0;
      const remainingBytes = Math.max(0, total - received);
      const etaSeconds = (speed > 0 && total > 0) ? Math.round(remainingBytes / speed) : null;

      if (state === 'interrupted') {
        mainWindow.webContents.send('download-event', {
          type: 'interrupted',
          id: downloadId,
          filename: item.getFilename(),
          path: defaultPath,
          totalBytes: total,
          receivedBytes: received,
          percent: total > 0 ? Math.round((received / total) * 100) : 0,
          speed: 0,
          etaSeconds: null,
          isPaused: false
        });
      } else if (state === 'progressing') {
        mainWindow.webContents.send('download-event', {
          type: item.isPaused() ? 'paused' : 'progressing',
          id: downloadId,
          filename: item.getFilename(),
          path: defaultPath,
          totalBytes: total,
          receivedBytes: received,
          percent: total > 0 ? Math.round((received / total) * 100) : 0,
          speed: item.isPaused() ? 0 : speed,
          etaSeconds: item.isPaused() ? null : etaSeconds,
          isPaused: item.isPaused()
        });
      }
    });

    item.once('done', (event, state) => {
      activeDownloads.delete(downloadId);
      downloadStartTimes.delete(downloadId);

      mainWindow.webContents.send('download-event', {
        type: state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'failed'),
        id: downloadId,
        filename: item.getFilename(),
        path: defaultPath,
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        percent: state === 'completed' ? 100 : 0,
        speed: 0,
        etaSeconds: 0,
        isPaused: false
      });
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    loadInstalledExtensions();

    if (urlToOpenOnStartup) {
      mainWindow.webContents.send('open-external-url', urlToOpenOnStartup);
      urlToOpenOnStartup = null;
    }

    if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch(err => {
        mainWindow?.webContents.send('updater-event', { status: 'error', error: err.message });
      });
    }
  });
}

// SQLite База данных (История, Закладки, Пароли, Speed Dial)
ipcMain.handle('db-get-history', (event, searchTerm, limit) => db.getHistory(searchTerm, limit));
ipcMain.handle('db-add-history', (event, title, url, visitTime, formattedTime) => db.addHistory(title, url, visitTime, formattedTime));
ipcMain.handle('db-delete-history', (event, id) => db.deleteHistoryItem(id));
ipcMain.handle('db-clear-history', () => db.clearHistory());

ipcMain.handle('db-get-bookmarks', () => db.getBookmarks());
ipcMain.handle('db-add-bookmark', (event, title, url) => db.addBookmark(title, url));
ipcMain.handle('db-remove-bookmark', (event, url) => db.removeBookmark(url));
ipcMain.handle('db-is-bookmarked', (event, url) => db.isBookmarked(url));

ipcMain.handle('db-get-passwords', () => db.getPasswords());
ipcMain.handle('db-save-password', (event, site, login, password) => db.savePassword(site, login, password));
ipcMain.handle('db-delete-password', (event, id, site, login) => db.deletePassword(id, site, login));
ipcMain.handle('db-clear-passwords', () => db.clearAllPasswords());
ipcMain.handle('db-import-passwords', (event, list) => db.importPasswordsList(list));

ipcMain.handle('db-get-speeddial', () => db.getSpeedDial());
ipcMain.handle('db-add-speeddial', (event, name, url, color, icon) => db.addSpeedDialTile(name, url, color, icon));
ipcMain.handle('db-remove-speeddial', (event, id) => db.removeSpeedDialTile(id));
ipcMain.handle('db-migrate-localstorage', (event, data) => db.migrateFromLocalStorage(data));

ipcMain.handle('get-autostart-status', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-autostart-status', (event, enable) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enable),
    path: process.execPath,
    args: []
  });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('install-extension-from-store', async (event, extId) => {
  try {
    const extDir = path.join(app.getPath('userData'), 'NebulaExtensions', extId);
    if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });

    const crxFile = path.join(extDir, 'temp.crx');
    const zipFile = path.join(extDir, 'temp.zip');

    const crxUrls = [
      `https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64&os_arch=x86_64&nacl_arch=x86-64&prod=chromecrx&prodchannel=&prodversion=130.0.0.0&lang=ru&acceptformat=crx2,crx3&x=id%3D${extId}%26installsource%3Dondemand%26uc`,
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${extId}%26uc`
    ];

    let downloaded = false;
    let lastErr = null;
    for (const url of crxUrls) {
      try {
        await downloadFileWithRedirects(url, crxFile);
        if (fs.existsSync(crxFile) && fs.statSync(crxFile).size > 100) {
          downloaded = true;
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }

    if (!downloaded || !fs.existsSync(crxFile)) {
      throw new Error(lastErr ? lastErr.message : 'Не удалось скачать файл расширения с серверов Google.');
    }

    const buf = fs.readFileSync(crxFile);
    const zipOffset = buf.indexOf(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
    if (zipOffset === -1) {
      throw new Error('Архив расширения поврежден или не распознан.');
    }

    const zipBuffer = buf.subarray(zipOffset);
    fs.writeFileSync(zipFile, zipBuffer);

    // Unpack using fast native Windows tar.exe first, fallback to PowerShell Expand-Archive
    await new Promise((resolve, reject) => {
      const tarCmd = `tar.exe -xf "${zipFile}" -C "${extDir}"`;
      exec(tarCmd, (err) => {
        if (!err) return resolve();
        const psCmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath '${zipFile}' -DestinationPath '${extDir}'"`;
        exec(psCmd, (psErr) => {
          if (psErr) reject(psErr);
          else resolve();
        });
      });
    });

    try { fs.unlinkSync(crxFile); } catch(e) {}
    try { fs.unlinkSync(zipFile); } catch(e) {}

    patchExtensionServiceWorker(extDir);
    const extension = await session.defaultSession.loadExtension(extDir, { allowFileAccess: true });

    return { success: true, name: extension.name || 'Расширение' };
  } catch (err) {
    console.error('Ошибка установки расширения:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-installed-extensions', async () => {
  const extDir = path.join(app.getPath('userData'), 'NebulaExtensions');
  if (!fs.existsSync(extDir)) return [];
  
  const list = [];
  const folders = fs.readdirSync(extDir);

  for (const id of folders) {
    const fullPath = path.join(extDir, id);
    if (!fs.statSync(fullPath).isDirectory()) continue;
    
    const manifestPath = path.join(fullPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        let name = manifest.name || id;

        if (name.startsWith('__MSG_')) {
          const key = name.replace(/^__MSG_|__$/g, '');
          const ruLoc = path.join(fullPath, '_locales', 'ru', 'messages.json');
          const enLoc = path.join(fullPath, '_locales', 'en', 'messages.json');
          const msgFile = fs.existsSync(ruLoc) ? ruLoc : (fs.existsSync(enLoc) ? enLoc : null);
          if (msgFile) {
            try {
              const msgs = JSON.parse(fs.readFileSync(msgFile, 'utf8'));
              if (msgs[key] && msgs[key].message) name = msgs[key].message;
            } catch (e) {}
          }
        }

        let iconData = null;
        if (manifest.icons) {
          const iconFile = manifest.icons['48'] || manifest.icons['128'] || manifest.icons['32'] || manifest.icons['16'];
          if (iconFile && fs.existsSync(path.join(fullPath, iconFile))) {
            const ext = path.extname(iconFile).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');
            iconData = `data:${mime};base64,` + fs.readFileSync(path.join(fullPath, iconFile)).toString('base64');
          }
        }

        const { optionsPage, popupPage } = parseExtensionPages(fullPath, manifest);

        list.push({
          id,
          name,
          version: manifest.version || '1.0',
          icon: iconData,
          hasOptions: Boolean(optionsPage),
          hasPopup: Boolean(popupPage)
        });
      } catch (err) {}
    }
  }
  return list;
});

ipcMain.on('open-extension-window', async (event, { extId, pageType }) => {
  const extDir = path.join(app.getPath('userData'), 'NebulaExtensions', extId);
  if (!fs.existsSync(extDir)) return;

  let loaded = session.defaultSession.getAllExtensions().find(e => {
    return path.normalize(e.path).toLowerCase() === path.normalize(extDir).toLowerCase() || e.id === extId;
  });

  if (!loaded) {
    try {
      patchExtensionServiceWorker(extDir);
      loaded = await session.defaultSession.loadExtension(extDir, { allowFileAccess: true });
    } catch (e) {
      console.error('Ошибка загрузки расширения в сессию:', e);
    }
  }

  if (!loaded) return;

  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const { optionsPage, popupPage } = parseExtensionPages(extDir, manifest);

    let targetPage = (pageType === 'options') 
      ? (optionsPage || popupPage) 
      : (popupPage || optionsPage);

    if (!targetPage) {
      mainWindow?.webContents.send('show-toast-msg', 'У этого расширения нет отдельной страницы управления.');
      return;
    }

    const cleanBase = loaded.url.endsWith('/') ? loaded.url : loaded.url + '/';
    const cleanTarget = targetPage.replace(/^\.?\/+/, '');
    const targetUrl = new URL(cleanTarget, cleanBase).href;

    const isPopup = (pageType === 'popup' && popupPage);
    const preloadPath = path.join(__dirname, 'extension-preload.js');

    if (isPopup) {
      if (activeExtPopup && !activeExtPopup.isDestroyed()) {
        const isSameExt = (activeExtPopupId === extId);
        activeExtPopup.close();
        activeExtPopup = null;
        activeExtPopupId = null;
        if (isSameExt) return;
      }

      const mainBounds = mainWindow ? mainWindow.getBounds() : { x: 100, y: 100, width: 1200, height: 800 };
      const popupWidth = 380;
      const popupHeight = 560;
      const x = Math.max(mainBounds.x, Math.round(mainBounds.x + mainBounds.width - popupWidth - 16));
      const y = Math.max(mainBounds.y, Math.round(mainBounds.y + 88));

      const extWin = new BrowserWindow({
        width: popupWidth,
        height: popupHeight,
        x: x,
        y: y,
        frame: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        parent: mainWindow,
        hasShadow: true,
        show: false,
        backgroundColor: '#19122c',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: false,
          webSecurity: false,
          session: session.defaultSession,
          preload: fs.existsSync(preloadPath) ? preloadPath : undefined
        }
      });

      activeExtPopup = extWin;
      activeExtPopupId = extId;
      extWin.setMenu(null);

      extWin.once('ready-to-show', () => {
        if (!extWin.isDestroyed()) {
          extWin.show();
          extWin.focus();
        }
      });

      extWin.on('blur', () => {
        setTimeout(() => {
          if (!extWin.isDestroyed() && !extWin.webContents.isDevToolsOpened()) {
            extWin.close();
          }
        }, 150);
      });

      extWin.on('closed', () => {
        if (activeExtPopup === extWin) {
          activeExtPopup = null;
          activeExtPopupId = null;
        }
      });

      extWin.webContents.on('before-input-event', (e, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
          extWin.webContents.toggleDevTools();
        } else if (input.key === 'Escape') {
          extWin.close();
        }
      });

      extWin.webContents.on('dom-ready', () => {
        extWin.webContents.insertCSS(`
          html, body {
            border-radius: 12px !important;
            overflow-x: hidden !important;
            box-shadow: 0 16px 38px rgba(0, 0, 0, 0.7) !important;
          }
          ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
          }
          ::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.35);
          }
        `).catch(() => {});
      });

      extWin.loadURL(targetUrl);
    } else {
      const extWin = new BrowserWindow({
        width: 960,
        height: 720,
        minWidth: 400,
        minHeight: 500,
        parent: mainWindow,
        modal: false,
        icon: appIconGlobal,
        autoHideMenuBar: true,
        title: `${manifest.name || 'Расширение'} - Настройки`,
        backgroundColor: '#19122c',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: false,
          webSecurity: false,
          session: session.defaultSession,
          preload: fs.existsSync(preloadPath) ? preloadPath : undefined
        }
      });

      extWin.setMenu(null);

      extWin.webContents.on('before-input-event', (e, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
          extWin.webContents.toggleDevTools();
        }
      });

      extWin.loadURL(targetUrl);
    }
  } catch (err) {
    console.error('Ошибка открытия страницы расширения:', err);
  }
});

ipcMain.handle('remove-extension', async (event, extId) => {
  try {
    const extDir = path.join(app.getPath('userData'), 'NebulaExtensions', extId);
    if (fs.existsSync(extDir)) {
      try { session.defaultSession.removeExtension(extDir); } catch(e) {}
      fs.rmSync(extDir, { recursive: true, force: true });
      return { success: true };
    }
    return { success: false, error: 'Папка не найдена' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.on('pause-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item && !item.isPaused()) item.pause();
});

ipcMain.on('resume-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item && item.isPaused()) item.resume();
});

ipcMain.on('cancel-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.cancel();
    activeDownloads.delete(id);
    downloadStartTimes.delete(id);
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

autoUpdater.on('checking-for-update', () => mainWindow?.webContents.send('updater-event', { status: 'checking' }));
autoUpdater.on('update-available', (info) => mainWindow?.webContents.send('updater-event', { status: 'available', version: info.version }));
autoUpdater.on('update-not-available', () => mainWindow?.webContents.send('updater-event', { status: 'not-available' }));
autoUpdater.on('error', (err) => mainWindow?.webContents.send('updater-event', { status: 'error', error: err ? (err.message || err).toString() : 'Ошибка связи' }));
autoUpdater.on('download-progress', (progressObj) => mainWindow?.webContents.send('updater-event', { status: 'downloading', percent: Math.round(progressObj.percent) }));
autoUpdater.on('update-downloaded', (info) => mainWindow?.webContents.send('updater-event', { status: 'ready', version: info.version }));

ipcMain.on('manual-check-update', () => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err => mainWindow?.webContents.send('updater-event', { status: 'error', error: err.message }));
  } else {
    mainWindow?.webContents.send('updater-event', { status: 'error', error: 'Обновления по воздуху работают только в скомпилированном Setup.exe.' });
  }
});

ipcMain.on('restart-and-install-update', () => autoUpdater.quitAndInstall());
ipcMain.on('open-file', (event, filePath) => { if (filePath && fs.existsSync(filePath)) shell.openPath(filePath); });
ipcMain.on('show-in-folder', (event, filePath) => { if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath); });
ipcMain.on('open-downloads-folder', () => shell.openPath(app.getPath('downloads')));

ipcMain.on('show-context-menu', (event) => {
  const menuTemplate = [
    { label: 'Назад', click: () => event.sender.send('exec-nav', 'back') },
    { label: 'Вперед', click: () => event.sender.send('exec-nav', 'forward') },
    { label: 'Перезагрузить', click: () => event.sender.send('exec-nav', 'reload') },
    { type: 'separator' },
    { label: 'Копировать', role: 'copy' },
    { label: 'Вставить', role: 'paste' },
    { label: 'Вырезать', role: 'cut' },
    { label: 'Выделить всё', role: 'selectAll' },
    { type: 'separator' },
    { label: 'Просмотреть код', click: () => event.sender.send('exec-devtools') }
  ];
  Menu.buildFromTemplate(menuTemplate).popup(BrowserWindow.fromWebContents(event.sender));
});

ipcMain.on('toggle-adblock', (event, state) => { adBlockActive = state; });
ipcMain.on('clear-session-data', async () => {
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();
});
ipcMain.on('set-fullscreen', (event, flag) => { if (mainWindow) mainWindow.setFullScreen(flag); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});