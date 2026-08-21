(function() {
  var DATA_DIRECTORY, GuideGuide, LOGGING_ENABLED, REGISTRY_KEY, USE_LAYERS_AS_CONTEXT, Utilities, addGuide, addGuides, cAll, cBottom, cDelete, cDocument, cGuide, cHorizontal, cItemIndex, cKind, cLayer, cLeft, cMake, cMakeVisible, cMenu, cMenuItem, cName, cNew, cNull, cNumberOfLayers, cOrdinal, cOrientation, cPixel, cPosition, cProperty, cRight, cSelect, cTarget, cToggleGuides, cTop, cUndo, cVertical, clearAllGuides, clearArtboardGuides, clearCanvasGuides, clearGuideByIndex, clearGuides, clearGuidesInBounds, clearOrientationGuides, cpFile, createFileAt, canvasFallbackContexts, dataPathFor, deselectAllLayers, hasContextEntries, duplicateGuidesToArtboards, duplicateGuidesToOpenDocuments, e, filter, getAMLayerPropertyByIndex, getContexts, getDataDirFromHostStorage, getDocumentProperty, getGuideInfoByindex, getGuidesFromTargetContexts, getLayerInfoByIndex, getLogPath, getOffset, getSelectionBounds, getSelectionContext, getSnap, getTargetLayerRef, getUses, groupSelectedLayers, hasBackground, hostStorage, incrimentUses, relativeRect, rulerOrigin, sAddToSelection, sArtboard, sArtboardRect, sBounds, sClearAllGuides, sClearArtboardGuides, sClearCanvasGuides, sDataDir, sFreeUses, sGroupLayersEvent, sGuideIDs, sGuideTarget, sGuideTargetCanvas, sID, sInit, sKind, sLayerID, sLayerSection, sPosition, sSelectNoLayers, sSelectedArtboard, sSelectionModifier, sSelectionModifierType, sTargetLayers, sTargetLayersIDs, sUseLayersAsContext, sVisible, selectLayerAtIntex, setDataFolder, setup, suspend, teardown, trialExpired, undo, writeLineToFile, zeroes, _;

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

  USE_LAYERS_AS_CONTEXT = false;

  hasBackground = function() {
    var e;
    try {
      app.activeDocument.backgroundLayer;
      return true;
    } catch (_error) {
      e = _error;
      return false;
    }
  };

  setDataFolder = function(path) {
    var dataFolder, desc, e;
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
      desc = hostStorage();
      desc.putString(sDataDir, dataFolder.absoluteURI);
      app.putCustomOptions(REGISTRY_KEY, desc, true);
      return dataFolder;
    } catch (_error) {
      e = _error;
      return Error("Cannot set data folder to " + (encodeURI(dataFolder.absoluteURI)) + " because:\n" + (_.formatError(e)));
    }
  };

  _.cTID = function(s) {
    return app.charIDToTypeID(s);
  };

  _.sTID = function(s) {
    return app.stringIDToTypeID(s);
  };

  _.tSID = function(n) {
    return app.typeIDToStringID(n);
  };

  _.listKeys = function(desc) {
    var n, str, _i, _ref;
    str = "Total keys: " + desc.count + "\n";
    for (n = _i = 0, _ref = desc.count; 0 <= _ref ? _i < _ref : _i > _ref; n = 0 <= _ref ? ++_i : --_i) {
      str += "" + n + ": " + (this.tSID(desc.getKey(n))) + "\n";
    }
    return alert(str);
  };

  _.getDescDataByKey = function(desc, typeID) {
    if ((desc.hasKey != null) && !desc.hasKey(typeID)) {
      return null;
    }
    switch (desc.getType(typeID)) {
      case DescValueType.REFERENCETYPE:
        return executeActionGet(desc.getReference(typeID));
      case DescValueType.LISTTYPE:
        return desc.getList(typeID);
      case DescValueType.INTEGERTYPE:
        return desc.getInteger(typeID);
      case DescValueType.OBJECTTYPE:
        return desc.getObjectValue(typeID);
      case DescValueType.STRINGTYPE:
        return desc.getString(typeID);
      case DescValueType.BOOLEANTYPE:
        return desc.getBoolean(typeID);
      case DescValueType.ENUMERATEDTYPE:
        return desc.getEnumerationValue(typeID);
      case DescValueType.DOUBLETYPE:
        return desc.getDouble(typeID);
      case DescValueType.UNITDOUBLE:
        return desc.getUnitDoubleValue(typeID);
      default:
        return alert("Cannot get data from " + (desc.getType(typeID)));
    }
  };

  _.getList = function(list) {
    var n, _i, _ref, _results;
    _results = [];
    for (n = _i = 0, _ref = list.count; 0 <= _ref ? _i < _ref : _i > _ref; n = 0 <= _ref ? ++_i : --_i) {
      _results.push(this.getDescDataByKey(list, n));
    }
    return _results;
  };

  _.artboardRelativeGuide = function(guide, rect) {
    var clone, k, offset, v;
    clone = new Object();
    for (k in guide) {
      v = guide[k];
      clone[k] = v;
    }
    offset = clone.orientation === 'v' ? rect.x1 : rect.y1;
    clone.canvasLocation = clone.location;
    clone.location = clone.canvasLocation - offset;
    return clone;
  };

  _.friendlyUnits = function(units) {
    switch (units) {
      case Units.CM:
        return "cm";
      case Units.INCHES:
        return "in";
      case Units.MM:
        return "mm";
      case Units.PERCENT:
        return "%";
      case Units.PICAS:
        return "picas";
      case Units.POINTS:
        return "points";
      default:
        return "px";
    }
  };

  cProperty = _.cTID('Prpr');

  cDocument = _.cTID('Dcmn');

  cOrdinal = _.cTID('Ordn');

  cTarget = _.cTID('Trgt');

  cNumberOfLayers = _.cTID('NmbL');

  cName = _.cTID('Nm  ');

  cLayer = _.cTID('Lyr ');

  cItemIndex = _.cTID('ItmI');

  cTop = _.cTID('Top ');

  cLeft = _.cTID('Left');

  cBottom = _.cTID('Btom');

  cRight = _.cTID('Rght');

  cGuide = _.cTID('Gd  ');

  cOrientation = _.cTID('Ornt');

  cPosition = _.cTID('Pstn');

  cPixel = _.cTID('#Pxl');

  cVertical = _.cTID('Vrtc');

  cHorizontal = _.cTID('Hrzn');

  cMake = _.cTID('Mk  ');

  cNew = _.cTID('Nw  ');

  cKind = _.cTID('Knd ');

  cNull = _.cTID('null');

  cSelect = _.cTID('slct');

  cLayer = _.cTID('Lyr ');

  cMakeVisible = _.cTID('MkVs');

  cDelete = _.cTID('Dlt ');

  cAll = _.cTID('Al  ');

  cUndo = _.cTID('undo');

  cMenu = _.cTID('Mn  ');

  cMenuItem = _.cTID('MnIt');

  cToggleGuides = _.cTID('Tgld');

  sLayerSection = _.sTID('layerSection');

  sTargetLayers = _.sTID('targetLayers');

  sTargetLayersIDs = _.sTID('targetLayersIDs');

  sLayerID = _.sTID('layerID');

  sArtboard = _.sTID('artboard');

  sArtboardRect = _.sTID('artboardRect');

  sBounds = _.sTID('bounds');

  sPosition = _.sTID('position');

  sID = _.sTID('ID');

  sKind = _.sTID('kind');

  sGuideIDs = _.sTID('guideIDs');

  sInit = _.sTID('init');

  sFreeUses = _.sTID('ggFreeUses');

  sDataDir = _.sTID('dataDir');

  sGuideTarget = _.sTID('guideTarget');

  sGuideTargetCanvas = _.sTID('guideTargetCanvas');

  sSelectedArtboard = _.sTID('guideTargetSelectedArtboard');

  sSelectionModifier = _.sTID('selectionModifier');

  sSelectionModifierType = _.sTID('selectionModifierType');

  sAddToSelection = _.sTID('addToSelection');

  sSelectNoLayers = _.sTID('selectNoLayers');

  sClearCanvasGuides = _.sTID('clearCanvasGuides');

  sClearArtboardGuides = _.sTID('clearSelectedArtboardGuides');

  sClearAllGuides = _.sTID('clearAllGuides');

  sVisible = _.sTID('visible');

  sGroupLayersEvent = _.sTID('groupLayersEvent');

  sUseLayersAsContext = _.sTID('useLayersAsContext');

  undo = function() {
    return executeAction(cUndo, void 0, DialogModes.NO);
  };

  getTargetLayerRef = function() {
    var ref;
    ref = new ActionReference();
    ref.putEnumerated(cLayer, cOrdinal, cTarget);
    return ref;
  };

  groupSelectedLayers = function() {
    var desc, e;
    try {
      desc = new ActionDescriptor();
      desc.putReference(cNull, getTargetLayerRef());
      executeAction(sGroupLayersEvent, desc, DialogModes.NO);
      return true;
    } catch (_error) {
      e = _error;
      return false;
    }
  };

  deselectAllLayers = function() {
    var deselectDesc, e;
    try {
      deselectDesc = new ActionDescriptor();
      deselectDesc.putReference(cNull, getTargetLayerRef());
      return executeAction(sSelectNoLayers, deselectDesc, DialogModes.NO);
    } catch (_error) {
      e = _error;
    }
  };

  selectLayerAtIntex = function(idx, addToSelection) {
    var layerRef, layerSelectDesc;
    _.log("" + (addToSelection ? 'Add' : 'Select') + " layer at: " + idx);
    layerRef = new ActionReference();
    layerRef.putIndex(cLayer, idx);
    layerSelectDesc = new ActionDescriptor();
    layerSelectDesc.putReference(cNull, layerRef);
    layerSelectDesc.putBoolean(cMakeVisible, false);
    if (addToSelection) {
      layerSelectDesc.putEnumerated(sSelectionModifier, sSelectionModifierType, sAddToSelection);
    }
    return executeAction(cSelect, layerSelectDesc, DialogModes.NO);
  };

  zeroes = function(args) {
    var k, v;
    return ((function() {
      var _results;
      _results = [];
      for (k in args) {
        v = args[k];
        if (v !== 0) {
          _results.push(v);
        }
      }
      return _results;
    })()).length === 0;
  };

  getLayerInfoByIndex = function(idx) {
    var abBottom, abLeft, abRight, abTop, artboard, artboardRect, bottom, bounds, closing, e, guideIDs, isLayerSet, left, name, obj, right, top, type, typeID;
    name = getAMLayerPropertyByIndex(idx, cName) || 'Background';
    typeID = getAMLayerPropertyByIndex(idx, sLayerSection);
    type = typeID ? _.tSID(typeID) : 'background';
    isLayerSet = type === 'layerSectionStart';
    obj = {
      name: name,
      index: idx,
      isSet: isLayerSet,
      visible: getAMLayerPropertyByIndex(idx, sVisible)
    };
    try {
      artboard = getAMLayerPropertyByIndex(idx, sArtboard);
      artboardRect = _.getDescDataByKey(artboard, sArtboardRect);
      abTop = parseInt(_.getDescDataByKey(artboardRect, cTop));
      abLeft = parseInt(_.getDescDataByKey(artboardRect, cLeft));
      abBottom = parseInt(_.getDescDataByKey(artboardRect, cBottom));
      abRight = parseInt(_.getDescDataByKey(artboardRect, cRight));
      guideIDs = _.getList(_.getDescDataByKey(artboard, sGuideIDs));
      if (guideIDs.length > 0) {
        obj.guideIDs = guideIDs;
      }
      if ((abTop + abBottom + abLeft + abRight) > 0) {
        obj.artboard = {
          x1: abLeft,
          x2: abRight,
          y1: abTop,
          y2: abBottom
        };
      }
    } catch (_error) {
      e = _error;
    }
    bounds = getAMLayerPropertyByIndex(idx, sBounds);
    if (bounds) {
      top = parseInt(_.getDescDataByKey(bounds, cTop));
      left = parseInt(_.getDescDataByKey(bounds, cLeft));
      bottom = parseInt(_.getDescDataByKey(bounds, cBottom));
      right = parseInt(_.getDescDataByKey(bounds, cRight));
    }
    if (!isLayerSet) {
      obj.rect = {
        x1: left || 0,
        x2: right || 0,
        y1: top || 0,
        y2: bottom || 0
      };
    } else {
      closing = type === 'layerSectionEnd' || name.match(/<\/Layer group/) != null;
      if (closing) {
        obj.isClosing = true;
        obj.isSet = false;
      }
    }
    return obj;
  };

  getGuideInfoByindex = function(idx) {
    var guide, kind, kindID, orientation, origin, ref, rulerOffset;
    ref = new ActionReference();
    ref.putIndex(cGuide, idx + 1);
    guide = executeActionGet(ref);
    origin = rulerOrigin();
    orientation = _.tSID(_.getDescDataByKey(guide, cOrientation)).charAt(0);
    rulerOffset = orientation === 'v' ? origin.x : origin.y;
    kindID = _.getDescDataByKey(guide, sKind);
    kind = kindID ? _.tSID(kindID) : 'document';
    return {
      index: idx,
      id: _.getDescDataByKey(guide, sID),
      orientation: orientation,
      location: _.getDescDataByKey(guide, sPosition) - rulerOffset,
      kind: kind,
      toString: function() {
        return "" + this.orientation + ":" + this.location;
      },
      inBounds: function(bounds) {
        var key, str, _ref;
        str = this + '\n';
        str += _.beautify(bounds);
        key = this.orientation === 'v' ? 'x' : 'y';
        return (bounds["" + key + "1"] <= (_ref = this.location) && _ref <= bounds["" + key + "2"]);
      }
    };
  };

  getAMLayerPropertyByIndex = function(idx, property) {
    var e, ref;
    ref = new ActionReference();
    ref.putProperty(cProperty, property);
    ref.putIndex(cLayer, idx);
    try {
      return _.getDescDataByKey(executeActionGet(ref), property);
    } catch (_error) {
      e = _error;
      return null;
    }
  };

  getOffset = function(key) {
    var desc, origin, ref;
    ref = new ActionReference();
    origin = _.sTID(key);
    ref.putProperty(cProperty, origin);
    ref.putEnumerated(cDocument, cOrdinal, cTarget);
    desc = executeActionGet(ref);
    if (desc.hasKey(origin)) {
      return (desc.getInteger(origin) / 65536) * -1;
    } else {
      return 0;
    }
  };

  rulerOrigin = function() {
    return {
      x: getOffset('rulerOriginH'),
      y: getOffset('rulerOriginV')
    };
  };

  relativeRect = function(relativeTo, rect) {
    return {
      x1: rect.x1 - relativeTo.x1,
      x2: rect.x2 - relativeTo.x1,
      y1: rect.y1 - relativeTo.y1,
      y2: rect.y2 - relativeTo.y1
    };
  };

  getSelectionBounds = function(bounds) {
    if (!bounds) {
      return null;
    }
    return {
      x1: parseInt(bounds[0]),
      x2: parseInt(bounds[2]),
      y1: parseInt(bounds[1]),
      y2: parseInt(bounds[3])
    };
  };

  getSelectionContext = function(doc) {
    var artboard, b, contexts, e, index, leftmost, offsetX, offsetY, overlaps, rect, topmost, _i, _len, _ref;
    try {
      b = getSelectionBounds(app.activeDocument.selection.bounds);
      overlaps = [];
      leftmost = null;
      topmost = null;
      contexts = {};
      _ref = doc.dom.artboards;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        artboard = _ref[_i];
        rect = artboard.artboard;
        if (artboard.artboardIndex > 0) {
          if ((leftmost == null) || rect.x1 < leftmost) {
            leftmost = rect.x1;
          }
          if ((topmost == null) || rect.y1 < topmost) {
            topmost = rect.y1;
          }
        }
        if ((b.x1 > rect.x2) || (b.x2 < rect.x1)) {
          continue;
        }
        if ((b.y1 > rect.y2) || (b.y2 < rect.y1)) {
          continue;
        }
        overlaps.push(artboard.artboardIndex);
      }
      index = 0;
      offsetX = b.x1 - leftmost;
      offsetY = b.y1 - topmost;
      if (overlaps.length === 2) {
        index = overlaps[1];
        artboard = doc.dom.artboards[index];
        offsetX = b.x1 - artboard.artboard.x1;
        offsetY = b.y1 - artboard.artboard.y1;
      }
      contexts[index] = {
        width: b.x2 - b.x1,
        height: b.y2 - b.y1,
        offsetX: offsetX,
        offsetY: offsetY
      };
      _.log(contexts);
      return contexts;
    } catch (_error) {
      e = _error;
      return null;
    }
  };

  hasContextEntries = function(obj) {
    var key;
    if (!obj) return false;
    for (key in obj) {
      if (obj.hasOwnProperty(key)) return true;
    }
    return false;
  };

  canvasFallbackContexts = function() {
    var width = 1;
    var height = 1;
    try {
      width = Math.max(1, app.activeDocument.width.as('px'));
      height = Math.max(1, app.activeDocument.height.as('px'));
    } catch (ignoreCanvasFallback) {}
    return {
      0: { width: width, height: height, offsetX: 0, offsetY: 0 }
    };
  };

  getContexts = function() {
    var activeArtboards, artboard, artboards, artboardsToProcess, contexts, doc, e, rect, selectionContext, state, _i, _len;
    state = null;
    try {
      state = setup(true);
      doc = state.document;
      artboards = doc.dom.artboards;
      contexts = {};
      selectionContext = getSelectionContext(doc);
      if (selectionContext != null) {
        teardown(state);
        return selectionContext;
      }
      artboardsToProcess = artboards.length > 1 ? artboards.slice(1, artboards.length) : artboards;
      activeArtboards = doc.getActiveArtboards();
      if (activeArtboards.length > 0) artboardsToProcess = activeArtboards;
      for (_i = 0, _len = artboardsToProcess.length; _i < _len; _i++) {
        artboard = artboardsToProcess[_i];
        if (!artboard || !artboard.artboard) continue;
        rect = artboard.rect ? artboard.rect : artboard.artboard;
        rect = relativeRect(artboard.artboard, rect);
        contexts[artboard.artboardIndex] = {
          width: rect.x2 - rect.x1,
          height: rect.y2 - rect.y1,
          offsetX: rect.x1,
          offsetY: rect.y1
        };
      }
      teardown(state);
      return hasContextEntries(contexts) ? contexts : canvasFallbackContexts();
    } catch (_error) {
      e = _error;
      try { _.log('Guide context fallback: ' + e); } catch (ignoreContextLog) {}
      try { if (state) teardown(state); } catch (ignoreContextTeardown) {}
      return canvasFallbackContexts();
    }
  };


  getSelectedLayerContexts = function() {
    var artboard, artboards, bounds, centerX, centerY, contexts, doc, rect, selectionContext, state, targetArtboard, _i, _len;
    state = setup(true);
    contexts = {};
    try {
      doc = state.document;

      /*
       * 底部快捷参考线优先使用 Photoshop 当前选区范围。
       * 没有有效选区时再回退到当前活动图层，避免“顶边/底边/左右边/中心”
       * 在已有选区的情况下仍错误地按图层边界创建参考线。
       */
      selectionContext = getSelectionContext(doc);
      if (selectionContext != null) {
        teardown(state);
        return selectionContext;
      }

      bounds = getSelectionBounds(app.activeDocument.activeLayer.bounds);
      if (!bounds || ((bounds.x2 - bounds.x1) === 0 && (bounds.y2 - bounds.y1) === 0)) {
        teardown(state);
        return getContexts();
      }
      artboards = doc.dom.artboards;
      targetArtboard = artboards[0];
      centerX = (bounds.x1 + bounds.x2) / 2;
      centerY = (bounds.y1 + bounds.y2) / 2;
      if (artboards.length > 1) {
        for (_i = 1, _len = artboards.length; _i < _len; _i++) {
          artboard = artboards[_i];
          rect = artboard.artboard;
          if (rect && rect.x1 <= centerX && centerX <= rect.x2 && rect.y1 <= centerY && centerY <= rect.y2) {
            targetArtboard = artboard;
            break;
          }
        }
      }
      rect = targetArtboard.artboard;
      contexts[targetArtboard.artboardIndex] = {
        width: bounds.x2 - bounds.x1,
        height: bounds.y2 - bounds.y1,
        offsetX: bounds.x1 - rect.x1,
        offsetY: bounds.y1 - rect.y1
      };
    } catch (e) {
      _.log('Failed to get selected layer context: ' + e);
    }
    teardown(state);
    return contexts;
  };

  getDocumentProperty = function(property) {
    var ref;
    ref = new ActionReference();
    ref.putProperty(cProperty, property);
    ref.putEnumerated(cDocument, cOrdinal, cTarget);
    return _.getDescDataByKey(executeActionGet(ref), property);
  };

  _.ActiveDocument = (function() {
    ActiveDocument.prototype.cache = {};

    function ActiveDocument() {
      var state;
      state = setup();
      this.dom = {};
      this.getGuidesFromAM();
      this.getLayersFromAM();
      teardown(state);
    }

    ActiveDocument.prototype.countLayers = function() {
      return getDocumentProperty(cNumberOfLayers);
    };

    ActiveDocument.prototype.getTargetLayerIDs = function() {
      var background, idx, layers, n, ref, targetList;
      if (this.countLayers() === 0) {
        return [];
      }
      targetList = getDocumentProperty(sTargetLayers);
      background = hasBackground();
      if (targetList) {
        layers = (function() {
          var _i, _ref, _results;
          _results = [];
          for (n = _i = 0, _ref = targetList.count; 0 <= _ref ? _i < _ref : _i > _ref; n = 0 <= _ref ? ++_i : --_i) {
            idx = targetList.getReference(n).getIndex();
            if (background) {
              _results.push(idx);
            } else {
              _results.push(idx + 1);
            }
          }
          return _results;
        })();
        return layers.reverse();
      } else {
        ref = new ActionReference();
        ref.putProperty(cProperty, cItemIndex);
        ref.putEnumerated(cLayer, cOrdinal, cTarget);
        idx = executeActionGet(ref).getInteger(cItemIndex);
        idx = background ? idx - 1 : idx;
        if (idx !== this.countLayers()) {
          return [idx];
        }
        if (groupSelectedLayers()) {
          undo();
          return [idx];
        } else {
          return [];
        }
      }
    };

    ActiveDocument.prototype.getArtboardGuides = function(artboard) {
      var guide, guides, _i, _j, _len, _len1, _ref, _results, _results1;
      if (artboard.isDocument) {
        guides = filter(this.dom.guides, function(guide) {
          return guide.kind === 'document';
        });
        _results = [];
        for (_i = 0, _len = guides.length; _i < _len; _i++) {
          guide = guides[_i];
          _results.push(_.guideToString(guide));
        }
        return _results;
      } else {
        if (!artboard.guides) {
          return [];
        }
        _ref = artboard.guides;
        _results1 = [];
        for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
          guide = _ref[_j];
          _results1.push(_.guideToString(guide));
        }
        return _results1;
      }
    };

    ActiveDocument.prototype.getLayersFromAM = function() {
      var children, docChildren, guide, i, l, layer, parentNode, parents, targetLayers, _i, _j, _len, _len1, _ref, _ref1;
      this.dom.artboards = [
        {
          name: "Document",
          isDocument: true,
          children: [],
          artboardIndex: 0,
          artboard: {
            x1: 0,
            x2: app.activeDocument.width.as('px'),
            y1: 0,
            y2: app.activeDocument.height.as('px')
          }
        }
      ];
      this.layers = {};
      targetLayers = this.getTargetLayerIDs();
      parents = {
        arr: [this.dom.artboards[0]],
        push: function(el) {
          return this.arr.push(el);
        },
        pop: function() {
          return this.arr.pop();
        },
        last: function(distance) {
          if (distance == null) {
            distance = 1;
          }
          return this.arr[this.arr.length - distance];
        }
      };
      _ref = this.getLayersInfo();
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        layer = _ref[_i];
        this.layers[layer.index] = layer;
        if (layer.isClosing) {
          if (parents.arr.length > 1) parents.pop();
          continue;
        }
        parentNode = parents.last();
        if (!parentNode) {
          parents.arr = [this.dom.artboards[0]];
          parentNode = this.dom.artboards[0];
        }
        if (!parentNode.children) parentNode.children = [];
        layer.parent = isFinite(Number(parentNode.index)) ? parentNode.index : 0;
        layer.artboardIndex = this.dom.artboards.length;
        if (layer.isSet) {
          layer.children = [];
        }
        if (layer.index === targetLayers[0]) {
          layer.target = true;
          targetLayers.shift();
        }
        if (layer.guideIDs) {
          layer.guides = filter(this.dom.guides, function(guide) {
            var id;
            return ((function() {
              var _j, _len1, _ref1, _results;
              _ref1 = layer.guideIDs;
              _results = [];
              for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
                id = _ref1[_j];
                if (id === guide.id) {
                  _results.push(true);
                }
              }
              return _results;
            })()).length;
          });
          _ref1 = layer.guides;
          for (i = _j = 0, _len1 = _ref1.length; _j < _len1; i = ++_j) {
            guide = _ref1[i];
            layer.guides[i] = _.artboardRelativeGuide(guide, layer.artboard);
          }
        }
        parentNode.children.push(layer);
        if (layer.artboard) {
          this.dom.artboards.push(layer);
        }
        if (layer.isSet) {
          children = parentNode.children;
          parents.push(children[children.length - 1]);
        }
      }
      docChildren = this.dom.artboards[0].children;
      return this.dom.artboards[0].children = (function() {
        var _k, _len2, _results;
        _results = [];
        for (_k = 0, _len2 = docChildren.length; _k < _len2; _k++) {
          l = docChildren[_k];
          if (l.artboard == null) {
            _results.push(l);
          }
        }
        return _results;
      })();
    };

    ActiveDocument.prototype.getGuidesFromAM = function() {
      var guideCount, i, _i, _results;
      this.dom.guides = [];
      guideCount = app.activeDocument.guides.length;
      _results = [];
      for (i = _i = 0; 0 <= guideCount ? _i < guideCount : _i > guideCount; i = 0 <= guideCount ? ++_i : --_i) {
        _results.push(this.dom.guides.push(getGuideInfoByindex(i)));
      }
      return _results;
    };

    ActiveDocument.prototype.getLayersInfo = function() {
      var count, i, start, _i, _j, _len, _ref, _results, _results1;
      count = this.countLayers() + 1;
      start = this.getStartIndex();
      _ref = (function() {
        _results1 = [];
        for (var _j = start; start <= count ? _j < count : _j > count; start <= count ? _j++ : _j--){ _results1.push(_j); }
        return _results1;
      }).apply(this).reverse();
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        i = _ref[_i];
        _results.push(getLayerInfoByIndex(i));
      }
      return _results;
    };

    ActiveDocument.prototype.getStartIndex = function() {
      if (hasBackground()) {
        return 0;
      } else {
        return 1;
      }
    };

    ActiveDocument.prototype.getFirstTarget = function(layer) {
      var child, targets, _i, _len, _ref, _ref1;
      if (layer.target) {
        return [layer.index];
      }
      if (!((_ref = layer.children) != null ? _ref.length : void 0)) {
        return [];
      }
      targets = [];
      _ref1 = layer.children;
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        child = _ref1[_i];
        targets = targets.concat(arguments.callee(child));
      }
      return targets;
    };

    ActiveDocument.prototype.getLayerRect = function(layer) {
      var child, rect, _i, _len, _ref;
      if (!layer.isSet) {
        return layer.rect;
      }
      rect = null;
      _ref = layer.children;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        child = _ref[_i];
        if (!(child.rect && child.visible)) {
          continue;
        }
        if (rect == null) {
          if (!zeroes(child.rect)) {
            rect = child.rect;
          }
          continue;
        }
        rect = this.growRect(rect, child.rect);
      }
      return rect;
    };

    ActiveDocument.prototype.growRect = function(a, b) {
      if (zeroes(b)) {
        return a;
      }
      return {
        x1: b.x1 < a.x1 ? b.x1 : a.x1,
        x2: b.x2 > a.x2 ? b.x2 : a.x2,
        y1: b.y1 < a.y1 ? b.y1 : a.y1,
        y2: b.y2 > a.y2 ? b.y2 : a.y2
      };
    };

    ActiveDocument.prototype.getActiveArtboards = function(includeDocument) {
      var artboard, idx, innerTargets, rect, targetRect, targets, _i, _j, _len, _len1, _ref;
      if (includeDocument == null) {
        includeDocument = false;
      }
      targets = [];
      _ref = this.dom.artboards;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        artboard = _ref[_i];
        if (this.dom.artboards.length > 1 && artboard.artboardIndex === 0 && !includeDocument) {
          continue;
        }
        innerTargets = this.getFirstTarget(artboard);
        if (!(innerTargets.length > 0)) {
          continue;
        }
        targetRect = null;
        if (!USE_LAYERS_AS_CONTEXT) {
          targets.push(artboard);
          continue;
        }
        for (_j = 0, _len1 = innerTargets.length; _j < _len1; _j++) {
          idx = innerTargets[_j];
          if (idx === artboard.index) {
            continue;
          }
          if (!(rect = this.getLayerRect(this.layers[idx]))) {
            continue;
          }
          if (targetRect == null) {
            targetRect = rect;
            continue;
          }
          if (!zeroes(rect)) {
            targetRect = this.growRect(targetRect, rect);
          }
        }
        if (targetRect && !zeroes(targetRect)) {
          artboard.rect = targetRect;
        }
        targets.push(artboard);
      }
      return targets;
    };

    return ActiveDocument;

  })();

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

  getDataDirFromHostStorage = function() {
    return hostStorage().getString(sDataDir);
  };

  getSnap = function() {
    return true;
  };

  getUses = function() {
    var count, e;
    count = 0;
    try {
      count = hostStorage().getInteger(sFreeUses);
    } catch (_error) {
      e = _error;
    }
    return count;
  };

  incrimentUses = function() {
    var desc;
    desc = hostStorage();
    desc.putInteger(sFreeUses, getUses() + 1);
    return app.putCustomOptions(REGISTRY_KEY, desc, true);
  };

  hostStorage = function() {
    var desc, e, storage;
    storage = {};
    try {
      storage = app.getCustomOptions(REGISTRY_KEY);
    } catch (_error) {
      e = _error;
      desc = new ActionDescriptor();
      desc.putBoolean(sInit, true);
      app.putCustomOptions(REGISTRY_KEY, desc, true);
      storage = app.getCustomOptions(REGISTRY_KEY);
    }
    return storage;
  };

  trialExpired = function() {
    return getUses() > 30;
  };

  suspend = function(label, method, data) {
    var fn;
    _.log("");
    if (data && typeof data === 'object') {
      data = "'" + (JSON.stringify(data)) + "'";
    }
    fn = "" + method + "(" + (data ? '\'' + data + '\'' : '') + ")";
    _.log("Suspending: " + fn);
    return app.activeDocument.suspendHistory(label, fn);
  };

  addGuide = function(str, artboardGuide) {
    var guide, guideDesc, newGuideDesc, orientation, origin, rulerOffset, target;
    _.log("Adding " + (artboardGuide ? 'artboard ' : '') + "guide: " + str);
    guide = _.guideToObject(str);
    orientation = guide.orientation === 'v' ? cVertical : cHorizontal;
    origin = rulerOrigin();
    rulerOffset = guide.orientation === 'v' ? origin.x : origin.y;
    guideDesc = new ActionDescriptor();
    guideDesc.putUnitDouble(cPosition, cPixel, guide.location + rulerOffset);
    guideDesc.putEnumerated(cOrientation, cOrientation, orientation);
    guideDesc.putEnumerated(cKind, cKind, cDocument);
    newGuideDesc = new ActionDescriptor();
    newGuideDesc.putObject(cNew, cGuide, guideDesc);
    target = artboardGuide ? sSelectedArtboard : sGuideTargetCanvas;
    newGuideDesc.putEnumerated(sGuideTarget, sGuideTarget, target);
    return executeAction(cMake, newGuideDesc, DialogModes.NO);
  };

  setup = function(document) {
    var k, obj, units, v;
    units = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    obj = {
      units: units
    };
    if (!document) {
      return obj;
    }
    document = new _.ActiveDocument();
    obj.targetLayers = (function() {
      var _ref, _results;
      _ref = document.layers;
      _results = [];
      for (k in _ref) {
        v = _ref[k];
        if (v.target === true) {
          _results.push(v.index);
        }
      }
      return _results;
    })();
    obj.document = document;
    return obj;
  };

  teardown = function(state) {
    var i, index, _i, _len, _ref, _results;
    _.log("Restoring to previous state: ");
    _.log("  Units: " + (state.units.toString()));
    if (state.targetLayers) {
      _.log("  Layers: " + state.targetLayers);
    }
    app.preferences.rulerUnits = state.units;
    if (!state.targetLayers) {
      return;
    }
    if (state.targetLayers.length === 0) {
      return deselectAllLayers();
    }
    _ref = state.targetLayers;
    _results = [];
    for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
      index = _ref[i];
      _results.push(selectLayerAtIntex(index, i !== 0));
    }
    return _results;
  };

  addGuides = function(contexts) {
    var artboard, artboardGuides, doc, guides, key, state, token, _i, _len;
    _.log("Adding guides");
    _.log("Data from GuideGuide:", contexts);
    contexts = JSON.parse(contexts);
    state = setup(true);
    doc = state.document;
    for (key in contexts) {
      guides = contexts[key];
      artboard = doc.dom.artboards[parseInt(key)];
      _.log("Current Artboard: " + artboard.name);
      artboardGuides = doc.getArtboardGuides(artboard);
      if (!artboard.isDocument) {
        selectLayerAtIntex(artboard.index);
      }
      for (_i = 0, _len = guides.length; _i < _len; _i++) {
        token = guides[_i];
        if (filter(artboardGuides, function(g) {
          return g === token;
        }).length > 0) {
          _.log("Skipping already existing guide: " + token);
          continue;
        }
        addGuide(token, parseInt(key) > 0);
      }
    }
    return teardown(state);
  };

  clearCanvasGuides = function() {
    var e;
    try {
      return executeAction(sClearCanvasGuides, void 0, DialogModes.NO);
    } catch (_error) {
      e = _error;
      return clearAllGuides();
    }
  };

  clearArtboardGuides = function() {
    var e;
    try {
      return executeAction(sClearArtboardGuides, void 0, DialogModes.NO);
    } catch (_error) {
      e = _error;
      return clearAllGuides();
    }
  };

  clearAllGuides = function() {
    var desc, e, ref;
    try {
      return executeAction(sClearAllGuides, void 0, DialogModes.NO);
    } catch (_error) {
      e = _error;
      desc = new ActionDescriptor();
      ref = new ActionReference();
      ref.putEnumerated(cGuide, cOrdinal, cAll);
      desc.putReference(cNull, ref);
      return executeAction(cDelete, desc, DialogModes.NO);
    }
  };

  clearGuideByIndex = function(idx) {
    var guideDesc, guideRef;
    guideRef = new ActionReference();
    guideRef.putIndex(cGuide, idx + 1);
    guideDesc = new ActionDescriptor();
    guideDesc.putReference(cNull, guideRef);
    return executeAction(cDelete, guideDesc, DialogModes.NO);
  };

  clearGuidesInBounds = function(guides, bounds) {
    var guide, _i, _results;
    if (!((guides != null) && (bounds != null))) {
      return;
    }
    _results = [];
    for (_i = guides.length - 1; _i >= 0; _i += -1) {
      guide = guides[_i];
      if (_.guideInBounds(guide, bounds)) {
        _.log("Deleting: " + (_.guideToString(guide)) + " at index " + guide.index);
        _results.push(clearGuideByIndex(guide.index));
      } else {
        _results.push(void 0);
      }
    }
    return _results;
  };

  clearGuides = function(orientation) {
    var activeArtboards, artboard, bounds, doc, e, guides, state, _i, _len;
    _.log("Clearing guides");
    state = setup(true);
    doc = state.document;
    _.log(state.units.toString());
    try {
      bounds = getSelectionBounds(app.activeDocument.selection.bounds);
      _.log('Clearing guides in selection: ', bounds);
      clearGuidesInBounds(doc.dom.guides, bounds);
      teardown(state);
      return;
    } catch (_error) {
      e = _error;
    }
    activeArtboards = doc.getActiveArtboards();
    if (activeArtboards.length === 0) {
      if (doc.dom.artboards.length > 1) {
        activeArtboards = doc.dom.artboards.slice(1, doc.dom.artboards.length);
      } else {
        activeArtboards = [doc.dom.artboards[0]];
      }
    }
    for (_i = 0, _len = activeArtboards.length; _i < _len; _i++) {
      artboard = activeArtboards[_i];
      if (artboard.rect != null) {
        _.log("Clearing specific guides");
        guides = artboard.guides;
        if (artboard.isDocument) {
          guides = filter(doc.dom.guides, function(g) {
            return g.kind === 'document';
          });
        }
        clearGuidesInBounds(guides, relativeRect(artboard.artboard, artboard.rect));
        continue;
      }
      if (artboard.isDocument) {
        clearCanvasGuides();
        continue;
      }
      if (!artboard.isDocument) {
        selectLayerAtIntex(artboard.index);
      }
      _.log("Clearing artboard guides in: " + artboard.name);
      clearArtboardGuides();
    }
    return teardown(state);
  };

  getGuidesFromTargetContexts = function(compact) {
    var activeArtboards, artboard, artboardIndex, context, contexts, doc, e, g, guide, guides, key, rect, relativeGuide, selection, selectionGuides, sourceArtboards, token, tokens, _i, _j, _k, _l, _len, _len1, _len2, _len3, _ref;
    if (compact == null) {
      compact = false;
    }
    doc = new _.ActiveDocument();
    sourceArtboards = doc.dom.artboards;
    activeArtboards = doc.getActiveArtboards();
    if (activeArtboards.length > 0) {
      sourceArtboards = activeArtboards;
    }
    contexts = {};
    try {
      selection = getSelectionBounds(app.activeDocument.selection.bounds);
      selectionGuides = [];
      sourceArtboards = doc.dom.artboards;
    } catch (_error) {
      e = _error;
    }
    for (_i = 0, _len = sourceArtboards.length; _i < _len; _i++) {
      artboard = sourceArtboards[_i];
      guides = artboard.guides;
      if (artboard.isDocument) {
        guides = filter(doc.dom.guides, function(g) {
          return g.kind === 'document';
        });
      }
      if (!guides) {
        continue;
      }
      if (selection != null) {
        guides = (function() {
          var _j, _len1, _results;
          _results = [];
          for (_j = 0, _len1 = guides.length; _j < _len1; _j++) {
            guide = guides[_j];
            if (_.guideInBounds(guide, selection, !artboard.isDocument)) {
              _results.push(guide);
            }
          }
          return _results;
        })();
      }
      if (artboard.rect != null) {
        if (artboard.rect != null) {
          rect = relativeRect(artboard.artboard, artboard.rect);
        }
        guides = (function() {
          var _j, _len1, _results;
          _results = [];
          for (_j = 0, _len1 = guides.length; _j < _len1; _j++) {
            g = guides[_j];
            if (_.guideInBounds(g, rect)) {
              _results.push(g);
            }
          }
          return _results;
        })();
      } else {

      }
      _ref = doc.dom.artboards;
      for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
        artboard = _ref[_j];
        if ((selection == null) && artboard.isDocument && doc.dom.artboards.length > 1) {
          continue;
        }
        artboardIndex = artboard.artboardIndex;
        contexts[artboardIndex] || (contexts[artboardIndex] = []);
        tokens = [];
        for (_k = 0, _len2 = guides.length; _k < _len2; _k++) {
          guide = guides[_k];
          if (guide.kind === 'document') {
            if (_.guideInBounds(guide, artboard.artboard)) {
              relativeGuide = _.artboardRelativeGuide(guide, artboard.artboard);
              tokens.push(_.guideToString(relativeGuide));
            }
            continue;
          }
          tokens.push(_.guideToString(guide));
        }
        contexts[artboardIndex] = contexts[artboardIndex].concat(tokens);
      }
    }
    if (compact) {
      tokens = {};
      for (key in contexts) {
        context = contexts[key];
        for (_l = 0, _len3 = context.length; _l < _len3; _l++) {
          token = context[_l];
          tokens[token] = token;
        }
      }
      return {
        0: (function() {
          var _results;
          _results = [];
          for (key in tokens) {
            token = tokens[key];
            _results.push(token);
          }
          return _results;
        })()
      };
    }
    return contexts;
  };

  duplicateGuidesToArtboards = function() {
    var contexts;
    _.log('Duplicating guides to all artboards');
    contexts = getGuidesFromTargetContexts();
    delete contexts[0];
    _.log('Duplicating from contexts:', contexts);
    return addGuides(JSON.stringify(contexts));
  };

  duplicateGuidesToOpenDocuments = function() {
    var activeDocument, contexts, doc, _i, _len, _ref;
    _.log('Duplicating guides to all open documents');
    activeDocument = app.activeDocument;
    _.log("Active document is: " + activeDocument.id);
    contexts = getGuidesFromTargetContexts(true);
    _.log("Duplicating from contexts:", contexts);
    if (contexts[0].length === 0) {
      return;
    }
    _ref = app.documents;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      doc = _ref[_i];
      app.activeDocument = doc;
      if (app.activeDocument.id === activeDocument.id) {
        continue;
      }
      _.log("Duplicating guides to: " + doc.id);
      suspend($.GuideGuideMessages['historyDuplicateGuidesFrom'] + ' ' + activeDocument.name, 'addGuides', JSON.stringify(contexts));
    }
    return app.activeDocument = activeDocument;
  };

  clearOrientationGuides = function(orientation) {
    var activeArtboards, artboard, artboardsToProcess, doc, guide, guides, guidesToClear, orientationString, state, _i, _j, _len, _len1;
    orientationString = orientation === 'v' ? 'vertical' : 'horizontal';
    _.log("Clearing " + orientationString + " guides");
    state = setup(true);
    doc = state.document;
    artboardsToProcess = doc.dom.artboards;
    activeArtboards = doc.getActiveArtboards(true);
    if (activeArtboards.length > 0) {
      artboardsToProcess = activeArtboards;
    }
    guidesToClear = [];
    for (_i = 0, _len = artboardsToProcess.length; _i < _len; _i++) {
      artboard = artboardsToProcess[_i];
      guides = artboard.guides;
      if (artboard.isDocument) {
        guides = filter(doc.dom.guides, function(g) {
          return g.kind === 'document';
        });
      }
      if (!guides) {
        continue;
      }
      guides = filter(guides, function(guide) {
        var inBounds, oriented, rect;
        oriented = guide.orientation === orientation;
        inBounds = true;
        if (artboard.rect != null) {
          rect = relativeRect(artboard.artboard, artboard.rect);
          inBounds = _.guideInBounds(guide, rect);
        }
        return oriented && inBounds;
      });
      guidesToClear = guidesToClear.concat(guides);
    }
    guidesToClear.sort(function(a, b) {
      return parseInt(a.index) < parseInt(b.index);
    });
    for (_j = 0, _len1 = guidesToClear.length; _j < _len1; _j++) {
      guide = guidesToClear[_j];
      clearGuideByIndex(guide.index);
    }
    return teardown(state);
  };

  $.GuideGuide.capabilities.gridFromExisting = true;

  $.GuideGuide.getAppInfo = function() {
    return JSON.stringify({
      snap: getSnap(),
      capabilities: this.capabilities,
      trialExpired: trialExpired(),
      useLayersAsContext: this.getLayerContextSetting(),
      usageCount: getUses()
    });
  };

  $.GuideGuide.getExistingGuides = function() {
    var contexts;
    if (!this.hasOpenDocument()) {
      return '[]';
    }
    contexts = getGuidesFromTargetContexts(true);
    return JSON.stringify(contexts['0']);
  };

  $.GuideGuide.hasOpenDocument = function() {
    if (!(app.documents.length > 0)) {
      return false;
    }
    return JSON.stringify({
      resolution: app.activeDocument.resolution
    });
  };

  $.GuideGuide.getDocumentRulerUnits = function() {
    if (!this.hasOpenDocument()) {
      return '';
    }
    return _.friendlyUnits(app.preferences.rulerUnits);
  };

  $.GuideGuide.addGuides = function(guides) {
    if (!this.hasOpenDocument()) {
      return null;
    }
    incrimentUses();
    suspend($.GuideGuideMessages['btnAddGuides'], 'addGuides', guides);
    return null;
  };

  $.GuideGuide.getContexts = function() {
    var contexts, e;
    if (!this.hasOpenDocument()) return '{}';
    try {
      contexts = getContexts() || canvasFallbackContexts();
      _.log("");
      _.log("Contexts requested, got:", contexts);
      return JSON.stringify(contexts);
    } catch (_error) {
      e = _error;
      try { _.log('getContexts failed: ' + e); } catch (ignoreGetContextsLog) {}
      return JSON.stringify(canvasFallbackContexts());
    }
  };


  $.GuideGuide.getSelectedLayerContexts = function() {
    var contexts, e;
    if (!this.hasOpenDocument()) return '{}';
    try {
      contexts = getSelectedLayerContexts();
      if (!hasContextEntries(contexts)) contexts = getContexts();
      _.log("");
      _.log("Selected layer contexts requested, got:", contexts);
      return JSON.stringify(contexts || canvasFallbackContexts());
    } catch (_error) {
      e = _error;
      try { _.log('getSelectedLayerContexts failed: ' + e); } catch (ignoreSelectedContextLog) {}
      return JSON.stringify(canvasFallbackContexts());
    }
  };

  $.GuideGuide.clearGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    suspend($.GuideGuideMessages['tooltipClearGuides'], 'clearGuides');
    return null;
  };

  $.GuideGuide.toggleLayerContext = function() {
    var desc;
    desc = hostStorage();
    desc.putBoolean(sUseLayersAsContext, !USE_LAYERS_AS_CONTEXT);
    app.putCustomOptions(REGISTRY_KEY, desc, true);
    return USE_LAYERS_AS_CONTEXT = !USE_LAYERS_AS_CONTEXT;
  };

  $.GuideGuide.getLayerContextSetting = function() {
    var e, use;
    use = USE_LAYERS_AS_CONTEXT;
    try {
      use = hostStorage().getBoolean(sUseLayersAsContext);
    } catch (_error) {
      e = _error;
    }
    USE_LAYERS_AS_CONTEXT = use;
    return use;
  };

  $.GuideGuide.duplicateGuidesToArtboards = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    suspend($.GuideGuideMessages['menuDuplicateToArtboards'], 'duplicateGuidesToArtboards');
    return null;
  };

  $.GuideGuide.duplicateGuidesToOpenDocuments = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    suspend($.GuideGuideMessages['menuDuplicateToOpenDocuments'], 'duplicateGuidesToOpenDocuments');
    return null;
  };

  $.GuideGuide.clearCanvasGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    return clearCanvasGuides();
  };

  $.GuideGuide.clearArtboardGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    return clearArtboardGuides();
  };

  $.GuideGuide.clearAllGuides = function() {
    if (!this.hasOpenDocument()) {
      return null;
    }
    return clearAllGuides();
  };

  $.GuideGuide.clearOrientationGuides = function(orientation) {
    var labelKey;
    if (!this.hasOpenDocument()) {
      return null;
    }
    labelKey = orientation === 'v' ? 'menuClearVerticalGuides' : 'menuClearHorizontalGuides';
    return suspend($.GuideGuideMessages[labelKey], 'clearOrientationGuides', orientation);
  };

  $.GuideGuide.toggleGuides = function() {
    var desc, ref;
    desc = new ActionDescriptor();
    ref = new ActionReference();
    ref.putEnumerated(cMenu, cMenuItem, cToggleGuides);
    desc.putReference(cNull, ref);
    return executeAction(cSelect, desc, DialogModes.NO);
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
