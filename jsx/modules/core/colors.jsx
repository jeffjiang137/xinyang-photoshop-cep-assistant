/* 鑫洋助理 ExtendScript 模块：coreColors（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.coreColors = function (deps) {
    deps = deps || {};

    function toolArrayContains(values, target) {
        var index;
        for (index = 0; index < values.length; index += 1) {
            if (values[index] === target) return true;
        }
        return false;
    }

    function toolHexPad(value) {
        var text = Math.max(0, Math.min(255, Math.round(Number(value) || 0)))
            .toString(16);
        return text.length < 2 ? "0" + text : text;
    }

    function toolHexColor(value) {
        var text = String(value || "#000000").replace(/[^0-9a-f]/gi, "");
        if (text.length === 3) {
            text = text.charAt(0) + text.charAt(0) +
                text.charAt(1) + text.charAt(1) +
                text.charAt(2) + text.charAt(2);
        }
        while (text.length < 6) text += "0";
        return {
            red: parseInt(text.substr(0, 2), 16) || 0,
            green: parseInt(text.substr(2, 2), 16) || 0,
            blue: parseInt(text.substr(4, 2), 16) || 0,
            hex: "#" + text.substr(0, 6).toLowerCase()
        };
    }

    function toolSolidColorHex(color) {
        try {
            return "#" + toolHexPad(color.rgb.red) +
                toolHexPad(color.rgb.green) +
                toolHexPad(color.rgb.blue);
        } catch (ignoreColor) {
            return "";
        }
    }

    function toolSolidColorFromHex(value) {
        var rgb = toolHexColor(value);
        var color = new SolidColor();
        color.rgb.red = rgb.red;
        color.rgb.green = rgb.green;
        color.rgb.blue = rgb.blue;
        return color;
    }

    return {
        toolArrayContains: toolArrayContains,
        toolHexPad: toolHexPad,
        toolHexColor: toolHexColor,
        toolSolidColorHex: toolSolidColorHex,
        toolSolidColorFromHex: toolSolidColorFromHex
    };
};
