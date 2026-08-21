/* 鑫洋助理 - Photoshop ExtendScript 主机层 */
var XinyangHostLoadStage = "host-start";
try {
var XinyangHostModules = {};
$.global.XinyangHostModules = XinyangHostModules;
var XinyangHostScriptFile = File($.fileName);
(function () {
    var hostFile = XinyangHostScriptFile;
    XinyangHostLoadStage = "module-loader";
    var loaderFile = File(hostFile.parent.fsName + "/module-loader.jsx");
    if (!loaderFile.exists) throw new Error("宿主模块加载器缺失：jsx/module-loader.jsx");
    $.evalFile(loaderFile);
    var hostModuleLoader = $.global.XinyangHostModuleLoader;
    if (!hostModuleLoader) throw new Error("宿主模块加载器未注册：jsx/module-loader.jsx");
    /*
     * 启动阶段只加载宿主公共层；业务域在首次 invoke 对应方法时再 evalFile。
     * 这样默认打开插件不会解析 OCR、文字、切片、框架等大体积 JSX。
     */
    XinyangHostLoadStage = "core-modules";
    hostModuleLoader.load(hostFile, [
        "modules/core/shared.jsx",
        "modules/core/layers.jsx",
        "modules/core/colors.jsx",
        "modules/tools/layer-tools.jsx"
    ]);
    /* 拼图是首屏主流程；先在宿主启动阶段解析，避免首次 invoke 时
     * ExtendScript 对大型业务 JSX 的动态 evalFile 只返回 code 38。 */
    XinyangHostLoadStage = "stitch-module";
    hostModuleLoader.loadOne(hostFile, "modules/stitch/stitch-slice.jsx");
}());

XinyangHostLoadStage = "public-api-init";
var LongStitchCEP = (function () {
    var MAX_CANVAS_HEIGHT = 300000;
    var INITIAL_CANVAS_HEIGHT = 790;
    var SPACING_NAMESPACE = "http://jeffjiang.com/long-stitch/spacing/1.0/";
    var SPACING_PREFIX = "longstitch";
    var SPACING_PROPERTY = "layerSpacing";
    var STITCH_SOURCE_NAMESPACE =
        "http://jeffjiang.com/xinyang-assistant/stitch-sources/1.0/";
    var STITCH_SOURCE_PREFIX = "xinyangstitch";
    var STITCH_SOURCE_PROPERTY = "sourceLayers";
    var activeToolsJob = null;
    var HOST_SCRIPT_FOLDER = null;
    try {
        HOST_SCRIPT_FOLDER = XinyangHostScriptFile.parent;
    } catch (ignoreHostScriptFolder) {}

    XinyangHostLoadStage = "core-shared-init";
    var coreShared = XinyangHostModules.coreShared({
        SPACING_NAMESPACE: SPACING_NAMESPACE,
        SPACING_PREFIX: SPACING_PREFIX,
        SPACING_PROPERTY: SPACING_PROPERTY,
        STITCH_SOURCE_NAMESPACE: STITCH_SOURCE_NAMESPACE,
        STITCH_SOURCE_PREFIX: STITCH_SOURCE_PREFIX,
        STITCH_SOURCE_PROPERTY: STITCH_SOURCE_PROPERTY
    });
    var escapeJsonString = coreShared.escapeJsonString;
    var toJson = coreShared.toJson;
    var parseJson = coreShared.parseJson;
    var pixels = coreShared.pixels;
    var layerSize = coreShared.layerSize;
    var integerValue = coreShared.integerValue;
    var activeLayerId = coreShared.activeLayerId;
    var selectedLayerIds = coreShared.selectedLayerIds;
    var selectLayersByIds = coreShared.selectLayersByIds;
    var collectImageLayers = coreShared.collectImageLayers;
    var defaultSpacingState = coreShared.defaultSpacingState;
    var normalizedSpacing = coreShared.normalizedSpacing;
    var ensureXmpLibrary = coreShared.ensureXmpLibrary;
    var saveStitchSourceState = coreShared.saveStitchSourceState;
    var loadStitchSourceState = coreShared.loadStitchSourceState;
    var loadSpacingState = coreShared.loadSpacingState;
    var saveSpacingState = coreShared.saveSpacingState;
    var initializeSpacingState = coreShared.initializeSpacingState;
    var fileObject = coreShared.fileObject;
    var sameFile = coreShared.sameFile;
    var findOpenDocument = coreShared.findOpenDocument;

    function inspectImageWidth(options) {
        var file = fileObject(options && options.path);
        var previousDocument = app.documents.length
            ? app.activeDocument
            : null;
        var document = findOpenDocument(file);
        var openedForInspection = false;
        var previousDialogs = app.displayDialogs;

        try {
            app.displayDialogs = DialogModes.NO;
            if (!document) {
                document = app.open(file);
                openedForInspection = true;
            }
            return {
                width: Math.round(pixels(document.width))
            };
        } finally {
            if (openedForInspection && document) {
                try {
                    document.close(SaveOptions.DONOTSAVECHANGES);
                } catch (ignoreInspectionClose) {}
            }
            if (previousDocument) {
                try {
                    app.activeDocument = previousDocument;
                } catch (ignoreRestoreDocument) {}
            }
            app.displayDialogs = previousDialogs;
        }
    }

    function displayFileName(file) {
        try {
            return decodeURI(file.name);
        } catch (ignore) {
            return String(file.name || "图片");
        }
    }

    function withoutExtension(value) {
        return String(value || "").replace(/\.[^.]+$/, "");
    }

    function safeLayerName(value, fallback) {
        var name = withoutExtension(value)
            .replace(/[\\\/:*?\"<>|]/g, "_")
            .replace(/^\s+|\s+$/g, "");
        return name || fallback || "图片";
    }

    function twoDigits(value) {
        var text = String(value);
        return text.length < 2 ? "0" + text : text;
    }

    /*
     * 直接在目标文档中“置入嵌入对象”，不会打开源图片标签页。
     * 这是 v1.2 的主要性能优化：每张图只读取一次，Photoshop 界面
     * 不再因 app.open / close 和 activeDocument 切换而反复闪烁。
     */
    function placeEmbedded(target, file) {
        app.activeDocument = target;

        var descriptor = new ActionDescriptor();
        descriptor.putPath(charIDToTypeID("null"), file);
        descriptor.putEnumerated(
            charIDToTypeID("FTcs"),
            charIDToTypeID("QCSt"),
            charIDToTypeID("Qcsa")
        );

        var offset = new ActionDescriptor();
        offset.putUnitDouble(
            charIDToTypeID("Hrzn"),
            charIDToTypeID("#Pxl"),
            0
        );
        offset.putUnitDouble(
            charIDToTypeID("Vrtc"),
            charIDToTypeID("#Pxl"),
            0
        );
        descriptor.putObject(
            charIDToTypeID("Ofst"),
            charIDToTypeID("Ofst"),
            offset
        );

        executeAction(charIDToTypeID("Plc "), descriptor, DialogModes.NO);
        return target.activeLayer;
    }

    function placeLinked(target, file) {
        app.activeDocument = target;

        var descriptor = new ActionDescriptor();
        descriptor.putPath(charIDToTypeID("null"), file);
        descriptor.putEnumerated(
            charIDToTypeID("FTcs"),
            charIDToTypeID("QCSt"),
            charIDToTypeID("Qcsa")
        );
        descriptor.putBoolean(stringIDToTypeID("linked"), true);

        var offset = new ActionDescriptor();
        offset.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), 0);
        offset.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), 0);
        descriptor.putObject(charIDToTypeID("Ofst"), charIDToTypeID("Ofst"), offset);

        executeAction(charIDToTypeID("Plc "), descriptor, DialogModes.NO);
        return target.activeLayer;
    }

    function isSmartObjectLayer(layer) {
        try {
            return layer.kind === LayerKind.SMARTOBJECT;
        } catch (ignoreLayerKind) {
            return false;
        }
    }

    function convertToSmartObject(target, layer) {
        app.activeDocument = target;
        target.activeLayer = layer;
        if (isSmartObjectLayer(layer)) return layer;

        executeAction(
            stringIDToTypeID("newPlacedLayer"),
            undefined,
            DialogModes.NO
        );
        layer = target.activeLayer;
        if (!isSmartObjectLayer(layer)) {
            throw new Error("无法将图片图层转换为智能对象");
        }
        return layer;
    }

    /*
     * 极少数 Photoshop 无法直接置入的格式使用一次性兼容回退。
     * 正常 JPG / PNG / WEBP / PSD / TIF 不会进入这里。
     */
    function openOnceAsLayer(target, file, targetWidth) {
        var source = null;
        try {
            source = app.open(file);
            source.flatten();

            var layer = source.activeLayer.duplicate(
                target,
                ElementPlacement.PLACEATBEGINNING
            );
            source.close(SaveOptions.DONOTSAVECHANGES);
            source = null;
            app.activeDocument = target;
            layer = convertToSmartObject(target, layer);

            return {
                layer: layer,
                needsScale: true,
                usedFallback: true
            };
        } finally {
            if (source) source.close(SaveOptions.DONOTSAVECHANGES);
        }
    }

    function createSourceLayer(target, file, targetWidth) {
        try {
            return {
                layer: placeEmbedded(target, file),
                needsScale: true,
                usedFallback: false
            };
        } catch (placeError) {
            app.activeDocument = target;
            return openOnceAsLayer(target, file, targetWidth);
        }
    }

    function moveLayerToBottom(target, layer) {
        if (target.layers.length < 2) return;
        var bottom = target.layers[target.layers.length - 1];
        if (bottom !== layer) {
            layer.move(bottom, ElementPlacement.PLACEAFTER);
        }
    }

    /* Photoshop 在移动新建白底时偶尔会把紧邻图层自动变为剪贴蒙版。 */
    function clearLayerClippingMask(layer) {
        if (!layer || layer.typename !== "ArtLayer") return;
        try { layer.grouped = false; } catch (ignoreClearClipping) {}
        try {
            if (layer.grouped) {
                app.activeDocument.activeLayer = layer;
                executeAction(stringIDToTypeID("groupEvent"), undefined, DialogModes.NO);
            }
        } catch (ignoreReleaseClippingCommand) {}
        try { layer.grouped = false; } catch (ignoreFinalClearClipping) {}
    }

    function clearStitchSourceClippingMasks(document, layerIds) {
        var index;
        for (index = 0; index < (layerIds || []).length; index += 1) {
            try {
                var layer = findLayerById(document, integerValue(layerIds[index], -1));
                if (!layer) continue;
                document.activeLayer = layer;
                clearLayerClippingMask(layer);
            } catch (ignoreSourceClipping) {}
        }
    }

    function createStitchWhiteBackground(target) {
        app.activeDocument = target;
        var background = target.artLayers.add();
        background.name = "00_白色背景";
        background.kind = LayerKind.NORMAL;
        var white = new SolidColor();
        white.rgb.red = 255;
        white.rgb.green = 255;
        white.rgb.blue = 255;
        try {
            target.activeLayer = background;
            target.selection.selectAll();
            target.selection.fill(white, ColorBlendMode.NORMAL, 100, false);
            target.selection.deselect();
            moveLayerToBottom(target, background);
            try { background.allLocked = true; } catch (ignoreBackgroundLock) {}
            return background;
        } catch (error) {
            try { target.selection.deselect(); } catch (ignoreBackgroundDeselect) {}
            try { background.remove(); } catch (ignoreBackgroundRemove) {}
            throw error;
        }
    }

    function currentDocumentId() {
        var reference = new ActionReference();
        reference.putProperty(
            charIDToTypeID("Prpr"),
            stringIDToTypeID("documentID")
        );
        reference.putEnumerated(
            charIDToTypeID("Dcmn"),
            charIDToTypeID("Ordn"),
            charIDToTypeID("Trgt")
        );
        var descriptor = executeActionGet(reference);
        return descriptor.getInteger(stringIDToTypeID("documentID"));
    }

    function currentPixelSelectionBounds(document) {
        try {
            var bounds = document.selection.bounds;
            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            var left = Math.max(0, Math.floor(pixels(bounds[0])));
            var top = Math.max(0, Math.floor(pixels(bounds[1])));
            var right = Math.min(canvasWidth, Math.ceil(pixels(bounds[2])));
            var bottom = Math.min(canvasHeight, Math.ceil(pixels(bounds[3])));
            if (!(right - left > 1 && bottom - top > 1)) return null;
            return {
                left: left,
                top: top,
                right: right,
                bottom: bottom,
                width: right - left,
                height: bottom - top
            };
        } catch (ignoreNoPixelSelection) {
            return null;
        }
    }

    function currentDocumentIdFor(document) {
        var previous = app.activeDocument;
        try {
            app.activeDocument = document;
            return currentDocumentId();
        } finally {
            try {
                app.activeDocument = previous;
            } catch (ignoreRestoreIdDocument) {}
        }
    }


    function runToolsJob() {
        if (!activeToolsJob || !activeToolsJob.run) {
            throw new Error("没有可执行的工具任务");
        }
        activeToolsJob.result = activeToolsJob.run();
    }

    function suspendToolsHistory(document, name, runner) {
        var previousHistory = document.activeHistoryState;
        activeToolsJob = {
            run: runner,
            result: null
        };
        try {
            document.suspendHistory(
                String(name || "鑫洋助理工具"),
                "$.global.LongStitchCEP._runToolsJob()"
            );
            return activeToolsJob.result;
        } catch (error) {
            try {
                document.activeHistoryState = previousHistory;
            } catch (ignoreToolsRollback) {}
            throw error;
        } finally {
            activeToolsJob = null;
        }
    }



    /*
     * 文字批量修改专用：一次遍历图层树取得全部目标图层，避免旧逻辑
     * 对每个图层执行一次 select，再在结束后重新多选。大量文字图层时，
     * 选层动作远比属性写入更耗时，也是实时修改卡顿的主要原因。
     */









    /*
     * v2.2.05：当同一个底图上已经叠有多个剪切图层时，
     * “嵌入图片”不能用面板中紧邻的下一个图层作为缩放范围。
     * Photoshop 的 ArtLayer.grouped=true 表示该层仍属于上方剪切链，
     * 因此持续向下越过所有 grouped 图层，直到找到真正承载显示范围的
     * 最底部非剪切底图。
     */







    /*
     * v2.1.95：嵌入下方图层。
     * 这里的“下方”按 Photoshop 实际视觉堆叠理解，而不是简单取图层面板相邻下一项：
     * 先以当前图层透明度建立选区，再临时隐藏当前层以及所有视觉上方的 ArtLayer，
     * 使用 Copy Merged 取得该选区内真正可见的下层合成结果。最终粘贴回原位、移动到
     * 原图层正上方并建立向下剪切蒙版。临时可见性在复制后完整恢复。
     */











    /* 兼容旧版/图牛方法名，避免 toolLayersEmpty 不是函数。 */














































    /* v2.1.59 修改段落对齐时保持文字在画布中的视觉位置不变。 */





    /* v1.9.0 图层与文字进阶工具 */




































    /*
     * “多字拆开”按可读词组处理，而不是逐字切碎：
     * - 有标点的行是一个完整表达，始终保留整行；
     * - 无标点的行只按用户明确输入的空白分隔；连续中文、英文或数字都保留为一个词组。
     * 这样“满足包装·收纳·定制需求”和“简洁束口结构”不会被拆散。
     */







    /*
     * 根据文字图层中心点的横纵跨度，并用图层自身宽高归一化，判断原始
     * 排列方向。这样纵向堆叠的长句不会因为文字本身很宽而被误判为横向。
     */




    /*
     * 合并为段落时，不能把原图层的联合宽度直接作为新文本框宽度：
     * 原图层可能被拉伸、分散摆放，或本身就是一个很宽的段落框。
     * 用同一套文字样式逐行测量可见字形，取最长一行的实际宽度，不加边距。
     */

    /* 段落文字框必须完整落在当前画布内，不能因原文字靠边而溢出。 */

    /*
     * v2.2.05：“合并成段落”不再只是把多个点文本拼成一行文字。
     * 以所有原文字图层的联合范围作为段落框，转换为真正的 PARAGRAPHTEXT，
     * 文字会在这个范围框内自动换行，后续拖动段落框也保持 Photoshop 原生行为。
     */







































    function undoPhotoshop() {
        if (!app.documents.length) {
            throw new Error("当前没有可撤回的 Photoshop 文档");
        }
        try {
            executeAction(
                charIDToTypeID("undo"),
                undefined,
                DialogModes.NO
            );
        } catch (undoError) {
            try {
                app.runMenuItem(stringIDToTypeID("undo"));
            } catch (fallbackUndoError) {
                throw new Error("Photoshop 当前没有可撤回的操作");
            }
        }
        return { undone: true };
    }





    /* v2.1.0 常用功能面板 */













    /* CEP cannot receive mouse-drag frames.  This applies the same nearest-target
       correction after a move, keeping the expensive layer scan inside Photoshop. */











    function getText() {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var output = [];
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) continue;
            output.push({
                id: ids[index],
                text: String(layer.textItem.contents || "")
            });
        }
        return { texts: output };
    }

    function pinyin(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var texts = options && options.texts instanceof Array ? options.texts : [];
        if (!texts.length) throw new Error("没有可写入的拼音文字");
        return suspendToolsHistory(document, "鑫洋助理：汉字转拼音", function () {
            var converted = 0;
            var ids = [];
            var index;
            for (index = 0; index < texts.length; index += 1) {
                var id = integerValue(texts[index].id, -1);
                var text = String(texts[index].text === undefined || texts[index].text === null ? "" : texts[index].text);
                if (id < 0) continue;
                try {
                    var layer = toolLayerById(document, id);
                    if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.TEXT) continue;
                    layer.textItem.contents = text;
                    ids.push(id);
                    converted += 1;
                } catch (ignorePinyinLayer) {}
            }
            if (!converted) throw new Error("没有成功转换任何文字图层");
            selectLayersByIds(ids);
            return { converted: converted };
        });
    }
    /* v2.1.30 图牛自定义框架 */
    function batchExportLayer(options) {
        options = options || {};
        options.target = "topLevel";
        return toolsBatchExport(options);
    }

    function BatchExportSecondLevelLayer(options) {
        options = options || {};
        options.target = "secondLevel";
        return toolsBatchExport(options);
    }

    function bacthExportPsd(options) {
        options = options || {};
        if (!options.filePath) return toolsBatchExportPsdFolder(options);
        var inputFile = new File(String(options.filePath || ""));
        if (!inputFile.exists) throw new Error("PSD/PSB 文件不存在：" + inputFile.fsName);
        var previousDialogs = app.displayDialogs;
        var previousDocument = app.documents.length ? app.activeDocument : null;
        var opened = null;
        try {
            app.displayDialogs = DialogModes.NO;
            opened = app.open(inputFile);
            var folder = toolResolveExportFolder(options, opened);
            var files = toolExportDocument(opened, folder, options, 1);
            return { exported: files.length, files: files, folder: folder.fsName, documents: 1 };
        } finally {
            if (opened) {
                try { opened.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseSingleBatchPsd) {}
            }
            if (previousDocument) { try { app.activeDocument = previousDocument; } catch (ignoreRestoreSingleBatchPsd) {} }
            app.displayDialogs = previousDialogs;
        }
    }

    /* v2.1.32 图牛文字方法兼容层 */
    function wordsOptionValue(options, names, fallback) {
        var index;
        options = options || {};
        for (index = 0; index < names.length; index += 1) {
            if (options[names[index]] !== undefined) return options[names[index]];
        }
        return fallback;
    }

    function wordsApplyTextPartial(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var layers = toolSelectedTextLayers(document, ids);
        if (!layers.length) throw new Error("当前选择中没有文字图层");
        options = options || {};
        return suspendToolsHistory(document, "鑫洋助理：文字属性", function () {
            var index;
            var positionPreserved = 0;
            for (index = 0; index < layers.length; index += 1) {
                var item = layers[index].textItem;
                if (options.font !== undefined && String(options.font)) item.font = String(options.font);
                if (options.size !== undefined && Number(options.size) > 0) item.size = UnitValue(Math.max(1, integerValue(options.size, 48)), "pt");
                if (options.leading !== undefined && Number(options.leading) > 0) {
                    try { item.useAutoLeading = false; } catch (ignoreAutoLeading) {}
                    item.leading = UnitValue(Math.max(1, integerValue(options.leading, 58)), "pt");
                }
                if (options.tracking !== undefined) item.tracking = Math.max(-1000, Math.min(10000, integerValue(options.tracking, 0)));
                if (options.align !== undefined && toolSetTextJustificationPreservePosition(layers[index], String(options.align))) positionPreserved += 1;
                if (options.color !== undefined && String(options.color)) item.color = toolSolidColorFromHex(String(options.color));
                try { if (options.fauxBold !== undefined) item.fauxBold = !!options.fauxBold; } catch (ignoreBold) {}
                try { if (options.fauxItalic !== undefined) item.fauxItalic = !!options.fauxItalic; } catch (ignoreItalic) {}
                if (options.allCaps !== undefined) toolSetTextAllCaps(item, !!options.allCaps);
                if (options.opticalKern !== undefined) toolSetTextOpticalKern(item, !!options.opticalKern);
            }
            selectLayersByIds(ids);
            return { processed: layers.length, positionPreserved: positionPreserved };
        });
    }

    function wordsUseFont(options) {
        return wordsApplyTextPartial({ font: wordsOptionValue(options, ["font", "postScriptName", "fontName", "value"], "") });
    }
    function wordsSetFontColor(options) {
        return wordsApplyTextPartial({ color: wordsOptionValue(options, ["color", "value", "hex"], "#ffffff") });
    }
    function wordsSetFontBold(options) {
        return wordsApplyTextPartial({ fauxBold: !!wordsOptionValue(options, ["bold", "fauxBold", "value"], true) });
    }
    function wordsSetFontItalic(options) {
        return wordsApplyTextPartial({ fauxItalic: !!wordsOptionValue(options, ["italic", "fauxItalic", "value"], true) });
    }
    function wordsSetFontCaps(options) {
        return wordsApplyTextPartial({ allCaps: !!wordsOptionValue(options, ["caps", "allCaps", "value"], true) });
    }
    function wordsSetFontAlign(options) {
        return wordsApplyTextPartial({ align: String(wordsOptionValue(options, ["align", "value", "type"], "left")) });
    }
    function wordsSetFontSize(options) {
        return wordsApplyTextPartial({ size: integerValue(wordsOptionValue(options, ["size", "fontSize", "value"], 48), 48) });
    }
    function wordsSetFontLeading(options) {
        var value = Number(wordsOptionValue(options, ["leading", "lineHeight", "value"], 58));
        if (value > 0 && value <= 5 && app.documents.length) {
            try {
                var ids = selectedLayerIds();
                var layers = toolSelectedTextLayers(app.activeDocument, ids);
                if (layers.length) value = toolReadTextStyle(layers[0]).size * value;
            } catch (ignoreLeadingRatio) {}
        }
        return wordsApplyTextPartial({ leading: Math.max(1, Math.round(value)) });
    }
    function wordsSetFontTracking(options) {
        return wordsApplyTextPartial({ tracking: Number(wordsOptionValue(options, ["tracking", "wordSpace", "value"], 0)) });
    }
    function wordsSetFontAutoKern(options) {
        return wordsApplyTextPartial({ opticalKern: !!wordsOptionValue(options, ["opticalKern", "autoKern", "value"], true) });
    }
    function wordsTextSplitMerge(options) {
        var fn = String(wordsOptionValue(options, ["fn", "action", "type"], ""));
        var map = { splitLine: "splitLines", splitWords: "splitChars", mergeLine: "mergeLines", mergeTextsToArea: "mergeParagraph" };
        return toolsTextStructure({ action: map[fn] || fn, order: "topdown" });
    }
    function wordsCreateBtn(options) {
        options = options || {};
        var type = wordsOptionValue(options, ["type", "cornerType", "shape"], "0");
        var shape = type === 1 || type === "1" || type === "rectangle" ? "rectangle" : "capsule";
        return toolsGenerateTextButtons({
            paddingRule: String(wordsOptionValue(options, ["padding", "paddingRule"], "28,12")),
            isBorder: !!wordsOptionValue(options, ["isBorder", "border"], false),
            shape: shape,
            cornerType: shape,
            color: String(wordsOptionValue(options, ["color"], "#e53935") || "#e53935"),
            group: false,
            updateExisting: wordsOptionValue(options, ["updateExisting"], true) !== false,
            radius: shape === "capsule" ? 9999 : 0
        });
    }

    function wordsSetAlignment(options) {
        var action = String(wordsOptionValue(options, ["action", "type", "align"], "left"));
        var map = { center: "hCenter", middle: "vCenter", horizontalCenter: "hCenter", verticalCenter: "vCenter" };
        return toolsAlignLayers({ action: map[action] || action });
    }
    function wordsUseSmartTypesetting(options) {
        options = options || {};
        var sizes = options.sizes || options.fontSizes || options.fontSizeArray || [92,48,36,24,15,12];
        if (!(sizes instanceof Array)) {
            var parts = String(sizes || "").split(/[,，\s]+/);
            sizes = [];
            var index;
            for (index = 0; index < parts.length; index += 1) if (Number(parts[index]) > 0) sizes.push(Number(parts[index]));
        }
        return toolsAutoTextLayout({
            sizes: sizes,
            gap: Number(wordsOptionValue(options, ["gap", "space", "baseGap"], 12)) || 12,
            align: String(wordsOptionValue(options, ["align", "alignment"], "left")),
            font: String(wordsOptionValue(options, ["font", "postScriptName"], "")),
            tracking: Number(wordsOptionValue(options, ["tracking", "wordSpace"], 0)) || 0,
            leading: Number(wordsOptionValue(options, ["leading", "lineSpace"], 1.2)) || 1.2
        });
    }

    function wordsDistributionByH(options) {
        options = options || {};
        options.axis = "horizontal";
        return toolsDistributeLayersEvenly(options);
    }
    function wordsDistributionByV(options) {
        options = options || {};
        options.axis = "vertical";
        return toolsDistributeLayersEvenly(options);
    }
    function wordsSetAlignmentByDocument(options) {
        var axis = String(wordsOptionValue(options, ["axis", "direction", "type"], "horizontal"));
        if (axis === "h" || axis === "x" || axis === "horizontalCenter") axis = "horizontal";
        if (axis === "v" || axis === "y" || axis === "verticalCenter") axis = "vertical";
        return toolsCenterLayersOnCanvas({ axis: axis });
    }
    function translateTextReplace(options) {
        options = options || {};
        options.replace = true;
        return toolsApplyTranslatedText(options);
    }
    function translate2Bottom(options) {
        options = options || {};
        options.replace = false;
        return toolsApplyTranslatedText(options);
    }



    XinyangHostLoadStage = "core-layers-init";
    var coreLayersModule = XinyangHostModules.coreLayers({
        currentDocumentId: currentDocumentId, pixels: pixels, layerSize: layerSize,
        activeLayerId: activeLayerId, selectLayersByIds: selectLayersByIds
    });
    var findLayerById = coreLayersModule.findLayerById;
    var toolLayerById = coreLayersModule.toolLayerById;
    var toolLayersByIdsWithoutSelection = coreLayersModule.toolLayersByIdsWithoutSelection;
    var toolTextFormattingLayers = coreLayersModule.toolTextFormattingLayers;
    var layerNumericId = coreLayersModule.layerNumericId;
    var toolLayerBoundsPixels = coreLayersModule.toolLayerBoundsPixels;
    var toolLayerIsEmpty = coreLayersModule.toolLayerIsEmpty;
    var toolLayersEmpty = coreLayersModule.toolLayersEmpty;
    var toolLayerOutsideCanvas = coreLayersModule.toolLayerOutsideCanvas;
    var toolLayerIsDescendantOf = coreLayersModule.toolLayerIsDescendantOf;
    var toolLayerGroupedState = coreLayersModule.toolLayerGroupedState;
    var toolSetLayerGroupedState = coreLayersModule.toolSetLayerGroupedState;
    var toolLayerId = coreLayersModule.toolLayerId;
    var toolCollectLayers = coreLayersModule.toolCollectLayers;
    var toolCollectGroupChildren = coreLayersModule.toolCollectGroupChildren;
    var toolLayerType = coreLayersModule.toolLayerType;
    var toolLayerSort = coreLayersModule.toolLayerSort;
    var toolLayerVisualBounds = coreLayersModule.toolLayerVisualBounds;
    var toolCollectLayersRecursive = coreLayersModule.toolCollectLayersRecursive;
    var toolCollectAllLayersInPanelOrder = coreLayersModule.toolCollectAllLayersInPanelOrder;

    XinyangHostLoadStage = "core-colors-init";
    var coreColorsModule = XinyangHostModules.coreColors({});
    var toolArrayContains = coreColorsModule.toolArrayContains;
    var toolHexPad = coreColorsModule.toolHexPad;
    var toolHexColor = coreColorsModule.toolHexColor;
    var toolSolidColorHex = coreColorsModule.toolSolidColorHex;
    var toolSolidColorFromHex = coreColorsModule.toolSolidColorFromHex;

    XinyangHostLoadStage = "layer-tools-init";
    var layerToolsModule = XinyangHostModules.layerTools({
        pixels: pixels,
        layerSize: layerSize,
        integerValue: integerValue,
        activeLayerId: activeLayerId,
        selectedLayerIds: selectedLayerIds,
        selectLayersByIds: selectLayersByIds,
        layerNumericId: layerNumericId,
        suspendToolsHistory: suspendToolsHistory,
        toolArrayContains: toolArrayContains,
        toolCollectAllLayersInPanelOrder: toolCollectAllLayersInPanelOrder,
        toolCollectGroupChildren: toolCollectGroupChildren,
        toolCollectLayers: toolCollectLayers,
        toolHexColor: toolHexColor,
        toolHexPad: toolHexPad,
        toolLayerById: toolLayerById,
        toolLayerGroupedState: toolLayerGroupedState,
        toolLayerId: toolLayerId,
        toolLayerIsDescendantOf: toolLayerIsDescendantOf,
        toolLayerSort: toolLayerSort,
        toolLayerType: toolLayerType,
        toolSetLayerGroupedState: toolSetLayerGroupedState,
        toolSolidColorFromHex: toolSolidColorFromHex,
        toolSolidColorHex: toolSolidColorHex
    });
    var toolCreateSwapMarker = layerToolsModule.toolCreateSwapMarker;
    var toolRemoveSwapMarker = layerToolsModule.toolRemoveSwapMarker;
    var toolSwapLayerSlots = layerToolsModule.toolSwapLayerSlots;
    var toolMoveLayerCenterTo = layerToolsModule.toolMoveLayerCenterTo;
    var toolFlipCurrentLayerSelection = layerToolsModule.toolFlipCurrentLayerSelection;
    var toolGroupCurrentLayerSelection = layerToolsModule.toolGroupCurrentLayerSelection;
    var toolUngroupCurrentLayerSelection = layerToolsModule.toolUngroupCurrentLayerSelection;
    var toolsQuickTransform = layerToolsModule.toolsQuickTransform;
    var toolTransformAnchor = layerToolsModule.toolTransformAnchor;
    var toolFloatValue = layerToolsModule.toolFloatValue;
    var toolsCustomTransform = layerToolsModule.toolsCustomTransform;
    var toolsCreateDocumentPreset = layerToolsModule.toolsCreateDocumentPreset;
    var toolRenameNumber = layerToolsModule.toolRenameNumber;
    var toolFormatLayerName = layerToolsModule.toolFormatLayerName;
    var toolsBatchRenameLayers = layerToolsModule.toolsBatchRenameLayers;
    var toolLayerDescriptor = layerToolsModule.toolLayerDescriptor;
    var toolDescriptorColorHex = layerToolsModule.toolDescriptorColorHex;
    var toolLayerFillColor = layerToolsModule.toolLayerFillColor;
    var toolLayerStrokeColor = layerToolsModule.toolLayerStrokeColor;
    var toolLayerLabel = layerToolsModule.toolLayerLabel;
    var toolSmartObjectSource = layerToolsModule.toolSmartObjectSource;
    var toolLayerSignature = layerToolsModule.toolLayerSignature;
    var toolSignaturesMatch = layerToolsModule.toolSignaturesMatch;
    var toolSetLayerLabel = layerToolsModule.toolSetLayerLabel;
    var toolsFindSimilarLayers = layerToolsModule.toolsFindSimilarLayers;
    var toolSetShapeFill = layerToolsModule.toolSetShapeFill;
    var toolSetShapeStroke = layerToolsModule.toolSetShapeStroke;
    var toolSetLiveShapeGeometry = layerToolsModule.toolSetLiveShapeGeometry;
    var toolSetLiveShapeRadius = layerToolsModule.toolSetLiveShapeRadius;
    var toolsApplyRectangleSettings = layerToolsModule.toolsApplyRectangleSettings;
    var toolsSmartObject = layerToolsModule.toolsSmartObject;
    var toolsScaleLayers = layerToolsModule.toolsScaleLayers;
    var toolsAlignLayers = layerToolsModule.toolsAlignLayers;
    var toolsCenterLayersOnCanvas = layerToolsModule.toolsCenterLayersOnCanvas;
    var toolsDistributeLayersEvenly = layerToolsModule.toolsDistributeLayersEvenly;
    var toolSetColorOverlay = layerToolsModule.toolSetColorOverlay;
    var toolFillNormalLayerPixels = layerToolsModule.toolFillNormalLayerPixels;
    var toolsAutoFillForeground = layerToolsModule.toolsAutoFillForeground;
    var toolPlainFind = layerToolsModule.toolPlainFind;
    var toolPlainPointCoordinates = layerToolsModule.toolPlainPointCoordinates;
    var toolCollectPathPoints = layerToolsModule.toolCollectPathPoints;
    var toolSnapPointDimension = layerToolsModule.toolSnapPointDimension;
    var toolGetVectorMaskPathPlain = layerToolsModule.toolGetVectorMaskPathPlain;
    var toolSetVectorMaskPathPlain = layerToolsModule.toolSetVectorMaskPathPlain;
    var toolsApplySmartSnap = layerToolsModule.toolsApplySmartSnap;
    var toolsSnapShapeAnchors = layerToolsModule.toolsSnapShapeAnchors;
    var toolShapeAppearanceInfo = layerToolsModule.toolShapeAppearanceInfo;
    var toolPutNativeStrokeDefaults = layerToolsModule.toolPutNativeStrokeDefaults;
    var toolSetNativeShapeAppearance = layerToolsModule.toolSetNativeShapeAppearance;
    var toolsSwapShapeFillStroke = layerToolsModule.toolsSwapShapeFillStroke;
    var toolsDistributeLayers = layerToolsModule.toolsDistributeLayers;
    var toolsReplaceElements = layerToolsModule.toolsReplaceElements;
    var toolSetMainLayerColor = layerToolsModule.toolSetMainLayerColor;
    var toolsSwapLayerColors = layerToolsModule.toolsSwapLayerColors;

    function ensureHostBusinessFactory(key, relativePath) {
        var hostModuleLoader = $.global.XinyangHostModuleLoader;
        if (!XinyangHostModules[key]) {
            if (!hostModuleLoader) throw new Error("宿主模块加载器未注册：" + relativePath);
            hostModuleLoader.loadOne(XinyangHostScriptFile, relativePath);
        }
        if (!XinyangHostModules[key]) {
            throw new Error("宿主模块未注册：" + key);
        }
        return XinyangHostModules[key];
    }

    function lazyHostMethod(getModule, methodName) {
        return function () {
            var module = getModule();
            var method = module && module[methodName];
            if (typeof method !== "function") {
                throw new Error("宿主模块能力缺失：" + methodName);
            }
            return method.apply(module, arguments);
        };
    }

    var embedImportModule = null;
    function getEmbedImportModule() {
        if (!embedImportModule) {
            embedImportModule = ensureHostBusinessFactory("embedImport", "modules/tools/embed-import.jsx")({
        HOST_SCRIPT_FOLDER: HOST_SCRIPT_FOLDER,
        pixels: pixels,
        layerSize: layerSize,
        integerValue: integerValue,
        activeLayerId: activeLayerId,
        selectedLayerIds: selectedLayerIds,
        selectLayersByIds: selectLayersByIds,
        loadStitchSourceState: loadStitchSourceState,
        fileObject: fileObject,
        displayFileName: displayFileName,
        findLayerById: findLayerById,
        layerNumericId: layerNumericId,
        placeEmbedded: placeEmbedded,
        placeLinked: placeLinked,
        safeLayerName: safeLayerName,
        suspendToolsHistory: suspendToolsHistory,
        toolLayerById: toolLayerById
    });
        }
        return embedImportModule;
    }
    var centerLayerInCanvas = lazyHostMethod(getEmbedImportModule, "centerLayerInCanvas");
    var fitLayerToCanvas = lazyHostMethod(getEmbedImportModule, "fitLayerToCanvas");
    var arrangeImportedLayers = lazyHostMethod(getEmbedImportModule, "arrangeImportedLayers");
    var fitLayerCoverBounds = lazyHostMethod(getEmbedImportModule, "fitLayerCoverBounds");
    var createDownwardClippingMask = lazyHostMethod(getEmbedImportModule, "createDownwardClippingMask");
    var directLowerSibling = lazyHostMethod(getEmbedImportModule, "directLowerSibling");
    var clippingDisplayBaseBelow = lazyHostMethod(getEmbedImportModule, "clippingDisplayBaseBelow");
    var isEmbeddableImageLayer = lazyHostMethod(getEmbedImportModule, "isEmbeddableImageLayer");
    var collectArtLayersInPanelOrder = lazyHostMethod(getEmbedImportModule, "collectArtLayersInPanelOrder");
    var sortLayersByPanelOrder = lazyHostMethod(getEmbedImportModule, "sortLayersByPanelOrder");
    var collectEmbedTargets = lazyHostMethod(getEmbedImportModule, "collectEmbedTargets");
    var toolsEmbedSelectedLayerClipped = lazyHostMethod(getEmbedImportModule, "toolsEmbedSelectedLayerClipped");
    var toolsLoadActiveLayerTransparencySelection = lazyHostMethod(getEmbedImportModule, "toolsLoadActiveLayerTransparencySelection");
    var toolsPasteInPlace = lazyHostMethod(getEmbedImportModule, "toolsPasteInPlace");
    var toolsEmbedLowerVisualContent = lazyHostMethod(getEmbedImportModule, "toolsEmbedLowerVisualContent");
    var toolsAutoEmbedActiveLayer = lazyHostMethod(getEmbedImportModule, "toolsAutoEmbedActiveLayer");
    var toolSameFsPath = lazyHostMethod(getEmbedImportModule, "toolSameFsPath");
    var toolRemoveAutoEmbedNotifiers = lazyHostMethod(getEmbedImportModule, "toolRemoveAutoEmbedNotifiers");
    var toolsConfigureAutoEmbed = lazyHostMethod(getEmbedImportModule, "toolsConfigureAutoEmbed");
    var toolsEmbedSelectedLayersToGroup = lazyHostMethod(getEmbedImportModule, "toolsEmbedSelectedLayersToGroup");
    var toolsImportImages = lazyHostMethod(getEmbedImportModule, "toolsImportImages");

    var fileExportModule = null;
    function getFileExportModule() {
        if (!fileExportModule) {
            fileExportModule = ensureHostBusinessFactory("fileExport", "modules/tools/file-export.jsx")({
        layerSize: layerSize,
        integerValue: integerValue,
        selectedLayerIds: selectedLayerIds,
        selectLayersByIds: selectLayersByIds,
        placeEmbedded: placeEmbedded,
        suspendToolsHistory: suspendToolsHistory,
        toolFloatValue: toolFloatValue,
        toolLayerById: toolLayerById,
        toolLayerIsEmpty: toolLayerIsEmpty,
        toolLayerOutsideCanvas: toolLayerOutsideCanvas,
        toolMoveLayerCenterTo: toolMoveLayerCenterTo
    });
        }
        return fileExportModule;
    }
    var normalizeFileSlimOptions = lazyHostMethod(getFileExportModule, "normalizeFileSlimOptions");
    var toolsFileSlim = lazyHostMethod(getFileExportModule, "toolsFileSlim");
    var commonToolsFileSlim = lazyHostMethod(getFileExportModule, "commonToolsFileSlim");
    var commonToolsGetPsdFiles = lazyHostMethod(getFileExportModule, "commonToolsGetPsdFiles");
    var commonToolsBatchSlimFile = lazyHostMethod(getFileExportModule, "commonToolsBatchSlimFile");
    var safeExportName = lazyHostMethod(getFileExportModule, "safeExportName");
    var toolDocumentBaseName = lazyHostMethod(getFileExportModule, "toolDocumentBaseName");
    var uniqueExportFile = lazyHostMethod(getFileExportModule, "uniqueExportFile");
    var fillDocumentWhite = lazyHostMethod(getFileExportModule, "fillDocumentWhite");
    var toolNormalizeExportFormat = lazyHostMethod(getFileExportModule, "toolNormalizeExportFormat");
    var saveToolDocument = lazyHostMethod(getFileExportModule, "saveToolDocument");
    var saveToolDocumentAdvanced = lazyHostMethod(getFileExportModule, "saveToolDocumentAdvanced");
    var toolResolveExportFolder = lazyHostMethod(getFileExportModule, "toolResolveExportFolder");
    var toolExportName = lazyHostMethod(getFileExportModule, "toolExportName");
    var toolResizeExportDocument = lazyHostMethod(getFileExportModule, "toolResizeExportDocument");
    var toolAddExportWatermark = lazyHostMethod(getFileExportModule, "toolAddExportWatermark");
    var toolPrepareExportDocument = lazyHostMethod(getFileExportModule, "toolPrepareExportDocument");
    var newExportDocument = lazyHostMethod(getFileExportModule, "newExportDocument");
    var toolSavePreparedExport = lazyHostMethod(getFileExportModule, "toolSavePreparedExport");
    var exportOneLayer = lazyHostMethod(getFileExportModule, "exportOneLayer");
    var toolExportDocument = lazyHostMethod(getFileExportModule, "toolExportDocument");
    var toolLayerIsArtboard = lazyHostMethod(getFileExportModule, "toolLayerIsArtboard");
    var toolSecondLevelLayers = lazyHostMethod(getFileExportModule, "toolSecondLevelLayers");
    var toolsExportImage = lazyHostMethod(getFileExportModule, "toolsExportImage");
    var toolsBatchExport = lazyHostMethod(getFileExportModule, "toolsBatchExport");
    var toolsBatchExportPsdFolder = lazyHostMethod(getFileExportModule, "toolsBatchExportPsdFolder");
    var toolsOpenExportFolder = lazyHostMethod(getFileExportModule, "toolsOpenExportFolder");

    var textToolsModule = null;
    function getTextToolsModule() {
        if (!textToolsModule) {
            textToolsModule = ensureHostBusinessFactory("textTools", "modules/text/text-tools.jsx")({
        pixels: pixels,
        layerSize: layerSize,
        integerValue: integerValue,
        activeLayerId: activeLayerId,
        selectedLayerIds: selectedLayerIds,
        selectLayersByIds: selectLayersByIds,
        findLayerById: findLayerById,
        layerNumericId: layerNumericId,
        suspendToolsHistory: suspendToolsHistory,
        toolCollectLayersRecursive: toolCollectLayersRecursive,
        toolHexColor: toolHexColor,
        toolLayerById: toolLayerById,
        toolLayerId: toolLayerId,
        toolLayerSort: toolLayerSort,
        toolLayerVisualBounds: toolLayerVisualBounds,
        toolPutNativeStrokeDefaults: toolPutNativeStrokeDefaults,
        toolSetLiveShapeGeometry: toolSetLiveShapeGeometry,
        toolSetLiveShapeRadius: toolSetLiveShapeRadius,
        toolSetNativeShapeAppearance: toolSetNativeShapeAppearance,
        toolShapeAppearanceInfo: toolShapeAppearanceInfo,
        toolSolidColorFromHex: toolSolidColorFromHex,
        toolSolidColorHex: toolSolidColorHex,
        toolTextFormattingLayers: toolTextFormattingLayers
    });
        }
        return textToolsModule;
    }
    var toolsGetFonts = lazyHostMethod(getTextToolsModule, "toolsGetFonts");
    var textJustification = lazyHostMethod(getTextToolsModule, "textJustification");
    var toolSetTextJustificationPreservePosition = lazyHostMethod(getTextToolsModule, "toolSetTextJustificationPreservePosition");
    var toolsPickTextColor = lazyHostMethod(getTextToolsModule, "toolsPickTextColor");
    var toolsApplyTextFormatting = lazyHostMethod(getTextToolsModule, "toolsApplyTextFormatting");
    var toolJustificationName = lazyHostMethod(getTextToolsModule, "toolJustificationName");
    var toolTextEnumName = lazyHostMethod(getTextToolsModule, "toolTextEnumName");
    var toolSetTextAllCaps = lazyHostMethod(getTextToolsModule, "toolSetTextAllCaps");
    var toolReadTextAllCaps = lazyHostMethod(getTextToolsModule, "toolReadTextAllCaps");
    var toolSetTextOpticalKern = lazyHostMethod(getTextToolsModule, "toolSetTextOpticalKern");
    var toolReadTextOpticalKern = lazyHostMethod(getTextToolsModule, "toolReadTextOpticalKern");
    var toolReadTextDirection = lazyHostMethod(getTextToolsModule, "toolReadTextDirection");
    var toolSetTextDirection = lazyHostMethod(getTextToolsModule, "toolSetTextDirection");
    var toolFontInfoByPostScript = lazyHostMethod(getTextToolsModule, "toolFontInfoByPostScript");
    var toolReadTextStyle = lazyHostMethod(getTextToolsModule, "toolReadTextStyle");
    var toolApplyTextStyle = lazyHostMethod(getTextToolsModule, "toolApplyTextStyle");
    var toolsCopyTextStyle = lazyHostMethod(getTextToolsModule, "toolsCopyTextStyle");
    var toolsGetTextInfo = lazyHostMethod(getTextToolsModule, "toolsGetTextInfo");
    var toolsGetTextSelectionState = lazyHostMethod(getTextToolsModule, "toolsGetTextSelectionState");
    var toolsGetTypographySnapshot = lazyHostMethod(getTextToolsModule, "toolsGetTypographySnapshot");
    var toolsGetSelectedTextContents = lazyHostMethod(getTextToolsModule, "toolsGetSelectedTextContents");
    var toolsApplyTranslatedText = lazyHostMethod(getTextToolsModule, "toolsApplyTranslatedText");
    var toolsToggleTextDirection = lazyHostMethod(getTextToolsModule, "toolsToggleTextDirection");
    var toolsPasteTextStyle = lazyHostMethod(getTextToolsModule, "toolsPasteTextStyle");
    var toolTextPosition = lazyHostMethod(getTextToolsModule, "toolTextPosition");
    var toolSetTextPosition = lazyHostMethod(getTextToolsModule, "toolSetTextPosition");
    var toolDuplicateTextLayer = lazyHostMethod(getTextToolsModule, "toolDuplicateTextLayer");
    var toolTextPointsToPixels = lazyHostMethod(getTextToolsModule, "toolTextPointsToPixels");
    var toolIsPointText = lazyHostMethod(getTextToolsModule, "toolIsPointText");
    var toolParagraphTextHorizontalAnchor = lazyHostMethod(getTextToolsModule, "toolParagraphTextHorizontalAnchor");
    var toolAlignSplitParagraphLine = lazyHostMethod(getTextToolsModule, "toolAlignSplitParagraphLine");
    var toolSplitTextLines = lazyHostMethod(getTextToolsModule, "toolSplitTextLines");
    var toolTextLineHasConnectorPunctuation = lazyHostMethod(getTextToolsModule, "toolTextLineHasConnectorPunctuation");
    var toolSplitTextWordEntries = lazyHostMethod(getTextToolsModule, "toolSplitTextWordEntries");
    var toolSplitTextCharacters = lazyHostMethod(getTextToolsModule, "toolSplitTextCharacters");
    var toolSelectedTextLayers = lazyHostMethod(getTextToolsModule, "toolSelectedTextLayers");
    var toolMedianNumber = lazyHostMethod(getTextToolsModule, "toolMedianNumber");
    var toolTextMergeGeometry = lazyHostMethod(getTextToolsModule, "toolTextMergeGeometry");
    var toolBuildTextMergeGeometries = lazyHostMethod(getTextToolsModule, "toolBuildTextMergeGeometries");
    var toolDetectTextMergeLayout = lazyHostMethod(getTextToolsModule, "toolDetectTextMergeLayout");
    var toolVerticalMergeLeadingPt = lazyHostMethod(getTextToolsModule, "toolVerticalMergeLeadingPt");
    var toolMergedTextLayerName = lazyHostMethod(getTextToolsModule, "toolMergedTextLayerName");
    var toolTextMergeUnionBounds = lazyHostMethod(getTextToolsModule, "toolTextMergeUnionBounds");
    var toolParagraphLongestLineWidth = lazyHostMethod(getTextToolsModule, "toolParagraphLongestLineWidth");
    var toolClampParagraphBoundsToCanvas = lazyHostMethod(getTextToolsModule, "toolClampParagraphBoundsToCanvas");
    var toolForceParagraphTextInBounds = lazyHostMethod(getTextToolsModule, "toolForceParagraphTextInBounds");
    var toolForcePointText = lazyHostMethod(getTextToolsModule, "toolForcePointText");
    var toolsTextStructure = lazyHostMethod(getTextToolsModule, "toolsTextStructure");
    var toolCreateRasterRectangle = lazyHostMethod(getTextToolsModule, "toolCreateRasterRectangle");
    var toolCreateRasterOutlineRectangle = lazyHostMethod(getTextToolsModule, "toolCreateRasterOutlineRectangle");
    var toolParseButtonPadding = lazyHostMethod(getTextToolsModule, "toolParseButtonPadding");
    var toolCreateShapeRectangle = lazyHostMethod(getTextToolsModule, "toolCreateShapeRectangle");
    var toolButtonMarker = lazyHostMethod(getTextToolsModule, "toolButtonMarker");
    var toolFindTextButtonBackground = lazyHostMethod(getTextToolsModule, "toolFindTextButtonBackground");
    var toolFitLayerToBounds = lazyHostMethod(getTextToolsModule, "toolFitLayerToBounds");
    var toolSetButtonTextColor = lazyHostMethod(getTextToolsModule, "toolSetButtonTextColor");
    var toolApplyTextButtonAppearance = lazyHostMethod(getTextToolsModule, "toolApplyTextButtonAppearance");
    var toolsGenerateTextButtons = lazyHostMethod(getTextToolsModule, "toolsGenerateTextButtons");
    var toolsAutoTextLayout = lazyHostMethod(getTextToolsModule, "toolsAutoTextLayout");
    var toolParseSpacingExpression = lazyHostMethod(getTextToolsModule, "toolParseSpacingExpression");
    var toolsTextSpreadElement = lazyHostMethod(getTextToolsModule, "toolsTextSpreadElement");

    var diagnosticsHostModule = null;
    function getDiagnosticsHostModule() {
        if (!diagnosticsHostModule) {
            diagnosticsHostModule = ensureHostBusinessFactory("diagnosticsHost", "modules/core/diagnostics.jsx")({ pixels: pixels, selectedLayerIds: selectedLayerIds });
        }
        return diagnosticsHostModule;
    }
    var getDiagnosticInfo = lazyHostMethod(getDiagnosticsHostModule, "getDiagnosticInfo");

    var stitchModule = null;
    function getStitchModule() {
        if (!stitchModule) {
            stitchModule = ensureHostBusinessFactory("stitchSlice", "modules/stitch/stitch-slice.jsx")({
        activeLayerId: activeLayerId, clearLayerClippingMask: clearLayerClippingMask,
        clearStitchSourceClippingMasks: clearStitchSourceClippingMasks, collectImageLayers: collectImageLayers,
        convertToSmartObject: convertToSmartObject, createSourceLayer: createSourceLayer,
        createStitchWhiteBackground: createStitchWhiteBackground, currentDocumentIdFor: currentDocumentIdFor,
        displayFileName: displayFileName, fileObject: fileObject, fillDocumentWhite: fillDocumentWhite,
        findLayerById: findLayerById, initializeSpacingState: initializeSpacingState, integerValue: integerValue,
        isSmartObjectLayer: isSmartObjectLayer, layerSize: layerSize, loadSpacingState: loadSpacingState,
        loadStitchSourceState: loadStitchSourceState, moveLayerToBottom: moveLayerToBottom, normalizedSpacing: normalizedSpacing,
        pixels: pixels, safeLayerName: safeLayerName, saveSpacingState: saveSpacingState,
        saveStitchSourceState: saveStitchSourceState, selectLayersByIds: selectLayersByIds,
        selectedLayerIds: selectedLayerIds, twoDigits: twoDigits,
        MAX_CANVAS_HEIGHT: MAX_CANVAS_HEIGHT, INITIAL_CANVAS_HEIGHT: INITIAL_CANVAS_HEIGHT
    });
        }
        return stitchModule;
    }
    var runActiveJob = lazyHostMethod(getStitchModule, "runActiveJob");
    var runSpacingJob = lazyHostMethod(getStitchModule, "runSpacingJob");
    var applyLayerSpacing = lazyHostMethod(getStitchModule, "applyLayerSpacing");
    var collectSpacingSourceEntries = lazyHostMethod(getStitchModule, "collectSpacingSourceEntries");
    var prepareSmartSliceAnalysis = lazyHostMethod(getStitchModule, "prepareSmartSliceAnalysis");
    var runSliceJob = lazyHostMethod(getStitchModule, "runSliceJob");
    var createStitchSlices = lazyHostMethod(getStitchModule, "createStitchSlices");
    var createSmartSlices = lazyHostMethod(getStitchModule, "createSmartSlices");
    var getSliceExportDefaultFolder = lazyHostMethod(getStitchModule, "getSliceExportDefaultFolder");
    var exportDocumentSlices = lazyHostMethod(getStitchModule, "exportDocumentSlices");
    var createLongStitch = lazyHostMethod(getStitchModule, "createLongStitch");

    var ocrHostModule = null;
    function getOcrHostModule() {
        if (!ocrHostModule) {
            ocrHostModule = ensureHostBusinessFactory("ocrHost", "modules/ocr/ocr-host.jsx")({
        activeLayerId: activeLayerId, currentDocumentId: currentDocumentId,
        currentPixelSelectionBounds: currentPixelSelectionBounds, currentDocumentIdFor: currentDocumentIdFor,
        findLayerById: findLayerById, fileObject: fileObject, integerValue: integerValue,
        layerSize: layerSize, pixels: pixels, safeLayerName: safeLayerName,
        selectLayersByIds: selectLayersByIds, selectedLayerIds: selectedLayerIds, twoDigits: twoDigits
    });
        }
        return ocrHostModule;
    }
    var exportSelectedLayerForOCR = lazyHostMethod(getOcrHostModule, "exportSelectedLayerForOCR");
    var runTextJob = lazyHostMethod(getOcrHostModule, "runTextJob");
    var createEditableTextLayers = lazyHostMethod(getOcrHostModule, "createEditableTextLayers");
    var selectedTextEraseRegions = lazyHostMethod(getOcrHostModule, "selectedTextEraseRegions");
    var runEraseJob = lazyHostMethod(getOcrHostModule, "runEraseJob");
    var eraseOriginalText = lazyHostMethod(getOcrHostModule, "eraseOriginalText");
    var applyInpaintResult = lazyHostMethod(getOcrHostModule, "applyInpaintResult");

    var frameModule = null;
    function getFrameModule() {
        if (!frameModule) {
            frameModule = ensureHostBusinessFactory("frameTools", "modules/framework/frame.jsx")({
        integerValue: integerValue, layerNumericId: layerNumericId, layerSize: layerSize, pixels: pixels,
        selectLayersByIds: selectLayersByIds, selectedLayerIds: selectedLayerIds, suspendToolsHistory: suspendToolsHistory,
        toolCreateShapeRectangle: toolCreateShapeRectangle, toolHexColor: toolHexColor, toolLayerById: toolLayerById,
        toolLayerFillColor: toolLayerFillColor, toolLayerStrokeColor: toolLayerStrokeColor,
        toolLayerVisualBounds: toolLayerVisualBounds, toolSolidColorFromHex: toolSolidColorFromHex,
        toolsApplyRectangleSettings: toolsApplyRectangleSettings
    });
        }
        return frameModule;
    }
    var frameCreate = lazyHostMethod(getFrameModule, "frameCreate");
    var frameMergeShape = lazyHostMethod(getFrameModule, "frameMergeShape");
    var setShape = lazyHostMethod(getFrameModule, "setShape");

    var guideModule = null;
    function getGuideModule() {
        if (!guideModule) {
            guideModule = ensureHostBusinessFactory("guides", "modules/framework/guides.jsx")({
        currentPixelSelectionBounds: currentPixelSelectionBounds, findLayerById: findLayerById,
        layerNumericId: layerNumericId, layerSize: layerSize, pixels: pixels, selectedLayerIds: selectedLayerIds,
        toolCollectLayersRecursive: toolCollectLayersRecursive, toolCreateShapeRectangle: toolCreateShapeRectangle,
        toolSetShapeFill: toolSetShapeFill
    });
        }
        return guideModule;
    }
    var GuideGuide = lazyHostMethod(getGuideModule, "GuideGuide");
    var guideCurrentContext = lazyHostMethod(getGuideModule, "guideCurrentContext");
    var guideCreate = lazyHostMethod(getGuideModule, "guideCreate");
    var guideAdd = lazyHostMethod(getGuideModule, "guideAdd");
    var guideClear = lazyHostMethod(getGuideModule, "guideClear");
    var guideCreateComposition = lazyHostMethod(getGuideModule, "guideCreateComposition");
    var guideCreatePerspective = lazyHostMethod(getGuideModule, "guideCreatePerspective");
    var guideToggleOverlays = lazyHostMethod(getGuideModule, "guideToggleOverlays");
    var guideChangeOverlayColor = lazyHostMethod(getGuideModule, "guideChangeOverlayColor");

    XinyangHostLoadStage = "method-table-init";
    var methods = {
        getDiagnosticInfo: getDiagnosticInfo,
        GuideGuide: GuideGuide,
        guideQuickAdd: guideAdd,
        "guide.context": guideCurrentContext,
        "guide.create": guideCreate,
        "guide.add": guideAdd,
        "guide.clear": guideClear,
        "guide.composition": guideCreateComposition,
        "guide.perspective": guideCreatePerspective,
        "guide.toggleOverlays": guideToggleOverlays,
        "guide.changeOverlayColor": guideChangeOverlayColor,
        createLongStitch: createLongStitch,
        createStitchSlices: createStitchSlices,
        getSliceExportDefaultFolderV2190: getSliceExportDefaultFolder,
        getSliceExportDefaultFolderV2192: getSliceExportDefaultFolder,
        getSliceExportDefaultFolderV2193: getSliceExportDefaultFolder,
        exportDocumentWebAssetsV2190: exportDocumentSlices,
        exportDocumentWebAssetsV2192: exportDocumentSlices,
        exportDocumentWebAssetsV2193: exportDocumentSlices,
        getSliceExportDefaultFolder: getSliceExportDefaultFolder,
        exportDocumentSlices: exportDocumentSlices,
        prepareSmartSliceAnalysis: prepareSmartSliceAnalysis,
        createSmartSlices: createSmartSlices,
        applyLayerSpacing: applyLayerSpacing,
        inspectImageWidth: inspectImageWidth,
        exportSelectedLayerForOCR: exportSelectedLayerForOCR,
        createEditableTextLayers: createEditableTextLayers,
        selectedTextEraseRegions: selectedTextEraseRegions,
        eraseOriginalText: eraseOriginalText,
        applyInpaintResult: applyInpaintResult,
        importMoreImages: toolsImportImages,
        autoColor: toolsAutoFillForeground,
        switchColor: toolsSwapShapeFillStroke,
        spreadElement: toolsDistributeLayers,
        customTransform: toolsCustomTransform,
        setShape: setShape,
        "frame.create": frameCreate,
        "frame.mergeShape": frameMergeShape,
        exportImage: toolsExportImage,
        batchExportLayer: batchExportLayer,
        BatchExportSecondLevelLayer: BatchExportSecondLevelLayer,
        bacthExportPsd: bacthExportPsd,
        toolsScaleLayers: toolsScaleLayers,
        toolsAlignLayers: toolsAlignLayers,
        toolsCenterLayersOnCanvas: toolsCenterLayersOnCanvas,
        toolsDistributeLayersEvenly: toolsDistributeLayersEvenly,
        toolsAutoFillForeground: toolsAutoFillForeground,
        toolsSnapShapeAnchors: toolsSnapShapeAnchors,
        toolsApplySmartSnap: toolsApplySmartSnap,
        toolsSwapShapeFillStroke: toolsSwapShapeFillStroke,
        toolsDistributeLayers: toolsDistributeLayers,
        toolsReplaceElements: toolsReplaceElements,
        toolsSwapLayerColors: toolsSwapLayerColors,
        getText: getText,
        pinyin: pinyin,
        toolsEmbedSelectedLayerClipped: toolsEmbedSelectedLayerClipped,
        toolsEmbedLowerVisualContent: toolsEmbedLowerVisualContent,
        toolsEmbedLowerVisualContentV2195: toolsEmbedLowerVisualContent,
        toolsAutoEmbedActiveLayer: toolsAutoEmbedActiveLayer,
        toolsConfigureAutoEmbed: toolsConfigureAutoEmbed,
        toolsEmbedSelectedLayersToGroup: toolsEmbedSelectedLayersToGroup,
        toolsImportImages: toolsImportImages,
        toolsFileSlim: toolsFileSlim,
        "commonTools.fileSlim": commonToolsFileSlim,
        "commonTools.getPsdFiles": commonToolsGetPsdFiles,
        "commonTools.batchSlimFile": commonToolsBatchSlimFile,
        toolsBatchExport: toolsBatchExport,
        toolsExportImage: toolsExportImage,
        toolsBatchExportPsdFolder: toolsBatchExportPsdFolder,
        toolsOpenExportFolder: toolsOpenExportFolder,
        toolsQuickTransform: toolsQuickTransform,
        toolsCustomTransform: toolsCustomTransform,
        toolsCreateDocumentPreset: toolsCreateDocumentPreset,
        toolsGetFonts: toolsGetFonts,
        toolsGetTextInfo: toolsGetTextInfo,
        toolsGetTextSelectionState: toolsGetTextSelectionState,
        toolsGetTypographySnapshot: toolsGetTypographySnapshot,
        toolsGetSelectedTextContents: toolsGetSelectedTextContents,
        toolsApplyTranslatedText: toolsApplyTranslatedText,
        toolsToggleTextDirection: toolsToggleTextDirection,
        toolsTextSpreadElement: toolsTextSpreadElement,
        toolsPickTextColor: toolsPickTextColor,
        toolsPickTextColorV2191: toolsPickTextColor,
        openPhotoshopTextColorPickerV2191: toolsPickTextColor,
        toolsPickTextColorV2192: toolsPickTextColor,
        openPhotoshopTextColorPickerV2192: toolsPickTextColor,
        toolsPickTextColorV2193: toolsPickTextColor,
        openPhotoshopTextColorPickerV2193: toolsPickTextColor,
        toolsApplyTextFormatting: toolsApplyTextFormatting,
        toolsCopyTextStyle: toolsCopyTextStyle,
        toolsPasteTextStyle: toolsPasteTextStyle,
        toolsTextStructure: toolsTextStructure,
        toolsGenerateTextButtons: toolsGenerateTextButtons,
        toolsAutoTextLayout: toolsAutoTextLayout,
        "words.getInfo": toolsGetTextInfo,
        "fontManage.useFont": wordsUseFont,
        "words.setFontColor": wordsSetFontColor,
        "words.setFontBold": wordsSetFontBold,
        "words.setFontItalic": wordsSetFontItalic,
        "words.setFontCaps": wordsSetFontCaps,
        "words.setFontAlign": wordsSetFontAlign,
        "words.setFontSize": wordsSetFontSize,
        "words.setFontLeading": wordsSetFontLeading,
        "words.setLineSpace": wordsSetFontLeading,
        "words.setFontTracking": wordsSetFontTracking,
        "words.setFontAutoKern": wordsSetFontAutoKern,
        "words.copyTextStyle": toolsCopyTextStyle,
        "words.pasteTextStyle": toolsPasteTextStyle,
        "words.textSplitMerge": wordsTextSplitMerge,
        "words.createBtn": wordsCreateBtn,
        "words.textDirection": toolsToggleTextDirection,
        "words.setAlignment": wordsSetAlignment,
        "words.distributionByH": wordsDistributionByH,
        "words.distributionByV": wordsDistributionByV,
        "words.setAlignmentByDocument": wordsSetAlignmentByDocument,
        "words.spreadElement": toolsTextSpreadElement,
        "words.useSmartTypesetting": wordsUseSmartTypesetting,
        "translate.getTextContent": toolsGetSelectedTextContents,
        "translate.textReplace": translateTextReplace,
        "translate.translate2Bottom": translate2Bottom,
        toolsBatchRenameLayers: toolsBatchRenameLayers,
        toolsFindSimilarLayers: toolsFindSimilarLayers,
        toolsApplyRectangleSettings: toolsApplyRectangleSettings,
        toolsSmartObject: toolsSmartObject,
        undoPhotoshop: undoPhotoshop
    };

    function invoke(method, payloadJson) {
        try {
            if (!methods[method]) throw new Error("未知功能：" + method);
            var payload = payloadJson ? parseJson(payloadJson) : {};
            return toJson({
                ok: true,
                data: methods[method](payload)
            });
        } catch (error) {
            var message = error && error.message
                ? error.message
                : String(error);
            if (error && error.line) {
                message += "（脚本第 " + error.line + " 行）";
            }
            return toJson({ ok: false, error: message });
        }
    }

    return {
        version: "2.2.69",
        invoke: invoke,
        _runActiveJob: runActiveJob,
        _runSliceJob: runSliceJob,
        _runSpacingJob: runSpacingJob,
        _runTextJob: runTextJob,
        _runEraseJob: runEraseJob,
        _runToolsJob: runToolsJob
    };
}());
/*
 * Photoshop 的 suspendHistory 会在宿主全局上下文中重新解析回调字符串，
 * 不一定能看到当前 evalFile 代际的顶层 var。显式发布 API，确保拼图、
 * 间距和切片的历史回调都能稳定找到同一个 LongStitchCEP 实例。
 */
$.global.LongStitchCEP = LongStitchCEP;
XinyangHostLoadStage = "host-ready";
} catch (error) {
    var loadErrorMessage = error && error.message
        ? error.message
        : String(error);
    if (error && error.line) {
        loadErrorMessage += "（脚本第 " + error.line + " 行）";
    }
    throw new Error("宿主脚本启动失败[" + XinyangHostLoadStage + "]：" + loadErrorMessage);
}
