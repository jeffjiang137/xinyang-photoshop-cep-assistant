(function() {
  var Bridge, CSI, DATA_DIRECTORY, artboardsEnabled, check, dataFile, evalScript, fsEnabled, getBackgroundColor, getBackgroundHex, getThemeClass, isIllustrator, jsxPath, loadHostScripts, log, menuEvent, menuStates, menuXML, migrateLocalStorage, onAppThemeColorChanged, onChangeDataFolder, onDocumentLoaded, onMenuClick, persistent, ready, themeChangeEvent, tick, toggleLayerContext, toggleLogging;

  CSI = new CSInterface();

  Bridge = null;

  themeChangeEvent = CSInterface.THEME_COLOR_CHANGED_EVENT;

  DATA_DIRECTORY = null;

  /* v2.1.36：GuideGuide 原版每次 get/set 都同步读写 data.json，频繁操作
   * 会阻塞 CEP 主线程。改为内存缓存 + 180ms 合并写盘。 */
  var guideStorageCache = null;
  var guideStorageDirty = false;
  var guideStorageTimer = 0;
  var guideHostReady = false;
  var guideHostLoading = false;
  var guideHostCallbacks = [];

  function isGuideHostError(result) {
    return typeof result === 'string' && result.indexOf('__XY_GUIDE_ERROR__') === 0;
  }

  function finishGuideHostLoad(error) {
    var callbacks = guideHostCallbacks.slice();
    guideHostCallbacks.length = 0;
    guideHostLoading = false;
    if (!error) guideHostReady = true;
    callbacks.forEach(function(callback) {
      try { callback(error || null); } catch (ignoreGuideHostCallback) {}
    });
  }

  function readGuideStorageCache() {
    if (guideStorageCache) return guideStorageCache;
    guideStorageCache = {};
    try {
      var result = window.cep.fs.readFile(dataFile());
      if (result && result.err === 0 && result.data) {
        guideStorageCache = JSON.parse(result.data) || {};
      }
    } catch (ignoreGuideStorageRead) {
      guideStorageCache = {};
    }
    return guideStorageCache;
  }

  function flushGuideStorage() {
    if (guideStorageTimer) clearTimeout(guideStorageTimer);
    guideStorageTimer = 0;
    if (!guideStorageDirty || !guideStorageCache) return;
    guideStorageDirty = false;
    try {
      window.cep.fs.writeFile(dataFile(), JSON.stringify(guideStorageCache));
    } catch (ignoreGuideStorageWrite) {}
  }

  function scheduleGuideStorageFlush() {
    guideStorageDirty = true;
    if (guideStorageTimer) clearTimeout(guideStorageTimer);
    guideStorageTimer = setTimeout(flushGuideStorage, 180);
  }

  menuEvent = 'com.adobe.csxs.events.flyoutMenuClicked';

  menuStates = {
    logging: false,
    useLayersAsContext: false
  };

  menuXML = function() {
    return "<Menu>\n  <MenuItem Id=\"version\" Label=\"GuideGuide " + (Bridge.guideguideVersion()) + (Bridge.freeVersion() ? ' (' + Bridge.Messages.get('titleFreeVersion') + ')' : '') + "\" Enabled=\"false\" Checked=\"false\"/>\n  <MenuItem Label=\"---\" />\n  " + (isIllustrator() ? '<MenuItem Id=\"convertSelectionToGuides\" Label=\"' + Bridge.Messages.get('menuConvertSelectionToGuides') + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n  " + (!isIllustrator() ? '<MenuItem Id=\"duplicateToDocuments\" Label=\"' + Bridge.Messages.get('menuDuplicateToOpenDocuments') + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n  " + (artboardsEnabled() && !isIllustrator() ? '<MenuItem Id=\"duplicateToArtboards\" Label=\"' + Bridge.Messages.get('menuDuplicateToArtboards') + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n  <MenuItem Label=\"---\" />\n  <MenuItem Id=\"clearAllGuides\" Label=\"" + (Bridge.Messages.get('menuClearAllGuides')) + "\" Enabled=\"true\" Checked=\"false\"/>\n  " + (artboardsEnabled() && !isIllustrator() ? '<MenuItem Id=\"clearArtboardGuides\" Label=\"' + Bridge.Messages.get('menuClearArtboardGuides') + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n  " + (artboardsEnabled() && !isIllustrator() ? '<MenuItem Id=\"clearCanvasGuides\" Label=\"' + Bridge.Messages.get('menuClearCanvasGuides') + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n  <MenuItem Id=\"clearVertical\" Label=\"" + (Bridge.Messages.get('menuClearVerticalGuides')) + "\" Enabled=\"true\" Checked=\"false\"/>\n  <MenuItem Id=\"clearHorizontal\" Label=\"" + (Bridge.Messages.get('menuClearHorizontalGuides')) + "\" Enabled=\"true\" Checked=\"false\"/>\n  <MenuItem Label=\"---\" />\n  <MenuItem Id=\"tracking\" Label=\"" + (Bridge.Messages.get('menuTrackingSettings')) + "\" Enabled=\"true\" Checked=\"false\"/>\n  <MenuItem Id=\"uninstall\" Label=\"" + (Bridge.Messages.get('menuUninstall')) + "\" Enabled=\"true\" Checked=\"false\"/>\n  <MenuItem Id=\"logging\" Label=\"" + (Bridge.Messages.get('menuDebug')) + "\" Enabled=\"true\" Checked=\"" + menuStates["logging"] + "\"/>\n  " + (!isIllustrator() ? '<MenuItem Id=\"useLayers\" Label=\"' + Bridge.Messages.get('menuUseLayers') + '\" Enabled=\"true\" Checked=\"' + menuStates["useLayersAsContext"] + '\"/>' : '') + "\n  <MenuItem Id=\"changeDataFolder\" Label=\"" + (Bridge.Messages.get('menuChangeDataFolder')) + "\" Enabled=\"true\" Checked=\"false\"/>\n  " + (Bridge.freeVersion() ? '<MenuItem Id=\"buy\" Label=\"' + Bridge.Messages.get('menuBuyGuideGuide') + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n  " + (!Bridge.freeVersion() ? '<MenuItem Id=\"upgrade\" Label=\"' + Bridge.Messages.get('menuUpgradeGuideGuide', (isIllustrator() ? 'Photoshop' : 'Illustrator')) + '\" Enabled=\"true\" Checked=\"false\"/>' : '') + "\n</Menu>";
  };

  artboardsEnabled = function() {
    var n, version;
    version = (function() {
      var _i, _len, _ref, _results;
      _ref = CSI.getHostEnvironment().appVersion.split('.');
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        n = _ref[_i];
        _results.push(parseInt(n));
      }
      return _results;
    })();
    if (version[0] > 16 || (version[0] === 16 && version[1] > 0)) {
      return true;
    }
    return false;
  };

  evalScript = function(str, callback) {
    var methodStr, runtime, promise;
    methodStr = "try {\n  " + str + "\n}\ncatch (e) {\n  try {\n    if (typeof $ !== 'undefined' && $._ && typeof $._.log === 'function') {\n      $._.log($._.formatError(e, \"" + (str.replace(/[\"']/g, '`')) + "\"));\n    }\n  } catch (ignoreGuideLog) {}\n  '__XY_GUIDE_ERROR__|' + e.message + '|line=' + e.line;\n}";
    try {
      runtime = window.parent && window.parent.XinyangRuntime;
    } catch (ignoreParentRuntime) {
      runtime = null;
    }
    if (runtime && runtime.evalScriptRaw) {
      promise = runtime.evalScriptRaw(methodStr, { label: "GuideGuide" });
      promise.then(function(result) {
        if (callback) callback(result);
      }).catch(function(error) {
        if (callback) callback("__XY_GUIDE_ERROR__|" + (error && error.message ? error.message : "EvalScript error"));
      });
      return promise;
    }
    return CSI.evalScript(methodStr, function(result) {
      if (callback) callback(result);
    });
  };

  CSInterface.prototype.updatePanelMenuItem = function(menuItemLabel, enabled, checked) {
    var itemStatus, ret;
    ret = false;
    if (this.getHostCapabilities().EXTENDED_PANEL_MENU) {
      itemStatus = new MenuItemStatus(menuItemLabel, enabled, checked);
      ret = window.__adobe_cep__.invokeSync('updatePanelMenuItem', JSON.stringify(itemStatus));
    }
    return ret;
  };

  log = function(msg) {
    if (typeof msg !== 'string') {
      msg = JSON.stringify(msg);
    }
    return evalScript("$._.log('" + msg + "')");
  };

  isIllustrator = function() {
    return CSI.getHostEnvironment().appId === 'ILST';
  };

  jsxPath = "" + (CSI.getSystemPath(SystemPath.EXTENSION)) + "/guideguide-panel/host";

  /* v2.1.76：严格串行加载宿主 JSX，避免打开参考线页面时
   * getDataDir 早于 ps.jsx 执行而出现“undefined 不是对象”。 */
  loadHostScripts = function(callback) {
    if (guideHostReady) {
      callback(null);
      return;
    }
    guideHostCallbacks.push(callback);
    if (guideHostLoading) return;
    guideHostLoading = true;
    evalScript("$.evalFile('" + jsxPath + "/json.jsx')", function(jsonResult) {
      if (isGuideHostError(jsonResult)) {
        finishGuideHostLoad(jsonResult);
        return;
      }
      var hostFile = isIllustrator() ? "/il.jsx" : "/ps.jsx";
      evalScript("$.evalFile('" + jsxPath + hostFile + "')", function(hostResult) {
        if (isGuideHostError(hostResult)) {
          finishGuideHostLoad(hostResult);
          return;
        }
        finishGuideHostLoad(null);
      });
    });
  };

  persistent = function() {
    var csInterface, e, event, id;
    try {
      event = new CSEvent('com.adobe.PhotoshopPersistent', 'APPLICATION');
      id = "com.jeffjiang.ecommerce-design-assistant-cep.panel";
      event.extensionId = id;
      csInterface = new CSInterface();
      csInterface.dispatchEvent(event);
      return log("Triggering persistence for " + id);
    } catch (_error) {
      e = _error;
    }
  };

  getThemeClass = function() {
    var color;
    color = getBackgroundColor();
    if (color._r < 64) {
      return 'theme-darker';
    }
    if (color._r < 128) {
      return 'theme-dark';
    }
    if (color._r < 192) {
      return 'theme-light';
    }
    return 'theme-lighter';
  };

  getBackgroundColor = function() {
    var color;
    color = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
    return tinycolor("rgba(" + color.red + "," + color.green + "," + color.blue + "," + color.alpha + ")");
  };

  getBackgroundHex = function() {
    return getBackgroundColor().toHexString();
  };

  fsEnabled = function() {
    var fs;
    fs = window.cep.fs;
    if (fs == null) {
      return false;
    }
    if (fs.showOpenDialog == null) {
      return false;
    }
    if (fs.readFile == null) {
      return false;
    }
    if (fs.showSaveDialogEx == null) {
      return false;
    }
    if (fs.writeFile == null) {
      return false;
    }
    return true;
  };

  check = function() {
    Bridge = document.getElementById('panel').contentWindow.Bridge;
    if (Bridge && Bridge.ready) {
      return ready();
    } else {
      return tick();
    }
  };

  tick = function() {
    return setTimeout(check, 50);
  };

  dataFile = function() {
    var file, result;
    if (!DATA_DIRECTORY) {
      alert('DATA_DIRECTORY not found');
    }
    file = "" + DATA_DIRECTORY + "/data.json";
    result = window.cep.fs.readFile(file);
    if (result.err === 0 && result.data) {
      return file;
    }
    result = window.cep.fs.makedir(DATA_DIRECTORY);
    result = window.cep.fs.writeFile(file, JSON.stringify({}));
    if (result.err !== 0) {
      alert("Tried to create data file, got code " + result.err);
    }
    return file;
  };

  migrateLocalStorage = function() {
    var i, k, ls, v, _i, _j, _len, _ref, _ref1, _results, _results1;
    ls = document.getElementById('panel').contentWindow.localStorage;
    if (!ls.length) {
      return;
    }
    Bridge.log('Migrating localStorage values');
    _ref1 = (function() {
      _results1 = [];
      for (var _j = 0, _ref = ls.length - 1; 0 <= _ref ? _j <= _ref : _j >= _ref; 0 <= _ref ? _j++ : _j--){ _results1.push(_j); }
      return _results1;
    }).apply(this).reverse();
    _results = [];
    for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
      i = _ref1[_i];
      k = ls.key(i);
      v = ls.getItem(k);
      Bridge.localStorage().setItem(k, v);
      ls.removeItem(k);
      _results.push(Bridge.log("Migrated " + k));
    }
    return _results;
  };

  ready = function() {
    var e, k, messages, v, _ref, _ref1;
    try {
      log('Begining ready()');
      document.getElementById('panel').contentWindow.isNotDemo = true;
      log('Running in Photoshop');
      if (typeof __adobe_cep__.getExtensionId === "function" ? __adobe_cep__.getExtensionId().match(/\.dev/) : void 0) {
        log('  Starting dev mode options');
        // v2.1.36: disable the legacy iframe live-reload hook even in dev builds.
        // Re-loading the parent CEP document when the embedded panel fires load can
        // destroy all panel state and cause a visible flash when Photoshop restores it.
        log('    Live reload disabled for persistent panel stability');
        log('    Initializing log');
        toggleLogging(false);
      }
      log('  Initializing events');
      CSI.addEventListener(themeChangeEvent, onAppThemeColorChanged);
      CSI.addEventListener(menuEvent, onMenuClick);
      if (((_ref = window.cep) != null ? _ref.fs : void 0) != null) {
        log('  Initializing Bridge localStorage');
        Bridge.localStorage = function() {
          return {
            getItem: function(k) {
              return readGuideStorageCache()[k];
            },
            setItem: function(k, v) {
              readGuideStorageCache()[k] = v;
              scheduleGuideStorageFlush();
              return true;
            },
            removeItem: function(k) {
              delete readGuideStorageCache()[k];
              scheduleGuideStorageFlush();
              return true;
            }
          };
        };
        migrateLocalStorage();
      }
      log('  Replacing Bridge methods');
      Bridge.log = function() {
        var arg, _i, _len, _results;
        _results = [];
        for (_i = 0, _len = arguments.length; _i < _len; _i++) {
          arg = arguments[_i];
          _results.push(log(arg));
        }
        return _results;
      };
      messages = {};
      _ref1 = Bridge.Messages.library;
      for (k in _ref1) {
        v = _ref1[k];
        messages[k] = Bridge.Messages.get(k);
      }
      evalScript("$.GuideGuideMessages = " + (JSON.stringify(messages)));
      Bridge.exec = function(method, data, callback) {
        var argString, methodStr;
        if (typeof arguments[1] === 'function') {
          callback = arguments[1];
          data = null;
        }
        argString = data ? "'" + (JSON.stringify(data)) + "'" : '';
        methodStr = "$.GuideGuide." + method + "(" + argString + ")";
        return evalScript(methodStr, function(result) {
          var json = null;
          if (isGuideHostError(result)) {
            if (callback != null) callback(new Error(result), null);
            return;
          }
          try {
            json = typeof result === 'string' && result !== ''
              ? JSON.parse(result)
              : result;
          } catch (parseError) {
            if (callback != null) callback(parseError, null);
            return;
          }
          if (callback != null) callback(null, json);
        });
      };
      Bridge.getLocale = function() {
        var env;
        env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
        return env.appUILocale.toLowerCase();
      };
      Bridge.getAppVersion = function() {
        return "" + (CSI.getApplicationID()) + " " + (parseInt(CSI.getHostEnvironment().appVersion));
      };
      Bridge.fetchAndSyncAppInfo = function(callback) {
        var _this = this;
        return this.exec('getAppInfo', function(err, info) {
          if (!info || typeof info !== 'object') {
            info = {
              snap: true,
              capabilities: { artboardGuides: false, gridFromExisting: true },
              trialExpired: false,
              useLayersAsContext: false,
              usageCount: 0
            };
          }
          menuStates['useLayersAsContext'] = !!info.useLayersAsContext;
          info.themeClass = getThemeClass();
          info.locale = _this.getLocale();
          info.localStorage = true;
          info.fsEnabled = fsEnabled();
          _this.syncAppInfo(info);
          if (callback != null) callback(err || null);
        });
      };
      Bridge.getDocumentRulerUnits = function(callback) {
        return evalScript('$.GuideGuide.getDocumentRulerUnits()', callback);
      };
      Bridge.hasOpenDocument = function(callback) {
        return evalScript('$.GuideGuide.hasOpenDocument()', callback);
      };
      Bridge.openUrl = function(url) {
        return CSI.openURLInDefaultBrowser(url);
      };
      Bridge.openInstallDirectory = function() {
        var path;
        path = CSI.getSystemPath(SystemPath.EXTENSION);
        path = path.substring(0, path.lastIndexOf('/'));
        return evalScript("$.GuideGuide.openInstallDirectory('" + path + "')");
      };
      Bridge.readFile = function(callback) {
        var file, result;
        result = window.cep.fs.showOpenDialog(false, false, 'open', null, ['json']);
        if (result.err) {
          return callback('fileError');
        }
        if (!/\.json$/gi.test(result.data[0])) {
          return callback('notJSON');
        }
        file = window.cep.fs.readFile(result.data[0]);
        if (file.err) {
          return callback('fileError');
        }
        return callback(null, file.data);
      };
      Bridge.writeFile = function(filename, data, callback) {
        var result, save, show, title;
        show = window.cep.fs.showSaveDialogEx;
        title = this.Messages.get('titleExportGrids');
        save = this.Messages.get('btnExport');
        result = show(title, null, ['json'], 'grids.json', null, save);
        if (result.data === '') {
          return callback('canceled');
        }
        result = window.cep.fs.writeFile(result.data, data);
        if (result.err) {
          return callback(result.err);
        }
        if (callback != null) {
          return callback();
        }
      };
      Bridge.initTasks.push(function() {
        log('  Loading the menu');
        if (window.__adobe_cep__.invokeSync != null) {
          return CSI.setPanelFlyoutMenu(menuXML());
        }
      });
      log('Fetching and syncing info');
      return Bridge.fetchAndSyncAppInfo(function() {
        Bridge.updateTheme();
        Bridge.start();
        document.getElementById('panel').style.opacity = 1;
        return persistent();
      });
    } catch (_error) {
      e = _error;
      log(encodeURI(e.stack).replace(/'/g, "\\'"));
      return toggleLogging();
    }
  };

  onAppThemeColorChanged = function(event) {
    Bridge.syncAppInfo({
      themeClass: getThemeClass()
    });
    return Bridge.updateTheme();
  };

  onMenuClick = function(event) {
    log("Menu item clicked: " + event.data.menuId);
    switch (event.data.menuId) {
      case 'tracking':
        return Bridge.changeTrackingSettings();
      case 'logging':
        return toggleLogging();
      case 'useLayers':
        return toggleLayerContext();
      case 'uninstall':
        return Bridge.openInstallDirectory();
      case 'buy':
      case 'upgrade':
        return Bridge.openUrl('http://guideguide.me/');
      case 'clearAllGuides':
        return evalScript('$.GuideGuide.clearAllGuides()');
      case 'clearArtboardGuides':
        return evalScript('$.GuideGuide.clearArtboardGuides()');
      case 'clearCanvasGuides':
        return evalScript('$.GuideGuide.clearCanvasGuides()');
      case 'duplicateToArtboards':
        return evalScript('$.GuideGuide.duplicateGuidesToArtboards()');
      case 'duplicateToDocuments':
        return evalScript('$.GuideGuide.duplicateGuidesToOpenDocuments()');
      case 'clearVertical':
        return evalScript('$.GuideGuide.clearOrientationGuides("v")');
      case 'clearHorizontal':
        return evalScript('$.GuideGuide.clearOrientationGuides("h")');
      case 'convertSelectionToGuides':
        return evalScript('$.GuideGuide.convertSelectionToGuides()');
      case 'changeDataFolder':
        return onChangeDataFolder();
    }
  };

  onChangeDataFolder = function() {
    return evalScript("$.GuideGuide.getDataDir()", function(dir) {
      var path, result;
      result = window.cep.fs.showOpenDialog(false, true, 'Choose', dir);
      if (result.err) {
        return callback('fileError');
      }
      path = encodeURI(result.data);
      if (path === '') {
        return;
      }
      return evalScript("$.GuideGuide.changeDataDir('" + path + "')", function(dir) {
        log("bridge updated to " + dir);
        if (dir) {
          return DATA_DIRECTORY = dir;
        }
      });
    });
  };

  toggleLogging = function(openFile) {
    if (openFile == null) {
      openFile = true;
    }
    evalScript("$.GuideGuide.toggleLogging('" + openFile + "')");
    menuStates['logging'] = !menuStates['logging'];
    return CSI.updatePanelMenuItem(Bridge.Messages.get('menuDebug'), true, menuStates['logging']);
  };

  toggleLayerContext = function() {
    evalScript("$.GuideGuide.toggleLayerContext()");
    menuStates['useLayersAsContext'] = !menuStates['useLayersAsContext'];
    return CSI.updatePanelMenuItem(Bridge.Messages.get('menuUseLayers'), true, menuStates['useLayersAsContext']);
  };

  onDocumentLoaded = function() {
    return loadHostScripts(function(loadError) {
      var iframe = document.getElementById('panel');
      if (loadError) {
        document.body.innerHTML = '<div style="padding:14px;color:#ddd;font:12px Microsoft YaHei UI">参考线宿主脚本加载失败，请重新加载插件。</div>';
        return;
      }
      evalScript('$.GuideGuide.getDataDir()', function(dir) {
        if (isGuideHostError(dir) || !dir) {
          document.body.innerHTML = '<div style="padding:14px;color:#ddd;font:12px Microsoft YaHei UI">参考线数据目录初始化失败，请重新加载插件。</div>';
          return;
        }
        DATA_DIRECTORY = dir;
        document.body.style.backgroundColor = getBackgroundHex();
        iframe.src = iframe.getAttribute('data-src');
        tick();
        log('JSX files loaded');
      });
    });
  };

  window.addEventListener('pagehide', flushGuideStorage, false);
  window.addEventListener('beforeunload', flushGuideStorage, false);
  document.addEventListener('DOMContentLoaded', onDocumentLoaded, false);

}).call(this);
