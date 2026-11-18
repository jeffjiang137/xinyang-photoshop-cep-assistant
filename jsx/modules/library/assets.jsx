/* 素材库 Photoshop 操作：所有导出、缩略图与编组准备均在私有副本中执行。 */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.libraryAssets = function (deps) {
    deps = deps || {};
    var pixels = deps.pixels;
    var selectedLayerIds = deps.selectedLayerIds;
    var selectLayersByIds = deps.selectLayersByIds;
    var findOpenDocument = deps.findOpenDocument;
    var suspendToolsHistory = deps.suspendToolsHistory;
    var currentDocumentId = deps.currentDocumentId;
    var groupCurrentSelection = deps.toolGroupCurrentLayerSelection;
    var supportedAsset = /\.(psd|psb|png|jpe?g|jfif|tiff?|bmp|gif|webp)$/i;

    function absolutePath(value) {
        var path = String(value || "").replace(/^\s+|\s+$/g, "");
        if (!path || /[\x00-\x1f]/.test(path) || !/^([a-z]:[\\\/]|\\\\|\/)/i.test(path)) {
            throw new Error("素材路径必须是有效的绝对路径");
        }
        return path;
    }

    function assetFile(value) {
        var file = new File(absolutePath(value));
        if (!supportedAsset.test(file.name)) throw new Error("暂不支持此素材格式，请使用 PSD、PSB 或常见图片格式");
        if (!file.exists) throw new Error("素材源文件不存在：" + file.fsName);
        return file;
    }

    function outputFile(value, extension, allowExisting) {
        var file = new File(absolutePath(value));
        if (!(new RegExp("\\." + extension + "$", "i")).test(file.name)) throw new Error("输出文件必须使用 ." + extension + " 扩展名");
        if (!file.parent.exists) throw new Error("输出目录不存在，请先创建素材目录");
        if (new Folder(file.fsName).exists) throw new Error("输出路径指向文件夹，请使用新的文件名");
        if (!allowExisting && file.exists) throw new Error("输出文件已存在，请使用新的素材名称：" + file.name);
        return file;
    }

    function samePath(left, right) {
        return String(left.fsName).replace(/\\/g, "/").toLowerCase() === String(right.fsName).replace(/\\/g, "/").toLowerCase();
    }

    function assetName(value, fallback) {
        var name = String(value || fallback || "素材");
        name = name.replace(/[\\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\s+|[.\s]+$/g, "");
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = "_" + name;
        name = name.slice(0, 180).replace(/[.\s]+$/g, "");
        return name || "素材";
    }

    function documentInfo(document, name) {
        return {
            name: assetName(name, documentAssetName(document)),
            width: Math.round(pixels(document.width)),
            height: Math.round(pixels(document.height)),
            documentId: currentDocumentId()
        };
    }

    function documentAssetName(document) {
        try {
            var file = document.fullName;
            /* Document.name is display text; File.name may contain URI escapes. */
            if (file) return assetName(String(document.name).replace(/\.[^.]+$/, ""));
        }
        catch (ignoreUnsavedDocumentPath) {
        }
        /* An unsaved title such as 产品.v2 has no real filename extension. */
        return assetName(String(document.name).replace(/\.(psd|psb|png|jpe?g|jfif|tiff?|bmp|gif|webp|pdf|ai|eps)$/i, ""));
    }

    function sourceAssetName(document, file) {
        /* Photoshop's display title is already decoded. Never decode it again:
         * a real filename containing literal %20 must retain those characters. */
        try {
            if (String(document.name || "")) return documentAssetName(document);
        } catch (ignoreDocumentDisplayName) {}
        var fileName = String(file.name || "素材");
        /* File.name is URI encoded by ExtendScript; decode exactly once. */
        try { fileName = decodeURIComponent(fileName); } catch (ignoreInvalidFileEscape) {}
        return assetName(fileName.replace(/\.[^.]+$/, ""));
    }

    function localDateName() {
        var date = new Date();
        function pad(number) { return number < 10 ? "0" + number : String(number); }
        return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate());
    }

    function selectedAssetName(document, ids) {
        if (!ids.length) throw new Error("请先选择需要添加到素材库的图层");
        var wanted = {};
        var group = null;
        var first = null;
        var index;
        for (index = 0; index < ids.length; index += 1) wanted["id_" + ids[index]] = true;
        var active = document.activeLayer;
        if (active.typename === "LayerSet" && wanted["id_" + active.id]) group = active;
        function walk(container) {
            var layerIndex;
            for (layerIndex = 0; layerIndex < container.layers.length; layerIndex += 1) {
                var layer = container.layers[layerIndex];
                if (wanted["id_" + layer.id]) {
                    if (!first) first = layer;
                    if (!group && layer.typename === "LayerSet") group = layer;
                }
                if (layer.typename === "LayerSet") walk(layer);
            }
        }
        walk(document);
        if (!first) throw new Error("所选图层已变化，请重新选择后添加");
        if (group) return assetName(group.name);
        return ids.length > 1 ? localDateName() : assetName(first.name);
    }

    function toolsLibraryExportInfo(options) {
        options = options || {};
        if (!app.documents.length) throw new Error("请先打开文档或选择图层");
        var mode = String(options.mode || "document");
        if (mode !== "document" && mode !== "layers") throw new Error("未知素材导出方式");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        var name = mode === "layers" ? selectedAssetName(document, ids) : documentAssetName(document);
        var info = documentInfo(document, name);
        info.selectedLayerIds = ids;
        return info;
    }

    function verifyExportContext(options, state, mode) {
        if (options.expectedDocumentId !== undefined && Number(options.expectedDocumentId) !== Number(currentDocumentId())) {
            throw new Error("当前文档已切换，请重新点击添加素材");
        }
        if (mode !== "layers" || options.expectedLayerIds === undefined) return;
        var expected = options.expectedLayerIds;
        if (!(expected instanceof Array) || expected.length !== state.selection.length) throw new Error("所选图层已变化，请重新点击添加素材");
        var wanted = {};
        var index;
        for (index = 0; index < expected.length; index += 1) wanted["id_" + Number(expected[index])] = true;
        for (index = 0; index < state.selection.length; index += 1) {
            if (!wanted["id_" + state.selection[index]]) throw new Error("所选图层已变化，请重新点击添加素材");
        }
    }

    function environment() {
        var state = {
            document: app.documents.length ? app.activeDocument : null,
            dialogs: app.displayDialogs,
            rulerUnits: app.preferences.rulerUnits,
            selection: []
        };
        if (state.document) state.selection = selectedLayerIds();
        return state;
    }

    function restoreEnvironment(state, restoreDocument) {
        if (state.document) {
            try {
                var current = app.documents.length ? app.activeDocument : null;
                app.activeDocument = state.document;
                if (state.selection.length) selectLayersByIds(state.selection);
                if (!restoreDocument && current) app.activeDocument = current;
            } catch (ignoreRestoreSelection) {}
        }
        app.displayDialogs = state.dialogs;
        app.preferences.rulerUnits = state.rulerUnits;
    }

    function closePrivate(document) {
        if (document) {
            try { document.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClosePrivateDocument) {}
        }
    }

    function toolsLibraryChooseFolder(options) {
        options = options || {};
        var initial = null;
        if (options.path) {
            initial = new Folder(absolutePath(options.path));
            if (!initial.exists) initial = null;
        }
        var folder = Folder.selectDialog(String(options.title || "选择素材库文件夹"), initial);
        return folder ? { canceled: false, path: folder.fsName } : { canceled: true, path: "" };
    }

    function toolsLibraryChooseFiles(options) {
        options = options || {};
        var isPack = options.kind === "pack";
        if (isPack) {
            var pack = Folder.selectDialog("选择 .pack 素材包文件夹");
            if (!pack) return { canceled: true, paths: [] };
            if (!/\.pack$/i.test(pack.name)) throw new Error("请选择以 .pack 结尾的素材包文件夹");
            return { canceled: false, paths: [pack.fsName] };
        }
        var filter = "素材文件:*.psd;*.psb;*.png;*.jpg;*.jpeg;*.jfif;*.tif;*.tiff;*.bmp;*.gif;*.webp";
        var files = File.openDialog("选择要导入的素材", filter, true);
        if (!files) return { canceled: true, paths: [] };
        if (!(files instanceof Array)) files = [files];
        var paths = [];
        var index;
        for (index = 0; index < files.length; index += 1) {
            if (!files[index].exists) throw new Error("所选文件不存在");
            if (!supportedAsset.test(files[index].name)) throw new Error("所选文件格式不受支持");
            paths.push(files[index].fsName);
        }
        return { canceled: false, paths: paths };
    }

    function toolsLibraryChooseSave(options) {
        options = options || {};
        var parent = Folder.selectDialog("选择素材包导出位置（将新建 .pack 文件夹）");
        if (!parent) return { canceled: true, path: "" };
        var chosen = new Folder(parent.fsName + "/" + assetName(options.name, "素材包") + ".pack");
        if (chosen.exists || new File(chosen.fsName).exists) throw new Error("素材包已存在，请选择新名称或其他目录");
        return { canceled: false, path: chosen.fsName };
    }

    function toolsLibraryReveal(options) {
        var path = absolutePath(options && options.path);
        var folder = new Folder(path);
        if (!folder.exists) {
            var file = new File(path);
            if (!file.exists) throw new Error("文件或文件夹不存在");
            folder = file.parent;
        }
        if (!folder.exists || !folder.execute()) throw new Error("无法打开所在目录");
        return { path: folder.fsName };
    }

    function preparePrivateAsset(document, name) {
        app.activeDocument = document;
        if (document.mode === DocumentMode.BITMAP) document.changeMode(ChangeMode.GRAYSCALE);
        if (document.mode === DocumentMode.INDEXEDCOLOR) document.changeMode(ChangeMode.RGB);
        var ids = [];
        var index;
        for (index = 0; index < document.layers.length; index += 1) {
            var layer = document.layers[index];
            try {
                if (layer.isBackgroundLayer) {
                    var backgroundName = layer.name;
                    layer.isBackgroundLayer = false;
                    layer.name = backgroundName;
                }
            } catch (ignoreNotBackground) {}
            ids.push(layer.id);
        }
        if (!ids.length) throw new Error("素材文档中没有可应用的图层");
        /* Preserve a native root group/layer and its masks, name and children.
         * Only multi-root artwork needs a container for one-piece placement. */
        if (ids.length === 1) return document.layers[0];
        selectLayersByIds(ids);
        var group = groupCurrentSelection(document);
        group.name = name;
        return group;
    }

    function translatePreservingLocks(group, dx, dy) {
        var states = [];
        var keys = ["allLocked", "pixelsLocked", "positionLocked", "transparentPixelsLocked"];
        function unlock(layer) {
            var state = { layer: layer, values: {} };
            states.push(state);
            var index;
            /* Read every flag before changing allLocked, which can affect other flags. */
            for (index = 0; index < keys.length; index += 1) {
                try {
                    var value = layer[keys[index]];
                    if (typeof value === "boolean") state.values[keys[index]] = value;
                } catch (ignoreReadLayerLock) {}
            }
            for (index = 0; index < keys.length; index += 1) {
                try { layer[keys[index]] = false; } catch (ignoreUnlockImportedLayer) {}
            }
            if (layer.typename === "LayerSet") {
                for (index = 0; index < layer.layers.length; index += 1) unlock(layer.layers[index]);
            }
        }
        try {
            unlock(group);
            group.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
        } finally {
            var stateIndex;
            for (stateIndex = states.length - 1; stateIndex >= 0; stateIndex -= 1) {
                var keyIndex;
                for (keyIndex = keys.length - 1; keyIndex >= 0; keyIndex -= 1) {
                    var key = keys[keyIndex];
                    if (typeof states[stateIndex].values[key] === "boolean") {
                        try { states[stateIndex].layer[key] = states[stateIndex].values[key]; } catch (ignoreRestoreImportedLock) {}
                    }
                }
            }
        }
    }

    function visiblePlacementCenter(document) {
        var fallback = [pixels(document.width) / 2, pixels(document.height) / 2];
        try {
            function property(name) {
                var ref = new ActionReference();
                ref.putProperty(stringIDToTypeID("property"), stringIDToTypeID(name));
                ref.putEnumerated(stringIDToTypeID("document"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
                return executeActionGet(ref);
            }
            var transform = property("viewTransform").getList(stringIDToTypeID("viewTransform"));
            var bounds = property("viewInfo").getObjectValue(stringIDToTypeID("viewInfo")).getObjectValue(stringIDToTypeID("activeView")).getObjectValue(stringIDToTypeID("globalBounds"));
            var width = bounds.getDouble(stringIDToTypeID("right")) - bounds.getDouble(stringIDToTypeID("left"));
            var height = bounds.getDouble(stringIDToTypeID("bottom")) - bounds.getDouble(stringIDToTypeID("top"));
            var x = transform.getDouble(4) + width * transform.getDouble(0) / 2;
            var y = transform.getDouble(5) + height * transform.getDouble(3) / 2;
            if (isFinite(x) && isFinite(y) && width > 0 && height > 0) return [x, y];
        } catch (ignoreViewport) {}
        return fallback;
    }

    function toolsLibraryOpenAsset(options) {
        options = options || {};
        var mode = String(options.mode || "apply");
        if (mode !== "apply" && mode !== "open" && mode !== "edit") throw new Error("未知素材打开方式");
        var file = assetFile(options.path);
        var state = environment();
        var placementCenter = state.document ? visiblePlacementCenter(state.document) : null;
        var source = null;
        var openedSource = false;
        var privateDocument = null;
        var keepSource = false;
        var keepPrivate = false;
        var success = false;
        try {
            app.displayDialogs = DialogModes.NO;
            source = findOpenDocument(file);
            if (!source) {
                source = app.open(file);
                openedSource = true;
            }
            app.activeDocument = source;
            var info = documentInfo(source, sourceAssetName(source, file));
            info.mode = mode;
            if (mode === "edit") {
                keepSource = true;
            } else {
                privateDocument = source.duplicate(info.name);
                app.activeDocument = privateDocument;
                if (mode === "open") {
                    keepPrivate = true;
                    info.documentId = currentDocumentId();
                } else {
                    var preparedGroup = preparePrivateAsset(privateDocument, info.name);
                    if (!state.document) {
                        keepPrivate = true;
                        info.documentId = currentDocumentId();
                        info.layerId = preparedGroup.id;
                        info.createdDocument = true;
                    } else {
                        app.activeDocument = state.document;
                        var imported = suspendToolsHistory(state.document, "鑫洋助理：应用素材", function () {
                            app.activeDocument = privateDocument;
                            var result = preparedGroup.duplicate(state.document, ElementPlacement.PLACEATBEGINNING);
                            app.activeDocument = state.document;
                            var bounds = result.bounds;
                            var dx = placementCenter[0] - (pixels(bounds[0]) + pixels(bounds[2])) / 2;
                            var dy = placementCenter[1] - (pixels(bounds[1]) + pixels(bounds[3])) / 2;
                            if (isFinite(dx) && isFinite(dy)) translatePreservingLocks(result, dx, dy);
                            return result.id;
                        });
                        app.activeDocument = state.document;
                        info.documentId = currentDocumentId();
                        info.layerId = imported;
                    }
                }
            }
            success = true;
            return info;
        } finally {
            if (privateDocument && (!success || !keepPrivate)) closePrivate(privateDocument);
            if (openedSource && (!success || !keepSource)) closePrivate(source);
            if (success && keepPrivate && privateDocument) app.activeDocument = privateDocument;
            if (success && mode === "edit" && source) app.activeDocument = source;
            restoreEnvironment(state, !success || mode === "apply");
        }
    }

    /* Paths survive duplicate() even when Photoshop remaps numeric layer IDs. */
    function selectedLayerPlan(document, ids) {
        var selected = {};
        var entries = {};
        var full = {};
        var keep = {};
        var queue = [];
        var index;
        for (index = 0; index < ids.length; index += 1) selected["id_" + ids[index]] = true;
        function walk(container, prefix, parent) {
            var i;
            var siblings = [];
            for (i = 0; i < container.layers.length; i += 1) siblings.push(prefix + i);
            for (i = 0; i < container.layers.length; i += 1) {
                var layer = container.layers[i];
                var path = siblings[i];
                var clipped = false;
                try { clipped = !!layer.grouped; } catch (ignoreGrouped) {}
                entries[path] = { path: path, parent: parent, siblings: siblings, index: i, clipped: clipped };
                if (selected["id_" + layer.id]) queue.push({ path: path, full: true });
                if (layer.typename === "LayerSet") walk(layer, path + "/", path);
            }
        }
        walk(document, "", "");
        if (!queue.length) throw new Error("请先选择需要添加到素材库的图层");
        var dependencyCount = 0;
        for (index = 0; index < queue.length; index += 1) {
            var request = queue[index];
            var entry = entries[request.path];
            if (request.full) full[request.path] = true;
            if (keep[request.path]) continue;
            keep[request.path] = true;
            if (entry.parent) queue.push({ path: entry.parent, full: false });
            if (entry.clipped) {
                var siblingIndex = entry.index + 1;
                while (siblingIndex < entry.siblings.length) {
                    var basePath = entry.siblings[siblingIndex];
                    if (!entries[basePath].clipped) {
                        if (!full[basePath]) dependencyCount += 1;
                        queue.push({ path: basePath, full: true });
                        break;
                    }
                    siblingIndex += 1;
                }
                if (siblingIndex >= entry.siblings.length) throw new Error("剪贴图层缺少有效底图，请先修复剪贴关系");
            }
        }
        return { full: full, keep: keep, dependencies: dependencyCount };
    }

    function prunePrivateDocument(document, plan) {
        function unlockForRemoval(layer) {
            var keys = ["allLocked", "pixelsLocked", "positionLocked", "transparentPixelsLocked"];
            var keyIndex;
            for (keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
                try { layer[keys[keyIndex]] = false; } catch (ignoreUnsupportedLock) {}
            }
            if (layer.typename === "LayerSet") {
                var childIndex;
                for (childIndex = 0; childIndex < layer.layers.length; childIndex += 1) unlockForRemoval(layer.layers[childIndex]);
            }
        }
        function walk(container, prefix) {
            var index;
            for (index = container.layers.length - 1; index >= 0; index -= 1) {
                var layer = container.layers[index];
                var path = prefix + index;
                if (!plan.keep[path]) {
                    /* Photoshop refuses deleting a group whose descendants are locked. */
                    unlockForRemoval(layer);
                    layer.remove();
                    continue;
                }
                var locked = false;
                try { locked = layer.allLocked; layer.allLocked = false; } catch (ignoreReadLock) {}
                try {
                    layer.visible = true;
                    if (!plan.full[path] && layer.typename === "LayerSet") walk(layer, path + "/");
                } finally {
                    if (locked) { try { layer.allLocked = true; } catch (ignoreRestoreLock) {} }
                }
            }
        }
        walk(document, "");
        try { document.trim(TrimType.TRANSPARENT, true, true, true, true); } catch (ignoreEmptyTrim) {}
    }

    function savePreview(document, file) {
        app.activeDocument = document;
        if (document.mode === DocumentMode.BITMAP) document.changeMode(ChangeMode.GRAYSCALE);
        if (document.mode !== DocumentMode.RGB) document.changeMode(ChangeMode.RGB);
        if (document.bitsPerChannel !== BitsPerChannelType.EIGHT) document.bitsPerChannel = BitsPerChannelType.EIGHT;
        var width = pixels(document.width);
        var height = pixels(document.height);
        var scale = Math.min(1, 512 / Math.max(width, height));
        if (scale < 1) document.resizeImage(UnitValue(Math.max(1, Math.round(width * scale)), "px"), UnitValue(Math.max(1, Math.round(height * scale)), "px"), null, ResampleMethod.BICUBICSHARPER);
        var png = new PNGSaveOptions();
        png.interlaced = false;
        document.saveAs(file, png, true, Extension.LOWERCASE);
        if (!file.exists) throw new Error("缩略图未成功写入");
    }

    function toolsLibraryExportAsset(options) {
        options = options || {};
        if (!app.documents.length) throw new Error("请先打开文档或选择图层");
        var mode = String(options.mode || "document");
        if (mode !== "document" && mode !== "layers") throw new Error("未知素材导出方式");
        var state = environment();
        verifyExportContext(options, state, mode);
        var sourceFile = outputFile(options.source, "psd", false);
        var previewFile = outputFile(options.preview, "png", false);
        var privateDocument = null;
        var attemptedSource = false;
        var attemptedPreview = false;
        var success = false;
        try {
            app.displayDialogs = DialogModes.NO;
            var plan = mode === "layers" ? selectedLayerPlan(state.document, state.selection) : null;
            var name = options.name ? assetName(options.name) : toolsLibraryExportInfo({ mode: mode }).name;
            privateDocument = state.document.duplicate("__素材库导出_" + name);
            app.activeDocument = privateDocument;
            if (plan) prunePrivateDocument(privateDocument, plan);
            var info = documentInfo(privateDocument, name);
            if (info.width > 30000 || info.height > 30000) throw new Error("素材尺寸超过 PSD 的 30000 像素限制，请缩小后再添加");
            var psd = new PhotoshopSaveOptions();
            psd.layers = true;
            psd.embedColorProfile = true;
            attemptedSource = true;
            privateDocument.saveAs(sourceFile, psd, true, Extension.LOWERCASE);
            if (!sourceFile.exists) throw new Error("素材 PSD 未成功写入");
            attemptedPreview = true;
            savePreview(privateDocument, previewFile);
            info.source = sourceFile.fsName;
            info.preview = previewFile.fsName;
            info.mode = mode;
            info.clippingDependencies = plan ? plan.dependencies : 0;
            delete info.documentId;
            success = true;
            return info;
        } finally {
            closePrivate(privateDocument);
            restoreEnvironment(state, true);
            if (!success) {
                /* Both paths were verified absent before this operation. */
                if (attemptedSource && sourceFile.exists) { try { sourceFile.remove(); } catch (ignorePartialSource) {} }
                if (attemptedPreview && previewFile.exists) { try { previewFile.remove(); } catch (ignorePartialPreview) {} }
            }
        }
    }

    function toolsLibraryThumbnail(options) {
        options = options || {};
        var file = assetFile(options.path);
        var preview = outputFile(options.preview, "png", true);
        if (samePath(file, preview)) throw new Error("缩略图路径不能覆盖素材源文件");
        var state = environment();
        var placementCenter = state.document ? visiblePlacementCenter(state.document) : null;
        var source = null;
        var openedSource = false;
        var privateDocument = null;
        try {
            app.displayDialogs = DialogModes.NO;
            source = findOpenDocument(file);
            if (!source) { source = app.open(file); openedSource = true; }
            app.activeDocument = source;
            var info = documentInfo(source, sourceAssetName(source, file));
            privateDocument = source.duplicate("__素材库缩略图");
            savePreview(privateDocument, preview);
            info.preview = preview.fsName;
            delete info.documentId;
            return info;
        } finally {
            closePrivate(privateDocument);
            if (openedSource) closePrivate(source);
            restoreEnvironment(state, true);
        }
    }

    return {
        toolsLibraryChooseFolder: toolsLibraryChooseFolder,
        toolsLibraryChooseFiles: toolsLibraryChooseFiles,
        toolsLibraryChooseSave: toolsLibraryChooseSave,
        toolsLibraryReveal: toolsLibraryReveal,
        toolsLibraryOpenAsset: toolsLibraryOpenAsset,
        toolsLibraryExportInfo: toolsLibraryExportInfo,
        toolsLibraryExportAsset: toolsLibraryExportAsset,
        toolsLibraryThumbnail: toolsLibraryThumbnail
    };
};
