(function() {
  if (!window.chrome) window.chrome = {};

  // 1. chrome.action
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

  // 2. chrome.privacy
  if (!window.chrome.privacy) window.chrome.privacy = {};
  if (!window.chrome.privacy.network) {
    window.chrome.privacy.network = {
      webRTCIPHandlingPolicy: {
        get: function(d, cb) {
          const res = { levelOfControl: 'controllable_by_this_extension', value: 'default' };
          if (typeof cb === 'function') cb(res);
          return Promise.resolve(res);
        },
        set: function(d, cb) {
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        clear: function(d, cb) {
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        onChange: {
          addListener: function() {},
          removeListener: function() {},
          hasListener: function() { return false; }
        }
      },
      networkPredictionEnabled: {
        get: function(d, cb) {
          const res = { levelOfControl: 'controllable_by_this_extension', value: true };
          if (typeof cb === 'function') cb(res);
          return Promise.resolve(res);
        },
        set: function(d, cb) {
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        clear: function(d, cb) {
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        onChange: {
          addListener: function() {},
          removeListener: function() {},
          hasListener: function() { return false; }
        }
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

  // 3. chrome.proxy
  if (!window.chrome.proxy) {
    window.chrome.proxy = {
      settings: {
        get: function(d, cb) {
          const res = { levelOfControl: 'controllable_by_this_extension', value: { mode: 'direct' } };
          if (typeof cb === 'function') cb(res);
          return Promise.resolve(res);
        },
        set: function(d, cb) {
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        clear: function(d, cb) {
          if (typeof cb === 'function') cb();
          return Promise.resolve();
        },
        onChange: {
          addListener: function() {},
          removeListener: function() {},
          hasListener: function() { return false; }
        }
      }
    };
  }

  // 4. chrome.storage.session
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
      onChanged: {
        addListener: function() {},
        removeListener: function() {},
        hasListener: function() { return false; }
      }
    };
  }

  // 5. chrome.tabs
  if (!window.chrome.tabs) {
    window.chrome.tabs = {
      query: function(q, cb) {
        const res = [{ id: 1, active: true, url: 'https://www.google.com', title: 'Google' }];
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      },
      get: function(id, cb) {
        const res = { id: 1, active: true, url: 'https://www.google.com', title: 'Google' };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      },
      sendMessage: function(id, msg, opts, cb) {
        if (typeof opts === 'function') cb = opts;
        if (typeof cb === 'function') cb({});
        return Promise.resolve({});
      },
      create: function(p, cb) {
        if (typeof cb === 'function') cb({});
        return Promise.resolve({});
      },
      reload: function() {},
      onUpdated: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onActivated: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } }
    };
  }

  // 6. chrome.windows
  if (!window.chrome.windows) {
    window.chrome.windows = {
      getCurrent: function(cb) {
        const res = { id: 1, focused: true };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      }
    };
  }

  // 7. chrome.management
  if (!window.chrome.management) {
    window.chrome.management = {
      getSelf: function(cb) {
        const res = { id: 'nebula-ext', enabled: true };
        if (typeof cb === 'function') cb(res);
        return Promise.resolve(res);
      }
    };
  }

  // 8. chrome.notifications
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

  // 9. chrome.cookies
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
