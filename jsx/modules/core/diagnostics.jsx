/* 鑫洋助理 ExtendScript 模块：diagnosticsHost（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.diagnosticsHost = function (deps) {
    deps = deps || {};
    var pixels = deps.pixels;
    var selectedLayerIds = deps.selectedLayerIds;

    function getDiagnosticInfo() {
        var data = {
            photoshopVersion: "",
            locale: "",
            os: "",
            documentCount: 0,
            activeDocument: null,
            selectedLayerCount: 0,
            foregroundColor: null,
            backgroundColor: null,
            hostModules: null
        };
        try { data.photoshopVersion = String(app.version || ""); } catch (ignoreVersion) {}
        try { data.locale = String(app.locale || ""); } catch (ignoreLocale) {}
        try { data.os = String($.os || ""); } catch (ignoreOs) {}
        try { data.documentCount = app.documents.length; } catch (ignoreDocs) {}
        try { data.selectedLayerCount = selectedLayerIds().length; } catch (ignoreSelection) {}
        try {
            if (typeof XinyangHostModuleLoader !== "undefined" && XinyangHostModuleLoader.diagnostics) {
                data.hostModules = XinyangHostModuleLoader.diagnostics();
            }
        } catch (ignoreModuleDiagnostics) {}
        try {
            data.foregroundColor = {
                r: Math.round(app.foregroundColor.rgb.red),
                g: Math.round(app.foregroundColor.rgb.green),
                b: Math.round(app.foregroundColor.rgb.blue)
            };
            data.backgroundColor = {
                r: Math.round(app.backgroundColor.rgb.red),
                g: Math.round(app.backgroundColor.rgb.green),
                b: Math.round(app.backgroundColor.rgb.blue)
            };
        } catch (ignoreColors) {}
        if (data.documentCount > 0) {
            try {
                var document = app.activeDocument;
                var layer = document.activeLayer;
                data.activeDocument = {
                    widthPx: Math.round(pixels(document.width)),
                    heightPx: Math.round(pixels(document.height)),
                    resolution: Number(document.resolution) || 0,
                    mode: String(document.mode),
                    bitsPerChannel: String(document.bitsPerChannel),
                    layerCount: document.layers.length,
                    saved: !!document.saved,
                    nameLength: String(document.name || "").length,
                    activeLayer: layer ? {
                        kind: String(layer.kind),
                        visible: !!layer.visible,
                        locked: !!layer.allLocked,
                        nameLength: String(layer.name || "").length
                    } : null
                };
            } catch (documentError) {
                data.activeDocument = { error: String(documentError && documentError.message ? documentError.message : documentError) };
            }
        }
        return data;
    }

    return {
        getDiagnosticInfo: getDiagnosticInfo
    };
};
