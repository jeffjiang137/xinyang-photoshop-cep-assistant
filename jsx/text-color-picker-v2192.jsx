/* 鑫洋助理 v2.1.92 - 独立 Photoshop 原生拾色器入口
 * 每次点击颜色块时由 CEP 直接 $.evalFile 加载，绕过 LongStitchCEP 方法缓存。
 */
var XinyangTextColorPickerV2192 = (function () {
    var activeJob = null;

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
        return "\"" + String(value).replace(/[\\\"\u0000-\u001f]/g, function (character) {
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
        if (!value) return {};
        if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(value);
        return eval("(" + value + ")");
    }

    function normalizeHex(value, fallback) {
        var text = String(value || "").replace(/^#/, "");
        if (/^[0-9a-f]{3}$/i.test(text)) {
            text = text.charAt(0) + text.charAt(0) +
                text.charAt(1) + text.charAt(1) +
                text.charAt(2) + text.charAt(2);
        }
        if (!/^[0-9a-f]{6}$/i.test(text)) return fallback || "#ffffff";
        return "#" + text.toLowerCase();
    }

    function hexPad(value) {
        var text = Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16);
        return text.length < 2 ? "0" + text : text;
    }

    function solidColorHex(color) {
        try {
            return "#" + hexPad(color.rgb.red) + hexPad(color.rgb.green) + hexPad(color.rgb.blue);
        } catch (ignoreColor) {
            return "";
        }
    }

    function solidColorFromHex(value) {
        var text = normalizeHex(value, "#ffffff").replace(/^#/, "");
        var color = new SolidColor();
        color.rgb.red = parseInt(text.substr(0, 2), 16) || 0;
        color.rgb.green = parseInt(text.substr(2, 2), 16) || 0;
        color.rgb.blue = parseInt(text.substr(4, 2), 16) || 0;
        return color;
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
                    ids.push(list.getReference(index).getIdentifier(charIDToTypeID("Lyr ")));
                }
            }
        } catch (ignoreSelectionList) {}
        if (!ids.length) {
            try { ids.push(activeLayerId()); } catch (ignoreActiveLayer) {}
        }
        return ids;
    }

    function findLayerById(container, id) {
        var index;
        for (index = 0; index < container.layers.length; index += 1) {
            var layer = container.layers[index];
            try {
                if (Number(layer.id) === Number(id)) return layer;
            } catch (ignoreLayerId) {}
            if (layer.typename === "LayerSet") {
                var nested = findLayerById(layer, id);
                if (nested) return nested;
            }
        }
        return null;
    }

    function collectTextLayers(layer, output, seen) {
        if (!layer) return;
        if (layer.typename === "ArtLayer") {
            try {
                if (layer.kind === LayerKind.TEXT) {
                    var id = Number(layer.id);
                    var key = "id_" + id;
                    if (!seen[key]) {
                        seen[key] = true;
                        output.push(layer);
                    }
                }
            } catch (ignoreTextKind) {}
            return;
        }
        if (layer.typename === "LayerSet") {
            var index;
            for (index = 0; index < layer.layers.length; index += 1) {
                collectTextLayers(layer.layers[index], output, seen);
            }
        }
    }

    function selectedTextLayers(document) {
        var ids = selectedLayerIds();
        var output = [];
        var seen = {};
        var index;
        for (index = 0; index < ids.length; index += 1) {
            collectTextLayers(findLayerById(document, ids[index]), output, seen);
        }
        return output;
    }

    function runActiveJob() {
        if (!activeJob || !activeJob.run) throw new Error("没有可执行的文字颜色任务");
        activeJob.result = activeJob.run();
    }

    function suspendHistory(document, name, runner) {
        var previousHistory = null;
        try { previousHistory = document.activeHistoryState; } catch (ignoreHistory) {}
        activeJob = { run: runner, result: null };
        try {
            document.suspendHistory(String(name || "鑫洋助理：修改文字颜色"), "XinyangTextColorPickerV2192._runActiveJob()");
            return activeJob.result;
        } catch (error) {
            if (previousHistory) {
                try { document.activeHistoryState = previousHistory; } catch (ignoreRollback) {}
            }
            throw error;
        } finally {
            activeJob = null;
        }
    }

    function pick(options) {
        options = options || {};
        var initialColor = normalizeHex(options.color, "#ffffff");
        var previousHex = solidColorHex(app.foregroundColor) || "#000000";
        try { app.foregroundColor = solidColorFromHex(initialColor); } catch (ignoreInitialColor) {}

        var accepted = false;
        try {
            if (typeof app.showColorPicker !== "function") {
                throw new Error("当前 Photoshop 版本不支持脚本调用原生拾色器");
            }
            accepted = !!app.showColorPicker();
        } catch (pickerError) {
            try { app.foregroundColor = solidColorFromHex(previousHex); } catch (ignoreRestoreOnError) {}
            throw new Error("无法打开 Photoshop 自带拾色器：" + pickerError.message);
        }

        if (!accepted) {
            try { app.foregroundColor = solidColorFromHex(previousHex); } catch (ignoreRestoreOnCancel) {}
            return { cancelled: true, color: initialColor, processed: 0, skipped: 0 };
        }

        var selectedHex = normalizeHex(solidColorHex(app.foregroundColor), initialColor);
        var processed = 0;
        var skipped = 0;
        var applyError = "";

        if (app.documents.length) {
            try {
                var document = app.activeDocument;
                var layers = selectedTextLayers(document);
                var preparedColor = solidColorFromHex(selectedHex);
                if (layers.length) {
                    var result = suspendHistory(document, "鑫洋助理：修改文字颜色", function () {
                        var index;
                        for (index = 0; index < layers.length; index += 1) {
                            try {
                                layers[index].textItem.color = preparedColor;
                                processed += 1;
                            } catch (ignoreApplyColor) {
                                skipped += 1;
                            }
                        }
                        return { processed: processed, skipped: skipped };
                    });
                    processed = Number(result && result.processed) || processed;
                    skipped = Number(result && result.skipped) || skipped;
                }
            } catch (colorApplyError) {
                applyError = "当前选择未应用到文字图层：" + colorApplyError.message;
            }
        }

        return {
            cancelled: false,
            color: selectedHex,
            processed: processed,
            skipped: skipped,
            applyError: applyError
        };
    }

    function invoke(payloadJson) {
        try {
            return toJson({ ok: true, data: pick(parseJson(payloadJson)) });
        } catch (error) {
            var message = error && error.message ? error.message : String(error);
            if (error && error.line) message += "（脚本第 " + error.line + " 行）";
            return toJson({ ok: false, error: message });
        }
    }

    return {
        version: "2.1.92",
        invoke: invoke,
        _runActiveJob: runActiveJob
    };
}());
