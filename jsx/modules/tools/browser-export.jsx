/* Export only in a disposable document; never alter the source history. */
var XinyangHostModules = $.global.XinyangHostModules;
XinyangHostModules.browserExport = function (deps) {
    function browserSelectedLayerIds() {
        /* An explicitly empty target list means Select > Deselect Layers.
         * The shared helper falls back to activeLayer even in that case. */
        try {
            var property = stringIDToTypeID("targetLayersIDs");
            var reference = new ActionReference();
            reference.putProperty(stringIDToTypeID("property"), property);
            reference.putEnumerated(stringIDToTypeID("document"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var descriptor = executeActionGet(reference);
            if (descriptor.hasKey(property)) {
                var list = descriptor.getList(property);
                var ids = [];
                for (var i = 0; i < list.count; i += 1) ids.push(list.getReference(i).getIdentifier(charIDToTypeID("Lyr ")));
                return ids;
            }
        } catch (ignoreSelectionList) {}
        return deps.selectedLayerIds();
    }
    function toolsExportToBrowser() {
        if (!app.documents.length) throw new Error("请先打开文档");
        var source = app.activeDocument;
        var bounds = deps.currentPixelSelectionBounds(source);
        var onlyBackground = false;
        if (source.layers.length === 1) {
            try { onlyBackground = source.layers[0].isBackgroundLayer === true; } catch (ignoreBackgroundKind) {}
            if (!onlyBackground) {
                try { onlyBackground = !!source.backgroundLayer; } catch (ignoreSingleBackground) {}
            }
        }
        /* A lone Background always fills the canvas. Do not enumerate its
         * special index 0 or run transparent trim on its opaque pixels. */
        var ids = onlyBackground ? [] : browserSelectedLayerIds();
        var selectedBackground = false;
        if (!bounds && !onlyBackground && ids.length === 1) {
            try {
                if (source.backgroundLayer) {
                    var backgroundRef = new ActionReference();
                    backgroundRef.putIndex(charIDToTypeID("Lyr "), 0);
                    var backgroundDescriptor = executeActionGet(backgroundRef);
                    selectedBackground = Number(backgroundDescriptor.getInteger(stringIDToTypeID("layerID"))) === Number(ids[0]);
                }
            } catch (ignoreSelectedBackground) {}
        }
        var copy = null;
        var file = new File(Folder.temp.fsName + "/xinyang_browser_" + (new Date()).getTime() + ".png");
        var dialogs = app.displayDialogs;
        var stage = "读取图层";
        function captureLayers() {
            var tree = [];
            var parents = [];
            var current = tree;
            var documentRef = new ActionReference();
            documentRef.putProperty(stringIDToTypeID("property"), stringIDToTypeID("numberOfLayers"));
            documentRef.putEnumerated(stringIDToTypeID("document"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var count = executeActionGet(documentRef).getInteger(stringIDToTypeID("numberOfLayers"));
            var bottom = 1;
            try { if (source.backgroundLayer) bottom = 0; } catch (ignoreBackground) {}
            for (var i = count; i >= bottom; i -= 1) {
                var reference = new ActionReference();
                reference.putIndex(charIDToTypeID("Lyr "), i);
                var descriptor = executeActionGet(reference);
                var section = descriptor.hasKey(stringIDToTypeID("layerSection"))
                    ? typeIDToStringID(descriptor.getEnumerationValue(stringIDToTypeID("layerSection"))) : "layerSectionContent";
                if (section === "layerSectionEnd") {
                    if (!parents.length) throw new Error("图层组结构不完整");
                    current = parents.pop();
                    continue;
                }
                var node = { id: descriptor.getInteger(stringIDToTypeID("layerID")),
                    visible: descriptor.getBoolean(stringIDToTypeID("visible")),
                    children: section === "layerSectionStart" ? [] : null };
                current.push(node);
                if (node.children) { parents.push(current); current = node.children; }
            }
            if (parents.length) throw new Error("图层组结构不完整");
            return tree;
        }
        function isolate(originalLayers, copiedLayers, inherited) {
            if (originalLayers.length !== copiedLayers.length) throw new Error("临时文档图层结构不一致");
            var any = false;
            for (var i = 0; i < originalLayers.length; i += 1) {
                var original = originalLayers[i];
                var cloned = copiedLayers[i];
                var chosen = inherited;
                for (var j = 0; j < ids.length; j += 1) {
                    if (Number(original.id) === Number(ids[j])) chosen = true;
                }
                var children = false;
                if (original.children) children = isolate(original.children, cloned.layers, chosen);
                var visible = chosen ? original.visible : children;
                if (cloned.visible !== visible) cloned.visible = visible;
                if (cloned.visible) any = true;
            }
            return any;
        }
        try {
            app.displayDialogs = DialogModes.NO;
            var layerTree = !bounds && ids.length && !selectedBackground ? captureLayers() : null;
            stage = "复制临时文档";
            copy = source.duplicate("浏览器临时图片", false);
            app.activeDocument = copy;
            stage = "隔离选中图层";
            if (selectedBackground) {
                for (var layerIndex = 0; layerIndex < copy.layers.length; layerIndex += 1) {
                    var copiedLayer = copy.layers[layerIndex];
                    var keepBackground = copiedLayer.isBackgroundLayer === true;
                    if (!keepBackground && copiedLayer.visible) copiedLayer.visible = false;
                }
                if (!copy.backgroundLayer.visible) throw new Error("选中背景没有可见内容");
            } else if (!bounds && ids.length) {
                if (!isolate(layerTree, copy.layers, false)) throw new Error("选中图层没有可见内容");
            }
            stage = "裁剪图片范围";
            copy.selection.deselect();
            if (bounds) copy.crop([UnitValue(bounds.left, "px"), UnitValue(bounds.top, "px"), UnitValue(bounds.right, "px"), UnitValue(bounds.bottom, "px")]);
            else if (ids.length) {
                var opaqueBackground = false;
                try { opaqueBackground = copy.backgroundLayer.visible; } catch (ignoreOpaqueBackground) {}
                if (!opaqueBackground) copy.trim(TrimType.TRANSPARENT, true, true, true, true);
            }
            stage = "转换图片颜色";
            if (copy.mode !== DocumentMode.RGB) copy.changeMode(ChangeMode.RGB);
            if (copy.bitsPerChannel !== BitsPerChannelType.EIGHT) copy.bitsPerChannel = BitsPerChannelType.EIGHT;
            stage = "导出 Web PNG";
            var web = new ExportOptionsSaveForWeb();
            web.format = SaveDocumentType.PNG;
            web.PNG8 = false;
            web.transparency = true;
            web.interlaced = false;
            web.includeProfile = false;
            var exportMode = "web";
            try {
                copy.exportDocument(file, ExportType.SAVEFORWEB, web);
            } catch (webError) {
                /* Some Photoshop installations reject Save for Web. Native PNG
                 * preserves the exact pixels and has no Save for Web size cap. */
                stage = "兼容导出 PNG";
                try { if (file.exists) file.remove(); } catch (ignorePartial) {}
                var png = new PNGSaveOptions();
                png.interlaced = false;
                png.compression = 9;
                copy.saveAs(file, png, true, Extension.LOWERCASE);
                exportMode = "native";
            }
            if (!file.exists || file.length <= 0) throw new Error("图片文件未生成");
            return { tempPath: file.fsName, scope: bounds ? "selection" : ids.length ? "layers" : "canvas", format: "png", exportMode: exportMode };
        } catch (error) {
            try { if (file.exists) file.remove(); } catch (ignoreRemove) {}
            throw new Error(stage + "失败：" + String(error.message || error) + "（错误码 " + String(error.number || "未知") + "）");
        } finally {
            if (copy) try { copy.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
            app.activeDocument = source;
            app.displayDialogs = dialogs;
        }
    }
    return { toolsExportToBrowser: toolsExportToBrowser };
};
