/* 鑫洋助理 ExtendScript 模块：coreShared */
/* $.evalFile 在 Photoshop 中可能继承调用函数的局部作用域。 */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.coreShared = function (deps) {
    deps = deps || {};
        var SPACING_NAMESPACE = deps.SPACING_NAMESPACE;
        var SPACING_PREFIX = deps.SPACING_PREFIX;
        var SPACING_PROPERTY = deps.SPACING_PROPERTY;
        var STITCH_SOURCE_NAMESPACE = deps.STITCH_SOURCE_NAMESPACE;
        var STITCH_SOURCE_PREFIX = deps.STITCH_SOURCE_PREFIX;
        var STITCH_SOURCE_PROPERTY = deps.STITCH_SOURCE_PROPERTY;


        function escapeJsonString(value) {
            var escapes = {
                "\b": "\\b",
                "\t": "\\t",
                "\n": "\\n",
                "\f": "\\f",
                "\r": "\\r",
                "\"": "\\\"",
                "\\": "\\\\"
            };
            return "\"" + String(value).replace(/[\\"\u0000-\u001f]/g, function (character) {
                if (escapes[character]) return escapes[character];
                var code = character.charCodeAt(0).toString(16);
                while (code.length < 4) code = "0" + code;
                return "\\u" + code;
            }) + "\"";
        }

        function toJson(value) {
            if (value === null) return "null";
            var type = typeof value;
            if (type === "string") return escapeJsonString(value);
            if (type === "number") return isFinite(value) ? String(value) : "null";
            if (type === "boolean") return value ? "true" : "false";
            if (value instanceof Array) {
                var arrayParts = [];
                var arrayIndex;
                for (arrayIndex = 0; arrayIndex < value.length; arrayIndex += 1) {
                    arrayParts.push(toJson(value[arrayIndex]));
                }
                return "[" + arrayParts.join(",") + "]";
            }
            if (type === "object") {
                var objectParts = [];
                var key;
                for (key in value) {
                    if (value.hasOwnProperty(key) && typeof value[key] !== "undefined") {
                        objectParts.push(escapeJsonString(key) + ":" + toJson(value[key]));
                    }
                }
                return "{" + objectParts.join(",") + "}";
            }
            return "null";
        }

        function parseJson(value) {
            if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(value);
            return eval("(" + value + ")");
        }

        function pixels(value) {
            if (value === undefined || value === null) return 0;
            try {
                return Number(value.as("px"));
            } catch (ignore) {
                return Number(value) || 0;
            }
        }

        function layerSize(layer) {
            var bounds = layer.bounds;
            return {
                left: pixels(bounds[0]),
                top: pixels(bounds[1]),
                width: pixels(bounds[2]) - pixels(bounds[0]),
                height: pixels(bounds[3]) - pixels(bounds[1])
            };
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
            reference.putEnumerated(
                charIDToTypeID("Lyr "),
                charIDToTypeID("Ordn"),
                charIDToTypeID("Trgt")
            );
            return executeActionGet(reference).getInteger(property);
        }

        function selectedLayerIds() {
            var ids = [];
            try {
                var property = stringIDToTypeID("targetLayersIDs");
                var reference = new ActionReference();
                reference.putProperty(stringIDToTypeID("property"), property);
                reference.putEnumerated(
                    stringIDToTypeID("document"),
                    stringIDToTypeID("ordinal"),
                    stringIDToTypeID("targetEnum")
                );
                var descriptor = executeActionGet(reference);
                if (descriptor.hasKey(property)) {
                    var list = descriptor.getList(property);
                    var index;
                    for (index = 0; index < list.count; index += 1) {
                        ids.push(
                            list.getReference(index).getIdentifier(
                                charIDToTypeID("Lyr ")
                            )
                        );
                    }
                }
            } catch (ignoreSelectionList) {}

            if (!ids.length) {
                try {
                    ids.push(activeLayerId());
                } catch (ignoreActiveLayer) {}
            }
            return ids;
        }

        function selectLayersByIds(ids) {
            if (!(ids instanceof Array) || !ids.length) return;
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var descriptor = new ActionDescriptor();
                var reference = new ActionReference();
                reference.putIdentifier(
                    charIDToTypeID("Lyr "),
                    integerValue(ids[index], -1)
                );
                descriptor.putReference(charIDToTypeID("null"), reference);
                if (index > 0) {
                    descriptor.putEnumerated(
                        stringIDToTypeID("selectionModifier"),
                        stringIDToTypeID("selectionModifierType"),
                        stringIDToTypeID("addToSelection")
                    );
                }
                descriptor.putBoolean(charIDToTypeID("MkVs"), false);
                executeAction(
                    charIDToTypeID("slct"),
                    descriptor,
                    DialogModes.NO
                );
            }
        }

        function collectImageLayers(document) {
            var original = document.activeLayer;
            var output = [];
            var index;

            for (index = 0; index < document.layers.length; index += 1) {
                var layer = document.layers[index];
                if (layer.typename !== "ArtLayer") continue;

                var size;
                try {
                    size = layerSize(layer);
                } catch (ignoreBounds) {
                    continue;
                }
                if (!(size.width > 0 && size.height > 0)) continue;

                document.activeLayer = layer;
                output.push({
                    layer: layer,
                    id: activeLayerId(),
                    size: size
                });
            }

            document.activeLayer = original;
            return output;
        }

        function defaultSpacingState() {
            return {
                version: 1,
                layers: {}
            };
        }

        function normalizedSpacing(value) {
            value = value && typeof value === "object" ? value : {};
            return {
                side: integerValue(value.side, 0),
                top: integerValue(value.top, 0),
                bottom: integerValue(value.bottom, 0)
            };
        }

        function ensureXmpLibrary() {
            try {
                if (typeof XMPMeta === "undefined") {
                    if (
                        typeof ExternalObject === "undefined" ||
                        ExternalObject.AdobeXMPScript
                    ) {
                        return typeof XMPMeta !== "undefined";
                    }
                    ExternalObject.AdobeXMPScript = new ExternalObject(
                        "lib:AdobeXMPScript"
                    );
                }
                return typeof XMPMeta !== "undefined";
            } catch (ignoreXmpLoad) {
                return false;
            }
        }

        /*
         * 拼图源图层使用独立的文档级记录，后续文字、图标、修复层以及
         * 间距状态更新都不会被写入这里。切片只信任这份稳定 ID 列表。
         */
        function saveStitchSourceState(document, layerIds, sourceFolder) {
            try {
                if (!ensureXmpLibrary()) return false;
                XMPMeta.registerNamespace(
                    STITCH_SOURCE_NAMESPACE,
                    STITCH_SOURCE_PREFIX
                );
                var xmp = new XMPMeta(document.xmpMetadata.rawData);
                xmp.setProperty(
                    STITCH_SOURCE_NAMESPACE,
                    STITCH_SOURCE_PROPERTY,
                    toJson({
                        version: 2,
                        layerIds: layerIds || [],
                        sourceFolder: String(sourceFolder || "")
                    })
                );
                document.xmpMetadata.rawData = xmp.serialize();
                return true;
            } catch (ignoreWriteStitchSources) {
                return false;
            }
        }

        function loadStitchSourceState(document) {
            var state = {
                version: 2,
                layerIds: [],
                sourceFolder: ""
            };
            try {
                if (!ensureXmpLibrary()) return state;
                XMPMeta.registerNamespace(
                    STITCH_SOURCE_NAMESPACE,
                    STITCH_SOURCE_PREFIX
                );
                var xmp = new XMPMeta(document.xmpMetadata.rawData);
                var property = xmp.getProperty(
                    STITCH_SOURCE_NAMESPACE,
                    STITCH_SOURCE_PROPERTY
                );
                if (!property) return state;
                var parsed = parseJson(String(property));
                if (
                    parsed &&
                    parsed.layerIds instanceof Array
                ) {
                    state.layerIds = parsed.layerIds;
                    state.sourceFolder = String(parsed.sourceFolder || "");
                }
            } catch (ignoreReadStitchSources) {}
            return state;
        }

        function loadSpacingState(document) {
            var state = defaultSpacingState();
            try {
                if (!ensureXmpLibrary()) return state;
                XMPMeta.registerNamespace(SPACING_NAMESPACE, SPACING_PREFIX);
                var xmp = new XMPMeta(document.xmpMetadata.rawData);
                var property = xmp.getProperty(
                    SPACING_NAMESPACE,
                    SPACING_PROPERTY
                );
                if (!property) return state;
                var parsed = parseJson(String(property));
                if (
                    parsed &&
                    typeof parsed === "object" &&
                    parsed.layers &&
                    typeof parsed.layers === "object"
                ) {
                    state = parsed;
                }
            } catch (ignoreReadXmp) {}
            if (!state.layers || typeof state.layers !== "object") {
                state.layers = {};
            }
            state.version = 1;
            return state;
        }

        function saveSpacingState(document, state) {
            try {
                if (!ensureXmpLibrary()) return false;
                XMPMeta.registerNamespace(SPACING_NAMESPACE, SPACING_PREFIX);
                var xmp = new XMPMeta(document.xmpMetadata.rawData);
                xmp.setProperty(
                    SPACING_NAMESPACE,
                    SPACING_PROPERTY,
                    toJson(state)
                );
                document.xmpMetadata.rawData = xmp.serialize();
                return true;
            } catch (ignoreWriteXmp) {
                return false;
            }
        }

        function initializeSpacingState(document, sourceLayerIds) {
            /*
             * 间距状态只记录拼图导入时保存的稳定源图层 ID。这里属于核心
             * 模块，不能调用 stitch-slice.jsx 内部的 collectSpacingSourceEntries()
             * （它不在当前闭包中）。创建长图时由调用方传入刚置入的图层 ID。
             * 未传入时保留对旧文档的普通图层回退。
             */
            var state = defaultSpacingState();
            var ids = sourceLayerIds || [];
            var index;
            if (!ids.length) {
                var entries = collectImageLayers(document);
                for (index = 0; index < entries.length; index += 1) {
                    ids.push(entries[index].id);
                }
            }
            for (index = 0; index < ids.length; index += 1) {
                state.layers[String(ids[index])] = normalizedSpacing(null);
            }
            return saveSpacingState(document, state);
        }

        function fileObject(path) {
            var file = new File(String(path || ""));
            if (!file.exists) throw new Error("找不到文件：" + path);
            return file;
        }

        function sameFile(left, right) {
            try {
                return String(left.fsName).toLowerCase() ===
                    String(right.fsName).toLowerCase();
            } catch (ignoreFileCompare) {
                return false;
            }
        }

        function findOpenDocument(file) {
            var index;
            for (index = 0; index < app.documents.length; index += 1) {
                try {
                    if (sameFile(app.documents[index].fullName, file)) {
                        return app.documents[index];
                    }
                } catch (ignoreUnsavedDocument) {}
            }
            return null;
        }

    return {
            escapeJsonString: escapeJsonString,
            toJson: toJson,
            parseJson: parseJson,
            pixels: pixels,
            layerSize: layerSize,
            integerValue: integerValue,
            activeLayerId: activeLayerId,
            selectedLayerIds: selectedLayerIds,
            selectLayersByIds: selectLayersByIds,
            collectImageLayers: collectImageLayers,
            defaultSpacingState: defaultSpacingState,
            normalizedSpacing: normalizedSpacing,
            ensureXmpLibrary: ensureXmpLibrary,
            saveStitchSourceState: saveStitchSourceState,
            loadStitchSourceState: loadStitchSourceState,
            loadSpacingState: loadSpacingState,
            saveSpacingState: saveSpacingState,
            initializeSpacingState: initializeSpacingState,
            fileObject: fileObject,
            sameFile: sameFile,
            findOpenDocument: findOpenDocument
    };
};
