/* 鑫洋助理 ExtendScript 模块：fileExport（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.fileExport = function (deps) {
    deps = deps || {};
    var layerSize = deps.layerSize;
    var integerValue = deps.integerValue;
    var selectedLayerIds = deps.selectedLayerIds;
    var selectLayersByIds = deps.selectLayersByIds;
    var placeEmbedded = deps.placeEmbedded;
    var suspendToolsHistory = deps.suspendToolsHistory;
    var toolFloatValue = deps.toolFloatValue;
    var toolLayerById = deps.toolLayerById;
    var toolLayerIsEmpty = deps.toolLayerIsEmpty;
    var toolLayerOutsideCanvas = deps.toolLayerOutsideCanvas;
    var toolMoveLayerCenterTo = deps.toolMoveLayerCenterTo;

    function normalizeFileSlimOptions(options) {
        options = options || {};
        var removeEmpty = options.removeEmptyLayer === true;
        return {
            metadata: options.metadata === true || options.slimSmartObject === true,
            emptyLayers: options.emptyLayers === true || removeEmpty,
            emptyGroups: options.emptyGroups === true || removeEmpty,
            hiddenLayers: options.hiddenLayers === true || options.removeHideLayer === true,
            outsideLayers: options.outsideLayers === true,
            saveDocument: options.saveDocument === true,
            batchMode: options.batchMode === true
        };
    }

    function toolsFileSlim(options) {
        if (!app.documents.length) {
            throw new Error("请先打开需要清理的 Photoshop 文档");
        }

        options = normalizeFileSlimOptions(options || {});
        var cleanMetadata = options.metadata === true;
        var cleanLayers = options.emptyLayers === true ||
            options.emptyGroups === true ||
            options.hiddenLayers === true ||
            options.outsideLayers === true;
        if (!cleanMetadata && !cleanLayers) {
            throw new Error("请至少选择一个清理项目");
        }

        var mainDocument = app.activeDocument;
        var report = {
            emptyLayers: 0,
            emptyGroups: 0,
            hiddenLayers: 0,
            outsideLayers: 0,
            removed: 0,
            documents: 0,
            smartObjects: 0,
            skipped: 0,
            smartObjectNames: [],
            errors: [],
            metadataCleaned: false,
            mainDocumentSaved: false
        };
        var MAX_DEEP_CLEAN_DEPTH = 32;

        function removeOne(layer, key) {
            try {
                layer.remove();
                report[key] += 1;
                report.removed += 1;
                return true;
            } catch (ignoreRemove) {
                return false;
            }
        }

        function walkForLayerCleanup(container) {
            var index;
            for (index = container.layers.length - 1; index >= 0; index -= 1) {
                var layer = container.layers[index];
                if (options.hiddenLayers && !layer.visible) {
                    removeOne(layer, "hiddenLayers");
                    continue;
                }
                if (layer.typename === "LayerSet") {
                    walkForLayerCleanup(layer);
                    if (options.emptyGroups && layer.layers.length === 0) {
                        removeOne(layer, "emptyGroups");
                    }
                    continue;
                }
                if (options.outsideLayers && toolLayerOutsideCanvas(mainDocument, layer)) {
                    removeOne(layer, "outsideLayers");
                    continue;
                }
                if (options.emptyLayers && toolLayerIsEmpty(layer)) {
                    removeOne(layer, "emptyLayers");
                }
            }
        }

        function ensureXMPScript() {
            if (ExternalObject.AdobeXMPScript === undefined) {
                ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
            }
            if (ExternalObject.AdobeXMPScript === undefined) {
                throw new Error("无法载入 AdobeXMPScript");
            }
        }

        function cleanDocumentMetadata(document) {
            var xmp = new XMPMeta(document.xmpMetadata.rawData);
            xmp.deleteProperty(XMPConst.NS_PHOTOSHOP, "DocumentAncestors");
            document.xmpMetadata.rawData = xmp.serialize();
            report.documents += 1;
        }

        function layerSnapshot(container) {
            var output = [];
            var index;
            for (index = 0; index < container.layers.length; index += 1) {
                output.push(container.layers[index]);
            }
            return output;
        }

        function clearDocumentAncestorsForAllLayers(document, container, depth) {
            if (!container) return;
            if (depth > MAX_DEEP_CLEAN_DEPTH) {
                throw new Error("智能对象嵌套超过 " + MAX_DEEP_CLEAN_DEPTH + " 层，已停止以避免循环");
            }

            var layers = layerSnapshot(container);
            var index;
            for (index = 0; index < layers.length; index += 1) {
                var currentLayer = layers[index];
                if (currentLayer.typename === "LayerSet") {
                    clearDocumentAncestorsForAllLayers(document, currentLayer, depth);
                    continue;
                }
                if (currentLayer.typename !== "ArtLayer" || currentLayer.kind !== LayerKind.SMARTOBJECT) {
                    continue;
                }

                var smartObjectName = String(currentLayer.name || "未命名智能对象");
                var openedDocument = null;
                try {
                    app.activeDocument = document;
                    document.activeLayer = currentLayer;
                    executeAction(
                        stringIDToTypeID("placedLayerEditContents"),
                        new ActionDescriptor(),
                        DialogModes.NO
                    );
                    if (app.activeDocument === document) {
                        report.skipped += 1;
                        continue;
                    }

                    openedDocument = app.activeDocument;
                    cleanDocumentMetadata(openedDocument);
                    clearDocumentAncestorsForAllLayers(
                        openedDocument,
                        openedDocument,
                        depth + 1
                    );
                    openedDocument.close(SaveOptions.SAVECHANGES);
                    openedDocument = null;
                    report.smartObjects += 1;
                    report.smartObjectNames.push(smartObjectName);
                } catch (smartObjectError) {
                    report.skipped += 1;
                    report.errors.push(
                        smartObjectName + "：" +
                        (smartObjectError && smartObjectError.message
                            ? smartObjectError.message
                            : String(smartObjectError))
                    );
                    try {
                        if (openedDocument && app.activeDocument === openedDocument) {
                            openedDocument.close(SaveOptions.DONOTSAVECHANGES);
                        } else if (app.activeDocument !== document) {
                            app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
                        }
                    } catch (ignoreCloseFailedSmartObject) {}
                } finally {
                    try {
                        app.activeDocument = document;
                    } catch (ignoreReactivateParentDocument) {}
                }
            }
        }

        if (cleanMetadata) {
            ensureXMPScript();
        }

        if (cleanLayers) {
            suspendToolsHistory(
                mainDocument,
                "鑫洋助理：文件瘦身图层清理",
                function () {
                    walkForLayerCleanup(mainDocument);
                    return report;
                }
            );
        }

        if (cleanMetadata) {
            app.activeDocument = mainDocument;
            cleanDocumentMetadata(mainDocument);
            clearDocumentAncestorsForAllLayers(mainDocument, mainDocument, 0);
            app.activeDocument = mainDocument;
            report.metadataCleaned = true;
        }

        if (cleanMetadata || options.saveDocument) {
            try {
                app.activeDocument = mainDocument;
                mainDocument.save();
                report.mainDocumentSaved = true;
            } catch (saveError) {
                report.errors.push(
                    "保存文档失败：" +
                    (saveError && saveError.message ? saveError.message : String(saveError))
                );
                if (options.batchMode) throw saveError;
            }
        }

        if (report.errors.length) {
            report.errorSummary = report.errors.join("\n");
        }
        return report;
    }

    function commonToolsFileSlim(options) {
        return toolsFileSlim(normalizeFileSlimOptions(options || {}));
    }

    function commonToolsGetPsdFiles() {
        var filter = /windows/i.test(String($.os || ""))
            ? "Photoshop 文档:*.psd;*.psb"
            : function (item) {
                return item instanceof Folder ||
                    (item instanceof File && /\.(psd|psb)$/i.test(item.name));
            };
        var files = File.openDialog(
            "选择需要批量优化的 PSD/PSB 文档",
            filter,
            true
        );
        if (!files) return [];
        if (!(files instanceof Array)) files = [files];
        var output = [];
        var index;
        for (index = 0; index < files.length; index += 1) {
            if (files[index] instanceof File && /\.(psd|psb)$/i.test(files[index].name)) {
                output.push(files[index].fsName);
            }
        }
        return output;
    }

    function commonToolsBatchSlimFile(options) {
        options = options || {};
        var inputFile = new File(String(options.filePath || ""));
        if (!inputFile.exists) {
            throw new Error("PSD/PSB 文件不存在：" + inputFile.fsName);
        }

        var previousDialogs = app.displayDialogs;
        var previousDocument = app.documents.length ? app.activeDocument : null;
        var openedDocument = null;
        try {
            app.displayDialogs = DialogModes.NO;
            openedDocument = app.open(inputFile);
            var slimOptions = normalizeFileSlimOptions(options.param || options.options || {});
            slimOptions.saveDocument = true;
            slimOptions.batchMode = true;
            var result = toolsFileSlim(slimOptions);
            result.filePath = inputFile.fsName;
            try {
                openedDocument.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreCloseSlimmedDocument) {}
            openedDocument = null;
            return result;
        } catch (batchSlimError) {
            if (openedDocument) {
                try { openedDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseFailedSlimDocument) {}
            }
            throw batchSlimError;
        } finally {
            app.displayDialogs = previousDialogs;
            if (previousDocument) {
                try { app.activeDocument = previousDocument; } catch (ignoreRestorePreviousDocument) {}
            }
        }
    }

    function safeExportName(value, fallback) {
        var text = String(value || "")
            .replace(/[\\\/:*?\"<>|]/g, "_")
            .replace(/^\s+|\s+$/g, "");
        return text || fallback || "导出";
    }

    function toolDocumentBaseName(document) {
        return safeExportName(String(document && document.name || "当前文档").replace(/\.[^.]+$/, ""), "当前文档");
    }

    function uniqueExportFile(folder, name, extension) {
        var safeName = safeExportName(name, "导出");
        var file = new File(folder.fsName + "/" + safeName + "." + extension);
        var index = 2;
        while (file.exists) {
            file = new File(folder.fsName + "/" + safeName + "_" + index + "." + extension);
            index += 1;
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

    function toolNormalizeExportFormat(value) {
        var format = String(value || "png").toLowerCase();
        if (format === "jpeg") format = "jpg";
        if (format !== "jpg" && format !== "psd") format = "png";
        return format;
    }

    function saveToolDocument(document, file, format, quality) {
        format = toolNormalizeExportFormat(format);
        if (format !== "psd") {
            try { if (document.mode !== DocumentMode.RGB) document.changeMode(ChangeMode.RGB); } catch (ignoreExportMode) {}
            try { document.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreExportBits) {}
        }
        if (format === "jpg") {
            fillDocumentWhite(document);
            var jpeg = new JPEGSaveOptions();
            jpeg.quality = Math.max(1, Math.min(12, Math.round(Math.max(1, Math.min(100, Number(quality) || 90)) * 12 / 100)));
            jpeg.embedColorProfile = true;
            jpeg.formatOptions = FormatOptions.STANDARDBASELINE;
            document.saveAs(file, jpeg, true, Extension.LOWERCASE);
            return;
        }
        if (format === "psd") {
            var psd = new PhotoshopSaveOptions();
            psd.layers = true;
            psd.embedColorProfile = true;
            document.saveAs(file, psd, true, Extension.LOWERCASE);
            return;
        }
        var png = new PNGSaveOptions();
        png.interlaced = false;
        document.saveAs(file, png, true, Extension.LOWERCASE);
    }

    function saveToolDocumentAdvanced(document, file, options) {
        options = options || {};
        var format = toolNormalizeExportFormat(options.format || options.ext);
        var quality = Math.max(1, Math.min(100, Number(options.quality) || 100));
        var saveType = integerValue(options.saveType, 0);
        if (format === "psd" || saveType === 1) {
            saveToolDocument(document, file, format, quality);
            return;
        }
        try { if (document.mode !== DocumentMode.RGB) document.changeMode(ChangeMode.RGB); } catch (ignoreWebMode) {}
        try { document.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreWebBits) {}
        if (format === "jpg") fillDocumentWhite(document);
        var web = new ExportOptionsSaveForWeb();
        web.format = format === "jpg" ? SaveDocumentType.JPEG : SaveDocumentType.PNG;
        web.includeProfile = true;
        web.interlaced = false;
        web.optimized = true;
        if (format === "jpg") {
            web.quality = quality;
        } else {
            web.PNG8 = String(options.pngMode || (options.isPng24 === false ? "8" : "24")) === "8" || options.png24 === false || options.isPng24 === false;
            web.transparency = true;
            if (web.PNG8) web.colors = 256;
        }
        document.exportDocument(file, ExportType.SAVEFORWEB, web);
    }

    function toolResolveExportFolder(options, document) {
        options = options || {};
        var explicitPath = String(options.path || options.folder || "").replace(/^\s+|\s+$/g, "");
        var folder = null;
        if (explicitPath) {
            folder = new Folder(explicitPath);
        } else if (String(options.pathType || "desktop") === "originFilePath") {
            try { folder = document.path; } catch (ignoreDocumentPath) {
                throw new Error("当前文档尚未保存，无法使用文件所在目录");
            }
        } else {
            folder = Folder.desktop;
        }
        if (!folder.exists && !folder.create()) throw new Error("无法创建导出目录：" + folder.fsName);
        return folder;
    }

    function toolExportName(options, fallback, index, layer) {
        options = options || {};
        var base = "";
        if (options.layerName && layer) base = String(layer.name || "");
        if (!base) base = String(options.fileName || "");
        if (!base) base = String(fallback || "导出");
        base = safeExportName(base, fallback || "导出");
        if (options.autoNumber) {
            var serial = Math.max(1, integerValue(index, 1));
            base += "_" + (serial < 10 ? "0" : "") + serial;
        }
        return base;
    }

    function toolResizeExportDocument(document, options) {
        var width = toolFloatValue(options && (options.width !== undefined ? options.width : options.compress_width), 0);
        var height = toolFloatValue(options && (options.height !== undefined ? options.height : options.compress_height), 0);
        if (!(width > 0) && !(height > 0)) return false;
        var currentWidth = document.width.as("px");
        var currentHeight = document.height.as("px");
        if (!(width > 0)) width = currentWidth * height / currentHeight;
        if (!(height > 0)) height = currentHeight * width / currentWidth;
        document.resizeImage(UnitValue(Math.max(1, width), "px"), UnitValue(Math.max(1, height), "px"), null, ResampleMethod.BICUBICSHARPER);
        return true;
    }

    function toolAddExportWatermark(document, options) {
        var path = String(options && options.watermark || "").replace(/^\s+|\s+$/g, "");
        if (!path) return false;
        var file = new File(path);
        if (!file.exists) throw new Error("水印文件不存在，请重新选择");
        var layer = placeEmbedded(document, file);
        layer.name = "水印";
        var box = layerSize(layer);
        var canvasWidth = document.width.as("px");
        var canvasHeight = document.height.as("px");
        var maxWidth = canvasWidth * 0.25;
        var maxHeight = canvasHeight * 0.25;
        if (box.width > 0 && box.height > 0) {
            var scale = Math.min(100, maxWidth / box.width * 100, maxHeight / box.height * 100);
            if (scale > 0 && scale < 100) layer.resize(scale, scale, AnchorPosition.MIDDLECENTER);
        }
        box = layerSize(layer);
        var margin = Math.max(8, Math.min(canvasWidth, canvasHeight) * 0.02);
        toolMoveLayerCenterTo(layer, canvasWidth - margin - box.width / 2, canvasHeight - margin - box.height / 2);
        return true;
    }

    function toolPrepareExportDocument(document, options) {
        toolResizeExportDocument(document, options || {});
        toolAddExportWatermark(document, options || {});
    }

    function newExportDocument(source, name) {
        return app.documents.add(source.width, source.height, source.resolution, name, NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
    }

    function toolSavePreparedExport(document, folder, name, options) {
        var format = toolNormalizeExportFormat(options && (options.format || options.ext));
        var file = uniqueExportFile(folder, name, format);
        saveToolDocumentAdvanced(document, file, options || {});
        return file.fsName;
    }

    function exportOneLayer(source, layer, folder, options, index) {
        options = options || {};
        var name = toolExportName(options, safeExportName(layer.name, "图层" + index), index, layer);
        var temp = newExportDocument(source, "__鑫洋导出_" + name);
        var files = [];
        try {
            app.activeDocument = source;
            var duplicatedLayer = layer.duplicate(temp, ElementPlacement.PLACEATBEGINNING);
            app.activeDocument = temp;
            try { duplicatedLayer.visible = true; } catch (ignoreExportVisibility) {}
            try { temp.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (ignoreTrim) {}
            if (options.exportOriginImage || options.originImage) {
                var origin = temp.duplicate("__鑫洋导出原图_" + name);
                try {
                    app.activeDocument = origin;
                    files.push(toolSavePreparedExport(origin, folder, name + "_原图", {
                        format: options.format || options.ext,
                        quality: options.quality,
                        pngMode: options.pngMode,
                        png24: options.png24,
                        isPng24: options.isPng24,
                        saveType: options.saveType
                    }));
                } finally {
                    origin.close(SaveOptions.DONOTSAVECHANGES);
                    app.activeDocument = temp;
                }
            }
            toolPrepareExportDocument(temp, options);
            files.push(toolSavePreparedExport(temp, folder, name, options));
            return files;
        } finally {
            try { temp.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseExport) {}
            app.activeDocument = source;
        }
    }

    function toolExportDocument(source, folder, options, index) {
        options = options || {};
        var fallback = toolDocumentBaseName(source);
        var name = toolExportName(options, fallback, index || 1, null);
        var duplicate = source.duplicate("__鑫洋导出文档_" + name);
        var files = [];
        try {
            app.activeDocument = duplicate;
            if (options.exportOriginImage || options.originImage) {
                var origin = duplicate.duplicate("__鑫洋导出原图_" + name);
                try {
                    app.activeDocument = origin;
                    files.push(toolSavePreparedExport(origin, folder, name + "_原图", {
                        format: options.format || options.ext,
                        quality: options.quality,
                        pngMode: options.pngMode,
                        png24: options.png24,
                        isPng24: options.isPng24,
                        saveType: options.saveType
                    }));
                } finally {
                    origin.close(SaveOptions.DONOTSAVECHANGES);
                    app.activeDocument = duplicate;
                }
            }
            toolPrepareExportDocument(duplicate, options);
            files.push(toolSavePreparedExport(duplicate, folder, name, options));
            return files;
        } finally {
            try { duplicate.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseDocumentExport) {}
            app.activeDocument = source;
        }
    }

    function toolLayerIsArtboard(document, layer) {
        try {
            document.activeLayer = layer;
            var property = stringIDToTypeID("artboardEnabled");
            var reference = new ActionReference();
            reference.putProperty(stringIDToTypeID("property"), property);
            reference.putEnumerated(stringIDToTypeID("layer"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var descriptor = executeActionGet(reference);
            return descriptor.hasKey(property) && descriptor.getBoolean(property);
        } catch (ignoreArtboardCheck) { return false; }
    }

    function toolSecondLevelLayers(document) {
        var output = [];
        var topIndex, childIndex;
        for (topIndex = 0; topIndex < document.layers.length; topIndex += 1) {
            var topLayer = document.layers[topIndex];
            if (topLayer.typename !== "LayerSet") continue;
            for (childIndex = 0; childIndex < topLayer.layers.length; childIndex += 1) output.push(topLayer.layers[childIndex]);
        }
        return output;
    }

    function toolsExportImage(options) {
        if (!app.documents.length) throw new Error("请先打开需要导出的 Photoshop 文档");
        var document = app.activeDocument;
        var folder = toolResolveExportFolder(options || {}, document);
        var previousDialogs = app.displayDialogs;
        var files = [];
        try {
            app.displayDialogs = DialogModes.NO;
            files = toolExportDocument(document, folder, options || {}, 1);
            if (options && (options.autoOpenFolder || options.openFolder)) {
                try { folder.execute(); } catch (ignoreOpenSingleFolder) {}
            }
            return { exported: files.length, files: files, folder: folder.fsName, format: toolNormalizeExportFormat(options && (options.format || options.ext)) };
        } finally {
            try { app.activeDocument = document; } catch (ignoreSingleExportRestore) {}
            app.displayDialogs = previousDialogs;
        }
    }

    function toolsBatchExport(options) {
        if (!app.documents.length) throw new Error("请先打开需要导出的 Photoshop 文档");
        options = options || {};
        var document = app.activeDocument;
        var folder = toolResolveExportFolder(options, document);
        var target = String(options.target || "selected");
        if (target !== "document" && target !== "topLevel" && target !== "secondLevel" && target !== "artboards") target = "selected";
        var previousDialogs = app.displayDialogs;
        var previousDocument = app.activeDocument;
        var selectedIds = selectedLayerIds();
        var files = [];
        try {
            app.displayDialogs = DialogModes.NO;
            if (target === "document") {
                files = files.concat(toolExportDocument(document, folder, options, 1));
            } else if (target === "selected") {
                if (!selectedIds.length) throw new Error("请先选择需要导出的图层");
                var selectedIndex;
                for (selectedIndex = 0; selectedIndex < selectedIds.length; selectedIndex += 1) {
                    files = files.concat(exportOneLayer(document, toolLayerById(document, selectedIds[selectedIndex]), folder, options, selectedIndex + 1));
                }
                selectLayersByIds(selectedIds);
            } else {
                var candidates = [];
                var layerIndex;
                if (target === "secondLevel") {
                    candidates = toolSecondLevelLayers(document);
                } else {
                    for (layerIndex = 0; layerIndex < document.layers.length; layerIndex += 1) {
                        var topLayer = document.layers[layerIndex];
                        if (target === "artboards") {
                            if (toolLayerIsArtboard(document, topLayer)) candidates.push(topLayer);
                        } else candidates.push(topLayer);
                    }
                }
                if (!candidates.length) {
                    throw new Error(target === "artboards" ? "当前文档没有可导出的画板" : target === "secondLevel" ? "当前文档没有可导出的二级图层" : "当前文档没有可导出的一级图层");
                }
                for (layerIndex = 0; layerIndex < candidates.length; layerIndex += 1) {
                    files = files.concat(exportOneLayer(document, candidates[layerIndex], folder, options, layerIndex + 1));
                }
            }
            if (options.autoOpenFolder || options.openFolder) {
                try { folder.execute(); } catch (ignoreOpenExportFolder) {}
            }
            return { exported: files.length, files: files, folder: folder.fsName, format: toolNormalizeExportFormat(options.format || options.ext), target: target };
        } finally {
            try {
                app.activeDocument = previousDocument;
                if (selectedIds.length) selectLayersByIds(selectedIds);
            } catch (ignoreExportRestore) {}
            app.displayDialogs = previousDialogs;
        }
    }

    function toolsBatchExportPsdFolder(options) {
        options = options || {};
        var sourceFolder = new Folder(String(options.sourceFolder || ""));
        if (!sourceFolder.exists) throw new Error("请选择包含 PSD/PSB 的有效文件夹");
        var sourceFiles = sourceFolder.getFiles(function (item) {
            return item instanceof File && /\.(psd|psb)$/i.test(item.name);
        });
        if (!sourceFiles.length) throw new Error("所选文件夹中没有 PSD 或 PSB 文件");
        var previousDialogs = app.displayDialogs;
        var previousDocument = app.documents.length ? app.activeDocument : null;
        var exported = 0;
        var documents = 0;
        var files = [];
        var errors = [];
        try {
            app.displayDialogs = DialogModes.NO;
            var index;
            for (index = 0; index < sourceFiles.length; index += 1) {
                var opened = null;
                try {
                    opened = app.open(sourceFiles[index]);
                    documents += 1;
                    var perDocument = {};
                    var key;
                    for (key in options) if (options.hasOwnProperty(key)) perDocument[key] = options[key];
                    perDocument.autoOpenFolder = false;
                    perDocument.openFolder = false;
                    if (!perDocument.path && !perDocument.folder && String(perDocument.pathType || "") === "originFilePath") perDocument.path = sourceFolder.fsName;
                    var outputFolder = toolResolveExportFolder(perDocument, opened);
                    var output = toolExportDocument(opened, outputFolder, perDocument, index + 1);
                    exported += output.length;
                    files = files.concat(output);
                } catch (batchError) {
                    errors.push(sourceFiles[index].name + "：" + (batchError && batchError.message ? batchError.message : String(batchError)));
                } finally {
                    if (opened) {
                        try { opened.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseBatchPsd) {}
                    }
                }
            }
            var finalFolder = null;
            try { finalFolder = files.length ? new File(files[0]).parent : toolResolveExportFolder(options, previousDocument || app.activeDocument); } catch (ignoreFinalFolder) {}
            if ((options.autoOpenFolder || options.openFolder) && finalFolder) {
                try { finalFolder.execute(); } catch (ignoreOpenBatchPsdFolder) {}
            }
            if (!exported) throw new Error("没有成功导出任何 PSD；" + errors.join("\n"));
            return { documents: documents, exported: exported, files: files, errors: errors, folder: finalFolder ? finalFolder.fsName : "" };
        } finally {
            try { if (previousDocument) app.activeDocument = previousDocument; } catch (ignoreRestoreBatchPsd) {}
            app.displayDialogs = previousDialogs;
        }
    }

    function toolsOpenExportFolder(options) {
        if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
        var folder = toolResolveExportFolder(options || {}, app.activeDocument);
        if (!folder.execute()) throw new Error("无法打开导出目录");
        return { folder: folder.fsName };
    }

    return {
        normalizeFileSlimOptions: normalizeFileSlimOptions,
        toolsFileSlim: toolsFileSlim,
        commonToolsFileSlim: commonToolsFileSlim,
        commonToolsGetPsdFiles: commonToolsGetPsdFiles,
        commonToolsBatchSlimFile: commonToolsBatchSlimFile,
        safeExportName: safeExportName,
        toolDocumentBaseName: toolDocumentBaseName,
        uniqueExportFile: uniqueExportFile,
        fillDocumentWhite: fillDocumentWhite,
        toolNormalizeExportFormat: toolNormalizeExportFormat,
        saveToolDocument: saveToolDocument,
        saveToolDocumentAdvanced: saveToolDocumentAdvanced,
        toolResolveExportFolder: toolResolveExportFolder,
        toolExportName: toolExportName,
        toolResizeExportDocument: toolResizeExportDocument,
        toolAddExportWatermark: toolAddExportWatermark,
        toolPrepareExportDocument: toolPrepareExportDocument,
        newExportDocument: newExportDocument,
        toolSavePreparedExport: toolSavePreparedExport,
        exportOneLayer: exportOneLayer,
        toolExportDocument: toolExportDocument,
        toolLayerIsArtboard: toolLayerIsArtboard,
        toolSecondLevelLayers: toolSecondLevelLayers,
        toolsExportImage: toolsExportImage,
        toolsBatchExport: toolsBatchExport,
        toolsBatchExportPsdFolder: toolsBatchExportPsdFolder,
        toolsOpenExportFolder: toolsOpenExportFolder
    };
};
