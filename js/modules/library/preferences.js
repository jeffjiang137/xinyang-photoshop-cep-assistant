(function (global) {
  'use strict';
  function create(options) {
    options = options || {};
    var fs, path, file, storage = options.storage, prefix = 'longStitch.library';
    try {
      if (!storage) storage = global.localStorage;
    } catch (ignoreStorage) {}
    try {
      var req = options.require || (global.cep_node && global.cep_node.require) || (typeof require === 'function' && require);
      if (req) {
        fs = req('fs'); path = req('path');
        var base = req('process').env.APPDATA || path.join(req('os').homedir(), '.config');
        file = options.file || path.join(base, 'XinyangAssistant', 'library-preferences.json');
      }
    } catch (ignoreNode) {}
    function disk() {
      try { var value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
      catch (ignoreRead) { return {}; }
    }
    function set(key, value) {
      if (key.indexOf(prefix) !== 0) return false;
      value = String(value);
      var saved = false;
      try { storage.setItem(key, value); saved = true; } catch (ignoreLocal) {}
      if (file) {
        var temporary = file + '.tmp';
        try {
          var values = disk(); values[key] = value;
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(temporary, JSON.stringify(values, null, 2), 'utf8');
          fs.renameSync(temporary, file); saved = true;
        } catch (ignoreWrite) { try { fs.unlinkSync(temporary); } catch (ignoreCleanup) {} }
      }
      return saved;
    }
    function get(key, fallback) {
      var values = disk();
      if (Object.prototype.hasOwnProperty.call(values, key) && typeof values[key] === 'string') return values[key];
      try { var value = storage.getItem(key); if (value) { set(key, value); return value; } } catch (ignoreLocal) {}
      return fallback;
    }
    return { get: get, set: set };
  }
  global.XinyangLibraryPreferences = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.XinyangLibraryPreferences;
}(typeof window !== 'undefined' ? window : this));
