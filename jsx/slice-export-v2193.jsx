/* 鑫洋助理 v2.2.69 - 独立 Web 切片/画板/画布导出入口
 * 目的：绕过长期驻留 CEP 会话中的旧 LongStitchCEP 方法表，避免“未知功能”。
 */
var XinyangSliceExportV2193 = (function () {
    function escapeJsonString(value) {
        var escapes = {"\b":"\\b","\t":"\\t","\n":"\\n","\f":"\\f","\r":"\\r","\"":"\\\"","\\":"\\\\"};
        return "\"" + String(value).replace(/[\\\"\u0000-\u001f]/g, function (character) {
            if (escapes[character]) return escapes[character];
            var code = character.charCodeAt(0).toString(16);
            while (code.length < 4) code = "0" + code;
            return "\\u" + code;
        }) + "\"";
    }

    function toJson(value) {
        if (value === null || value === undefined) return "null";
        if (typeof value === "string") return escapeJsonString(value);
        if (typeof value === "number") return isFinite(value) ? String(value) : "null";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (value instanceof Array) {
            var arrayParts = [];
            var index;
            for (index = 0; index < value.length; index += 1) arrayParts.push(toJson(value[index]));
            return "[" + arrayParts.join(",") + "]";
        }
        if (typeof value === "object") {
            var objectParts = [];
            var key;
            for (key in value) {
                if (value.hasOwnProperty(key)) objectParts.push(escapeJsonString(key) + ":" + toJson(value[key]));
            }
            return "{" + objectParts.join(",") + "}";
        }
        return "null";
    }

    function parseJson(value) {
        if (!value) return {};
        if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(value);
        return eval("(" + value + ")");
    }

    function pixels(value) {
        if (value === undefined || value === null) return 0;
        try { return Number(value.as("px")); } catch (ignoreUnit) {}
        return Number(value) || 0;
    }

    function integerValue(value, fallback) {
        var number = Number(value);
        if (!isFinite(number)) return fallback || 0;
        return Math.round(number);
    }

    function activeLayerId() {
        var property = charIDToTypeID("LyrI");
        var reference = new ActionReference();
        reference.putProperty(charIDToTypeID("Prpr"), property);
        reference.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        return executeActionGet(reference).getInteger(property);
    }

    function selectedLayerIds() {
        var ids = [];
        try {
            var property = stringIDToTypeID("targetLayersIDs");
            var reference = new ActionReference();
            reference.putProperty(stringIDToTypeID("property"), property);
            reference.putEnumerated(stringIDToTypeID("document"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var descriptor = executeActionGet(reference);
            if (descriptor.hasKey(property)) {
                var list = descriptor.getList(property);
                var index;
                for (index = 0; index < list.count; index += 1) {
                    ids.push(list.getReference(index).getIdentifier(charIDToTypeID("Lyr ")));
                }
            }
        } catch (ignoreSelectionList) {}
        if (!ids.length) {
            try { ids.push(activeLayerId()); } catch (ignoreActiveLayer) {}
        }
        return ids;
    }

    function selectLayersByIds(ids) {
        if (!(ids instanceof Array) || !ids.length) return;
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var descriptor = new ActionDescriptor();
            var reference = new ActionReference();
            reference.putIdentifier(charIDToTypeID("Lyr "), integerValue(ids[index], -1));
            descriptor.putReference(charIDToTypeID("null"), reference);
            if (index > 0) {
                descriptor.putEnumerated(
                    stringIDToTypeID("selectionModifier"),
                    stringIDToTypeID("selectionModifierType"),
                    stringIDToTypeID("addToSelection")
                );
            }
            descriptor.putBoolean(charIDToTypeID("MkVs"), false);
            executeAction(charIDToTypeID("slct"), descriptor, DialogModes.NO);
        }
    }

    function sliceDescriptorNumber(descriptor, key) {
        try { return descriptor.getInteger(key); } catch (ignoreInteger) {}
        try { return descriptor.getDouble(key); } catch (ignoreDouble) {}
        try { return descriptor.getUnitDoubleValue(key); } catch (ignoreUnitDouble) {}
        return 0;
    }

    function sliceDescriptorEnum(descriptor, key) {
        try {
            var value = descriptor.getEnumerationValue(key);
            var text = typeIDToStringID(value);
            if (text) return text;
            return typeIDToCharID(value);
        } catch (ignoreSliceEnum) {
            return "";
        }
    }

    function collectDocumentSlices(document) {
        var originalDocument = app.activeDocument;
        var output = [];
        try {
            app.activeDocument = document;
            var reference = new ActionReference();
            reference.putEnumerated(stringIDToTypeID("document"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var documentDescriptor = executeActionGet(reference);
            var slicesKey = stringIDToTypeID("slices");
            if (!documentDescriptor.hasKey(slicesKey)) return output;
            var slicesContainer = documentDescriptor.getObjectValue(slicesKey);
            if (!slicesContainer.hasKey(slicesKey)) return output;
            var sliceDescriptors = slicesContainer.getList(slicesKey);
            var index;
            for (index = 0; index < sliceDescriptors.count; index += 1) {
                var current = sliceDescriptors.getObjectValue(index);
                var boundsKey = stringIDToTypeID("bounds");
                if (!current.hasKey(boundsKey)) continue;
                var bounds = current.getObjectValue(boundsKey);
                var item = {
                    id: 0,
                    group: 0,
                    name: "",
                    type: "",
                    origin: "",
                    top: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("top"))),
                    left: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("left"))),
                    bottom: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("bottom"))),
                    right: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("right")))
                };
                try { item.id = current.getInteger(stringIDToTypeID("sliceID")); } catch (ignoreSliceId) {}
                try { item.group = current.getInteger(stringIDToTypeID("groupID")); } catch (ignoreSliceGroup) {}
                try { if (current.hasKey(stringIDToTypeID("name"))) item.name = current.getString(stringIDToTypeID("name")); } catch (ignoreSliceName) {}
                item.type = sliceDescriptorEnum(current, stringIDToTypeID("type"));
                item.origin = sliceDescriptorEnum(current, stringIDToTypeID("origin"));
                if (item.right > item.left && item.bottom > item.top) output.push(item);
            }
        } finally {
            try { app.activeDocument = originalDocument; } catch (ignoreRestoreSliceDocument) {}
        }
        output.sort(function (left, right) {
            return left.top - right.top || left.left - right.left || left.id - right.id;
        });
        return output;
    }

    function sliceDescriptorBounds(descriptor) {
        if (!descriptor) return null;
        var top = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("top")));
        var left = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("left")));
        var bottom = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("bottom")));
        var right = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("right")));
        if (!(right > left && bottom > top)) return null;
        return { top: top, left: left, bottom: bottom, right: right };
    }

    function sliceDescriptorObjectBounds(descriptor, keyName) {
        try {
            var key = stringIDToTypeID(keyName);
            if (!descriptor.hasKey(key)) return null;
            return sliceDescriptorBounds(descriptor.getObjectValue(key));
        } catch (ignoreSliceObjectBounds) {
            return null;
        }
    }

    function sliceArtboardInfo(document, layer, index) {
        if (!layer || layer.typename !== "LayerSet") return null;
        try {
            app.activeDocument = document;
            document.activeLayer = layer;
            var reference = new ActionReference();
            reference.putEnumerated(stringIDToTypeID("layer"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var descriptor = executeActionGet(reference);
            var enabledKey = stringIDToTypeID("artboardEnabled");
            if (!descriptor.hasKey(enabledKey) || !descriptor.getBoolean(enabledKey)) return null;
            var bounds = null;
            var artboardKey = stringIDToTypeID("artboard");
            if (descriptor.hasKey(artboardKey)) {
                try {
                    var artboard = descriptor.getObjectValue(artboardKey);
                    bounds = sliceDescriptorObjectBounds(artboard, "artboardRect");
                    if (!bounds) bounds = sliceDescriptorBounds(artboard);
                } catch (ignoreArtboardObject) {}
            }
            if (!bounds) bounds = sliceDescriptorObjectBounds(descriptor, "artboardRect");
            if (!bounds) bounds = sliceDescriptorObjectBounds(descriptor, "boundsNoEffects");
            if (!bounds) bounds = sliceDescriptorObjectBounds(descriptor, "bounds");
            if (!bounds) {
                try {
                    var domBounds = layer.bounds;
                    bounds = {
                        left: Math.round(pixels(domBounds[0])),
                        top: Math.round(pixels(domBounds[1])),
                        right: Math.round(pixels(domBounds[2])),
                        bottom: Math.round(pixels(domBounds[3]))
                    };
                } catch (ignoreArtboardDomBounds) {}
            }
            if (!bounds || !(bounds.right > bounds.left && bounds.bottom > bounds.top)) return null;
            return {
                index: index,
                id: layer.id || 0,
                name: String(layer.name || ("画板_" + index)),
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom
            };
        } catch (ignoreArtboardDescriptor) {
            return null;
        }
    }

    function collectDocumentArtboards(document) {
        var previousDocument = app.activeDocument;
        var selectedIds = [];
        var output = [];
        try {
            app.activeDocument = document;
            try { selectedIds = selectedLayerIds(); } catch (ignoreSelectedArtboards) {}
            var index;
            for (index = 0; index < document.layers.length; index += 1) {
                var item = sliceArtboardInfo(document, document.layers[index], output.length + 1);
                if (item) output.push(item);
            }
        } finally {
            try {
                app.activeDocument = document;
                if (selectedIds.length) selectLayersByIds(selectedIds);
            } catch (ignoreRestoreArtboardSelection) {}
            try { app.activeDocument = previousDocument; } catch (ignoreRestoreArtboardDocument) {}
        }
        output.sort(function (left, right) {
            return left.top - right.top || left.left - right.left || left.index - right.index;
        });
        return output;
    }

    function sliceIsOnlyAutomaticCanvasSlice(slices, canvasWidth, canvasHeight) {
        if (!slices || slices.length !== 1) return false;
        var item = slices[0];
        return item.left <= 0 && item.top <= 0 && item.right >= canvasWidth && item.bottom >= canvasHeight;
    }

    function sliceSafeFileName(value, fallback) {
        var name = String(value || fallback || "导出");
        name = name.replace(/[\\\/:*?\"<>|]/g, "_");
        name = name.replace(/^\s+|\s+$/g, "").replace(/[\.\s]+$/g, "");
        if (!name) name = String(fallback || "导出");
        if (name.length > 80) name = name.slice(0, 80);
        return name;
    }

    function sliceUniqueOutputFile(folder, baseName, extension) {
        var safeBase = sliceSafeFileName(baseName, "导出");
        var ext = String(extension || "jpg").replace(/^\./, "");
        var file = new File(folder.fsName + "/" + safeBase + "." + ext);
        var serial = 2;
        while (file.exists) {
            file = new File(folder.fsName + "/" + safeBase + "_" + serial + "." + ext);
            serial += 1;
            if (serial > 10000) throw new Error("同名导出文件过多，请清理导出目录");
        }
        return file;
    }

    function fillDocumentWhite(document) {
        var previous = app.backgroundColor;
        try {
            var white = new SolidColor();
            white.rgb.red = 255;
            white.rgb.green = 255;
            white.rgb.blue = 255;
            app.backgroundColor = white;
            document.flatten();
        } finally {
            app.backgroundColor = previous;
        }
    }

    function sliceSaveForWebJpeg(document, outputFile, quality) {
        var exportAllSlices = arguments.length > 3 && !!arguments[3];
        var prepareTemporaryDocument = arguments.length > 4 && !!arguments[4];
        var webQuality = Math.max(55, Math.min(95, Math.round(Number(quality) || 82)));
        /* 当前用户文档只读导出，绝不在导出中改模式、扁平化或转换配置文件。 */
        if (prepareTemporaryDocument) {
            try { if (document.mode !== DocumentMode.RGB) document.changeMode(ChangeMode.RGB); } catch (ignoreSliceWebMode) {}
            try { document.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreSliceWebBits) {}
            fillDocumentWhite(document);
            try { document.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, false); } catch (ignoreSliceWebProfile) {}
        }
        var web = new ExportOptionsSaveForWeb();
        web.format = SaveDocumentType.JPEG;
        web.quality = webQuality;
        web.optimized = true;
        web.includeProfile = false;
        web.interlaced = false;
        web.transparency = false;
        try { web.blur = 0; } catch (ignoreSliceWebBlur) {}
        /*
         * 让 Photoshop 在当前文档上一次性处理全部切片。这样不必为每一
         * 个切片创建、裁切和关闭临时文档，避免导出时不停跳转画布。
         */
        try { web.allSlices = exportAllSlices; } catch (ignoreSliceAllSlices) {}
        document.exportDocument(outputFile, ExportType.SAVEFORWEB, web);
    }

    function clearAllDocumentSlices() {
        var reference = new ActionReference();
        reference.putEnumerated(
            stringIDToTypeID("slice"),
            stringIDToTypeID("ordinal"),
            stringIDToTypeID("allEnum")
        );
        var descriptor = new ActionDescriptor();
        descriptor.putReference(stringIDToTypeID("target"), reference);
        executeAction(stringIDToTypeID("delete"), descriptor, DialogModes.NO);
    }

    function makeSlicesFromGuides() {
        var reference = new ActionReference();
        reference.putClass(stringIDToTypeID("slice"));
        var descriptor = new ActionDescriptor();
        descriptor.putReference(stringIDToTypeID("target"), reference);
        descriptor.putClass(stringIDToTypeID("using"), stringIDToTypeID("guides"));
        executeAction(stringIDToTypeID("make"), descriptor, DialogModes.NO);
    }

    function makeExportSlicesFromGuides(document) {
        var guideCount = 0;
        try { guideCount = document.guides.length; } catch (ignoreReadExportGuides) {}
        if (!guideCount) return { generated: false, guides: 0 };

        /*
         * 旧的用户切片会和“从参考线建立切片”的结果同时存在，正是产生
         * 两套图片的原因。导出前只保留由当前参考线生成的这一套。
         */
        app.activeDocument = document;
        try { clearAllDocumentSlices(); } catch (ignoreClearExportSlices) {}
        makeSlicesFromGuides();
        return { generated: true, guides: guideCount };
    }

    function folderJpegNames(folder) {
        var files = [];
        try { files = folder.getFiles(); } catch (ignoreListJpegs) {}
        var names = [];
        var index;
        for (index = 0; index < files.length; index += 1) {
            if (files[index] instanceof File && /\.(jpg|jpeg)$/i.test(files[index].name)) {
                names.push(files[index].name);
            }
        }
        return names;
    }

    function collectJpegNamesRecursively(folder, prefix) {
        var files = [];
        var names = [];
        var index;
        prefix = prefix || "";
        try { files = folder.getFiles(); } catch (ignoreListNestedJpegs) {}
        for (index = 0; index < files.length; index += 1) {
            var item = files[index];
            if (item instanceof File && /\.(jpg|jpeg)$/i.test(item.name)) {
                names.push(prefix + item.name);
            } else if (item instanceof Folder) {
                names = names.concat(collectJpegNamesRecursively(item, prefix + item.name + "/"));
            }
        }
        return names;
    }

    function promoteSaveForWebSliceFiles(exportFolder) {
        /*
         * Photoshop 的 allSlices 选项固定把结果放进 images 子目录。
         * 当前批次目录由本次导出新建，可安全将 JPG 提升一级；复制成功
         * 后才删除原文件，避免异常时丢失切片。
         */
        var imagesFolder = new Folder(exportFolder.fsName + "/images");
        var promoted = [];
        if (!imagesFolder.exists) return promoted;
        var files = [];
        try { files = imagesFolder.getFiles(); } catch (ignoreListSliceImages) {}
        var index;
        for (index = 0; index < files.length; index += 1) {
            var sourceFile = files[index];
            if (!(sourceFile instanceof File) || !/\.(jpg|jpeg)$/i.test(sourceFile.name)) continue;
            var targetFile = sliceUniqueOutputFile(exportFolder, sourceFile.name.replace(/\.[^.]+$/, ""), "jpg");
            if (!sourceFile.copy(targetFile.fsName)) {
                throw new Error("无法整理导出的切片文件：" + sourceFile.name);
            }
            if (!sourceFile.remove()) {
                throw new Error("已复制切片，但无法删除临时文件：" + sourceFile.name);
            }
            promoted.push(targetFile.name);
        }
        try {
            if (!imagesFolder.getFiles().length) imagesFolder.remove();
        } catch (ignoreRemoveSliceImagesFolder) {}
        return promoted;
    }

    function getDefaultFolder() {
        var folder = null;
        var source = "desktop";
        if (app.documents.length) {
            var document = app.activeDocument;
            try {
                if (document.path && document.path.exists) {
                    folder = document.path;
                    source = "document";
                }
            } catch (ignoreUnsavedDocumentPath) {}
        }
        if (!folder) folder = Folder.desktop;
        return { path: folder.fsName, source: source };
    }

    function exportAssets(options) {
        if (!app.documents.length) throw new Error("请先打开需要导出的 Photoshop 文档");
        options = options || {};
        var webQuality = Math.max(55, Math.min(95, Math.round(Number(options.quality) || 82)));
        var folderPath = String(options.folder || options.path || "").replace(/^\s+|\s+$/g, "");
        if (!folderPath) throw new Error("请选择导出文件夹");
        var selectedFolder = new Folder(folderPath);
        if (!selectedFolder.exists && !selectedFolder.create()) throw new Error("无法创建所选导出文件夹：" + selectedFolder.fsName);

        var sourceDocument = app.activeDocument;
        var selectedIds = [];
        try { selectedIds = selectedLayerIds(); } catch (ignoreReadSelection) {}
        var canvasWidth = Math.max(1, Math.round(pixels(sourceDocument.width)));
        var canvasHeight = Math.max(1, Math.round(pixels(sourceDocument.height)));
        var artboards = collectDocumentArtboards(sourceDocument);
        var slices = [];
        var sliceReadFallback = false;
        var guideSliceInfo = { generated: false, guides: 0 };
        if (!artboards.length) {
            guideSliceInfo = makeExportSlicesFromGuides(sourceDocument);
            try { slices = collectDocumentSlices(sourceDocument) || []; }
            catch (ignoreCollectDocumentSlices) { slices = []; sliceReadFallback = true; }
        }
        var mode = "slices";
        if (artboards.length) mode = "artboards";
        else if (!slices.length || sliceIsOnlyAutomaticCanvasSlice(slices, canvasWidth, canvasHeight)) {
            mode = "canvas";
            slices = [];
        }

        var baseExportFolderName = mode === "artboards"
            ? "画板导出"
            : (canvasWidth === 790 ? "详情页切片" : (canvasWidth === 1920 ? "首页切片" : "切片"));
        var exportFolderName = baseExportFolderName;
        var exportFolder = new Folder(selectedFolder.fsName + "/" + exportFolderName);
        var folderSerial = 2;
        while (exportFolder.exists) {
            exportFolderName = baseExportFolderName + "_" + folderSerial;
            exportFolder = new Folder(selectedFolder.fsName + "/" + exportFolderName);
            folderSerial += 1;
            if (folderSerial > 10000) throw new Error("同名导出文件夹过多，请更换导出位置");
        }
        if (!exportFolder.create()) throw new Error("无法创建导出文件夹：" + exportFolder.fsName);

        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        var flattenedSource = null;
        var outputDocument = null;
        var exportedFiles = [];
        try {
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;

            var index;
            if (mode === "canvas") {
                app.activeDocument = sourceDocument;
                var canvasFile = sliceUniqueOutputFile(exportFolder, "画布", "jpg");
                sliceSaveForWebJpeg(sourceDocument, canvasFile, webQuality, false);
                exportedFiles.push(canvasFile.name);
            } else if (mode === "artboards") {
                flattenedSource = sourceDocument.duplicate("__鑫洋Web导出源_v2193__", true);
                try { if (flattenedSource.mode !== DocumentMode.RGB) flattenedSource.changeMode(ChangeMode.RGB); } catch (ignoreSliceExportMode) {}
                try { flattenedSource.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreSliceExportBits) {}
                for (index = 0; index < artboards.length; index += 1) {
                    var board = artboards[index];
                    if (!(board.right > board.left && board.bottom > board.top)) continue;
                    app.activeDocument = flattenedSource;
                    outputDocument = flattenedSource.duplicate("__画板_" + (index + 1) + "__", true);
                    outputDocument.crop([
                        UnitValue(board.left, "px"), UnitValue(board.top, "px"),
                        UnitValue(board.right, "px"), UnitValue(board.bottom, "px")
                    ]);
                    var boardFile = sliceUniqueOutputFile(exportFolder, sliceSafeFileName(board.name, "画板_" + (index + 1)), "jpg");
                    sliceSaveForWebJpeg(outputDocument, boardFile, webQuality, false, true);
                    exportedFiles.push(boardFile.name);
                    outputDocument.close(SaveOptions.DONOTSAVECHANGES);
                    outputDocument = null;
                }
            } else {
                /*
                 * 不使用 Save for Web 的 allSlices 分支。该分支在部分新版
                 * Photoshop 中会影响原生“导出 Web 所用格式”面板。只创建一
                 * 个临时副本，在同一历史基线中裁切、导出、回退，避免反复开关
                 * 新画布，也不生成 images 子目录。
                 */
                flattenedSource = sourceDocument.duplicate("__鑫洋切片导出源__", true);
                try { if (flattenedSource.mode !== DocumentMode.RGB) flattenedSource.changeMode(ChangeMode.RGB); } catch (ignoreSliceExportMode) {}
                try { flattenedSource.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreSliceExportBits) {}
                fillDocumentWhite(flattenedSource);
                try { flattenedSource.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, false); } catch (ignoreSliceExportProfile) {}
                var sliceBaseHistory = flattenedSource.activeHistoryState;
                for (index = 0; index < slices.length; index += 1) {
                    var item = slices[index];
                    var left = Math.max(0, Math.min(canvasWidth - 1, item.left));
                    var top = Math.max(0, Math.min(canvasHeight - 1, item.top));
                    var right = Math.max(left + 1, Math.min(canvasWidth, item.right));
                    var bottom = Math.max(top + 1, Math.min(canvasHeight, item.bottom));
                    if (!(right > left && bottom > top)) continue;
                    app.activeDocument = flattenedSource;
                    flattenedSource.crop([
                        UnitValue(left, "px"), UnitValue(top, "px"),
                        UnitValue(right, "px"), UnitValue(bottom, "px")
                    ]);
                    var outputFile = sliceUniqueOutputFile(exportFolder, "切片_" + (exportedFiles.length + 1), "jpg");
                    sliceSaveForWebJpeg(flattenedSource, outputFile, webQuality, false, false);
                    exportedFiles.push(outputFile.name);
                    flattenedSource.activeHistoryState = sliceBaseHistory;
                }
            }

            if (!exportedFiles.length) throw new Error(mode === "artboards" ? "没有识别到可导出的有效画板" : "没有导出任何图片");
            return {
                count: exportedFiles.length,
                folder: exportFolder.fsName,
                files: exportedFiles.slice(0, 50),
                mode: mode,
                format: "jpg",
                quality: webQuality,
                sourceFolder: selectedFolder.fsName,
                sliceReadFallback: sliceReadFallback,
                generatedFromGuides: guideSliceInfo.generated,
                guideCount: guideSliceInfo.guides
            };
        } finally {
            if (outputDocument) { try { outputDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseSliceOutput) {} }
            if (flattenedSource) { try { flattenedSource.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseFlattenedSource) {} }
            try {
                app.activeDocument = sourceDocument;
                if (selectedIds.length) selectLayersByIds(selectedIds);
            } catch (ignoreRestoreSourceDocument) {}
            app.preferences.rulerUnits = previousUnits;
            app.displayDialogs = previousDialogs;
        }
    }

    function invoke(action, payloadJson) {
        try {
            var payload = parseJson(payloadJson);
            var data;
            if (action === "defaultFolder") data = getDefaultFolder();
            else if (action === "export") data = exportAssets(payload);
            else throw new Error("未知独立导出操作：" + action);
            return toJson({ ok: true, data: data });
        } catch (error) {
            var message = error && error.message ? error.message : String(error);
            if (error && error.line) message += "（脚本第 " + error.line + " 行）";
            return toJson({ ok: false, error: message });
        }
    }

    return {
        version: "2.2.69",
        invoke: invoke
    };
}());
