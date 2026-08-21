/* 鑫洋助理 ExtendScript 模块：embedImport（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.embedImport = function (deps) {
    deps = deps || {};
    var HOST_SCRIPT_FOLDER = deps.HOST_SCRIPT_FOLDER;
    var pixels = deps.pixels;
    var layerSize = deps.layerSize;
    var integerValue = deps.integerValue;
    var activeLayerId = deps.activeLayerId;
    var selectedLayerIds = deps.selectedLayerIds;
    var selectLayersByIds = deps.selectLayersByIds;
    var loadStitchSourceState = deps.loadStitchSourceState;
    var fileObject = deps.fileObject;
    var displayFileName = deps.displayFileName;
    var findLayerById = deps.findLayerById;
    var layerNumericId = deps.layerNumericId;
    var placeEmbedded = deps.placeEmbedded;
    var placeLinked = deps.placeLinked;
    var safeLayerName = deps.safeLayerName;
    var suspendToolsHistory = deps.suspendToolsHistory;
    var toolLayerById = deps.toolLayerById;

    var autoEmbedLastLayerId = 0;
    var autoEmbedLastAt = 0;

    function centerLayerInCanvas(document, layer) {
        var size = layerSize(layer);
        var dx = (pixels(document.width) - size.width) / 2 - size.left;
        var dy = (pixels(document.height) - size.height) / 2 - size.top;
        layer.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
        return layerSize(layer);
    }

    function fitLayerToCanvas(document, layer) {
        var size = layerSize(layer);
        var canvasWidth = Math.max(1, pixels(document.width));
        var canvasHeight = Math.max(1, pixels(document.height));
        if (!(size.width > 0 && size.height > 0)) return size;
        var scale = Math.min(
            canvasWidth / size.width,
            canvasHeight / size.height
        );
        if (!(scale > 0)) return size;
        layer.resize(
            scale * 100,
            scale * 100,
            AnchorPosition.MIDDLECENTER
        );
        return layerSize(layer);
    }

    function arrangeImportedLayers(document, layers, layout, gap) {
        var canvasWidth = pixels(document.width);
        var canvasHeight = pixels(document.height);
        var sizes = [];
        var total = 0;
        var index;
        gap = Math.max(0, integerValue(gap, 0));

        for (index = 0; index < layers.length; index += 1) {
            sizes.push(layerSize(layers[index]));
            total += layout === "vertical"
                ? sizes[index].height
                : sizes[index].width;
        }
        total += Math.max(0, layers.length - 1) * gap;

        var cursor = layout === "vertical"
            ? (canvasHeight - total) / 2
            : (canvasWidth - total) / 2;

        for (index = 0; index < layers.length; index += 1) {
            var size = layerSize(layers[index]);
            var targetLeft = layout === "horizontal"
                ? cursor
                : (canvasWidth - size.width) / 2;
            var targetTop = layout === "vertical"
                ? cursor
                : (canvasHeight - size.height) / 2;
            layers[index].translate(
                UnitValue(targetLeft - size.left, "px"),
                UnitValue(targetTop - size.top, "px")
            );
            cursor += (layout === "vertical" ? size.height : size.width) + gap;
        }
    }

    function fitLayerCoverBounds(layer, targetBounds) {
        var source = layerSize(layer);
        if (!(source.width > 0 && source.height > 0)) {
            throw new Error("嵌入图片没有可用的像素范围");
        }
        if (!(targetBounds.width > 0 && targetBounds.height > 0)) {
            throw new Error("下方目标图层没有可用的边界范围");
        }

        var scale = Math.max(
            targetBounds.width / source.width,
            targetBounds.height / source.height
        );
        if (!(scale > 0) || !isFinite(scale)) {
            throw new Error("无法计算图片适配比例");
        }

        layer.resize(
            scale * 100,
            scale * 100,
            AnchorPosition.MIDDLECENTER
        );

        var resized = layerSize(layer);
        var targetCenterX = targetBounds.left + targetBounds.width / 2;
        var targetCenterY = targetBounds.top + targetBounds.height / 2;
        var sourceCenterX = resized.left + resized.width / 2;
        var sourceCenterY = resized.top + resized.height / 2;
        layer.translate(
            UnitValue(targetCenterX - sourceCenterX, "px"),
            UnitValue(targetCenterY - sourceCenterY, "px")
        );

        return {
            scalePercent: scale * 100,
            bounds: layerSize(layer)
        };
    }

    function createDownwardClippingMask(document, layer) {
        document.activeLayer = layer;
        try {
            layer.grouped = true;
            if (layer.grouped) return true;
        } catch (ignoreGroupedProperty) {}

        try {
            executeAction(charIDToTypeID("GrpL"), undefined, DialogModes.NO);
            return true;
        } catch (ignoreGroupEvent) {}

        return false;
    }

    function directLowerSibling(layer) {
        var parent = layer.parent;
        var layers = parent && parent.layers ? parent.layers : null;
        if (!layers || !layers.length) return null;
        var index;
        for (index = 0; index < layers.length; index += 1) {
            var same = false;
            try {
                same = layers[index] === layer;
            } catch (ignoreLayerIdentity) {}
            if (!same) {
                try {
                    same = Number(layers[index].id) === Number(layer.id);
                } catch (ignoreLayerIdCompare) {}
            }
            if (same) {
                return index + 1 < layers.length ? layers[index + 1] : null;
            }
        }
        return null;
    }

    function clippingDisplayBaseBelow(layer) {
        var target = directLowerSibling(layer);
        var skipped = 0;
        while (target && target.typename === "ArtLayer") {
            var grouped = false;
            try { grouped = !!target.grouped; } catch (ignoreGroupedState) {}
            if (!grouped) break;
            skipped += 1;
            target = directLowerSibling(target);
        }
        return { layer: target, skippedClippedLayers: skipped };
    }

    function isEmbeddableImageLayer(layer) {
        if (!layer || layer.typename !== "ArtLayer") return false;
        try {
            if (layer.isBackgroundLayer) return false;
        } catch (ignoreBackground) {}
        try {
            var kind = layer.kind;
            if (kind === LayerKind.NORMAL || kind === LayerKind.SMARTOBJECT || kind === LayerKind.SOLIDFILL) {
                return true;
            }
            // Photoshop 的渐变/图案形状同样具有可缩放矢量边界；旧版宿主没有这些枚举时安全跳过。
            try { if (kind === LayerKind.GRADIENTFILL) return true; } catch (ignoreGradientFillKind) {}
            try { if (kind === LayerKind.PATTERNFILL) return true; } catch (ignorePatternFillKind) {}
            return false;
        } catch (ignoreKind) {
            return true;
        }
    }

    function collectArtLayersInPanelOrder(container, output) {
        output = output || [];
        var layers = container && container.layers ? container.layers : null;
        if (!layers) return output;
        var index;
        for (index = 0; index < layers.length; index += 1) {
            var layer = layers[index];
            if (layer.typename === "LayerSet") {
                collectArtLayersInPanelOrder(layer, output);
            } else if (layer.typename === "ArtLayer") {
                output.push(layer);
            }
        }
        return output;
    }

    function sortLayersByPanelOrder(document, layers) {
        var order = collectArtLayersInPanelOrder(document, []);
        var ranks = {};
        var index;
        for (index = 0; index < order.length; index += 1) {
            ranks[String(layerNumericId(order[index]))] = index;
        }
        layers.sort(function (first, second) {
            var firstRank = ranks[String(layerNumericId(first))];
            var secondRank = ranks[String(layerNumericId(second))];
            if (firstRank === undefined) firstRank = 999999;
            if (secondRank === undefined) secondRank = 999999;
            return firstRank - secondRank;
        });
        return layers;
    }

    function collectEmbedTargets(group, excludedIds, output) {
        output = output || [];
        var layers = group && group.layers ? group.layers : null;
        if (!layers) return output;
        var index;
        for (index = 0; index < layers.length; index += 1) {
            var layer = layers[index];
            if (layer.typename === "LayerSet") {
                collectEmbedTargets(layer, excludedIds, output);
                continue;
            }
            if (layer.typename !== "ArtLayer") continue;
            var id = layerNumericId(layer);
            if (excludedIds[String(id)]) continue;
            try {
                if (layer.grouped) continue;
            } catch (ignoreGroupedTarget) {}
            var bounds;
            try {
                bounds = layerSize(layer);
            } catch (ignoreTargetBounds) {
                continue;
            }
            if (!(bounds.width > 0 && bounds.height > 0)) continue;
            output.push(layer);
        }
        return output;
    }

    function toolsEmbedSelectedLayerClipped(options) {
        if (!app.documents.length) {
            throw new Error("请先打开 Photoshop 文档");
        }
        var document = app.activeDocument;
        var selectedIds = selectedLayerIds();
        if (selectedIds.length !== 1) {
            throw new Error("请只选择一个需要嵌入的图层");
        }

        var sourceId = selectedIds[0];
        var source = toolLayerById(document, sourceId);
        if (!source || source.typename !== "ArtLayer") {
            throw new Error("当前选中对象不是可嵌入图层");
        }
        if (!isEmbeddableImageLayer(source)) {
            throw new Error("请选择普通图片图层、智能对象或形状图层后再执行嵌入");
        }
        try {
            if (source.isBackgroundLayer) {
                throw new Error("背景图层不能向下创建剪切蒙版");
            }
        } catch (backgroundError) {
            if (backgroundError && backgroundError.message === "背景图层不能向下创建剪切蒙版") {
                throw backgroundError;
            }
        }

        var targetInfo = clippingDisplayBaseBelow(source);
        var target = targetInfo.layer;
        if (!target) {
            throw new Error("当前图层下方没有可作为剪切蒙版底图的图层");
        }

        var sourceBounds = layerSize(source);
        var targetBounds = layerSize(target);
        if (!(sourceBounds.width > 0 && sourceBounds.height > 0)) {
            throw new Error("当前图层没有可用于适配的有效边界");
        }
        if (!(targetBounds.width > 0 && targetBounds.height > 0)) {
            throw new Error("下方图层没有可用于适配图片的有效大小");
        }

        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        try {
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(
                document,
                "鑫洋助理：嵌入图片",
                function () {
                    document.activeLayer = source;
                    var fitted = fitLayerCoverBounds(source, targetBounds);
                    if (!createDownwardClippingMask(document, source)) {
                        throw new Error("Photoshop 未能创建向下剪切蒙版");
                    }
                    document.activeLayer = source;
                    return {
                        processed: 1,
                        sourceId: sourceId,
                        sourceName: String(source.name || "当前图层"),
                        targetName: String(target.name || "下方图层"),
                        targetMode: targetInfo.skippedClippedLayers > 0 ? "clippingStackBase" : "directLower",
                        skippedClippedLayers: targetInfo.skippedClippedLayers,
                        scalePercent: Math.round(fitted.scalePercent * 100) / 100,
                        fitMode: "cover",
                        clippingMask: true
                    };
                }
            );
        } finally {
            app.preferences.rulerUnits = previousUnits;
            app.displayDialogs = previousDialogs;
        }
    }

    function toolsLoadActiveLayerTransparencySelection(document, layer) {
        document.activeLayer = layer;
        var setSelection = new ActionDescriptor();
        var selectionRef = new ActionReference();
        selectionRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
        setSelection.putReference(charIDToTypeID("null"), selectionRef);
        var transparencyRef = new ActionReference();
        transparencyRef.putEnumerated(
            charIDToTypeID("Chnl"),
            charIDToTypeID("Chnl"),
            charIDToTypeID("Trsp")
        );
        setSelection.putReference(charIDToTypeID("T   "), transparencyRef);
        executeAction(charIDToTypeID("setd"), setSelection, DialogModes.NO);
        var bounds = document.selection.bounds;
        if (!bounds || bounds.length < 4) throw new Error("当前图层没有可用于建立选区的可见内容");
        return {
            left: pixels(bounds[0]),
            top: pixels(bounds[1]),
            right: pixels(bounds[2]),
            bottom: pixels(bounds[3])
        };
    }

    function toolsPasteInPlace(document) {
        try {
            executeAction(stringIDToTypeID("pasteInPlace"), undefined, DialogModes.NO);
            return document.activeLayer;
        } catch (ignorePasteInPlace) {
            var pasted = document.paste();
            return pasted || document.activeLayer;
        }
    }

    function toolsEmbedLowerVisualContent(options) {
        if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
        var document = app.activeDocument;
        var selectedIds = selectedLayerIds();
        if (selectedIds.length !== 1) throw new Error("请只选择一个需要作为剪切底图的图层");

        var sourceId = selectedIds[0];
        var source = findLayerById(document, sourceId);
        if (!source || source.typename !== "ArtLayer") {
            throw new Error("嵌入下方图层目前支持普通图层、文字、形状和智能对象；请先选择一个单独图层");
        }
        try {
            if (source.grouped) {
                throw new Error("当前图层本身已是剪切蒙版，无法作为新的剪切底图；请先释放当前图层的剪切关系");
            }
        } catch (groupedError) {
            if (groupedError && String(groupedError.message || "").indexOf("当前图层本身已是剪切蒙版") >= 0) throw groupedError;
        }

        var panelOrder = collectArtLayersInPanelOrder(document, []);
        var sourceIndex = -1;
        var index;
        for (index = 0; index < panelOrder.length; index += 1) {
            if (layerNumericId(panelOrder[index]) === sourceId) {
                sourceIndex = index;
                break;
            }
        }
        if (sourceIndex < 0 || sourceIndex >= panelOrder.length - 1) {
            throw new Error("当前图层视觉下方没有可复制的图层内容");
        }

        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        try {
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(document, "鑫洋助理：嵌入下方图层", function () {
                toolsLoadActiveLayerTransparencySelection(document, source);

                var visibilityState = [];
                var visibilityRestored = false;
                try {
                    /* panelOrder 从视觉最上方到最下方排列；隐藏 source 以及它上面的内容，
                       Copy Merged 得到的就是 source 轮廓内真正可见的视觉下层。 */
                    for (index = 0; index <= sourceIndex; index += 1) {
                        var upper = panelOrder[index];
                        var wasVisible = false;
                        try { wasVisible = !!upper.visible; } catch (ignoreReadVisibility) {}
                        visibilityState.push({ layer: upper, visible: wasVisible });
                        if (wasVisible) {
                            try { upper.visible = false; } catch (ignoreHideUpper) {}
                        }
                    }

                    /* v2.2.02：当前层已被临时隐藏时，不再让它继续作为活动层。
                       Photoshop 27.3.x 在“隐藏活动层 + Copy Merged”场景下会误报选区为空。
                       先激活视觉下方第一个可见 ArtLayer，再执行 Copy Merged。 */
                    var lowerActive = null;
                    for (var lowerIndex = sourceIndex + 1; lowerIndex < panelOrder.length; lowerIndex += 1) {
                        try {
                            if (panelOrder[lowerIndex] && panelOrder[lowerIndex].typename === "ArtLayer" && panelOrder[lowerIndex].visible) {
                                lowerActive = panelOrder[lowerIndex];
                                break;
                            }
                        } catch (ignoreLowerVisibility) {}
                    }
                    if (!lowerActive) throw new Error("当前图层视觉下方没有可见图层内容");
                    try { document.activeLayer = lowerActive; }
                    catch (ignoreActivateLower) { throw new Error("无法激活当前图层视觉下方的可见内容"); }

                    try {
                        document.selection.copy(true);
                    } catch (copyError) {
                        throw new Error("当前图层选区内没有可复制的视觉下层内容");
                    }
                } finally {
                    for (index = visibilityState.length - 1; index >= 0; index -= 1) {
                        try { visibilityState[index].layer.visible = visibilityState[index].visible; } catch (ignoreRestoreVisibility) {}
                    }
                    visibilityRestored = true;
                }

                if (!visibilityRestored) throw new Error("恢复图层可见性失败");
                try { document.selection.deselect(); } catch (ignoreDeselectEmbedLower) {}
                document.activeLayer = source;
                var copied = toolsPasteInPlace(document);
                if (!copied || copied.typename !== "ArtLayer") throw new Error("Photoshop 未能粘贴视觉下层内容");

                copied.name = String(source.name || "当前图层") + "_下方内容";
                try { copied.move(source, ElementPlacement.PLACEBEFORE); } catch (moveError) {
                    throw new Error("无法把复制内容移动到原图层上方");
                }
                if (!createDownwardClippingMask(document, copied)) {
                    throw new Error("Photoshop 未能为复制内容创建向下剪切蒙版");
                }

                var copiedId = layerNumericId(copied);
                selectLayersByIds([sourceId]);
                return {
                    processed: 1,
                    sourceId: sourceId,
                    sourceName: String(source.name || "当前图层"),
                    copiedLayerId: copiedId,
                    copiedLayerName: String(copied.name || "下方内容"),
                    selectionMode: "sourceTransparency",
                    lowerMode: "visualMergedBelow",
                    clippingMask: true
                };
            });
        } finally {
            app.preferences.rulerUnits = previousUnits;
            app.displayDialogs = previousDialogs;
        }
    }

    function toolsAutoEmbedActiveLayer(options) {
        if (!app.documents.length) return { processed: 0, skipped: true, reason: "noDocument" };
        var document = app.activeDocument;
        /*
         * 拼图导入同样会触发 Photoshop 的“置入”通知。自动嵌入是给用户
         * 手动置入图片用的，不能作用于本插件生成的拼图文档，否则最后一张
         * 源图会被嵌入 00_白色背景。拼图完成后已写入稳定源图 XMP，以此识别。
         */
        var stitchState = loadStitchSourceState(document);
        if (stitchState.layerIds && stitchState.layerIds.length) {
            return { processed: 0, skipped: true, reason: "stitchDocument" };
        }
        var source = null;
        try { source = document.activeLayer; } catch (ignoreAutoEmbedLayer) {}
        if (!source || source.typename !== "ArtLayer") {
            return { processed: 0, skipped: true, reason: "invalidSource" };
        }
        if (!isEmbeddableImageLayer(source)) {
            return { processed: 0, skipped: true, reason: "unsupportedSource" };
        }
        try {
            if (source.isBackgroundLayer) return { processed: 0, skipped: true, reason: "backgroundLayer" };
        } catch (ignoreAutoEmbedBackground) {}

        var targetInfo = clippingDisplayBaseBelow(source);
        var target = targetInfo.layer;
        if (!target) return { processed: 0, skipped: true, reason: "noClippingBase" };

        var sourceBounds;
        var targetBounds;
        try {
            sourceBounds = layerSize(source);
            targetBounds = layerSize(target);
        } catch (ignoreAutoEmbedBounds) {
            return { processed: 0, skipped: true, reason: "invalidBounds" };
        }
        if (!(sourceBounds.width > 0 && sourceBounds.height > 0 && targetBounds.width > 0 && targetBounds.height > 0)) {
            return { processed: 0, skipped: true, reason: "emptyBounds" };
        }

        var sourceId = layerNumericId(source);
        var autoEmbedNow = (new Date()).getTime();
        /* 原生 notifier 与 CEP 回调可能同时到达；同一新图层只处理一次。 */
        if (sourceId && sourceId === autoEmbedLastLayerId && autoEmbedNow - autoEmbedLastAt < 4000) {
            return { processed: 0, skipped: true, reason: "alreadyProcessed" };
        }
        var wasGrouped = false;
        try { wasGrouped = !!source.grouped; } catch (ignoreAutoGroupedState) {}
        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        try {
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(document, "鑫洋助理：自动嵌入图片", function () {
                document.activeLayer = source;
                var fitted = fitLayerCoverBounds(source, targetBounds);
                if (!wasGrouped && !createDownwardClippingMask(document, source)) {
                    return { processed: 0, skipped: true, reason: "clippingFailed" };
                }
                document.activeLayer = source;
                autoEmbedLastLayerId = sourceId;
                autoEmbedLastAt = (new Date()).getTime();
                return {
                    processed: 1,
                    trigger: String(options && options.trigger || "unknown"),
                    sourceId: sourceId,
                    sourceName: String(source.name || "新图片图层"),
                    targetName: String(target.name || "下方图层"),
                    targetMode: targetInfo.skippedClippedLayers > 0 ? "clippingStackBase" : "directLower",
                    skippedClippedLayers: targetInfo.skippedClippedLayers,
                    scalePercent: Math.round(fitted.scalePercent * 100) / 100,
                    clippingMask: true
                };
            });
        } catch (ignoreAutoEmbedOperation) {
            return { processed: 0, skipped: true, reason: "operationFailed" };
        } finally {
            app.preferences.rulerUnits = previousUnits;
            app.displayDialogs = previousDialogs;
        }
    }

    function toolSameFsPath(first, second) {
        var left = String(first || "").replace(/\\/g, "/").toLowerCase();
        var right = String(second || "").replace(/\\/g, "/").toLowerCase();
        return left === right;
    }

    function toolRemoveAutoEmbedNotifiers(placeFile, pasteFile) {
        var removed = 0;
        var index;
        for (index = app.notifiers.length - 1; index >= 0; index -= 1) {
            try {
                var current = app.notifiers[index];
                var currentPath = current.eventFile ? current.eventFile.fsName : "";
                if (toolSameFsPath(currentPath, placeFile.fsName) || toolSameFsPath(currentPath, pasteFile.fsName)) {
                    current.remove();
                    removed += 1;
                }
            } catch (ignoreRemoveAutoEmbedNotifier) {}
        }
        return removed;
    }

    function toolsConfigureAutoEmbed(options) {
        var scriptFolder = HOST_SCRIPT_FOLDER;
        var extensionPath = String(options && options.extensionPath || "")
            .replace(/^file:\/{2,3}/i, "")
            .replace(/^\/([A-Za-z]:)/, "$1")
            .replace(/\\/g, "/");
        if (extensionPath) {
            var explicitFolder = new Folder(extensionPath + "/jsx");
            if (explicitFolder.exists) scriptFolder = explicitFolder;
        }
        if (!scriptFolder) throw new Error("无法定位自动嵌入监听脚本目录");
        var notifierFolder = new Folder(scriptFolder.fsName + "/notifiers");
        var placeFile = new File(notifierFolder.fsName + "/auto_embed_place.jsx");
        var pasteFile = new File(notifierFolder.fsName + "/auto_embed_paste.jsx");
        if (!placeFile.exists || !pasteFile.exists) {
            throw new Error("自动嵌入监听脚本缺失：" + notifierFolder.fsName);
        }
        var enablePlace = !!(options && options.place);
        var enablePaste = !!(options && options.paste);
        var removed = toolRemoveAutoEmbedNotifiers(placeFile, pasteFile);
        var registered = 0;
        if (enablePlace) {
            app.notifiers.add(charIDToTypeID("Plc "), placeFile);
            registered += 1;
        }
        if (enablePaste) {
            app.notifiers.add(charIDToTypeID("past"), pasteFile);
            registered += 1;
        }
        if (registered) app.notifiersEnabled = true;
        return {
            place: enablePlace,
            paste: enablePaste,
            registered: registered,
            removed: removed
        };
    }

    function toolsEmbedSelectedLayersToGroup(options) {
        if (!app.documents.length) {
            throw new Error("请先打开 Photoshop 文档");
        }
        var document = app.activeDocument;
        var selectedIds = selectedLayerIds();
        if (selectedIds.length < 3) {
            throw new Error("请同时选择至少两个图片图层和一个目标图层组");
        }

        var targetGroup = null;
        var groupCount = 0;
        var sources = [];
        var excludedIds = {};
        var index;
        for (index = 0; index < selectedIds.length; index += 1) {
            var selectedLayer = toolLayerById(document, selectedIds[index]);
            if (selectedLayer && selectedLayer.typename === "LayerSet") {
                targetGroup = selectedLayer;
                groupCount += 1;
            } else if (isEmbeddableImageLayer(selectedLayer)) {
                sources.push(selectedLayer);
                excludedIds[String(layerNumericId(selectedLayer))] = true;
            } else {
                throw new Error("多图嵌入只支持普通图片图层、智能对象、形状图层和一个图层组");
            }
        }

        if (groupCount !== 1 || !targetGroup) {
            throw new Error("请准确选择一个目标图层组");
        }
        if (!sources.length) {
            throw new Error("请同时选择需要嵌入的图片图层");
        }

        sortLayersByPanelOrder(document, sources);
        var targets = collectEmbedTargets(targetGroup, excludedIds, []);
        if (!targets.length) {
            throw new Error("目标图层组内没有可用于承载图片的有效图层");
        }
        if (sources.length !== targets.length) {
            throw new Error(
                "图片数量与目标图层数量不一致：已选 " +
                sources.length + " 张图片，图层组内有 " + targets.length + " 个有效目标"
            );
        }

        var sourceIds = [];
        for (index = 0; index < sources.length; index += 1) {
            sourceIds.push(layerNumericId(sources[index]));
        }

        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        try {
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(
                document,
                "鑫洋助理：嵌入多图片",
                function () {
                    var pairs = [];
                    var itemIndex;
                    for (itemIndex = 0; itemIndex < sources.length; itemIndex += 1) {
                        var source = sources[itemIndex];
                        var target = targets[itemIndex];
                        var targetBounds = layerSize(target);
                        try { source.grouped = false; } catch (ignoreUngroupSource) {}
                        try { source.visible = true; } catch (ignoreShowSource) {}
                        source.move(target, ElementPlacement.PLACEBEFORE);
                        document.activeLayer = source;
                        var fitted = fitLayerCoverBounds(source, targetBounds);
                        if (!createDownwardClippingMask(document, source)) {
                            throw new Error("第 " + (itemIndex + 1) + " 张图片未能创建剪切蒙版");
                        }
                        pairs.push({
                            sourceId: layerNumericId(source),
                            sourceName: String(source.name || ("图片" + (itemIndex + 1))),
                            targetId: layerNumericId(target),
                            targetName: String(target.name || ("目标" + (itemIndex + 1))),
                            scalePercent: Math.round(fitted.scalePercent * 100) / 100
                        });
                    }
                    selectLayersByIds(sourceIds);
                    return {
                        processed: pairs.length,
                        groupName: String(targetGroup.name || "目标图层组"),
                        fitMode: "cover",
                        clippingMask: true,
                        pairs: pairs
                    };
                }
            );
        } finally {
            app.preferences.rulerUnits = previousUnits;
            app.displayDialogs = previousDialogs;
        }
    }

    function toolsImportImages(options) {
        if (!app.documents.length) {
            throw new Error("请先打开需要导入图片的 Photoshop 文档");
        }
        var document = app.activeDocument;
        var paths = options && options.files ? options.files : [];
        if (!(paths instanceof Array) || !paths.length) {
            throw new Error("请先选择需要导入的图片");
        }
        var isLinkObject = !!(options && options.isLinkObject);
        var mode = isLinkObject ? "smart" : String(options && options.mode || "smart");
        var layout = String(options && options.layout || "overlay");
        var fit = String(options && options.fit || "original");
        var gap = Math.max(0, integerValue(options && options.gap, 0));
        if (mode !== "raster") mode = "smart";
        if (layout !== "horizontal" && layout !== "vertical") layout = "overlay";
        if (fit !== "fit") fit = "original";

        var files = [];
        var index;
        for (index = 0; index < paths.length; index += 1) files.push(fileObject(paths[index]));

        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        var originalSelection = selectedLayerIds();
        try {
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(document, "鑫洋助理：导入多图片", function () {
                var imported = [];
                var ids = [];
                var itemIndex;
                for (itemIndex = 0; itemIndex < files.length; itemIndex += 1) {
                    var layer = isLinkObject
                        ? placeLinked(document, files[itemIndex])
                        : placeEmbedded(document, files[itemIndex]);
                    layer.name = safeLayerName(displayFileName(files[itemIndex]), "导入图片" + (itemIndex + 1));
                    if (fit === "fit") fitLayerToCanvas(document, layer);
                    centerLayerInCanvas(document, layer);
                    if (mode === "raster" && !isLinkObject) {
                        try { layer.rasterize(RasterizeType.ENTIRELAYER); } catch (ignoreRasterize) {}
                        layer = document.activeLayer;
                    }
                    imported.push(layer);
                    ids.push(activeLayerId());
                }
                if (layout !== "overlay") arrangeImportedLayers(document, imported, layout, gap);
                selectLayersByIds(ids);
                return {
                    imported: imported.length,
                    mode: mode,
                    isLinkObject: isLinkObject,
                    layout: layout,
                    layoutName: layout === "horizontal" ? "横向排列" : layout === "vertical" ? "纵向排列" : "居中叠放"
                };
            });
        } catch (error) {
            try { if (originalSelection.length) selectLayersByIds(originalSelection); } catch (ignoreImportRestore) {}
            throw error;
        } finally {
            app.preferences.rulerUnits = previousUnits;
            app.displayDialogs = previousDialogs;
        }
    }

    return {
        centerLayerInCanvas: centerLayerInCanvas,
        fitLayerToCanvas: fitLayerToCanvas,
        arrangeImportedLayers: arrangeImportedLayers,
        fitLayerCoverBounds: fitLayerCoverBounds,
        createDownwardClippingMask: createDownwardClippingMask,
        directLowerSibling: directLowerSibling,
        clippingDisplayBaseBelow: clippingDisplayBaseBelow,
        isEmbeddableImageLayer: isEmbeddableImageLayer,
        collectArtLayersInPanelOrder: collectArtLayersInPanelOrder,
        sortLayersByPanelOrder: sortLayersByPanelOrder,
        collectEmbedTargets: collectEmbedTargets,
        toolsEmbedSelectedLayerClipped: toolsEmbedSelectedLayerClipped,
        toolsLoadActiveLayerTransparencySelection: toolsLoadActiveLayerTransparencySelection,
        toolsPasteInPlace: toolsPasteInPlace,
        toolsEmbedLowerVisualContent: toolsEmbedLowerVisualContent,
        toolsAutoEmbedActiveLayer: toolsAutoEmbedActiveLayer,
        toolSameFsPath: toolSameFsPath,
        toolRemoveAutoEmbedNotifiers: toolRemoveAutoEmbedNotifiers,
        toolsConfigureAutoEmbed: toolsConfigureAutoEmbed,
        toolsEmbedSelectedLayersToGroup: toolsEmbedSelectedLayersToGroup,
        toolsImportImages: toolsImportImages
    };
};
