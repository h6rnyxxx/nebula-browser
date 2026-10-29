(function() {
  if (!window.chrome) window.chrome = {};

  let ipc = null;
  try {
    ipc = require('electron').ipcRenderer;
  } catch (e) {}

  // Загружаем локализованные сообщения расширения
  let extMessages = {};
  let currentActiveTab = { id: 1, active: true, currentWindow: true, url: 'https://www.youtube.com', title: 'YouTube' };

  if (ipc) {
    try {
      extMessages = ipc.sendSync('ext-get-messages') || {};
    } catch (e) {}
    try {
      const tabInfo = ipc.sendSync('ext-get-active-tab');
      if (tabInfo && tabInfo.url) {
        currentActiveTab = {
          id: tabInfo.id || 1,
          active: true,
          currentWindow: true,
          url: tabInfo.url,
          title: tabInfo.title || 'Вкладка',
          audible: true,
          status: 'complete'
        };
      }
    } catch (e) {}
  }

  function handleVolumeChange(msg) {
    if (!msg || typeof msg !== 'object' || !ipc) return;
    if (msg.action === 'ACTION_POPUP_GAIN_CHANGE' && typeof msg.volumeValue === 'number') {
      ipc.send('ext-set-tab-volume', msg.volumeValue);
    } else if (msg.type === 'setVolume' && typeof msg.volume === 'number') {
      const val = msg.volume > 1 ? msg.volume / 100 : msg.volume;
      ipc.send('ext-set-tab-volume', val);
    } else if (msg.action === 'setVolume' && typeof msg.value === 'number') {
      const val = msg.value > 1 ? msg.value / 100 : msg.value;
      ipc.send('ext-set-tab-volume', val);
    }
  }

  // 1. chrome.i18n (предотвращает белый экран и ошибку getMessage)
  if (!window.chrome.i18n) {
    window.chrome.i18n = {
      getMessage: function(key, subs) {
        if (!key) return '';
        const cleanKey = String(key).replace(/^__MSG_(\w+)__$/, '$1');
        let val = extMessages[cleanKey] || extMessages[cleanKey.toLowerCase()] || cleanKey;
        if (subs) {
          const sArr = Array.isArray(subs) ? subs : [subs];
          sArr.forEach((s, idx) => {
            val = val.replace(new RegExp('\\$' + (idx + 1), 'g'), s);
          });
        }
        return val;
      },
      getUILanguage: function() { return navigator.language || 'ru'; },
      getAcceptLanguages: function(cb) {
        const langs = ['ru', 'ru-RU', 'en-US', 'en'];
        if (typeof cb === 'function') cb(langs);
        return Promise.resolve(langs);
      },
      detectLanguage: function(text, cb) {
        const res = { isReliable: true, languages: [{ language: 'ru', percentage: 100 }] };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      }
    };
  }

  // 2. chrome.action
  if (!window.chrome.action) {
    window.chrome.action = {
      onClicked: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      setTitle: function() {},
      setIcon: function() {},
      setBadgeText: function() {},
      setBadgeBackgroundColor: function() {},
      setPopup: function() {}
    };
  }

  // 3. chrome.privacy
  if (!window.chrome.privacy) window.chrome.privacy = {};
  if (!window.chrome.privacy.network) {
    window.chrome.privacy.network = {
      webRTCIPHandlingPolicy: {
        get: function(d, cb) {
          const res = { levelOfControl: 'controllable_by_this_extension', value: 'default' };
          if (typeof cb === 'function') cb(res);
          return Promise.resolve(res);
        },
        set: function(d, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        clear: function(d, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        onChange: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
      },
      networkPredictionEnabled: {
        get: function(d, cb) {
          const res = { levelOfControl: 'controllable_by_this_extension', value: true };
          if (typeof cb === 'function') cb(res);
          return Promise.resolve(res);
        },
        set: function(d, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        clear: function(d, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        onChange: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
      }
    };
  }
  if (!window.chrome.privacy.services) {
    window.chrome.privacy.services = {
      autofillAddressEnabled: { get: (d, cb) => (cb ? cb({ value: false }) : Promise.resolve({ value: false })) },
      autofillCreditCardEnabled: { get: (d, cb) => (cb ? cb({ value: false }) : Promise.resolve({ value: false })) },
      passwordSavingEnabled: { get: (d, cb) => (cb ? cb({ value: false }) : Promise.resolve({ value: false })) }
    };
  }
  if (!window.chrome.privacy.websites) {
    window.chrome.privacy.websites = {
      hyperlinkAuditingEnabled: { get: (d, cb) => (cb ? cb({ value: false }) : Promise.resolve({ value: false })) },
      referrersEnabled: { get: (d, cb) => (cb ? cb({ value: true }) : Promise.resolve({ value: true })) },
      doNotTrackEnabled: { get: (d, cb) => (cb ? cb({ value: false }) : Promise.resolve({ value: false })) }
    };
  }

  // 4. chrome.proxy
  if (!window.chrome.proxy) {
    window.chrome.proxy = {
      settings: {
        get: function(d, cb) {
          const res = { levelOfControl: 'controllable_by_this_extension', value: { mode: 'direct' } };
          if (typeof cb === 'function') cb(res);
          return Promise.resolve(res);
        },
        set: function(d, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        clear: function(d, cb) { if (typeof cb === 'function') cb(); return Promise.resolve(); },
        onChange: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
      }
    };
  }

  // 5. chrome.storage.session
  if (!window.chrome.storage) window.chrome.storage = {};
  if (!window.chrome.storage.session) {
    const memStore = {};
    window.chrome.storage.session = {
      get: function(keys, cb) {
        let res = {};
        if (typeof keys === 'string') {
          res[keys] = memStore[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(k => { res[k] = memStore[k]; });
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach(k => {
            res[k] = (memStore[k] !== undefined) ? memStore[k] : keys[k];
          });
        } else {
          res = Object.assign({}, memStore);
        }
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      },
      set: function(items, cb) {
        if (items && typeof items === 'object') {
          Object.assign(memStore, items);
        }
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      },
      remove: function(keys, cb) {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete memStore[k]);
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      },
      clear: function(cb) {
        Object.keys(memStore).forEach(k => delete memStore[k]);
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      },
      onChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
    };
  }

  // 6. chrome.tabs (с передачей реальной активной вкладки)
  if (!window.chrome.tabs) window.chrome.tabs = {};
  window.chrome.tabs.query = function(q, cb) {
    const res = [Object.assign({}, currentActiveTab)];
    if (typeof cb === 'function') cb(res);
    return Promise.resolve(res);
  };
  window.chrome.tabs.get = function(id, cb) {
    const res = Object.assign({}, currentActiveTab, { id: id || currentActiveTab.id });
    if (typeof cb === 'function') cb(res);
    return Promise.resolve(res);
  };
  window.chrome.tabs.sendMessage = function(id, msg, opts, cb) {
    if (typeof opts === 'function') cb = opts;
    handleVolumeChange(msg);
    if (ipc) ipc.send('ext-send-tab-message', { tabId: id, message: msg });
    if (typeof cb === 'function') cb({});
    return Promise.resolve({});
  };
  window.chrome.tabs.executeScript = function(id, details, cb) {
    if (typeof id === 'object') { cb = details; details = id; id = null; }
    if (typeof details === 'function') { cb = details; details = {}; }
    if (ipc && details && details.code) {
      ipc.send('ext-execute-script-on-active-tab', details.code);
    }
    const res = [true];
    if (typeof cb === 'function') cb(res);
    return Promise.resolve(res);
  };
  window.chrome.tabs.insertCSS = function(id, details, cb) {
    if (typeof id === 'object') { cb = details; details = id; id = null; }
    if (typeof cb === 'function') cb();
    return Promise.resolve();
  };
  window.chrome.tabs.update = function(id, props, cb) {
    if (typeof cb === 'function') cb(currentActiveTab);
    return Promise.resolve(currentActiveTab);
  };
  window.chrome.tabs.create = function(p, cb) {
    if (ipc && p && p.url) ipc.send('open-external-url', p.url);
    if (typeof cb === 'function') cb({});
    return Promise.resolve({});
  };
  window.chrome.tabs.reload = function() {};
  window.chrome.tabs.onUpdated = { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } };
  window.chrome.tabs.onActivated = { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } };
  window.chrome.tabs.onRemoved = { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } };

  // 7. chrome.runtime
  if (!window.chrome.runtime) window.chrome.runtime = {};
  const origSendMessage = window.chrome.runtime.sendMessage;
  window.chrome.runtime.sendMessage = function(msg, opts, cb) {
    if (typeof opts === 'function') cb = opts;
    handleVolumeChange(msg);
    if (origSendMessage) {
      try {
        return origSendMessage.call(window.chrome.runtime, msg, opts, cb);
      } catch (e) {}
    }
    if (typeof cb === 'function') cb({});
    return Promise.resolve({});
  };
  if (!window.chrome.runtime.getPlatformInfo) {
    window.chrome.runtime.getPlatformInfo = function(cb) {
      const res = { os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' };
      if (typeof cb === 'function') cb(res);
      return Promise.resolve(res);
    };
  }
  if (!window.chrome.runtime.getContexts) {
    window.chrome.runtime.getContexts = function(filter, cb) {
      const res = [];
      if (typeof cb === 'function') cb(res);
      return Promise.resolve(res);
    };
  }

  // 8. chrome.offscreen (для Volume Master и MV3)
  if (!window.chrome.offscreen) {
    window.chrome.offscreen = {
      createDocument: function() { return Promise.resolve(); },
      closeDocument: function() { return Promise.resolve(); },
      hasDocument: function() { return Promise.resolve(false); },
      Reason: {
        TESTING: 'TESTING',
        AUDIO_PLAYBACK: 'AUDIO_PLAYBACK',
        IFRAME_SCRIPTING: 'IFRAME_SCRIPTING',
        DOM_SCRAPING: 'DOM_SCRAPING',
        USER_MEDIA: 'USER_MEDIA'
      }
    };
  }

  // 9. chrome.tabCapture (для Volume Master и захвата звука)
  if (!window.chrome.tabCapture) {
    window.chrome.tabCapture = {
      capture: function(opts, cb) {
        if (typeof cb === 'function') cb(null);
        return Promise.resolve(null);
      },
      getMediaStreamId: function(opts, cb) {
        const streamId = 'nebula_stream_' + (opts && opts.targetTabId ? opts.targetTabId : '1');
        if (typeof cb === 'function') cb(streamId);
        return Promise.resolve(streamId);
      },
      getCapturedTabs: function(cb) {
        if (typeof cb === 'function') cb([]);
        return Promise.resolve([]);
      },
      onStatusChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
    };
  }

  // 10. chrome.scripting (Manifest V3)
  if (!window.chrome.scripting) {
    window.chrome.scripting = {
      executeScript: function(injection, cb) {
        if (ipc && injection) {
          if (injection.func) {
            const code = `(${injection.func.toString()})(${JSON.stringify(injection.args || [])})`;
            ipc.send('ext-execute-script-on-active-tab', code);
          }
        }
        const res = [{ result: true }];
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      },
      insertCSS: function(injection, cb) {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      },
      removeCSS: function(injection, cb) {
        if (typeof cb === 'function') cb();
        return Promise.resolve();
      }
    };
  }

  // 11. chrome.windows
  if (!window.chrome.windows) {
    window.chrome.windows = {
      getCurrent: function(cb) {
        const res = { id: 1, focused: true, top: 0, left: 0, width: 1200, height: 800 };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      },
      update: function(id, props, cb) {
        const res = { id: 1, focused: true };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      }
    };
  }

  // 12. chrome.management
  if (!window.chrome.management) {
    window.chrome.management = {
      getSelf: function(cb) {
        const res = { id: 'nebula-ext', enabled: true };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      }
    };
  }

  // 13. chrome.notifications
  if (!window.chrome.notifications) {
    window.chrome.notifications = {
      create: function(id, opts, cb) {
        if (typeof cb === 'function') cb(id || '1');
        return Promise.resolve(id || '1');
      },
      clear: function(id, cb) {
        if (typeof cb === 'function') cb(true);
        return Promise.resolve(true);
      },
      getAll: function(cb) {
        if (typeof cb === 'function') cb({});
        return Promise.resolve({});
      },
      onClicked: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onClosed: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
    };
  }

  // 14. chrome.cookies
  if (!window.chrome.cookies) {
    window.chrome.cookies = {
      get: function(d, cb) { if (typeof cb === 'function') cb(null); return Promise.resolve(null); },
      getAll: function(d, cb) { if (typeof cb === 'function') cb([]); return Promise.resolve([]); },
      set: function(d, cb) { if (typeof cb === 'function') cb(d); return Promise.resolve(d); },
      remove: function(d, cb) { if (typeof cb === 'function') cb(d); return Promise.resolve(d); },
      onChanged: { addListener: function() {}, removeListener: function() {} }
    };
  }
})();
