/* 鑫洋助理 ExtendScript 模块：coreLayers（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.coreLayers = function (deps) {
    deps = deps || {};
    var currentDocumentId = deps.currentDocumentId;
    var pixels = deps.pixels;
    var layerSize = deps.layerSize;
    var activeLayerId = deps.activeLayerId;
    var selectLayersByIds = deps.selectLayersByIds;

    var toolTextFormattingLayerCache = null;

    function findLayerById(container, id) {
        var index;
        for (index = 0; index < container.layers.length; index += 1) {
            var layer = container.layers[index];
            try {
                if (layer.id === id) return layer;
            } catch (ignoreLayerId) {}
            if (layer.typename === "LayerSet") {
                var nested = findLayerById(layer, id);
                if (nested) return nested;
            }
        }
        return null;
    }

    function toolLayerById(document, id) {
        selectLayersByIds([id]);
        return document.activeLayer;
    }

    function toolLayersByIdsWithoutSelection(document, ids) {
        var wanted = {};
        var found = {};
        var output = [];
        var index;
        for (index = 0; index < ids.length; index += 1) {
            wanted["id_" + ids[index]] = true;
        }
        function walk(container) {
            var layerIndex;
            for (layerIndex = 0; layerIndex < container.layers.length; layerIndex += 1) {
                var layer = container.layers[layerIndex];
                var layerId = -1;
                try { layerId = Number(layer.id); } catch (ignoreLayerId) {}
                if (wanted["id_" + layerId]) found["id_" + layerId] = layer;
                if (layer.typename === "LayerSet") walk(layer);
            }
        }
        walk(document);
        for (index = 0; index < ids.length; index += 1) {
            output.push(found["id_" + ids[index]] || null);
        }
        return output;
    }

    function toolTextFormattingLayers(document, ids) {
        var key = ids.join(",");
        var now = new Date().getTime();
        var documentId = currentDocumentId();
        var cache = toolTextFormattingLayerCache;
        var valid = !!(
            cache && cache.documentId === documentId && cache.key === key &&
            now - cache.time < 2200 && cache.layers &&
            cache.layers.length === ids.length
        );
        if (valid) {
            var index;
            for (index = 0; index < ids.length; index += 1) {
                try {
                    if (!cache.layers[index] || Number(cache.layers[index].id) !== Number(ids[index])) {
                        valid = false;
                        break;
                    }
                } catch (ignoreStaleLayer) {
                    valid = false;
                    break;
                }
            }
        }
        if (valid) {
            cache.time = now;
            return cache.layers;
        }
        var layers = toolLayersByIdsWithoutSelection(document, ids);
        toolTextFormattingLayerCache = {
            documentId: documentId,
            key: key,
            time: now,
            layers: layers
        };
        return layers;
    }

    function layerNumericId(layer) {
        try {
            return Number(layer.id);
        } catch (ignoreLayerId) {
            return -1;
        }
    }

    function toolLayerBoundsPixels(layer) {
        try {
            var bounds = layer.bounds;
            return {
                left: pixels(bounds[0]),
                top: pixels(bounds[1]),
                right: pixels(bounds[2]),
                bottom: pixels(bounds[3])
            };
        } catch (ignoreLayerBounds) {
            return null;
        }
    }

    function toolLayerIsEmpty(layer) {
        if (!layer || layer.typename !== "ArtLayer") return false;
        try { if (layer.isBackgroundLayer) return false; } catch (ignoreBackgroundLayer) {}

        var kindName = "";
        try { kindName = String(layer.kind || ""); } catch (ignoreLayerKind) {}
        if (/TEXT/i.test(kindName)) {
            try {
                return String(layer.textItem.contents || "")
                    .replace(/[\s\r\n]+/g, "") === "";
            } catch (ignoreEmptyText) {
                return false;
            }
        }

        /*
         * 只把普通像素层判定为空层。智能对象、形状、调整层和填充层
         * 即使当前可见边界为 0，也可能仍包含可编辑数据，不能误删。
         */
        if (kindName && !/NORMAL/i.test(kindName)) return false;
        var bounds = toolLayerBoundsPixels(layer);
        if (!bounds) return false;
        return bounds.right - bounds.left <= 0.01 ||
            bounds.bottom - bounds.top <= 0.01;
    }

    function toolLayersEmpty(layer) {
        return toolLayerIsEmpty(layer);
    }

    function toolLayerOutsideCanvas(document, layer) {
        if (!document || !layer || layer.typename !== "ArtLayer") return false;
        var bounds = toolLayerBoundsPixels(layer);
        if (!bounds) return false;
        var width = pixels(document.width);
        var height = pixels(document.height);
        return bounds.right <= 0 || bounds.bottom <= 0 ||
            bounds.left >= width || bounds.top >= height;
    }

    function toolLayerIsDescendantOf(layer, possibleAncestor) {
        var parent = null;
        try { parent = layer.parent; } catch (ignoreParent) { return false; }
        while (parent) {
            if (parent === possibleAncestor) return true;
            if (parent.typename === "Document") break;
            try { parent = parent.parent; } catch (ignoreNextParent) { break; }
        }
        return false;
    }

    function toolLayerGroupedState(layer) {
        try {
            return layer.typename === "ArtLayer" && !!layer.grouped;
        } catch (ignoreGroupedState) {
            return false;
        }
    }

    function toolSetLayerGroupedState(layer, grouped) {
        if (!layer || layer.typename !== "ArtLayer") return;
        try { layer.grouped = !!grouped; } catch (ignoreSetGroupedState) {}
    }

    function toolLayerId(document, layer) {
        document.activeLayer = layer;
        return activeLayerId();
    }

    function toolCollectLayers(container, output, includeGroups) {
        var index;
        for (index = 0; index < container.layers.length; index += 1) {
            var layer = container.layers[index];
            if (includeGroups || layer.typename !== "LayerSet") output.push(layer);
            if (layer.typename === "LayerSet") {
                toolCollectLayers(layer, output, includeGroups);
            }
        }
        return output;
    }

    function toolCollectGroupChildren(group, output) {
        var index;
        for (index = 0; index < group.layers.length; index += 1) {
            var layer = group.layers[index];
            output.push(layer);
            if (layer.typename === "LayerSet") toolCollectGroupChildren(layer, output);
        }
    }

    function toolLayerType(layer) {
        if (layer.typename === "LayerSet") return "group";
        if (layer.typename !== "ArtLayer") return String(layer.typename || "layer");
        try {
            if (layer.kind === LayerKind.TEXT) return "text";
            if (layer.kind === LayerKind.SMARTOBJECT) return "smartObject";
            if (layer.kind === LayerKind.SOLIDFILL) return "solidFill";
            if (layer.kind === LayerKind.GRADIENTFILL) return "gradientFill";
            if (layer.kind === LayerKind.PATTERNFILL) return "patternFill";
            if (layer.kind === LayerKind.NORMAL) return "pixel";
        } catch (ignoreKind) {}
        return "artLayer";
    }

    function toolLayerSort(layers, mode) {
        var copy = layers.slice(0);
        if (mode === "topdown" || mode === "leftright") {
            copy.sort(function (left, right) {
                var a;
                var b;
                try { a = layerSize(left); } catch (ignoreLeft) { a = { left: 0, top: 0 }; }
                try { b = layerSize(right); } catch (ignoreRight) { b = { left: 0, top: 0 }; }
                if (mode === "leftright") {
                    if (Math.abs(a.left - b.left) > 0.5) return a.left - b.left;
                    return a.top - b.top;
                }
                if (Math.abs(a.top - b.top) > 0.5) return a.top - b.top;
                return a.left - b.left;
            });
        }
        return copy;
    }

    function toolLayerVisualBounds(layer) {
        var bounds;
        try { bounds = layer.boundsNoEffects; } catch (ignoreNoEffects) { bounds = layer.bounds; }
        return {
            left: pixels(bounds[0]),
            top: pixels(bounds[1]),
            right: pixels(bounds[2]),
            bottom: pixels(bounds[3])
        };
    }

    function toolCollectLayersRecursive(container, output) {
        output = output || [];
        if (!container || !container.layers) return output;
        var index;
        for (index = 0; index < container.layers.length; index += 1) {
            var layer = container.layers[index];
            output.push(layer);
            if (layer.typename === "LayerSet") toolCollectLayersRecursive(layer, output);
        }
        return output;
    }

    function toolCollectAllLayersInPanelOrder(container, output) {
        output = output || [];
        var layers = container && container.layers ? container.layers : null;
        if (!layers) return output;
        var index;
        for (index = 0; index < layers.length; index += 1) {
            output.push(layers[index]);
            if (layers[index].typename === "LayerSet") toolCollectAllLayersInPanelOrder(layers[index], output);
        }
        return output;
    }

    return {
        findLayerById: findLayerById,
        toolLayerById: toolLayerById,
        toolLayersByIdsWithoutSelection: toolLayersByIdsWithoutSelection,
        toolTextFormattingLayers: toolTextFormattingLayers,
        layerNumericId: layerNumericId,
        toolLayerBoundsPixels: toolLayerBoundsPixels,
        toolLayerIsEmpty: toolLayerIsEmpty,
        toolLayersEmpty: toolLayersEmpty,
        toolLayerOutsideCanvas: toolLayerOutsideCanvas,
        toolLayerIsDescendantOf: toolLayerIsDescendantOf,
        toolLayerGroupedState: toolLayerGroupedState,
        toolSetLayerGroupedState: toolSetLayerGroupedState,
        toolLayerId: toolLayerId,
        toolCollectLayers: toolCollectLayers,
        toolCollectGroupChildren: toolCollectGroupChildren,
        toolLayerType: toolLayerType,
        toolLayerSort: toolLayerSort,
        toolLayerVisualBounds: toolLayerVisualBounds,
        toolCollectLayersRecursive: toolCollectLayersRecursive,
        toolCollectAllLayersInPanelOrder: toolCollectAllLayersInPanelOrder
    };
};
