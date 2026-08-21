/* 鑫洋助理 ExtendScript 模块：textTools（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.textTools = function (deps) {
    deps = deps || {};
    var pixels = deps.pixels;
    var layerSize = deps.layerSize;
    var integerValue = deps.integerValue;
    var activeLayerId = deps.activeLayerId;
    var selectedLayerIds = deps.selectedLayerIds;
    var selectLayersByIds = deps.selectLayersByIds;
    var findLayerById = deps.findLayerById;
    var layerNumericId = deps.layerNumericId;
    var suspendToolsHistory = deps.suspendToolsHistory;
    var toolCollectLayersRecursive = deps.toolCollectLayersRecursive;
    var toolHexColor = deps.toolHexColor;
    var toolLayerById = deps.toolLayerById;
    var toolLayerId = deps.toolLayerId;
    var toolLayerSort = deps.toolLayerSort;
    var toolLayerVisualBounds = deps.toolLayerVisualBounds;
    var toolPutNativeStrokeDefaults = deps.toolPutNativeStrokeDefaults;
    var toolSetLiveShapeGeometry = deps.toolSetLiveShapeGeometry;
    var toolSetLiveShapeRadius = deps.toolSetLiveShapeRadius;
    var toolSetNativeShapeAppearance = deps.toolSetNativeShapeAppearance;
    var toolShapeAppearanceInfo = deps.toolShapeAppearanceInfo;
    var toolSolidColorFromHex = deps.toolSolidColorFromHex;
    var toolSolidColorHex = deps.toolSolidColorHex;
    var toolTextFormattingLayers = deps.toolTextFormattingLayers;

    function toolsGetFonts() {
        var fonts = [];
        var index;
        for (index = 0; index < app.fonts.length; index += 1) {
            var font = app.fonts[index];
            fonts.push({
                postScriptName: String(font.postScriptName || font.name || ""),
                family: String(font.family || font.name || ""),
                style: String(font.style || "")
            });
        }
        fonts.sort(function (left, right) {
            var a = (left.family + " " + left.style).toLowerCase();
            var b = (right.family + " " + right.style).toLowerCase();
            return a < b ? -1 : a > b ? 1 : 0;
        });
        return { fonts: fonts };
    }

    function textJustification(value) {
        if (value === "center") return Justification.CENTER;
        if (value === "right") return Justification.RIGHT;
        return Justification.LEFT;
    }

    function toolSetTextJustificationPreservePosition(layer, value) {
        if (!layer || layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) return false;
        var item = layer.textItem;
        var targetName = String(value || "left");
        var currentName = "left";
        try { currentName = toolJustificationName(item.justification); } catch (ignoreReadJustification) {}
        if (currentName === targetName) return false;

        var before = toolLayerVisualBounds(layer);
        item.justification = textJustification(targetName);
        var after = toolLayerVisualBounds(layer);
        var dx = before.left - after.left;
        var dy = before.top - after.top;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            layer.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
        }
        return true;
    }

    function toolsPickTextColor(options) {
        options = options || {};
        var initialColor = String(options.color || "");
        var previousHex = toolSolidColorHex(app.foregroundColor) || "#000000";
        if (initialColor) {
            try { app.foregroundColor = toolSolidColorFromHex(initialColor); } catch (ignoreInitialColor) {}
        }

        var accepted = false;
        try {
            if (typeof app.showColorPicker !== "function") {
                throw new Error("当前 Photoshop 版本不支持脚本调用原生拾色器");
            }
            accepted = !!app.showColorPicker();
        } catch (pickerError) {
            try { app.foregroundColor = toolSolidColorFromHex(previousHex); } catch (ignoreRestoreOnError) {}
            throw new Error("无法打开 Photoshop 自带拾色器：" + pickerError.message);
        }

        if (!accepted) {
            try { app.foregroundColor = toolSolidColorFromHex(previousHex); } catch (ignoreRestoreOnCancel) {}
            return { cancelled: true, color: initialColor || previousHex, processed: 0, skipped: 0 };
        }

        var selectedHex = toolSolidColorHex(app.foregroundColor) || initialColor || previousHex;
        var processed = 0;
        var skipped = 0;
        var applyError = "";

        if (app.documents.length) {
            try {
                var document = app.activeDocument;
                var ids = selectedLayerIds();
                if (ids.length) {
                    var targetLayers = toolTextFormattingLayers(document, ids);
                    var preparedColor = toolSolidColorFromHex(selectedHex);
                    var result = suspendToolsHistory(document, "鑫洋助理：修改文字颜色", function () {
                        var index;
                        for (index = 0; index < targetLayers.length; index += 1) {
                            var layer = targetLayers[index];
                            if (!layer || layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) {
                                skipped += 1;
                                continue;
                            }
                            layer.textItem.color = preparedColor;
                            processed += 1;
                        }
                        return { processed: processed, skipped: skipped };
                    });
                    processed = Number(result && result.processed) || processed;
                    skipped = Number(result && result.skipped) || skipped;
                }
            } catch (colorApplyError) {
                applyError = "当前选择未应用到文字图层：" + colorApplyError.message;
            }
        }

        return {
            cancelled: false,
            color: selectedHex,
            processed: processed,
            skipped: skipped,
            applyError: applyError
        };
    }

    function toolsApplyTextFormatting(options) {
        if (!app.documents.length) throw new Error("请先打开 Photoshop 文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要排版的文字图层");
        options = options || {};

        function hasOption(name) {
            try { return options.hasOwnProperty(name); } catch (ignoreHasOption) {}
            return options[name] !== undefined;
        }

        var font = String(options.font || "");
        var applyFont = hasOption("font") && !!font;
        var applySize = hasOption("size");
        var size = Math.max(1, integerValue(options.size, 48));
        var applyTracking = hasOption("tracking");
        var tracking = Math.max(-1000, Math.min(10000, integerValue(options.tracking, 0)));
        var applyLeading = hasOption("leadingPoints") || hasOption("leading");
        var leadingPoints = integerValue(options.leadingPoints, 0);
        if (applyLeading && !(leadingPoints > 0) && applySize) {
            var leadingRatio = Math.max(0.5, Math.min(5, Number(options.leading || 1.2)));
            leadingPoints = Math.max(1, Math.round(size * leadingRatio));
        }
        var applyAlign = hasOption("align");
        var align = String(options.align || "left");
        var colorValue = String(options.color || "");
        var applyColor = hasOption("color") && !!colorValue;
        var applyFauxBold = hasOption("fauxBold");
        var fauxBold = !!options.fauxBold;
        var applyFauxItalic = hasOption("fauxItalic");
        var fauxItalic = !!options.fauxItalic;
        var applyAllCaps = hasOption("allCaps");
        var allCaps = !!options.allCaps;
        var applyOpticalKern = hasOption("opticalKern");
        var opticalKern = !!options.opticalKern;

        var changedProperties = [];
        if (applyFont) changedProperties.push("font");
        if (applySize) changedProperties.push("size");
        if (applyTracking) changedProperties.push("tracking");
        if (applyLeading) changedProperties.push("leading");
        if (applyAlign) changedProperties.push("align");
        if (applyColor) changedProperties.push("color");
        if (applyFauxBold) changedProperties.push("fauxBold");
        if (applyFauxItalic) changedProperties.push("fauxItalic");
        if (applyAllCaps) changedProperties.push("allCaps");
        if (applyOpticalKern) changedProperties.push("opticalKern");
        if (!changedProperties.length) throw new Error("没有检测到需要修改的文字属性");

        var targetLayers = toolTextFormattingLayers(document, ids);
        var preparedColor = applyColor ? toolSolidColorFromHex(colorValue) : null;
        var isRealtime = !!options.realtime;

        return suspendToolsHistory(document, "鑫洋助理：修改文字属性", function () {
            var processed = 0;
            var skipped = 0;
            var positionPreserved = 0;
            var index;
            for (index = 0; index < targetLayers.length; index += 1) {
                var layer = targetLayers[index];
                if (!layer || layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) {
                    skipped += 1;
                    continue;
                }
                var item = layer.textItem;
                if (applyFont) {
                    try { item.font = font; } catch (fontError) { throw new Error("找不到字体：" + font); }
                }
                if (applySize) item.size = UnitValue(size, "pt");
                if (applyTracking) item.tracking = tracking;
                if (applyLeading) {
                    var layerLeading = leadingPoints;
                    if (!(layerLeading > 0)) {
                        var currentSize = 48;
                        try { currentSize = Number(item.size.as("pt")) || currentSize; } catch (ignoreCurrentSize) {}
                        var ratio = Math.max(0.5, Math.min(5, Number(options.leading || 1.2)));
                        layerLeading = Math.max(1, Math.round(currentSize * ratio));
                    }
                    try { item.useAutoLeading = false; } catch (ignoreAutoLeading) {}
                    item.leading = UnitValue(layerLeading, "pt");
                }
                if (applyAlign && toolSetTextJustificationPreservePosition(layer, align)) positionPreserved += 1;
                if (applyColor) item.color = preparedColor;
                if (applyFauxBold) {
                    try { item.fauxBold = fauxBold; } catch (ignoreFauxBold) {}
                }
                if (applyFauxItalic) {
                    try { item.fauxItalic = fauxItalic; } catch (ignoreFauxItalic) {}
                }
                if (applyAllCaps) toolSetTextAllCaps(item, allCaps);
                if (applyOpticalKern) toolSetTextOpticalKern(item, opticalKern);
                processed += 1;
            }
            if (!processed) throw new Error("当前选区中没有可处理的文字图层");
            return {
                processed: processed,
                skipped: skipped,
                changedProperties: changedProperties,
                positionPreserved: positionPreserved,
                selectionPreserved: true,
                fastPath: isRealtime
            };
        });
    }

    function toolJustificationName(value) {
        if (value === Justification.CENTER) return "center";
        if (value === Justification.RIGHT) return "right";
        return "left";
    }

    function toolTextEnumName(value) {
        try { return String(value || "").toLowerCase(); } catch (ignoreEnumName) { return ""; }
    }

    function toolSetTextAllCaps(item, enabled) {
        try {
            if (typeof TextCase !== "undefined") {
                item.capitalization = enabled ? TextCase.ALLCAPS : TextCase.NORMAL;
            }
        } catch (ignoreCapitalization) {}
    }

    function toolReadTextAllCaps(item) {
        try { return toolTextEnumName(item.capitalization).indexOf("allcaps") >= 0; } catch (ignoreCapitalization) { return false; }
    }

    function toolSetTextOpticalKern(item, enabled) {
        try {
            if (typeof AutoKernType !== "undefined") {
                item.autoKerning = enabled ? AutoKernType.OPTICAL : AutoKernType.METRICS;
            }
        } catch (ignoreAutoKerning) {}
    }

    function toolReadTextOpticalKern(item) {
        try { return toolTextEnumName(item.autoKerning).indexOf("optical") >= 0; } catch (ignoreAutoKerning) { return false; }
    }

    function toolReadTextDirection(item) {
        try { return toolTextEnumName(item.direction).indexOf("vertical") >= 0 ? "vertical" : "horizontal"; } catch (ignoreDirection) { return "horizontal"; }
    }

    function toolSetTextDirection(item, direction) {
        try {
            if (typeof Direction !== "undefined") item.direction = direction === "vertical" ? Direction.VERTICAL : Direction.HORIZONTAL;
        } catch (ignoreDirection) {}
    }

    function toolFontInfoByPostScript(postScriptName) {
        var index;
        for (index = 0; index < app.fonts.length; index += 1) {
            var font = app.fonts[index];
            if (String(font.postScriptName || font.name || "") === String(postScriptName || "")) {
                return { family: String(font.family || font.name || ""), style: String(font.style || "") };
            }
        }
        return { family: "", style: "" };
    }

    function toolReadTextStyle(layer) {
        if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) {
            throw new Error("请选择一个文字图层");
        }
        var item = layer.textItem;
        var size = 0;
        var leading = 0;
        /*
         * Photoshop 27.3.1 对部分文字图层读取 item.useAutoLeading 会直接
         * 抛出不可捕获的“常规 Photoshop 错误”。复制样式不再访问该属性；
         * 行距仍尽力读取，失败时回退为字号的 1.2 倍。
         */
        var useAutoLeading = false;
        var font = "";
        var tracking = 0;
        var align = "left";
        var color = "";
        try { size = Number(item.size.as("pt")); } catch (ignoreSize) {
            try { size = Number(item.size) || 0; } catch (ignoreRawSize) { size = 0; }
        }
        try {
            leading = Number(item.leading.as("pt"));
        } catch (ignoreLeading) {
            leading = size * 1.2;
        }
        /* 混合字体/颜色的文字图层在部分 Photoshop 版本会拒绝读取某一项。 */
        try { font = String(item.font || ""); } catch (ignoreFont) {}
        try { tracking = Number(item.tracking) || 0; } catch (ignoreTracking) {}
        try { align = toolJustificationName(item.justification); } catch (ignoreJustification) {}
        try { color = toolSolidColorHex(item.color); } catch (ignoreTextColor) {}
        var style = {
            font: font,
            size: size,
            tracking: tracking,
            leading: leading,
            useAutoLeading: useAutoLeading,
            align: align,
            color: color,
            fauxBold: false,
            fauxItalic: false,
            allCaps: toolReadTextAllCaps(item),
            opticalKern: toolReadTextOpticalKern(item),
            direction: toolReadTextDirection(item)
        };
        try { style.fauxBold = !!item.fauxBold; } catch (ignoreBold) {}
        try { style.fauxItalic = !!item.fauxItalic; } catch (ignoreItalic) {}
        return style;
    }

    function toolApplyTextStyle(layer, style) {
        var item = layer.textItem;
        style = style || {};
        if (style.font) item.font = String(style.font);
        if (Number(style.size) > 0) item.size = UnitValue(Number(style.size), "pt");
        if (style.tracking !== undefined) {
            item.tracking = Math.max(-1000, Math.min(1000, integerValue(style.tracking, 0)));
        }
        if (Number(style.leading) > 0) {
            try { item.useAutoLeading = false; } catch (ignoreAuto) {}
            item.leading = UnitValue(Number(style.leading), "pt");
        }
        if (style.useAutoLeading) {
            try { item.useAutoLeading = true; } catch (ignoreRestoreAutoLeading) {}
        }
        if (style.align) toolSetTextJustificationPreservePosition(layer, String(style.align));
        if (style.color) item.color = toolSolidColorFromHex(style.color);
        try {
            if (style.fauxBold !== undefined) item.fauxBold = !!style.fauxBold;
        } catch (ignoreFauxBold) {}
        try {
            if (style.fauxItalic !== undefined) item.fauxItalic = !!style.fauxItalic;
        } catch (ignoreFauxItalic) {}
        if (style.allCaps !== undefined) toolSetTextAllCaps(item, !!style.allCaps);
        if (style.opticalKern !== undefined) toolSetTextOpticalKern(item, !!style.opticalKern);
        if (style.direction) toolSetTextDirection(item, String(style.direction));
    }

    function toolsCopyTextStyle() {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择一个文字图层");
        var referenceId;
        try { referenceId = activeLayerId(); } catch (ignoreActiveTextStyle) { referenceId = ids[0]; }
        /*
         * 读取文字属性必须是纯只读操作。旧版 toolLayerById 会调用
         * selectLayersByIds([id])，导致多选文字图层被收缩成单选。
         * 这里直接按图层 ID 遍历查找，不改变 Photoshop 当前选择。
         */
        var layer = findLayerById(document, referenceId);
        if (!layer) throw new Error("选中的文字图层已不存在");
        return {
            layerName: String(layer.name || "文字图层"),
            style: toolReadTextStyle(layer)
        };
    }

    function toolsGetTextInfo() {
        var copied = toolsCopyTextStyle();
        var info = toolFontInfoByPostScript(copied.style.font);
        copied.family = info.family;
        copied.fontStyle = info.style;
        return copied;
    }

    function toolsGetTextSelectionState() {
        if (!app.documents.length) {
            return { selectedCount: 0, activeIsText: false, activeLayerId: -1, signature: "none" };
        }
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var activeId = -1;
        var activeIsText = false;
        try { activeId = activeLayerId(); } catch (ignoreActiveSelectionId) {}
        try {
            var active = document.activeLayer;
            activeIsText = active && active.typename === "ArtLayer" && active.kind === LayerKind.TEXT;
        } catch (ignoreActiveTextKind) {}
        var signatureIds = ids.slice(0);
        signatureIds.sort(function (a, b) { return Number(a) - Number(b); });
        return {
            selectedCount: ids.length,
            selectedLayerIds: ids,
            activeIsText: !!activeIsText,
            activeLayerId: activeId,
            signature: String(activeId) + "|" + signatureIds.join(",")
        };
    }

    /*
     * 文字面板一次刷新只允许一次宿主调用。除选择信息外，单选文字图层
     * 一并返回样式；多选时保留 selection 信息，避免 UI 再发起第二次读取。
     */
    function toolsGetTypographySnapshot() {
        var started = (new Date()).getTime(), parseStarted, mixedStarted;
        var ids = selectedLayerIds(), activeId = -1, index, record, base = null;
        var actionGets = 1, allText = ids.length > 0, parseMs = 0, mixedMs = 0;
        try { activeId = activeLayerId(); actionGets += 1; } catch (ignoreActiveId) {}
        var fields = { font:{mixed:false,value:null}, size:{mixed:false,value:null}, tracking:{mixed:false,value:null}, leading:{mixed:false,value:null}, alignment:{mixed:false,value:null}, color:{mixed:false,value:null} };
        function key(name) { return stringIDToTypeID(name); }
        function value(d, name, fallback) { try { return d.getUnitDoubleValue(key(name)); } catch (ignoreUnit) { try { return d.getDouble(key(name)); } catch (ignoreDouble) { try { return d.getInteger(key(name)); } catch (ignoreInteger) { return fallback; } } } }
        function textRecord(id, need) {
            var ref = new ActionReference(), layer, text, styleRange, style, paragraphRange, paragraph, color, result;
            ref.putIdentifier(charIDToTypeID("Lyr "), id); layer = executeActionGet(ref); actionGets += 1;
            /* 只用 textKey 的存在性判断文字层；绝不切换 activeLayer。 */
            try { text = layer.getObjectValue(key("textKey")); } catch (ignoreNotText) { return null; }
            /* 六个字段都已经确认 mixed 后，不再解析 textStyle/paragraphStyle。 */
            if (!need.font && !need.size && !need.tracking && !need.leading && !need.alignment && !need.color) return {};
            try { styleRange = text.getList(key("textStyleRange")).getObjectValue(0); style = styleRange.getObjectValue(key("textStyle")); } catch (ignoreStyle) { return null; }
            result = {};
            if (need.font) try { result.font = String(style.getString(key("fontPostScriptName"))); } catch (ignoreFont) { result.font=""; }
            if (need.size) result.size=value(style,"size",0);
            if (need.tracking) result.tracking=value(style,"tracking",0);
            if (need.leading) result.leading=value(style,"leading",0);
            if (need.color) try { color = style.getObjectValue(key("color")); var rr=Math.round(color.getDouble(charIDToTypeID("Rd  "))),gg=Math.round(color.getDouble(charIDToTypeID("Grn "))),bb=Math.round(color.getDouble(charIDToTypeID("Bl  "))); function hx(n){var s=Math.max(0,Math.min(255,n)).toString(16);return s.length<2?"0"+s:s;} result.color = "#" + hx(rr) + hx(gg) + hx(bb); } catch (ignoreColor) { result.color=""; }
            if (need.alignment) try { paragraphRange = text.getList(key("paragraphStyleRange")).getObjectValue(0); paragraph = paragraphRange.getObjectValue(key("paragraphStyle")); result.alignment = String(typeIDToStringID(paragraph.getEnumerationValue(key("align"))) || "left"); } catch (ignoreAlign) { result.alignment="left"; }
            return result;
        }
        function compare(name, current) { if (current !== undefined && !fields[name].mixed && fields[name].value !== current) { fields[name].mixed = true; fields[name].value = null; } }
        for (index = 0; index < ids.length; index += 1) {
            parseStarted = (new Date()).getTime();
            record = textRecord(ids[index], {font:index===0||!fields.font.mixed,size:index===0||!fields.size.mixed,tracking:index===0||!fields.tracking.mixed,leading:index===0||!fields.leading.mixed,alignment:index===0||!fields.alignment.mixed,color:index===0||!fields.color.mixed});
            parseMs += (new Date()).getTime() - parseStarted;
            if (!record) { allText = false; break; }
            if (!base) { base = record; fields.font.value=record.font; fields.size.value=record.size; fields.tracking.value=record.tracking; fields.leading.value=record.leading; fields.alignment.value=record.alignment; fields.color.value=record.color; }
            else {
                mixedStarted = (new Date()).getTime();
                compare("font",record.font); compare("size",record.size); compare("tracking",record.tracking); compare("leading",record.leading); compare("alignment",record.alignment); compare("color",record.color);
                mixedMs += (new Date()).getTime() - mixedStarted;
            }
        }
        return { selectionCount:ids.length, selectedCount:ids.length, selectedLayerIds:ids, activeLayerId:activeId, activeIsText:allText && !!base, allTextLayers:allText, signature:String(activeId)+"|"+ids.join(","), font:fields.font, size:fields.size, tracking:fields.tracking, leading:fields.leading, alignment:fields.alignment, color:fields.color, style:base ? {font:fields.font.value || base.font,size:fields.size.value,tracking:fields.tracking.value,leading:fields.leading.value,align:fields.alignment.value || base.alignment,color:fields.color.value || base.color,fauxBold:false,fauxItalic:false,allCaps:false,opticalKern:false,direction:"horizontal"} : null, performance:{selectionCount:ids.length,snapshotDuration:(new Date()).getTime()-started,executeActionGetCount:actionGets,descriptorParseDuration:parseMs,mixedCalculationDuration:mixedMs} };
    }

    function toolsGetSelectedTextContents() {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var layers = toolLayerSort(toolSelectedTextLayers(document, ids), "topdown");
        if (!layers.length) throw new Error("当前选择中没有文字图层");
        var items = [];
        var index;
        for (index = 0; index < layers.length; index += 1) {
            items.push({ id: toolLayerId(document, layers[index]), name: String(layers[index].name || "文字图层"), text: String(layers[index].textItem.contents || "") });
        }
        selectLayersByIds(ids);
        return { items: items };
    }

    function toolsApplyTranslatedText(options) {
        if (!app.documents.length) throw new Error("请先打开文档");
        var document = app.activeDocument;
        var entries = options && options.items instanceof Array ? options.items : [];
        var replace = !(options && options.replace === false);
        if (!entries.length) throw new Error("没有可写入的翻译内容");
        return suspendToolsHistory(document, "鑫洋助理：文字翻译", function () {
            var outputIds = [];
            var processed = 0;
            var index;
            for (index = 0; index < entries.length; index += 1) {
                var entry = entries[index] || {};
                var layer;
                try { layer = toolLayerById(document, Number(entry.id)); } catch (ignoreMissingLayer) { continue; }
                if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) continue;
                if (replace) {
                    layer.textItem.contents = String(entry.text || "");
                    document.activeLayer = layer;
                    outputIds.push(activeLayerId());
                } else {
                    var duplicate = layer.duplicate();
                    duplicate.name = layer.name + "_翻译";
                    duplicate.textItem.contents = String(entry.text || "");
                    var sourceBounds = toolLayerVisualBounds(layer);
                    var duplicateBounds = toolLayerVisualBounds(duplicate);
                    duplicate.translate(UnitValue(sourceBounds.left - duplicateBounds.left, "px"), UnitValue(sourceBounds.bottom + 10 - duplicateBounds.top, "px"));
                    document.activeLayer = duplicate;
                    outputIds.push(activeLayerId());
                }
                processed += 1;
            }
            if (!processed) throw new Error("没有成功写入翻译内容");
            selectLayersByIds(outputIds);
            return { processed: processed, replace: replace };
        });
    }

    function toolsToggleTextDirection() {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var layers = toolSelectedTextLayers(document, ids);
        if (!layers.length) throw new Error("当前选择中没有文字图层");
        var target = toolReadTextDirection(layers[0].textItem) === "vertical" ? "horizontal" : "vertical";
        return suspendToolsHistory(document, "鑫洋助理：切换文字方向", function () {
            var index;
            for (index = 0; index < layers.length; index += 1) toolSetTextDirection(layers[index].textItem, target);
            selectLayersByIds(ids);
            return { processed: layers.length, direction: target };
        });
    }

    function toolsPasteTextStyle(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var style = options && options.style ? options.style : null;
        if (!style) throw new Error("没有可粘贴的文字属性");
        return suspendToolsHistory(document, "鑫洋助理：粘贴文字属性", function () {
            var processed = 0;
            var skipped = 0;
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) {
                    skipped += 1;
                    continue;
                }
                toolApplyTextStyle(layer, style);
                processed += 1;
            }
            if (!processed) throw new Error("当前选择中没有可处理的文字图层");
            selectLayersByIds(ids);
            return { processed: processed, skipped: skipped };
        });
    }

    function toolTextPosition(item) {
        try {
            return {
                x: pixels(item.position[0]),
                y: pixels(item.position[1])
            };
        } catch (ignorePosition) {
            return { x: 0, y: 0 };
        }
    }

    function toolSetTextPosition(item, x, y) {
        item.position = [UnitValue(x, "px"), UnitValue(y, "px")];
    }

    function toolDuplicateTextLayer(document, source, contents, name, x, y) {
        var copy = source.duplicate();
        copy.name = String(name || source.name);
        copy.textItem.contents = String(contents);
        toolSetTextPosition(copy.textItem, x, y);
        document.activeLayer = copy;
        return { layer: copy, id: activeLayerId() };
    }

    function toolTextPointsToPixels(document, points) {
        var resolution = 72;
        try { resolution = Number(document.resolution) || 72; } catch (ignoreResolution) {}
        return Math.max(0, Number(points) || 0) * resolution / 72;
    }

    function toolIsPointText(item) {
        try { return item.kind === TextType.POINTTEXT; } catch (ignoreTextKind) { return false; }
    }

    function toolParagraphTextHorizontalAnchor(item, sourceBounds, align) {
        var position = toolTextPosition(item);
        var width = 0;
        try { width = pixels(item.width); } catch (ignoreTextWidth) {}
        if (!(width > 0)) width = Math.max(1, sourceBounds.right - sourceBounds.left);
        if (align === "center") return position.x + width / 2;
        if (align === "right") return position.x + width;
        return position.x;
    }

    function toolAlignSplitParagraphLine(copyLayer, sourceItem, sourceBounds,
        align, targetTop) {
        var current = toolLayerVisualBounds(copyLayer);
        var anchor = toolParagraphTextHorizontalAnchor(
            sourceItem, sourceBounds, align
        );
        var currentAnchor = current.left;
        if (align === "center") currentAnchor = (current.left + current.right) / 2;
        else if (align === "right") currentAnchor = current.right;
        copyLayer.translate(
            UnitValue(anchor - currentAnchor, "px"),
            UnitValue(targetTop - current.top, "px")
        );
    }

    function toolSplitTextLines(document, layer, outputIds) {
        var text = String(layer.textItem.contents || "")
            .replace(/\r\n/g, "\r")
            .replace(/\n/g, "\r");
        var lines = text.split("\r");
        if (lines.length < 2) return { processed: 0, created: 0 };

        var entries = [];
        var index;
        for (index = 0; index < lines.length; index += 1) {
            if (String(lines[index]).length) {
                entries.push({ text: String(lines[index]), lineIndex: index });
            }
        }
        if (!entries.length) return { processed: 0, created: 0 };

        var sourceItem = layer.textItem;
        var sourcePointText = toolIsPointText(sourceItem);
        var sourcePosition = toolTextPosition(sourceItem);
        var sourceBounds = toolLayerVisualBounds(layer);
        var style = toolReadTextStyle(layer);
        var createdItems = [];

        for (index = 0; index < entries.length; index += 1) {
            var entry = entries[index];
            var copy = toolDuplicateTextLayer(
                document,
                layer,
                entry.text,
                layer.name + "_" + (entry.lineIndex + 1),
                sourcePosition.x,
                sourcePosition.y
            );
            /* 点文本本身无需转换；段落文本转换后立即恢复源样式。 */
            if (!sourcePointText) {
                try { copy.layer.textItem.kind = TextType.POINTTEXT; } catch (ignorePointConversion) {}
            }
            copy.layer.textItem.contents = entry.text;
            toolApplyTextStyle(copy.layer, style);
            createdItems.push({
                layer: copy.layer,
                id: copy.id,
                lineIndex: entry.lineIndex
            });
        }

        var firstBounds = toolLayerVisualBounds(createdItems[0].layer);
        var firstHeight = Math.max(1, firstBounds.bottom - firstBounds.top);
        var sizePx = Math.max(1, toolTextPointsToPixels(document, style.size));
        var leadingPx = Math.max(
            sizePx,
            toolTextPointsToPixels(
                document,
                style.leading || style.size * 1.2
            )
        );
        var firstLineIndex = createdItems[0].lineIndex;
        var lastLineIndex = createdItems[createdItems.length - 1].lineIndex;
        var lineSpan = lastLineIndex - firstLineIndex;
        var sourceHeight = Math.max(1, sourceBounds.bottom - sourceBounds.top);
        var measuredStep = 0;
        if (lineSpan > 0 && sourceHeight > firstHeight) {
            measuredStep = (sourceHeight - firstHeight) / lineSpan;
            if (measuredStep < sizePx * 0.72 || measuredStep > sizePx * 5) {
                measuredStep = 0;
            }
        }

        /*
         * 优先恢复拆分前由原图层实际高度推算出的行距；读取不到可靠值时
         * 使用原 leading。无论原值如何，基线间距至少为一倍字号，并且
         * 不小于单行可见高度，避免拆开后的文字互相堆叠。
         */
        var lineStep = Math.max(
            sizePx,
            firstHeight,
            measuredStep > 0 ? measuredStep : leadingPx
        );

        for (index = 0; index < createdItems.length; index += 1) {
            var createdItem = createdItems[index];
            var relativeLineIndex = createdItem.lineIndex - firstLineIndex;
            if (sourcePointText) {
                toolSetTextPosition(
                    createdItem.layer.textItem,
                    sourcePosition.x,
                    sourcePosition.y + lineStep * createdItem.lineIndex
                );
            } else {
                toolAlignSplitParagraphLine(
                    createdItem.layer,
                    sourceItem,
                    sourceBounds,
                    style.align,
                    sourceBounds.top + lineStep * relativeLineIndex
                );
            }
            outputIds.push(createdItem.id);
        }

        layer.remove();
        return {
            processed: 1,
            created: createdItems.length,
            lineStep: lineStep
        };
    }

    function toolTextLineHasConnectorPunctuation(line) {
        return /[，。！？；：、,.!?;:·•…—–\-_\/\\()（）\[\]【】{}「」『』“”"']/ .test(String(line || ""));
    }

    function toolSplitTextWordEntries(contents) {
        var lines = String(contents || "").replace(/\r\n|\n/g, "\r").split("\r");
        var entries = [];
        var lineIndex;
        for (lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            var line = String(lines[lineIndex] || "");
            if (!line.length || /^\s+$/.test(line)) continue;
            if (toolTextLineHasConnectorPunctuation(line)) {
                entries.push({ text: line, lineIndex: lineIndex, gap: 0 });
                continue;
            }
            var matcher = /\S+/g;
            var match;
            var previousEnd = 0;
            while ((match = matcher.exec(line)) !== null) {
                entries.push({
                    text: match[0],
                    lineIndex: lineIndex,
                    gap: Math.max(0, match.index - previousEnd)
                });
                previousEnd = match.index + match[0].length;
            }
        }
        return entries;
    }

    function toolSplitTextCharacters(document, layer, outputIds) {
        var entries = toolSplitTextWordEntries(layer.textItem.contents);
        if (!entries.length) return { processed: 0, created: 0 };
        /* 仅一个词组时保留原图层，不复制、不重排。 */
        if (entries.length === 1) {
            outputIds.push(layerNumericId(layer));
            return { processed: 1, created: 0, preserved: 1 };
        }
        var position = toolTextPosition(layer.textItem);
        var style = toolReadTextStyle(layer);
        var sourcePointText = toolIsPointText(layer.textItem);
        var sourceBounds = toolLayerVisualBounds(layer);
        var sizePx = Math.max(1, toolTextPointsToPixels(document, style.size));
        var leadingPx = Math.max(sizePx, toolTextPointsToPixels(document, style.leading || style.size * 1.2));
        var cursorByLine = {};
        var created = 0;
        var index;
        for (index = 0; index < entries.length; index += 1) {
            var entry = entries[index];
            var lineKey = String(entry.lineIndex);
            if (cursorByLine[lineKey] === undefined) cursorByLine[lineKey] = position.x;
            var cursor = cursorByLine[lineKey] + entry.gap * sizePx * 0.35;
            var targetY = sourcePointText
                ? position.y + entry.lineIndex * leadingPx
                : sourceBounds.top + entry.lineIndex * leadingPx;
            var copy = toolDuplicateTextLayer(
                document,
                layer,
                entry.text,
                layer.name + "_" + (created + 1),
                cursor,
                targetY
            );
            if (!sourcePointText) {
                try { toolForcePointText(copy.layer, cursor, targetY); } catch (ignoreWordPointConversion) {}
            }
            var size = layerSize(copy.layer);
            cursorByLine[lineKey] = cursor + Math.max(1, size.width) + sizePx * (style.tracking || 0) / 1000;
            outputIds.push(copy.id);
            created += 1;
        }
        /* 只有产生两个以上词组时才替换原图层；完整行不会被无意义地重新拆建。 */
        layer.remove();
        return { processed: 1, created: created, preserved: 0 };
    }

    function toolSelectedTextLayers(document, ids) {
        var layers = [];
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            if (layer.typename === "ArtLayer" && layer.kind === LayerKind.TEXT) {
                layers.push(layer);
            }
        }
        return layers;
    }

    function toolMedianNumber(values, fallback) {
        var numbers = [];
        var index;
        for (index = 0; index < (values || []).length; index += 1) {
            if (isFinite(Number(values[index]))) numbers.push(Number(values[index]));
        }
        numbers.sort(function (left, right) { return left - right; });
        if (!numbers.length) return Number(fallback) || 0;
        var middle = Math.floor(numbers.length / 2);
        return numbers.length % 2
            ? numbers[middle]
            : (numbers[middle - 1] + numbers[middle]) / 2;
    }

    function toolTextMergeGeometry(layer) {
        var size;
        try { size = layerSize(layer); } catch (ignoreBounds) {
            size = { left: 0, top: 0, width: 1, height: 1 };
        }
        var position = toolTextPosition(layer.textItem);
        return {
            layer: layer,
            left: Number(size.left) || 0,
            top: Number(size.top) || 0,
            width: Math.max(1, Number(size.width) || 1),
            height: Math.max(1, Number(size.height) || 1),
            right: (Number(size.left) || 0) + Math.max(1, Number(size.width) || 1),
            bottom: (Number(size.top) || 0) + Math.max(1, Number(size.height) || 1),
            centerX: (Number(size.left) || 0) + Math.max(1, Number(size.width) || 1) / 2,
            centerY: (Number(size.top) || 0) + Math.max(1, Number(size.height) || 1) / 2,
            baselineX: Number(position.x) || 0,
            baselineY: Number(position.y) || 0
        };
    }

    function toolBuildTextMergeGeometries(layers) {
        var output = [];
        var index;
        for (index = 0; index < (layers || []).length; index += 1) {
            output.push(toolTextMergeGeometry(layers[index]));
        }
        return output;
    }

    function toolDetectTextMergeLayout(layers) {
        var geometries = toolBuildTextMergeGeometries(layers);
        if (geometries.length < 2) {
            return { direction: "vertical", geometries: geometries };
        }
        var centersX = [];
        var centersY = [];
        var widths = [];
        var heights = [];
        var index;
        for (index = 0; index < geometries.length; index += 1) {
            centersX.push(geometries[index].centerX);
            centersY.push(geometries[index].centerY);
            widths.push(geometries[index].width);
            heights.push(geometries[index].height);
        }
        var xSpan = Math.max.apply(Math, centersX) - Math.min.apply(Math, centersX);
        var ySpan = Math.max.apply(Math, centersY) - Math.min.apply(Math, centersY);
        var medianWidth = Math.max(1, toolMedianNumber(widths, 1));
        var medianHeight = Math.max(1, toolMedianNumber(heights, 1));
        var horizontalScore = xSpan / medianWidth;
        var verticalScore = ySpan / medianHeight;
        var direction = horizontalScore > verticalScore * 1.12
            ? "horizontal"
            : "vertical";
        return {
            direction: direction,
            geometries: geometries,
            horizontalScore: horizontalScore,
            verticalScore: verticalScore
        };
    }

    function toolVerticalMergeLeadingPt(document, geometries, fallback) {
        if (!geometries || geometries.length < 2) return fallback;
        var sorted = geometries.slice(0);
        sorted.sort(function (left, right) {
            return left.top - right.top || left.left - right.left;
        });
        var gaps = [];
        var index;
        for (index = 1; index < sorted.length; index += 1) {
            var distance = sorted[index].baselineY - sorted[index - 1].baselineY;
            if (distance > 0) gaps.push(distance);
        }
        if (!gaps.length) return fallback;
        var resolution = 72;
        try { resolution = Number(document.resolution) || 72; } catch (ignoreResolution) {}
        return Math.max(1, toolMedianNumber(gaps, fallback) * 72 / Math.max(1, resolution));
    }

    function toolMergedTextLayerName(contents) {
        var name = String(contents || "")
            .replace(/\r\n/g, " ")
            .replace(/[\r\n\t]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .replace(/^\s+|\s+$/g, "");
        return name || "文字";
    }

    function toolTextMergeUnionBounds(geometries) {
        if (!geometries || !geometries.length) {
            return { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 };
        }
        var left = Number(geometries[0].left) || 0;
        var top = Number(geometries[0].top) || 0;
        var right = Number(geometries[0].right) || (left + 1);
        var bottom = Number(geometries[0].bottom) || (top + 1);
        var index;
        for (index = 1; index < geometries.length; index += 1) {
            left = Math.min(left, Number(geometries[index].left) || 0);
            top = Math.min(top, Number(geometries[index].top) || 0);
            right = Math.max(right, Number(geometries[index].right) || left + 1);
            bottom = Math.max(bottom, Number(geometries[index].bottom) || top + 1);
        }
        return {
            left: left, top: top, right: right, bottom: bottom,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top)
        };
    }

    function toolParagraphLongestLineWidth(document, sourceLayer, contents, x, y) {
        var sample = sourceLayer.duplicate();
        var widest = 1;
        try {
            toolForcePointText(sample, x, y);
            var lines = String(contents || "").replace(/\r\n|\n|\r/g, "\r").split("\r");
            var index;
            for (index = 0; index < lines.length; index += 1) {
                /* 空行没有可见字形，保留最小宽度即可。 */
                if (!lines[index].length) continue;
                sample.textItem.contents = lines[index];
                var visible = toolLayerVisualBounds(sample);
                widest = Math.max(widest, Math.ceil(visible.right - visible.left));
            }
        } finally {
            try { sample.remove(); } catch (ignoreMeasureSampleRemove) {}
        }
        return Math.max(1, widest);
    }

    function toolClampParagraphBoundsToCanvas(document, bounds) {
        var canvasWidth = Math.max(1, Math.round(pixels(document.width)));
        var canvasHeight = Math.max(1, Math.round(pixels(document.height)));
        var rawLeft = Number(bounds && bounds.left) || 0;
        var rawTop = Number(bounds && bounds.top) || 0;
        var rawRight = Number(bounds && bounds.right);
        var rawBottom = Number(bounds && bounds.bottom);
        if (!isFinite(rawRight)) rawRight = rawLeft + Math.max(1, Number(bounds && bounds.width) || 1);
        if (!isFinite(rawBottom)) rawBottom = rawTop + Math.max(1, Number(bounds && bounds.height) || 1);

        /* 框小于画布时整体平移入画布，而不是只截掉右/下边导致宽高异常缩小。 */
        var desiredWidth = Math.max(1, rawRight - rawLeft);
        var desiredHeight = Math.max(1, rawBottom - rawTop);
        var width = Math.min(canvasWidth, desiredWidth);
        var height = Math.min(canvasHeight, desiredHeight);
        var left = Math.max(0, Math.min(canvasWidth - width, rawLeft));
        var top = Math.max(0, Math.min(canvasHeight - height, rawTop));
        var right = left + width;
        var bottom = top + height;
        return {
            left: left,
            top: top,
            right: right,
            bottom: bottom,
            width: width,
            height: height
        };
    }

    function toolForceParagraphTextInBounds(document, layer, bounds, contents) {
        if (!layer || layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) {
            throw new Error("无法创建段落文字图层");
        }
        var item = layer.textItem;
        /* Photoshop 段落文本只稳定识别 CR 作为硬换行。 */
        var paragraphContents = String(contents || "").replace(/\r\n|\n|\r/g, "\r");
        try { item.kind = TextType.PARAGRAPHTEXT; }
        catch (paragraphKindError) { throw new Error("Photoshop 未能把合并文字转换为段落文本"); }
        try { toolSetTextDirection(item, "horizontal"); } catch (ignoreParagraphDirection) {}
        try { item.contents = paragraphContents; }
        catch (paragraphContentError) { throw new Error("Photoshop 未能写入段落文字内容"); }
        try { item.width = UnitValue(Math.max(1, bounds.width), "px"); }
        catch (paragraphWidthError) { throw new Error("Photoshop 未能设置段落文本宽度"); }
        try { item.height = UnitValue(Math.max(1, bounds.height), "px"); }
        catch (paragraphHeightError) { throw new Error("Photoshop 未能设置段落文本高度"); }
        try { toolSetTextPosition(item, bounds.left, bounds.top); }
        catch (paragraphPositionError) { throw new Error("Photoshop 未能定位段落文本范围框"); }

        /* 转换段落文本后 Photoshop 偶尔会偏移图层；按可见范围二次拉回画布。 */
        try {
            var canvasWidth = Math.max(1, Math.round(pixels(document.width)));
            var canvasHeight = Math.max(1, Math.round(pixels(document.height)));
            var visible = layerSize(layer);
            /* 可见内容本身大于画布时无法靠平移完整放入，避免反向移出另一侧。 */
            var moveX = visible.width <= canvasWidth
                ? (visible.left < 0 ? -visible.left :
                    (visible.left + visible.width > canvasWidth
                        ? canvasWidth - visible.left - visible.width : 0))
                : 0;
            var moveY = visible.height <= canvasHeight
                ? (visible.top < 0 ? -visible.top :
                    (visible.top + visible.height > canvasHeight
                        ? canvasHeight - visible.top - visible.height : 0))
                : 0;
            if (moveX || moveY) layer.translate(moveX, moveY);
        } catch (ignoreParagraphCanvasClamp) {}
    }

    function toolForcePointText(layer, x, y) {
        if (!layer || layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) return;
        try { layer.textItem.kind = TextType.POINTTEXT; } catch (ignorePointTextConversion) {}
        try { toolSetTextDirection(layer.textItem, "horizontal"); } catch (ignoreHorizontalDirection) {}
        try { toolSetTextPosition(layer.textItem, x, y); } catch (ignorePointTextPosition) {}
    }

    function toolsTextStructure(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var action = String(options && options.action || "");
        var layers = toolLayerSort(toolSelectedTextLayers(document, ids), "topdown");
        if (!layers.length) throw new Error("当前选择中没有文字图层");
        return suspendToolsHistory(document, "鑫洋助理：文字拆分合并", function () {
            var outputIds = [];
            var processed = 0;
            var created = 0;
            var preserved = 0;
            var index;
            if (action === "splitLines" || action === "splitChars") {
                for (index = 0; index < layers.length; index += 1) {
                    var report = action === "splitLines"
                        ? toolSplitTextLines(document, layers[index], outputIds)
                        : toolSplitTextCharacters(document, layers[index], outputIds);
                    processed += report.processed;
                    created += report.created;
                    preserved += report.preserved || 0;
                }
                if (!created && !preserved) throw new Error(action === "splitLines" ? "选中文字没有多行内容" : "选中文字没有可按空格拆开的词组");
                selectLayersByIds(outputIds);
                return { processed: processed, created: created, removed: created ? processed - preserved : 0, preserved: preserved };
            }
            if (action !== "mergeLines" && action !== "mergeParagraph") {
                throw new Error("未知文字操作");
            }
            /* 合并多行需要至少两层；单层也允许直接转换为段落文本。 */
            if (action === "mergeLines" && layers.length < 2) {
                throw new Error("合并多行至少需要选择两个文字图层");
            }
            var layout = action === "mergeLines"
                ? toolDetectTextMergeLayout(layers)
                : { direction: "vertical", geometries: toolBuildTextMergeGeometries(layers) };
            var orderedLayers = action === "mergeLines" && layout.direction === "horizontal"
                ? toolLayerSort(layers, "leftright")
                : toolLayerSort(layers, "topdown");
            var geometryById = {};
            for (index = 0; index < layout.geometries.length; index += 1) {
                var mergeGeometry = layout.geometries[index];
                geometryById[String(toolLayerId(document, mergeGeometry.layer))] = mergeGeometry;
            }
            var contents = [];
            var horizontalMerge = action === "mergeLines" && layout.direction === "horizontal";
            for (index = 0; index < orderedLayers.length; index += 1) {
                var layerContents = String(orderedLayers[index].textItem.contents || "");
                /*
                 * “合并成段落”保留原文字的行结构：既不清掉图层自身
                 * 的换行，也不把原本分行的文字图层用空格压到同一行。
                 * 横向合并仍维持原有的无分隔拼接行为。
                 */
                contents.push(layerContents.replace(/[\r\n]+/g, horizontalMerge ? "" : "\r"));
            }
            var mergedText = horizontalMerge
                ? contents.join("")
                : contents.join("\r");
            var first = orderedLayers[0];
            var position = toolTextPosition(first.textItem);
            var merged = toolDuplicateTextLayer(
                document,
                first,
                mergedText,
                toolMergedTextLayerName(mergedText),
                position.x,
                position.y
            );
            if (action === "mergeLines" && layout.direction === "horizontal") {
                toolForcePointText(merged.layer, position.x, position.y);
                merged.layer.textItem.contents = mergedText;
            } else if (action === "mergeLines") {
                /*
                 * 多行合并必须使用点文本。若沿用首图层的段落文本类型，
                 * 在部分 Photoshop 版本中同时写入 CR 换行和 leading 会报
                 * “发生了常规 Photoshop 错误”。
                 */
                toolForcePointText(merged.layer, position.x, position.y);
                try {
                    merged.layer.textItem.contents = mergedText;
                } catch (mergeVerticalContentError) {
                    throw new Error("Photoshop 未能写入合并后的多行文字");
                }
                var style = toolReadTextStyle(first);
                var verticalLeading = toolVerticalMergeLeadingPt(
                    document,
                    layout.geometries,
                    style.leading || style.size * 1.2
                );
                try {
                    merged.layer.textItem.useAutoLeading = false;
                    merged.layer.textItem.leading = UnitValue(verticalLeading, "pt");
                } catch (ignoreMergedLeading) {}
            } else if (action === "mergeParagraph") {
                var sourceBounds = toolTextMergeUnionBounds(layout.geometries);
                var paragraphWidth = toolParagraphLongestLineWidth(
                    document, first, mergedText, sourceBounds.left, sourceBounds.top
                );
                var paragraphBounds = toolClampParagraphBoundsToCanvas(document, {
                    left: sourceBounds.left,
                    top: sourceBounds.top,
                    right: sourceBounds.left + paragraphWidth,
                    bottom: sourceBounds.bottom,
                    width: paragraphWidth,
                    height: sourceBounds.height
                });
                toolForceParagraphTextInBounds(
                    document,
                    merged.layer,
                    paragraphBounds,
                    mergedText
                );
            }
            for (index = 0; index < layers.length; index += 1) layers[index].remove();
            selectLayersByIds([merged.id]);
            return {
                processed: layers.length,
                created: 1,
                removed: layers.length,
                layout: action === "mergeLines" ? layout.direction : "paragraph"
            };
        });
    }

    function toolCreateRasterRectangle(document, bounds, radius, colorValue) {
        var layer = document.artLayers.add();
        layer.name = "按钮背景";
        document.activeLayer = layer;
        document.selection.select([
            [bounds.left, bounds.top],
            [bounds.right, bounds.top],
            [bounds.right, bounds.bottom],
            [bounds.left, bounds.bottom]
        ]);
        if (radius > 0) {
            try { document.selection.smooth(Math.max(1, Math.round(radius))); } catch (ignoreSmooth) {}
        }
        document.selection.fill(toolSolidColorFromHex(colorValue), ColorBlendMode.NORMAL, 100, false);
        document.selection.deselect();
        return layer;
    }

    function toolCreateRasterOutlineRectangle(document, bounds, radius, colorValue, strokeWidth) {
        var layer = document.artLayers.add();
        layer.name = "按钮线框";
        document.activeLayer = layer;
        var width = Math.max(1, Number(strokeWidth) || 2);
        document.selection.select([[bounds.left,bounds.top],[bounds.right,bounds.top],[bounds.right,bounds.bottom],[bounds.left,bounds.bottom]]);
        if (radius > 0) { try { document.selection.smooth(Math.max(1, Math.round(radius))); } catch (ignoreOuterSmooth) {} }
        document.selection.fill(toolSolidColorFromHex(colorValue), ColorBlendMode.NORMAL, 100, false);
        document.selection.deselect();
        var inner = { left: bounds.left + width, top: bounds.top + width, right: bounds.right - width, bottom: bounds.bottom - width };
        if (inner.right > inner.left && inner.bottom > inner.top) {
            document.selection.select([[inner.left,inner.top],[inner.right,inner.top],[inner.right,inner.bottom],[inner.left,inner.bottom]]);
            if (radius > width) { try { document.selection.smooth(Math.max(1, Math.round(radius - width))); } catch (ignoreInnerSmooth) {} }
            try { document.selection.clear(); } catch (ignoreClearOutline) {}
            document.selection.deselect();
        }
        return layer;
    }

    function toolParseButtonPadding(rule, fontSize) {
        var text = String(rule || "28,12").replace(/\s+/g, "");
        if (text.indexOf("自动生成") === 0) text = "auto:" + text.replace("自动生成", "");
        if (text.indexOf("auto:") === 0) {
            var level = Math.max(1, Math.min(8, integerValue(text.split(":")[1], 4)));
            var scaleX = [0.2,0.35,0.5,0.7,0.9,1.1,1.35,1.6][level - 1];
            var scaleY = [0.1,0.18,0.25,0.35,0.45,0.55,0.68,0.8][level - 1];
            return { x: Math.round(fontSize * scaleX), y: Math.round(fontSize * scaleY) };
        }
        if (text.indexOf("=") >= 0) {
            var sides = text.split("=");
            var base = Math.max(0, Number(sides[0]) || 0);
            var ratios = String(sides[1] || "1:1").split(":");
            return { x: base * (Number(ratios[0]) || 1), y: base * (Number(ratios[1]) || 1) };
        }
        var values = text.split(/[,，]/);
        return { x: Math.max(0, Number(values[0]) || 0), y: Math.max(0, Number(values[1]) || Number(values[0]) || 0) };
    }

    function toolCreateShapeRectangle(document, bounds, radius, colorValue, requireLiveShape, isBorder) {
        var color = toolHexColor(colorValue);
        radius = Math.max(0, Math.min(
            Number(radius) || 0,
            Math.max(0, (bounds.right - bounds.left) / 2),
            Math.max(0, (bounds.bottom - bounds.top) / 2)
        ));
        try {
            var make = new ActionDescriptor();
            var reference = new ActionReference();
            reference.putClass(stringIDToTypeID("contentLayer"));
            make.putReference(charIDToTypeID("null"), reference);

            var using = new ActionDescriptor();
            var fill = new ActionDescriptor();
            var rgb = new ActionDescriptor();
            rgb.putDouble(charIDToTypeID("Rd  "), color.red);
            rgb.putDouble(charIDToTypeID("Grn "), color.green);
            rgb.putDouble(charIDToTypeID("Bl  "), color.blue);
            fill.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), rgb);
            using.putObject(charIDToTypeID("Type"), stringIDToTypeID("solidColorLayer"), fill);

            // 先创建无圆角的实时矩形，再通过 changePathDetails 明确写入四角半径。
            // Photoshop 会记忆矩形工具上一次的圆角值，仅在 Mk 描述符中写入
            // topLeft/topRight 等字段时，部分版本仍可能沿用工具预设，导致
            // “直角矩形变圆角、圆角矩形变胶囊”。二次写入可避免该状态污染。
            var rectangle = new ActionDescriptor();
            rectangle.putInteger(stringIDToTypeID("unitValueQuadVersion"), 1);
            rectangle.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), bounds.top);
            rectangle.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), bounds.left);
            rectangle.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), bounds.bottom);
            rectangle.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), bounds.right);
            rectangle.putUnitDouble(stringIDToTypeID("topLeft"), charIDToTypeID("#Pxl"), radius);
            rectangle.putUnitDouble(stringIDToTypeID("topRight"), charIDToTypeID("#Pxl"), radius);
            rectangle.putUnitDouble(stringIDToTypeID("bottomLeft"), charIDToTypeID("#Pxl"), radius);
            rectangle.putUnitDouble(stringIDToTypeID("bottomRight"), charIDToTypeID("#Pxl"), radius);
            using.putObject(charIDToTypeID("Shp "), charIDToTypeID("Rctn"), rectangle);

            var strokeStyle = new ActionDescriptor();
            strokeStyle.putInteger(stringIDToTypeID("strokeStyleVersion"), 2);
            strokeStyle.putBoolean(stringIDToTypeID("strokeEnabled"), !!isBorder);
            strokeStyle.putBoolean(stringIDToTypeID("fillEnabled"), !isBorder);
            if (isBorder) {
                toolPutNativeStrokeDefaults(strokeStyle, 2);
                var initialStrokeContent = new ActionDescriptor();
                var initialStrokeRgb = new ActionDescriptor();
                initialStrokeRgb.putDouble(stringIDToTypeID("red"), color.red);
                initialStrokeRgb.putDouble(stringIDToTypeID("green"), color.green);
                initialStrokeRgb.putDouble(stringIDToTypeID("blue"), color.blue);
                initialStrokeContent.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), initialStrokeRgb);
                strokeStyle.putObject(stringIDToTypeID("strokeStyleContent"), stringIDToTypeID("solidColorLayer"), initialStrokeContent);
            }
            using.putObject(stringIDToTypeID("strokeStyle"), stringIDToTypeID("strokeStyle"), strokeStyle);

            make.putObject(charIDToTypeID("Usng"), stringIDToTypeID("contentLayer"), using);
            executeAction(charIDToTypeID("Mk  "), make, DialogModes.NO);
            var created = document.activeLayer;
            var createdId = activeLayerId();
            /*
             * 半径已经在 Mk 描述符中写入。部分 Photoshop 27 环境在形状刚创建
             * 后立即执行 changePathDetails 会短暂失败；此时保留已经成功创建的
             * 原生矢量形状，而不是删除它。二次写入仅作为兼容增强。
             */
            try { toolSetLiveShapeGeometry(createdId, bounds, radius); } catch (ignoreInitialGeometrySync) {}
            document.activeLayer = created;
            return created;
        } catch (shapeError) {
            if (requireLiveShape) throw shapeError;
            return toolCreateRasterRectangle(document, bounds, radius, colorValue);
        }
    }

    function toolButtonMarker(textLayer) {
        return "__XYBTN__" + layerNumericId(textLayer) + "__";
    }

    function toolFindTextButtonBackground(document, textLayer) {
        var marker = toolButtonMarker(textLayer);
        var allLayers = toolCollectLayersRecursive(document, []);
        var index;
        for (index = 0; index < allLayers.length; index += 1) {
            var layer = allLayers[index];
            if (String(layer.name || "").indexOf(marker) === 0) return layer;
        }
        var parent = textLayer.parent;
        if (parent && parent.layers) {
            for (index = 0; index < parent.layers.length; index += 1) {
                if (parent.layers[index] !== textLayer) continue;
                var candidates = [];
                if (index + 1 < parent.layers.length) candidates.push(parent.layers[index + 1]);
                if (index > 0) candidates.push(parent.layers[index - 1]);
                var candidateIndex;
                for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
                    var candidate = candidates[candidateIndex];
                    var name = String(candidate && candidate.name || "");
                    if (name === String(textLayer.name) + "_按钮背景" || name === String(textLayer.name) + "_按钮线框") return candidate;
                }
                break;
            }
        }
        return null;
    }

    function toolFitLayerToBounds(layer, target) {
        var current = toolLayerVisualBounds(layer);
        var currentWidth = current.right - current.left;
        var currentHeight = current.bottom - current.top;
        var targetWidth = target.right - target.left;
        var targetHeight = target.bottom - target.top;
        if (!(currentWidth > 0 && currentHeight > 0 && targetWidth > 0 && targetHeight > 0)) throw new Error("按钮背景边界无效");
        layer.resize(targetWidth / currentWidth * 100, targetHeight / currentHeight * 100, AnchorPosition.MIDDLECENTER);
        current = toolLayerVisualBounds(layer);
        var currentCenterX = (current.left + current.right) / 2;
        var currentCenterY = (current.top + current.bottom) / 2;
        var targetCenterX = (target.left + target.right) / 2;
        var targetCenterY = (target.top + target.bottom) / 2;
        layer.translate(targetCenterX - currentCenterX, targetCenterY - currentCenterY);
    }

    function toolSetButtonTextColor(textLayer, isBorder, colorValue) {
        textLayer.textItem.color = toolSolidColorFromHex(isBorder ? colorValue : "#ffffff");
    }

    function toolApplyTextButtonAppearance(background, textLayer, bounds, radius, colorValue, isBorder) {
        if (!background || background.typename !== "ArtLayer") throw new Error("按钮背景不可用");
        if (background.kind !== LayerKind.SOLIDFILL) {
            toolFitLayerToBounds(background, bounds);
            toolSetButtonTextColor(textLayer, isBorder, colorValue);
            background.name = toolButtonMarker(textLayer) + (isBorder ? "border button" : "fill button");
            try { background.move(textLayer, ElementPlacement.PLACEAFTER); } catch (ignoreMoveRasterBelow) {}
            return { layer: background, geometryUpdated: false, rasterFallback: true };
        }
        var backgroundId = layerNumericId(background);
        var geometryUpdated = toolSetLiveShapeGeometry(backgroundId, bounds, radius);
        if (!geometryUpdated) {
            /* 旧版或特殊形状描述符回退：保持同一个形状图层，仅缩放移动。 */
            toolFitLayerToBounds(background, bounds);
            toolSetLiveShapeRadius(backgroundId, radius);
        }
        var appearance = toolShapeAppearanceInfo(backgroundId, background);
        var strokeWidth = appearance && appearance.strokeEnabled && appearance.strokeWidth ? appearance.strokeWidth : 2;
        toolSetNativeShapeAppearance(
            backgroundId,
            colorValue,
            !isBorder,
            colorValue,
            isBorder,
            strokeWidth,
            appearance && appearance.strokeStyle ? appearance.strokeStyle : null
        );
        toolSetButtonTextColor(textLayer, isBorder, colorValue);
        background.name = toolButtonMarker(textLayer) + (isBorder ? "线性按钮" : "填充按钮");
        try { background.move(textLayer, ElementPlacement.PLACEAFTER); } catch (ignoreMoveBelow) {}
        return { layer: background, geometryUpdated: geometryUpdated };
    }

    function toolsGenerateTextButtons(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var layers = toolSelectedTextLayers(document, ids);
        if (!layers.length) throw new Error("当前选择中没有文字图层");
        var shape = String(options && (options.cornerType || options.shape) || "capsule").toLowerCase();
        if (shape !== "rectangle" && shape !== "rounded" && shape !== "capsule") shape = "capsule";
        var isBorder = !!(options && options.isBorder);
        var colorValue = String(options && options.color || "#e53935");
        var paddingRule = String(options && (options.paddingRule || options.padding) || "28,12");
        var legacyPaddingX = Math.max(0, Number(options && options.paddingX) || 0);
        var legacyPaddingY = Math.max(0, Number(options && options.paddingY) || 0);
        return suspendToolsHistory(document, "鑫洋助理：生成或修改按钮", function () {
            var selectedTextIds = [];
            var created = 0;
            var updated = 0;
            var geometryFallbacks = 0;
            var index;
            for (index = 0; index < layers.length; index += 1) {
                var textLayer = layers[index];
                if (!textLayer || textLayer.typename !== "ArtLayer" || textLayer.kind !== LayerKind.TEXT) continue;
                var style = toolReadTextStyle(textLayer);
                var padding = paddingRule ? toolParseButtonPadding(paddingRule, style.size || 24) : { x: legacyPaddingX, y: legacyPaddingY };
                var visual = toolLayerVisualBounds(textLayer);
                if (!(visual.right > visual.left && visual.bottom > visual.top)) throw new Error("文字图层“" + textLayer.name + "”没有可用边界");
                var bounds = { left: visual.left-padding.x, top: visual.top-padding.y, right: visual.right+padding.x, bottom: visual.bottom+padding.y };
                var actualRadius = shape === "rectangle" ? 0 : shape === "capsule" ? Math.max(0, (bounds.bottom-bounds.top)/2) : Math.max(0, Number(options && options.radius) || 16);
                var background = toolFindTextButtonBackground(document, textLayer);
                if (background) {
                    /* 像素按钮不依赖不稳定的形状描述符；更新时直接重建背景。 */
                    try { background.remove(); } catch (ignoreRemoveExistingButton) {}
                    background = null;
                    updated += 1;
                }
                if (!background) {
                    document.activeLayer = textLayer;
                    /*
                     * 按钮背景使用稳定的像素图层，避免部分 Photoshop 对
                     * contentLayer / 实时形状 API 抛出“发生了常规 Photoshop 错误”。
                     * 图层名称携带文本层 ID，后续再次生成时仍会原位更新。
                     */
                    background = isBorder
                        ? toolCreateRasterOutlineRectangle(document, bounds, actualRadius, colorValue, 2)
                        : toolCreateRasterRectangle(document, bounds, actualRadius, colorValue);
                    background.name = toolButtonMarker(textLayer) + (isBorder ? "border button" : "fill button");
                    created += 1;
                }
                var appearanceResult = toolApplyTextButtonAppearance(background, textLayer, bounds, actualRadius, colorValue, isBorder);
                if (!appearanceResult.geometryUpdated) geometryFallbacks += 1;
                selectedTextIds.push(layerNumericId(textLayer));
            }
            if (!selectedTextIds.length) throw new Error("没有成功创建或更新按钮背景");
            selectLayersByIds(selectedTextIds);
            return {
                processed: selectedTextIds.length,
                created: created,
                updated: updated,
                grouped: false,
                vectorShape: geometryFallbacks === 0,
                fullRadius: shape === "capsule",
                border: isBorder,
                fillColor: colorValue,
                textColor: isBorder ? colorValue : "#ffffff",
                geometryFallbacks: geometryFallbacks
            };
        });
    }

    function toolsAutoTextLayout(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var layers = toolLayerSort(toolSelectedTextLayers(document, ids), "topdown");
        if (!layers.length) throw new Error("当前选择中没有文字图层");
        var sizes = options && options.sizes ? options.sizes : [];
        if (!(sizes instanceof Array) || !sizes.length) throw new Error("没有有效字号层级");
        var gap = Math.max(0, Number(options && options.gap) || 0);
        var align = String(options && options.align || "left");
        var font = String(options && options.font || "");
        var tracking = integerValue(options && options.tracking, 0);
        var leadingPoints = Number(options && options.leadingPoints) || 0;
        var leadingRatio = Math.max(0.5, Number(options && options.leading) || 1.2);
        var gapRatios = options && options.gapRatios instanceof Array ? options.gapRatios : [];
        return suspendToolsHistory(document, "鑫洋助理：一键基础排版", function () {
            var initialLeft = 999999999;
            var initialRight = -999999999;
            var initialTop = 999999999;
            var index;
            for (index = 0; index < layers.length; index += 1) {
                var before = layerSize(layers[index]);
                initialLeft = Math.min(initialLeft, before.left);
                initialRight = Math.max(initialRight, before.left + before.width);
                initialTop = Math.min(initialTop, before.top);
            }
            var center = (initialLeft + initialRight) / 2;
            var cursor = initialTop;
            for (index = 0; index < layers.length; index += 1) {
                var item = layers[index].textItem;
                var size = Math.max(1, Number(sizes[Math.min(index, sizes.length - 1)]) || 1);
                if (font) item.font = font;
                item.size = UnitValue(size, "pt");
                item.tracking = tracking;
                try { item.useAutoLeading = false; } catch (ignoreAuto) {}
                item.leading = UnitValue(leadingPoints > 0 ? size * Math.max(0.5, leadingPoints / Math.max(1, Number(sizes[0]) || size)) : size * leadingRatio, "pt");
                item.justification = textJustification(align);
                var current = layerSize(layers[index]);
                var targetLeft = initialLeft;
                if (align === "center") targetLeft = center - current.width / 2;
                if (align === "right") targetLeft = initialRight - current.width;
                layers[index].translate(
                    UnitValue(targetLeft - current.left, "px"),
                    UnitValue(cursor - current.top, "px")
                );
                current = layerSize(layers[index]);
                var gapScale = gapRatios.length ? Number(gapRatios[Math.min(index, gapRatios.length - 1)]) || 1 : 1;
                cursor = current.top + current.height + gap * gapScale;
            }
            selectLayersByIds(ids);
            return { processed: layers.length, gap: gap, align: align };
        });
    }

    function toolParseSpacingExpression(expression, count) {
        var text = String(expression || "").replace(/\s+/g, "");
        var gaps = [];
        var index;
        if (text.indexOf("=") >= 0) {
            var parts = text.split("=");
            var base = Number(parts[0]);
            if (!isFinite(base)) throw new Error("比例间距基数无效");
            var ratios = String(parts[1] || "").split(":");
            for (index = 0; index < count; index += 1) gaps.push(base * (Number(ratios[Math.min(index, ratios.length - 1)]) || 1));
        } else {
            var values = text.split(/[,，]/);
            for (index = 0; index < count; index += 1) {
                var value = Number(values[Math.min(index, values.length - 1)]);
                if (!isFinite(value)) throw new Error("固定间距表达式无效");
                gaps.push(value);
            }
        }
        return gaps;
    }

    function toolsTextSpreadElement(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var direction = String(options && options.direction || "vertical");
        var layers = toolSelectedTextLayers(document, ids);
        if (layers.length < 2) throw new Error("至少选择两个文字图层");
        layers.sort(function (left,right) {
            var a=layerSize(left), b=layerSize(right);
            return direction === "horizontal" ? a.left-b.left : a.top-b.top;
        });
        var gaps = toolParseSpacingExpression(options && options.space, layers.length - 1);
        return suspendToolsHistory(document,"鑫洋助理：文字间距分布",function(){
            var cursor;
            var index;
            var first=layerSize(layers[0]);
            cursor=direction === "horizontal" ? first.left+first.width : first.top+first.height;
            for(index=1;index<layers.length;index+=1){
                var current=layerSize(layers[index]);
                if(direction === "horizontal") layers[index].translate(UnitValue(cursor+gaps[index-1]-current.left,"px"),UnitValue(0,"px"));
                else layers[index].translate(UnitValue(0,"px"),UnitValue(cursor+gaps[index-1]-current.top,"px"));
                current=layerSize(layers[index]);
                cursor=direction === "horizontal" ? current.left+current.width : current.top+current.height;
            }
            selectLayersByIds(ids);
            return {processed:layers.length,direction:direction,gaps:gaps};
        });
    }

    return {
        toolsGetFonts: toolsGetFonts,
        textJustification: textJustification,
        toolSetTextJustificationPreservePosition: toolSetTextJustificationPreservePosition,
        toolsPickTextColor: toolsPickTextColor,
        toolsApplyTextFormatting: toolsApplyTextFormatting,
        toolJustificationName: toolJustificationName,
        toolTextEnumName: toolTextEnumName,
        toolSetTextAllCaps: toolSetTextAllCaps,
        toolReadTextAllCaps: toolReadTextAllCaps,
        toolSetTextOpticalKern: toolSetTextOpticalKern,
        toolReadTextOpticalKern: toolReadTextOpticalKern,
        toolReadTextDirection: toolReadTextDirection,
        toolSetTextDirection: toolSetTextDirection,
        toolFontInfoByPostScript: toolFontInfoByPostScript,
        toolReadTextStyle: toolReadTextStyle,
        toolApplyTextStyle: toolApplyTextStyle,
        toolsCopyTextStyle: toolsCopyTextStyle,
        toolsGetTextInfo: toolsGetTextInfo,
        toolsGetTextSelectionState: toolsGetTextSelectionState,
        toolsGetTypographySnapshot: toolsGetTypographySnapshot,
        toolsGetSelectedTextContents: toolsGetSelectedTextContents,
        toolsApplyTranslatedText: toolsApplyTranslatedText,
        toolsToggleTextDirection: toolsToggleTextDirection,
        toolsPasteTextStyle: toolsPasteTextStyle,
        toolTextPosition: toolTextPosition,
        toolSetTextPosition: toolSetTextPosition,
        toolDuplicateTextLayer: toolDuplicateTextLayer,
        toolTextPointsToPixels: toolTextPointsToPixels,
        toolIsPointText: toolIsPointText,
        toolParagraphTextHorizontalAnchor: toolParagraphTextHorizontalAnchor,
        toolAlignSplitParagraphLine: toolAlignSplitParagraphLine,
        toolSplitTextLines: toolSplitTextLines,
        toolTextLineHasConnectorPunctuation: toolTextLineHasConnectorPunctuation,
        toolSplitTextWordEntries: toolSplitTextWordEntries,
        toolSplitTextCharacters: toolSplitTextCharacters,
        toolSelectedTextLayers: toolSelectedTextLayers,
        toolMedianNumber: toolMedianNumber,
        toolTextMergeGeometry: toolTextMergeGeometry,
        toolBuildTextMergeGeometries: toolBuildTextMergeGeometries,
        toolDetectTextMergeLayout: toolDetectTextMergeLayout,
        toolVerticalMergeLeadingPt: toolVerticalMergeLeadingPt,
        toolMergedTextLayerName: toolMergedTextLayerName,
        toolTextMergeUnionBounds: toolTextMergeUnionBounds,
        toolParagraphLongestLineWidth: toolParagraphLongestLineWidth,
        toolClampParagraphBoundsToCanvas: toolClampParagraphBoundsToCanvas,
        toolForceParagraphTextInBounds: toolForceParagraphTextInBounds,
        toolForcePointText: toolForcePointText,
        toolsTextStructure: toolsTextStructure,
        toolCreateRasterRectangle: toolCreateRasterRectangle,
        toolCreateRasterOutlineRectangle: toolCreateRasterOutlineRectangle,
        toolParseButtonPadding: toolParseButtonPadding,
        toolCreateShapeRectangle: toolCreateShapeRectangle,
        toolButtonMarker: toolButtonMarker,
        toolFindTextButtonBackground: toolFindTextButtonBackground,
        toolFitLayerToBounds: toolFitLayerToBounds,
        toolSetButtonTextColor: toolSetButtonTextColor,
        toolApplyTextButtonAppearance: toolApplyTextButtonAppearance,
        toolsGenerateTextButtons: toolsGenerateTextButtons,
        toolsAutoTextLayout: toolsAutoTextLayout,
        toolParseSpacingExpression: toolParseSpacingExpression,
        toolsTextSpreadElement: toolsTextSpreadElement
    };
};
