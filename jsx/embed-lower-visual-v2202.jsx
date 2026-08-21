/* 鑫洋助理 v2.2.02 - 独立“嵌入下方图层”入口
 * 绕过长期驻留 CEP 会话中的旧 LongStitchCEP 方法表，避免“未知功能”。
 */
var XinyangEmbedLowerV2202 = $.global.XinyangEmbedLowerV2202 = (function () {
    var activeJob = null;

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
            var arrayParts = [], index;
            for (index = 0; index < value.length; index += 1) arrayParts.push(toJson(value[index]));
            return "[" + arrayParts.join(",") + "]";
        }
        if (typeof value === "object") {
            var objectParts = [], key;
            for (key in value) {
                if (value.hasOwnProperty(key)) objectParts.push(escapeJsonString(key) + ":" + toJson(value[key]));
            }
            return "{" + objectParts.join(",") + "}";
        }
        return "null";
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
                var list = descriptor.getList(property), index;
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

    function findLayerById(container, id) {
        var index;
        if (!container || !container.layers) return null;
        for (index = 0; index < container.layers.length; index += 1) {
            var layer = container.layers[index];
            try { if (Number(layer.id) === Number(id)) return layer; } catch (ignoreLayerId) {}
            if (layer.typename === "LayerSet") {
                var nested = findLayerById(layer, id);
                if (nested) return nested;
            }
        }
        return null;
    }

    function layerNumericId(layer) {
        try { return Number(layer.id); } catch (ignoreLayerId) { return -1; }
    }

    function collectArtLayersInPanelOrder(container, output) {
        output = output || [];
        if (!container || !container.layers) return output;
        var index;
        for (index = 0; index < container.layers.length; index += 1) {
            var layer = container.layers[index];
            if (layer.typename === "LayerSet") collectArtLayersInPanelOrder(layer, output);
            else if (layer.typename === "ArtLayer") output.push(layer);
        }
        return output;
    }

    function loadTransparencySelection(document, layer) {
        document.activeLayer = layer;
        var setSelection = new ActionDescriptor();
        var selectionRef = new ActionReference();
        selectionRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
        setSelection.putReference(charIDToTypeID("null"), selectionRef);
        var transparencyRef = new ActionReference();
        transparencyRef.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
        setSelection.putReference(charIDToTypeID("T   "), transparencyRef);
        executeAction(charIDToTypeID("setd"), setSelection, DialogModes.NO);
        var bounds = document.selection.bounds;
        if (!bounds || bounds.length < 4) throw new Error("当前图层没有可用于建立选区的可见内容");
        return {
            left: pixels(bounds[0]), top: pixels(bounds[1]),
            right: pixels(bounds[2]), bottom: pixels(bounds[3])
        };
    }

    function loadRenderedSourceSelection(document, layer) {
        var temporary = null;
        try {
            document.activeLayer = layer;
            temporary = layer.duplicate();
            temporary.name = "__鑫洋助理_选区临时层__";
            document.activeLayer = temporary;
            try { temporary.grouped = false; } catch (ignoreUngroupTemporary) {}
            try {
                temporary.rasterize(RasterizeType.ENTIRELAYER);
            } catch (rasterizeError) {
                /* 某些图层类型不能直接 RasterizeType.ENTIRELAYER，继续尝试
                   Photoshop 当前图层“栅格化图层”事件；两种方式都失败才报错。 */
                try { executeAction(stringIDToTypeID("rasterizeLayer"), undefined, DialogModes.NO); }
                catch (ignoreRasterizeEvent) { throw rasterizeError; }
            }
            return loadTransparencySelection(document, temporary);
        } finally {
            if (temporary) {
                try { temporary.remove(); } catch (ignoreRemoveTemporary) {}
            }
            try { document.activeLayer = layer; } catch (ignoreRestoreSource) {}
        }
    }

    function saveSelectionChannel(document) {
        var channel = document.channels.add();
        channel.name = "__XY_EMBED_SELECTION_" + String((new Date()).getTime());
        document.selection.store(channel, SelectionType.REPLACE);
        return channel;
    }

    function restoreSelectionChannel(document, channel) {
        if (!channel) return;
        document.selection.load(channel, SelectionType.REPLACE, false);
    }

    function hardCropLayerToSelection(document, layer, channel) {
        restoreSelectionChannel(document, channel);
        document.activeLayer = layer;
        try {
            document.selection.invert();
            document.selection.clear();
        } catch (clearError) {
            throw new Error("无法按当前图层选区裁掉复制层范围外的像素");
        } finally {
            try { document.selection.deselect(); } catch (ignoreDeselectCrop) {}
        }
    }

    function pasteInPlace(document) {
        try {
            executeAction(stringIDToTypeID("pasteInPlace"), undefined, DialogModes.NO);
            return document.activeLayer;
        } catch (ignorePasteInPlace) {
            var pasted = document.paste();
            return pasted || document.activeLayer;
        }
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

    function isEffectivelyVisible(layer) {
        var current = layer;
        while (current && current.typename !== "Document") {
            try { if (!current.visible) return false; } catch (ignoreVisible) {}
            try { current = current.parent; } catch (ignoreParent) { break; }
        }
        return true;
    }

    function firstVisibleLowerLayer(panelOrder, sourceIndex) {
        var index;
        for (index = sourceIndex + 1; index < panelOrder.length; index += 1) {
            var layer = panelOrder[index];
            if (!layer || layer.typename !== "ArtLayer") continue;
            if (isEffectivelyVisible(layer)) return layer;
        }
        return null;
    }

    function stampVisibleToNewLayer(document) {
        var beforeId = -1;
        try { beforeId = activeLayerId(); } catch (ignoreBeforeId) {}
        var descriptor = new ActionDescriptor();
        descriptor.putBoolean(stringIDToTypeID("duplicate"), true);
        executeAction(stringIDToTypeID("mergeVisible"), descriptor, DialogModes.NO);
        var layer = document.activeLayer;
        if (!layer || layer.typename !== "ArtLayer") throw new Error("Photoshop 未能生成视觉下层合成层");
        var afterId = layerNumericId(layer);
        if (afterId === beforeId) throw new Error("Photoshop 未生成新的视觉下层合成层");
        return layer;
    }

    function hasVisiblePixels(document, layer) {
        var previous = null;
        try { previous = document.activeLayer; } catch (ignorePrevious) {}
        try {
            document.activeLayer = layer;
            loadTransparencySelection(document, layer);
            return true;
        } catch (ignoreNoPixels) {
            return false;
        } finally {
            try { document.selection.deselect(); } catch (ignoreDeselectCheck) {}
            if (previous) { try { document.activeLayer = previous; } catch (ignoreRestoreActive) {} }
        }
    }

    function executeEmbed() {
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
            if (source.grouped) throw new Error("当前图层本身已是剪切蒙版，无法作为新的剪切底图；请先释放当前图层的剪切关系");
        } catch (groupedError) {
            if (groupedError && String(groupedError.message || "").indexOf("当前图层本身已是剪切蒙版") >= 0) throw groupedError;
        }

        var panelOrder = collectArtLayersInPanelOrder(document, []);
        var sourceIndex = -1, index;
        for (index = 0; index < panelOrder.length; index += 1) {
            if (layerNumericId(panelOrder[index]) === Number(sourceId)) { sourceIndex = index; break; }
        }
        if (sourceIndex < 0 || sourceIndex >= panelOrder.length - 1) {
            throw new Error("当前图层视觉下方没有可复制的图层内容");
        }

        loadRenderedSourceSelection(document, source);
        var selectionChannel = saveSelectionChannel(document);

        var visibilityState = [];
        var lowerComposite = null;
        try {
            /* panelOrder 按视觉从上到下：隐藏当前层及其上方。
               v2.2.02 不再直接依赖“隐藏中的当前层 + Copy Merged”，
               而是先把一个真正可见的下层设为活动层，再“盖印可见图层”到新层。
               这样在 Photoshop 27.3.x、长图、形状/像素/智能对象混排下都不会
               因活动层已隐藏而误报“选区内没有可复制内容”。 */
            for (index = 0; index <= sourceIndex; index += 1) {
                var upper = panelOrder[index];
                var wasVisible = false;
                try { wasVisible = !!upper.visible; } catch (ignoreReadVisibility) {}
                visibilityState.push({ layer: upper, visible: wasVisible });
                if (wasVisible) {
                    try { upper.visible = false; } catch (ignoreHideUpper) {}
                }
            }

            var lowerAnchor = firstVisibleLowerLayer(panelOrder, sourceIndex);
            if (!lowerAnchor) {
                throw new Error("当前图层视觉下方没有可见图层内容");
            }
            try { document.activeLayer = lowerAnchor; }
            catch (activateLowerError) { throw new Error("无法激活当前图层视觉下方的可见内容"); }

            /* 盖印整个视觉下层到临时新层，再用最初源图层的真实像素选区硬裁。
               与 Copy Merged 相比，这一步不依赖剪贴板，也不会因为活动层隐藏而失败。 */
            try {
                lowerComposite = stampVisibleToNewLayer(document);
                lowerComposite.name = "__鑫洋助理_视觉下层临时合成__";
            } catch (stampError) {
                /* 少数宿主若不支持 duplicate=true 的 Merge Visible，再回退到
                   “可见下层作为活动层 + Copy Merged”。 */
                restoreSelectionChannel(document, selectionChannel);
                try {
                    document.selection.copy(true);
                    lowerComposite = null;
                } catch (copyError) {
                    throw new Error("当前图层选区内没有可复制的视觉下层内容");
                }
            }
        } finally {
            for (index = visibilityState.length - 1; index >= 0; index -= 1) {
                try { visibilityState[index].layer.visible = visibilityState[index].visible; } catch (ignoreRestoreVisibility) {}
            }
        }

        try { document.selection.deselect(); } catch (ignoreDeselect) {}
        var copied = lowerComposite;
        if (!copied) {
            document.activeLayer = source;
            copied = pasteInPlace(document);
            if (!copied || copied.typename !== "ArtLayer") throw new Error("Photoshop 未能粘贴视觉下层内容");
        }

        /* 不论来自“盖印可见图层”还是 Copy Merged 回退，最后都严格使用
           最初源图层的真实像素选区硬裁，因此新图层本身只保留当前图层范围。 */
        hardCropLayerToSelection(document, copied, selectionChannel);
        if (!hasVisiblePixels(document, copied)) {
            try { copied.remove(); } catch (ignoreRemoveEmptyComposite) {}
            throw new Error("当前图层范围内的视觉下层是透明的，没有可嵌入内容");
        }
        try { selectionChannel.remove(); } catch (ignoreRemoveSelectionChannel) {}
        selectionChannel = null;

        copied.name = String(source.name || "当前图层") + "_下方内容";
        try { copied.move(source, ElementPlacement.PLACEBEFORE); }
        catch (moveError) { throw new Error("无法把复制内容移动到原图层上方"); }

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
            selectionMode: "renderedSourcePixelsHardCrop",
            lowerMode: "visualStampedBelow",
            clippingMask: true,
            standalone: "V2202"
        };
    }

    function runInsideHistory() {
        if (!activeJob) throw new Error("没有可执行的嵌入任务");
        activeJob.result = executeEmbed();
    }

    function invoke(payloadJson) {
        var previousDialogs = app.displayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        var document = null;
        try {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            document = app.activeDocument;
            app.displayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            activeJob = { result: null };
            var historyBefore = null;
            try { historyBefore = document.activeHistoryState; } catch (ignoreReadHistory) {}
            try {
                document.suspendHistory("鑫洋助理：嵌入下方图层", "XinyangEmbedLowerV2202._runJob()");
            } catch (historyError) {
                if (historyBefore) {
                    try { document.activeHistoryState = historyBefore; } catch (ignoreRollbackHistory) {}
                }
                throw historyError;
            }
            return toJson({ ok: true, data: activeJob.result || {} });
        } catch (error) {
            try { if (document) document.selection.deselect(); } catch (ignoreDeselectError) {}
            return toJson({ ok: false, error: String(error && error.message ? error.message : error) + (error && error.line ? "（脚本第 " + error.line + " 行）" : "") });
        } finally {
            activeJob = null;
            try { app.preferences.rulerUnits = previousUnits; } catch (ignoreRestoreUnits) {}
            try { app.displayDialogs = previousDialogs; } catch (ignoreRestoreDialogs) {}
        }
    }

    return {
        invoke: invoke,
        _runJob: runInsideHistory
    };
}());
