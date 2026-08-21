(function() {
  var DATA_DIRECTORY, DOC_MEASURE, GuideGuide, LOGGING_ENABLED, REGISTRY_KEY, Utilities, addGuide, addGuides, clearGuides, convertSelectionToGuides, coordAb, coordDoc, cpFile, createFileAt, dataPathFor, e, filter, getActiveArtboard, getContexts, getDataDirFromHostStorage, getDocumentGuides, getLayerGuides, getLogPath, getUses, incrimentUses, normalizedActiveArtboardRect, pasteboardRect, setDataFolder, trialExpired, writeLineToFile, _;

  REGISTRY_KEY = 'GuideGuide';

  LOGGING_ENABLED = false;

  DATA_DIRECTORY = null;

  getLogPath = function() {
    return "" + DATA_DIRECTORY + "/guideguide.log";
  };

  dataPathFor = function(path) {
    return "" + path + "/data.json";
  };

  cpFile = function(src, dest) {
    var e;
    try {
      if (typeof src === 'string') {
        src = File(src);
      }
      if (typeof dest === 'string') {
        dest = File(dest);
      }
      if (src.copy(dest)) {
        return _.log("cp " + src.absoluteURI + " -> " + dest.absoluteURI);
      }
      return _.log("Fail: cp " + src.absoluteURI + " -> " + dest.absoluteURI + " (" + src.error + ")");
    } catch (_error) {
      e = _error;
      return alert(e);
    }
  };

  createFileAt = function(path, initData) {
    var file, folder;
    if (path == null) {
      return;
    }
    file = new File(decodeURI(path));
    folder = Folder(file.path);
    if (!folder.exists) {
      folder.create();
    }
    if (file.open('w')) {
      if (_.isMac()) {
        file.lineFeed = 'unix';
      }
      file.encoding = 'UTF8';
      if (initData) {
        writeLineToFile(initData, file);
      }
      return file;
    } else {
      throw Error("Unable to create file at " + path + "\n" + file.error);
    }
  };

  filter = function(array, callback) {
    var item, _i, _len, _results;
    _results = [];
    for (_i = 0, _len = array.length; _i < _len; _i++) {
      item = array[_i];
      if (callback(item)) {
        _results.push(item);
      }
    }
    return _results;
  };

  writeLineToFile = function(str, file) {
    if (!file.open('e')) {
      throw Error("Unable to open file: " + file);
    }
    file.seek(0, 2);
    if (!file.writeln(str)) {
      throw Error("Unable to write file: " + file);
    }
  };

  Utilities = (function() {
    Utilities.prototype.logCache = '';

    function Utilities() {
      return;
    }

    Utilities.prototype.isMac = function() {
      return !$.os.match(/windows/i);
    };

    Utilities.prototype.log = function() {
      var arg, file, _i, _len, _results;
      _results = [];
      for (_i = 0, _len = arguments.length; _i < _len; _i++) {
        arg = arguments[_i];
        if (typeof arg !== 'string') {
          arg = this.beautify(arg);
        }
        arg = decodeURI(arg);
        this.logCache += arg + '\n';
        if (!LOGGING_ENABLED) {
          continue;
        }
        file = File(getLogPath());
        if (file.exists) {
          _results.push(writeLineToFile(arg, file));
        } else {
          _results.push(void 0);
        }
      }
      return _results;
    };

    Utilities.prototype.dumpLogFileTo = function(path) {
      return createFileAt(path, this.logCache.replace(/\n$/, ''));
    };

    Utilities.prototype.formatError = function(e, source) {
      var context, first, i, last;
      if (source == null) {
        source = '';
      }
      try {
        context = e.source.split('\n');
        first = e.line - 10 > 0 ? e.line - 10 : 0;
        last = e.line + 10 < context.length - 1 ? e.line + 10 : context.length - 1;
        return "////////////////////////////////////////\n\n  Error: " + e.message + "\n  File: " + e.fileName + "\n  Line: " + e.line + "\n  Context:\n\n  " + (((function() {
          var _i, _results;
          _results = [];
          for (i = _i = first; first <= last ? _i < last : _i > last; i = first <= last ? ++_i : --_i) {
            _results.push((i + 1) + '    ' + context[i]);
          }
          return _results;
        })()).join('\n  ')) + "\n\n  When evalutating: " + source + "\n\n////////////////////////////////////////\n";
      } catch (_error) {
        e = _error;
        return alert(e);
      }
    };

    Utilities.prototype.beautify = function(obj) {
      return JSON.stringify(obj, null, 2);
    };

    Utilities.prototype.guideToString = function(obj) {
      return "" + obj.orientation + ":" + obj.location;
    };

    Utilities.prototype.guideToObject = function(string) {
      var arr;
      arr = /([hv]):(-?[\d\.]+)/.exec(string).slice(1, 3);
      return {
        orientation: arr[0],
        location: parseFloat(arr[1])
      };
    };

    Utilities.prototype.guideInBounds = function(guide, bounds, canvasLocation) {
      var key, location;
      if (canvasLocation == null) {
        canvasLocation = false;
      }
      location = canvasLocation ? guide.canvasLocation : guide.location;
      key = guide.orientation === 'v' ? 'x' : 'y';
      return (bounds["" + key + "1"] <= location && location <= bounds["" + key + "2"]);
    };

    return Utilities;

  })();

  _ = new Utilities();

  $._ = _;

  DOC_MEASURE = 16383;

  coordDoc = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;

  coordAb = CoordinateSystem.ARTBOARDCOORDINATESYSTEM;

  _.setData = function(k, v) {
    var store;
    store = app.preferences.getStringPreference(REGISTRY_KEY) || '{}';
    store = JSON.parse(store);
    store[k] = v;
    return app.preferences.setStringPreference(REGISTRY_KEY, JSON.stringify(store));
  };

  _.getData = function(k) {
    var store;
    store = app.preferences.getStringPreference(REGISTRY_KEY) || '{}';
    return JSON.parse(store)[k];
  };

  getUses = function() {
    return _.getData('uses') || 0;
  };

  incrimentUses = function() {
    return _.setData('uses', (_.getData('uses') || 0) + 1);
  };

  trialExpired = function() {
    return getUses() > 30;
  };

  setDataFolder = function(path) {
    var dataFolder, e;
    try {
      if (path instanceof Folder) {
        path = path.absoluteURI;
      }
      dataFolder = Folder(path);
      if (!dataFolder.exists) {
        dataFolder.create();
      }
      if (!dataFolder.exists) {
        throw Error('Does not exist');
      }
      DATA_DIRECTORY = dataFolder.absoluteURI;
      _.setData('dataFolder', dataFolder.absoluteURI);
      return dataFolder;
    } catch (_error) {
      e = _error;
      return Error("Cannot set data folder to " + (encodeURI(dataFolder.absoluteURI)) + " because:\n" + (_.formatError(e)));
    }
  };

  getDataDirFromHostStorage = function() {
    return _.getData('dataFolder');
  };

  getActiveArtboard = function() {
    return activeDocument.artboards[activeDocument.artboards.getActiveArtboardIndex()];
  };

  _.friendlyUnits = function(units) {
    switch (units) {
      case RulerUnits.Centimeters:
        return "cm";
      case RulerUnits.Inches:
        return "in";
      case RulerUnits.Millimeters:
        return "mm";
      case RulerUnits.Picas:
        return "picas";
      case RulerUnits.Points:
        return "points";
      default:
        return "px";
    }
  };

  _.a2d = function(coords) {
    var ruler;
    ruler = getActiveArtboard().rulerOrigin;
    return app.activeDocument.convertCoordinate([coords[0] - ruler[0], coords[1] + ruler[1]], coordAb, coordDoc);
  };

  _.d2a = function(coords) {
    var ruler;
    ruler = getActiveArtboard().rulerOrigin;
    coords = app.activeDocument.convertCoordinate(coords, coordDoc, coordAb);
    return [coords[0] + ruler[0], coords[1] - ruler[1]];
  };

  _.il2gg = function(rect) {
    return {
      width: rect[2] - rect[0],
      height: Math.abs(rect[3] - rect[1]),
      offsetX: rect[0],
      offsetY: rect[1]
    };
  };

  _.doc2abRect = function(rect) {
    var _ref;
    return rect = (_ref = []).concat.apply(_ref, [_.d2a([rect[0], rect[1]]), _.d2a([rect[2], rect[3]])]);
  };

  _.ab2dRect = function(rect) {
    var _ref;
    return rect = (_ref = []).concat.apply(_ref, [_.a2d([rect[0], rect[1]]), _.a2d([rect[2], rect[3]])]);
  };

  getContexts = function() {
    var bounds, contexts, index, path, rect, selectedPaths, _i, _len, _ref, _ref1;
    contexts = {};
    index = activeDocument.artboards.getActiveArtboardIndex();
    contexts[index] = normalizedActiveArtboardRect();
    contexts[index].offsetX = 0;
    contexts[index].offsetY = 0;
    if (!((_ref = activeDocument.selection) != null ? _ref.length : void 0)) {
      return contexts;
    }
    selectedPaths = activeDocument.selection;
    bounds = [null, null, null, null];
    _ref1 = activeDocument.selection;
    for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
      path = _ref1[_i];
      rect = _.doc2abRect(path.geometricBounds);
      bounds[0] || (bounds[0] = rect[0]);
      bounds[1] || (bounds[1] = rect[1]);
      bounds[2] || (bounds[2] = rect[2]);
      bounds[3] || (bounds[3] = rect[3]);
      bounds[0] = Math.min(bounds[0], rect[0]);
      bounds[1] = Math.max(bounds[1], rect[1]);
      bounds[2] = Math.max(bounds[2], rect[2]);
      bounds[3] = Math.min(bounds[3], rect[3]);
    }
    rect = _.il2gg(bounds);
    rect.offsetY *= -1;
    return {
      0: rect
    };
  };

  normalizedActiveArtboardRect = function() {
    var artboards, index;
    artboards = activeDocument.artboards;
    index = artboards.getActiveArtboardIndex();
    return _.il2gg(artboards[index].artboardRect);
  };

  addGuides = function(contexts) {
    var artboard, doc, existingGuides, guides, key, token, _results;
    if (activeDocument.activeLayer.locked) {
      _.log("Cannot add guides. " + activeDocument.activeLayer.name + " is locked.");
      return;
    }
    contexts = JSON.parse(contexts);
    doc = activeDocument;
    existingGuides = getLayerGuides({
      relative: true
    });
    _results = [];
    for (key in contexts) {
      guides = contexts[key];
      artboard = doc.artboards[parseInt(key)];
      _.log("Current Artboard: " + artboard.name);
      _results.push((function() {
        var _i, _len, _results1;
        _results1 = [];
        for (_i = 0, _len = guides.length; _i < _len; _i++) {
          token = guides[_i];
          if (filter(existingGuides, function(g) {
            if (!g.orientation) {
              return false;
            }
            return _.guideToString({
              orientation: g.orientation,
              location: g.orientation === 'h' ? g.location * -1 : g.location
            }) === token;
          }).length > 0) {
            _.log("Skipping already existing guide: " + token);
            continue;
          }
          _results1.push(addGuide(token));
        }
        return _results1;
      })());
    }
    return _results;
  };

  pasteboardRect = function() {
    var abHeight, abRect, abWidth, artboards, centerX, centerY, i, topLeft, xSubstr, ySubstr;
    artboards = activeDocument.artboards;
    i = artboards.getActiveArtboardIndex();
    abRect = artboards[i].artboardRect;
    abWidth = abRect[2] - abRect[0];
    abHeight = abRect[3] - abRect[1];
    topLeft = Math.ceil(-DOC_MEASURE / 2);
    centerX = (abRect[2].toFixed(5) - abRect[0].toFixed(5)) / 2;
    centerY = (abRect[3].toFixed(5) - abRect[1].toFixed(5)) / 2;
    xSubstr = centerX < 0 ? Math.floor(centerX) : Math.ceil(centerX);
    ySubstr = centerY < 0 ? Math.floor(centerY) : Math.ceil(centerY);
    return [topLeft + xSubstr, -topLeft + ySubstr, -((topLeft + xSubstr) - abWidth), -((-topLeft + ySubstr) - abHeight)];
  };

  addGuide = function(str) {
    var abLocation, guide, path, pb;
    if (activeDocument.activeLayer.locked) {
      return;
    }
    guide = _.guideToObject(str);
    abLocation = _.a2d([guide.location, guide.location * -1]);
    _.log("Adding guide: " + str);
    _.log(JSON.stringify(guide));
    pb = pasteboardRect();
    path = activeDocument.activeLayer.pathItems.add();
    path.guides = true;
    if (guide.orientation === 'h') {
      return path.setEntirePath([[pb[0], abLocation[1]], [pb[2], abLocation[1]]]);
    } else {
      return path.setEntirePath([[abLocation[0], pb[1]], [abLocation[0], pb[3]]]);
    }
  };

  clearGuides = function(orientation) {
    var path, remove, _i, _ref, _ref1, _ref2;
    _ref = getDocumentGuides();
    for (_i = _ref.length - 1; _i >= 0; _i += -1) {
      path = _ref[_i];
      if (!path.path.guides) {
        continue;
      }
      if (!(!((_ref1 = path.path.layer) != null ? _ref1.locked : void 0) && ((_ref2 = path.path.layer) != null ? _ref2.visible : void 0))) {
        continue;
      }
      remove = false;
      if (orientation === 'v' && path.orientation === 'v') {
        remove = true;
      }
      if (orientation === 'h' && path.orientation === 'h') {
        remove = true;
      }
      if (!orientation) {
        remove = true;
      }
      if (remove) {
        path.path.remove();
      }
    }
    return null;
  };

  getDocumentGuides = function(opts) {
    var isHorz, isVert, orientation, path, rect, _i, _len, _ref, _results;
    if (opts == null) {
      opts = {};
    }
    isVert = function(r) {
      return (r[0] === r[2]) && (r[1] !== r[3]);
    };
    isHorz = function(r) {
      return (r[0] !== r[2]) && (r[1] === r[3]);
    };
    _ref = activeDocument.pathItems;
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      path = _ref[_i];
      if (!path.guides) {
        continue;
      }
      rect = path.geometricBounds;
      if (opts.relative) {
        rect = _.doc2abRect(rect);
      }
      orientation = null;
      if (isVert(rect)) {
        orientation = 'v';
      }
      if (isHorz(rect)) {
        orientation = 'h';
      }
      _results.push({
        path: path,
        orientation: orientation,
        location: orientation === 'v' ? rect[0] : rect[1]
      });
    }
    return _results;
  };

  getLayerGuides = function(opts) {
    var guide, layer, _i, _len, _ref, _results;
    layer = activeDocument.activeLayer;
    _ref = getDocumentGuides(opts);
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      guide = _ref[_i];
      if (guide.path.layer === layer) {
        _results.push(guide);
      }
    }
    return _results;
  };

  convertSelectionToGuides = function() {
    var path, _i, _len, _ref, _results;
    _ref = activeDocument.selection;
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      path = _ref[_i];
      _results.push(path.guides = true);
    }
    return _results;
  };

  GuideGuide = (function() {
    function GuideGuide() {
      this.capabilities = {
        artboardGuides: false
      };
    }

    GuideGuide.prototype.openInstallDirectory = function(path) {
      var e;
      try {
        _.log("Opening folder: " + path);
        return File(path).execute();
      } catch (_error) {
        e = _error;
        return _.log(e);
      }
    };

    GuideGuide.prototype.toggleLogging = function(openFile) {
      var e, file;
      if (openFile == null) {
        openFile = true;
      }
      if (openFile === 'true') {
        openFile = true;
      }
      try {
        LOGGING_ENABLED = !LOGGING_ENABLED;
        if (LOGGING_ENABLED) {
          _.log("    Logging enabled");
          file = _.dumpLogFileTo(getLogPath());
          if (openFile === true) {
            return file.execute();
          }
        } else {
          return _.log("Logging disabled");
        }
      } catch (_error) {
        e = _error;
        return alert(e);
      }
    };

    GuideGuide.prototype.getDataDir = function() {
      return File(DATA_DIRECTORY).fsName;
    };

    GuideGuide.prototype.changeDataDir = function(to) {
      var from, result;
      to = File(decodeURI(to)).absoluteURI;
      from = DATA_DIRECTORY;
      _.log("Changing DATA_DIRECTORY from " + from + " to " + to);
      if (to === from) {
        return;
      }
      result = setDataFolder(to);
      if (result instanceof Folder) {
        if (!File(dataPathFor(to)).exists) {
          cpFile(dataPathFor(from), dataPathFor(to));
        }
        _.dumpLogFileTo(getLogPath());
        return File(DATA_DIRECTORY).fsName;
      } else {
        _.log(_.formatError(result));
        return null;
      }
    };

    return GuideGuide;

  })();

  $.GuideGuide = new GuideGuide();

  $.GuideGuide.capabilities.artboardGuides = true;

  $.GuideGuide.capabilities.gridFromExisting = false;

  $.GuideGuide.hasOpenDocument = function() {
    if (!(app.documents.length > 0)) {
      return false;
    }
    return JSON.stringify({
      resolution: activeDocument.resolution
    });
  };

  $.GuideGuide.getDocumentRulerUnits = function() {
    if (!this.hasOpenDocument()) {
      return '';
    }
    return _.friendlyUnits(activeDocument.rulerUnits);
  };

  $.GuideGuide.getAppInfo = function() {
    return JSON.stringify({
      snap: false,
      capabilities: this.capabilities,
      trialExpired: trialExpired(),
      useLayersAsContext: false,
      usageCount: getUses()
    });
  };

  $.GuideGuide.getContexts = function() {
    var contexts;
    if (!this.hasOpenDocument()) {
      return '{}';
    }
    contexts = getContexts();
    _.log("");
    _.log("Contexts requested, got:", contexts);
    return JSON.stringify(contexts);
  };

  $.GuideGuide.addGuides = function(contexts) {
    if (!this.hasOpenDocument()) {
      return '{}';
    }
    incrimentUses();
    _.log("Adding guides");
    _.log("Data from GuideGuide:", contexts);
    addGuides(contexts);
    return null;
  };

  $.GuideGuide.clearGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    _.log("Clearing guides");
    clearGuides();
    return null;
  };

  $.GuideGuide.clearAllGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    _.log("Clearing all guides");
    clearGuides();
    return null;
  };

  $.GuideGuide.clearOrientationGuides = function(orientation) {
    if (!this.hasOpenDocument()) {
      return null;
    }
    _.log("Clearing orientation (" + orientation + ") guides");
    clearGuides(orientation);
    return null;
  };

  $.GuideGuide.convertSelectionToGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    _.log("Converting selection guides");
    convertSelectionToGuides();
    return null;
  };

  $.GuideGuide.toggleGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    _.log("Toggling guides");
    app.executeMenuCommand('showguide');
    return null;
  };

  try {
    DATA_DIRECTORY = getDataDirFromHostStorage();
  } catch (_error) {
    e = _error;
  }

  if (DATA_DIRECTORY == null) {
    setDataFolder("" + Folder.myDocuments.absoluteURI + "/GuideGuide");
  }

  if (DATA_DIRECTORY == null) {
    setDataFolder("" + Folder.userData.absoluteURI + "/GuideGuide");
  }

  if (DATA_DIRECTORY == null) {
    alert('Unable to save GuideGuide data files');
  }

}).call(this);
