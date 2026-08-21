#target photoshop
#targetengine "xinyangTextButtonV2249"

var XinyangTextButtonV2249 = $.global.XinyangTextButtonV2249 = (function () {
    function jsonEscape(value) {
        return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
    }
    function result(ok, data, error) {
        if (!ok) return "{\"ok\":false,\"error\":" + jsonEscape(error || "按钮生成失败") + "}";
        return "{\"ok\":true,\"data\":{\"processed\":" + Number(data.processed || 0) + ",\"created\":" + Number(data.created || 0) + ",\"updated\":" + Number(data.updated || 0) + "}}";
    }
    function parse(value) {
        try { return value ? eval("(" + value + ")") : {}; } catch (ignoreParse) { return {}; }
    }
    function px(value) { return Number(value.as("px")); }
    function bounds(layer) {
        var value = layer.bounds;
        return { left:px(value[0]), top:px(value[1]), right:px(value[2]), bottom:px(value[3]) };
    }
    function textLayers(document) {
        var ids = [];
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("targetLayers"));
        ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        try {
            var descriptor = executeActionGet(ref);
            var list = descriptor.getList(stringIDToTypeID("targetLayers"));
            var index;
            for (index = 0; index < list.count; index += 1) {
                var item = list.getReference(index);
                ids.push(item.getIndex());
            }
        } catch (ignoreMultiSelection) {}
        if (!ids.length) return [document.activeLayer];
        var output = [];
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var refByIndex = new ActionReference();
            refByIndex.putIndex(charIDToTypeID("Lyr "), ids[index]);
            try {
                var id = executeActionGet(refByIndex).getInteger(stringIDToTypeID("layerID"));
                var layer = findById(document, id);
                if (layer) output.push(layer);
            } catch (ignoreLayerLookup) {}
        }
        return output.length ? output : [document.activeLayer];
    }
    function findById(parent, id) {
        var index;
        for (index = 0; index < parent.layers.length; index += 1) {
            var layer = parent.layers[index];
            try { if (Number(layer.id) === Number(id)) return layer; } catch (ignoreId) {}
            if (layer.typename === "LayerSet") {
                var found = findById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
    function marker(layer) { return "__XYBTN__" + Number(layer.id) + "__"; }
    function removeOld(parent, prefix) {
        var index;
        for (index = parent.layers.length - 1; index >= 0; index -= 1) {
            var layer = parent.layers[index];
            if (String(layer.name || "").indexOf(prefix) === 0) { try { layer.remove(); } catch (ignoreRemove) {} }
            else if (layer.typename === "LayerSet") removeOld(layer, prefix);
        }
    }
    function padding(value, fontSize) {
        var text = String(value || "28,12").replace(/\s/g, "");
        if (text.indexOf("自动生成") === 0) text = "auto:" + text.replace("自动生成", "");
        if (text.indexOf("auto:") === 0) {
            var level = Math.max(1, Math.min(8, Number(text.split(":")[1]) || 4));
            return { x:Math.round(fontSize * [0.2,0.35,0.5,0.7,0.9,1.1,1.35,1.6][level - 1]), y:Math.round(fontSize * [0.1,0.18,0.25,0.35,0.45,0.55,0.68,0.8][level - 1]) };
        }
        var values = text.split(/[,，]/);
        return { x:Math.max(0, Number(values[0]) || 0), y:Math.max(0, Number(values[1]) || Number(values[0]) || 0) };
    }
    function color(hex) {
        var value = String(hex || "#e53935").replace("#", "");
        var output = new SolidColor();
        output.rgb.hexValue = /^[0-9a-f]{6}$/i.test(value) ? value : "E53935";
        return output;
    }
    function draw(document, textLayer, options) {
        var box = bounds(textLayer);
        if (!(box.right > box.left && box.bottom > box.top)) throw new Error("选中文字图层没有有效边界");
        var size = 24;
        try { size = Number(textLayer.textItem.size.as("px")) || 24; } catch (ignoreFontSize) {}
        var pad = padding(options.padding, size);
        var left = box.left - pad.x, top = box.top - pad.y, right = box.right + pad.x, bottom = box.bottom + pad.y;
        var radius = options.type === "1" ? 0 : Math.max(0, (bottom - top) / 2);
        var border = !!options.isBorder;
        removeOld(document, marker(textLayer));
        var background = document.artLayers.add();
        background.name = marker(textLayer) + (border ? "border" : "fill");
        document.activeLayer = background;
        document.selection.select([[left,top],[right,top],[right,bottom],[left,bottom]]);
        if (radius > 0) { try { document.selection.smooth(Math.max(1, Math.round(radius))); } catch (ignoreSmooth) {} }
        var fill = color(options.color);
        document.selection.fill(fill, ColorBlendMode.NORMAL, 100, false);
        document.selection.deselect();
        if (border) {
            var line = 2;
            if (right - left > line * 2 && bottom - top > line * 2) {
                document.selection.select([[left+line,top+line],[right-line,top+line],[right-line,bottom-line],[left+line,bottom-line]]);
                if (radius > line) { try { document.selection.smooth(Math.max(1, Math.round(radius-line))); } catch (ignoreInnerSmooth) {} }
                document.selection.clear();
                document.selection.deselect();
            }
            textLayer.textItem.color = fill;
        } else {
            var white = new SolidColor(); white.rgb.red = 255; white.rgb.green = 255; white.rgb.blue = 255;
            textLayer.textItem.color = white;
        }
        background.move(textLayer, ElementPlacement.PLACEAFTER);
    }
    function invoke(payload) {
        try {
            if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
            var document = app.activeDocument, options = parse(payload), layers = textLayers(document), processed = 0;
            var index;
            for (index = 0; index < layers.length; index += 1) {
                if (layers[index] && layers[index].typename === "ArtLayer" && layers[index].kind === LayerKind.TEXT) { draw(document, layers[index], options); processed += 1; }
            }
            if (!processed) throw new Error("当前选择中没有文字图层");
            return result(true, { processed:processed, created:processed, updated:0 });
        } catch (error) { return result(false, null, error && error.message ? error.message : String(error)); }
    }
    return { invoke:invoke };
}());
