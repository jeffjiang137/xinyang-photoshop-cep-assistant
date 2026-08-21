#target photoshop
#targetengine "xinyangTextButtonV2250"

/*
 * 独立按钮入口。只在创建时使用 Mk/contentLayer 描述符，不调用 set，
 * 以避免某些 Photoshop 版本对刚创建形状执行“设置”时报常规错误。
 */
var XinyangTextButtonV2250 = $.global.XinyangTextButtonV2250 = (function () {
    function quote(value) {
        return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"';
    }
    function response(ok, data, message) {
        if (!ok) return "{\"ok\":false,\"error\":" + quote(message || "按钮生成失败") + "}";
        return "{\"ok\":true,\"data\":{\"processed\":" + Number(data.processed || 0) + ",\"created\":" + Number(data.created || 0) + ",\"updated\":0}}";
    }
    function read(value) { try { return value ? eval("(" + value + ")") : {}; } catch (ignoreRead) { return {}; } }
    function pixel(value) { return Number(value.as("px")); }
    function layerBounds(layer) {
        var value = layer.bounds;
        return { left:pixel(value[0]), top:pixel(value[1]), right:pixel(value[2]), bottom:pixel(value[3]) };
    }
    function findLayer(parent, id) {
        var index, layer, result;
        for (index = 0; index < parent.layers.length; index += 1) {
            layer = parent.layers[index];
            try { if (Number(layer.id) === Number(id)) return layer; } catch (ignoreId) {}
            if (layer.typename === "LayerSet") { result = findLayer(layer, id); if (result) return result; }
        }
        return null;
    }
    function selectedTextLayers(document) {
        var indexes = [], output = [], reference, descriptor, list, index, item, query, id, layer;
        try {
            reference = new ActionReference();
            reference.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("targetLayers"));
            reference.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
            descriptor = executeActionGet(reference); list = descriptor.getList(stringIDToTypeID("targetLayers"));
            for (index = 0; index < list.count; index += 1) { item = list.getReference(index); indexes.push(item.getIndex()); }
        } catch (ignoreMulti) {}
        if (!indexes.length) return [document.activeLayer];
        for (index = 0; index < indexes.length; index += 1) {
            try {
                query = new ActionReference(); query.putIndex(charIDToTypeID("Lyr "), indexes[index]);
                id = executeActionGet(query).getInteger(stringIDToTypeID("layerID"));
                layer = findLayer(document, id); if (layer) output.push(layer);
            } catch (ignoreLayer) {}
        }
        return output.length ? output : [document.activeLayer];
    }
    function marker(layer) { return "__XYBTN__" + Number(layer.id) + "__"; }
    function removeOld(parent, prefix) {
        var index, layer;
        for (index = parent.layers.length - 1; index >= 0; index -= 1) {
            layer = parent.layers[index];
            if (String(layer.name || "").indexOf(prefix) === 0) { try { layer.remove(); } catch (ignoreRemove) {} }
            else if (layer.typename === "LayerSet") removeOld(layer, prefix);
        }
    }
    function pad(value, fontSize) {
        var text = String(value || "28,12").replace(/\s/g, ""), values, level;
        if (text.indexOf("auto:") === 0) {
            level = Math.max(1, Math.min(8, Number(text.split(":")[1]) || 4));
            return { x:Math.round(fontSize * [0.2,0.35,0.5,0.7,0.9,1.1,1.35,1.6][level - 1]), y:Math.round(fontSize * [0.1,0.18,0.25,0.35,0.45,0.55,0.68,0.8][level - 1]) };
        }
        values = text.split(/[,，]/);
        return { x:Math.max(0, Number(values[0]) || 0), y:Math.max(0, Number(values[1]) || Number(values[0]) || 0) };
    }
    function rgb(hex) {
        var value = String(hex || "#e53935").replace("#", "");
        if (!/^[0-9a-f]{6}$/i.test(value)) value = "E53935";
        return { red:parseInt(value.substr(0, 2), 16), green:parseInt(value.substr(2, 2), 16), blue:parseInt(value.substr(4, 2), 16) };
    }
    function strokeDefaults(style, width) {
        style.putUnitDouble(stringIDToTypeID("strokeStyleLineWidth"), charIDToTypeID("#Pxl"), Math.max(1, Number(width) || 2));
        style.putEnumerated(stringIDToTypeID("strokeStyleLineAlignment"), stringIDToTypeID("strokeStyleLineAlignment"), stringIDToTypeID("strokeStyleAlignInside"));
        style.putEnumerated(stringIDToTypeID("strokeStyleLineJoinType"), stringIDToTypeID("strokeStyleLineJoinType"), stringIDToTypeID("strokeStyleMiterJoin"));
        style.putBoolean(stringIDToTypeID("strokeStyleScaleLock"), false);
        style.putBoolean(stringIDToTypeID("strokeStyleStrokeAdjust"), false);
        style.putList(stringIDToTypeID("strokeStyleLineDashSet"), new ActionList());
        style.putEnumerated(stringIDToTypeID("strokeStyleBlendMode"), stringIDToTypeID("blendMode"), stringIDToTypeID("normal"));
        style.putUnitDouble(stringIDToTypeID("strokeStyleOpacity"), stringIDToTypeID("percentUnit"), 100);
        style.putDouble(stringIDToTypeID("strokeStyleResolution"), Number(app.activeDocument.resolution) || 72);
    }
    function createLiveRectangle(document, box, radius, hex, border) {
        var value = rgb(hex), make = new ActionDescriptor(), reference = new ActionReference(), using = new ActionDescriptor();
        var fill = new ActionDescriptor(), fillRgb = new ActionDescriptor(), rectangle = new ActionDescriptor(), stroke = new ActionDescriptor();
        reference.putClass(stringIDToTypeID("contentLayer")); make.putReference(charIDToTypeID("null"), reference);
        fillRgb.putDouble(charIDToTypeID("Rd  "), value.red); fillRgb.putDouble(charIDToTypeID("Grn "), value.green); fillRgb.putDouble(charIDToTypeID("Bl  "), value.blue);
        fill.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), fillRgb); using.putObject(charIDToTypeID("Type"), stringIDToTypeID("solidColorLayer"), fill);
        rectangle.putInteger(stringIDToTypeID("unitValueQuadVersion"), 1);
        rectangle.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), box.top); rectangle.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), box.left);
        rectangle.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), box.bottom); rectangle.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), box.right);
        rectangle.putUnitDouble(stringIDToTypeID("topLeft"), charIDToTypeID("#Pxl"), radius); rectangle.putUnitDouble(stringIDToTypeID("topRight"), charIDToTypeID("#Pxl"), radius);
        rectangle.putUnitDouble(stringIDToTypeID("bottomLeft"), charIDToTypeID("#Pxl"), radius); rectangle.putUnitDouble(stringIDToTypeID("bottomRight"), charIDToTypeID("#Pxl"), radius);
        using.putObject(charIDToTypeID("Shp "), charIDToTypeID("Rctn"), rectangle);
        stroke.putInteger(stringIDToTypeID("strokeStyleVersion"), 2); stroke.putBoolean(stringIDToTypeID("fillEnabled"), !border); stroke.putBoolean(stringIDToTypeID("strokeEnabled"), !!border);
        if (border) {
            var content = new ActionDescriptor(), strokeRgb = new ActionDescriptor();
            strokeDefaults(stroke, 2); strokeRgb.putDouble(stringIDToTypeID("red"), value.red); strokeRgb.putDouble(stringIDToTypeID("green"), value.green); strokeRgb.putDouble(stringIDToTypeID("blue"), value.blue);
            content.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), strokeRgb); stroke.putObject(stringIDToTypeID("strokeStyleContent"), stringIDToTypeID("solidColorLayer"), content);
        }
        using.putObject(stringIDToTypeID("strokeStyle"), stringIDToTypeID("strokeStyle"), stroke); make.putObject(charIDToTypeID("Usng"), stringIDToTypeID("contentLayer"), using);
        executeAction(charIDToTypeID("Mk  "), make, DialogModes.NO);
        return document.activeLayer;
    }
    function setTextColor(layer, hex, border) {
        var value = new SolidColor(), source = border ? rgb(hex) : { red:255, green:255, blue:255 };
        value.rgb.red = source.red; value.rgb.green = source.green; value.rgb.blue = source.blue; layer.textItem.color = value;
    }
    function draw(document, textLayer, options) {
        var textBox = layerBounds(textLayer), fontSize = 24, paddingValue, box, radius, background;
        if (!(textBox.right > textBox.left && textBox.bottom > textBox.top)) throw new Error("选中的文字图层没有有效边界");
        try { fontSize = Number(textLayer.textItem.size.as("px")) || 24; } catch (ignoreSize) {}
        paddingValue = pad(options.padding, fontSize);
        box = { left:textBox.left-paddingValue.x, top:textBox.top-paddingValue.y, right:textBox.right+paddingValue.x, bottom:textBox.bottom+paddingValue.y };
        radius = options.type === "1" ? 0 : Math.max(0, Math.min((box.right-box.left)/2, (box.bottom-box.top)/2, (box.bottom-box.top)/2));
        removeOld(document, marker(textLayer));
        background = createLiveRectangle(document, box, radius, options.color, !!options.isBorder);
        background.name = marker(textLayer) + (options.isBorder ? "border vector" : "fill vector");
        setTextColor(textLayer, options.color, !!options.isBorder);
        background.move(textLayer, ElementPlacement.PLACEAFTER);
    }
    function invoke(payload) {
        try {
            if (!app.documents.length) throw new Error("请先打开文档并选择文字图层");
            var document = app.activeDocument, options = read(payload), layers = selectedTextLayers(document), index, processed = 0;
            for (index = 0; index < layers.length; index += 1) {
                if (layers[index] && layers[index].typename === "ArtLayer" && layers[index].kind === LayerKind.TEXT) { draw(document, layers[index], options); processed += 1; }
            }
            if (!processed) throw new Error("当前选择中没有文字图层");
            return response(true, { processed:processed, created:processed });
        } catch (error) { return response(false, null, error && error.message ? error.message : String(error)); }
    }
    return { invoke:invoke };
}());
