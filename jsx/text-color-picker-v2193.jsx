/* 鑫洋助理 v2.1.93 - 独立 Photoshop 原生拾色器入口
 * 仅负责取色；文字颜色应用交给 toolsApplyTextFormatting，确保写入 Photoshop 历史记录并可 Ctrl+Z 撤回。
 */
var XinyangTextColorPickerV2193 = (function () {
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
            var arrayParts = [];
            var index;
            for (index = 0; index < value.length; index += 1) arrayParts.push(toJson(value[index]));
            return "[" + arrayParts.join(",") + "]";
        }
        if (typeof value === "object") {
            var objectParts = [];
            var key;
            for (key in value) {
                if (value.hasOwnProperty(key)) objectParts.push(escapeJsonString(key) + ":" + toJson(value[key]));
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
            text = text.charAt(0) + text.charAt(0) + text.charAt(1) + text.charAt(1) + text.charAt(2) + text.charAt(2);
        }
        if (!/^[0-9a-f]{6}$/i.test(text)) return fallback || "#ffffff";
        return "#" + text.toLowerCase();
    }

    function solidColorFromHex(value) {
        var hex = normalizeHex(value, "#ffffff").slice(1);
        var color = new SolidColor();
        color.rgb.red = parseInt(hex.slice(0, 2), 16);
        color.rgb.green = parseInt(hex.slice(2, 4), 16);
        color.rgb.blue = parseInt(hex.slice(4, 6), 16);
        return color;
    }

    function solidColorHex(color) {
        try {
            var red = Math.max(0, Math.min(255, Math.round(color.rgb.red))).toString(16);
            var green = Math.max(0, Math.min(255, Math.round(color.rgb.green))).toString(16);
            var blue = Math.max(0, Math.min(255, Math.round(color.rgb.blue))).toString(16);
            if (red.length < 2) red = "0" + red;
            if (green.length < 2) green = "0" + green;
            if (blue.length < 2) blue = "0" + blue;
            return "#" + red + green + blue;
        } catch (ignoreColor) {
            return "";
        }
    }

    function pick(options) {
        options = options || {};
        var initialColor = normalizeHex(options.color, "#ffffff");
        var previousHex = solidColorHex(app.foregroundColor) || "#000000";
        try { app.foregroundColor = solidColorFromHex(initialColor); } catch (ignoreInitialColor) {}

        var accepted = false;
        try {
            if (typeof app.showColorPicker !== "function") throw new Error("当前 Photoshop 版本不支持脚本调用原生拾色器");
            accepted = !!app.showColorPicker();
        } catch (pickerError) {
            try { app.foregroundColor = solidColorFromHex(previousHex); } catch (ignoreRestoreOnError) {}
            throw new Error("无法打开 Photoshop 自带拾色器：" + pickerError.message);
        }

        if (!accepted) {
            try { app.foregroundColor = solidColorFromHex(previousHex); } catch (ignoreRestoreOnCancel) {}
            return { cancelled: true, color: initialColor };
        }

        return {
            cancelled: false,
            color: normalizeHex(solidColorHex(app.foregroundColor), initialColor)
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
        version: "2.1.93",
        invoke: invoke
    };
}());
