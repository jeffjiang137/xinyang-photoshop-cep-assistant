/* Use the installed Photoshop Artboards To Files core; do not ship Adobe code. */
var XinyangHostModules = $.global.XinyangHostModules || {};
$.global.XinyangHostModules = XinyangHostModules;
XinyangHostModules.nativeArtboardExport = function () {
    function exportJpeg(sourceDocument, folder, quality, singleSquare) {
        var nativeFile = File(app.path.fsName + "/Presets/Scripts/ArtboardExport.inc");
        if (!nativeFile.exists) throw new Error("当前 Photoshop 缺少原生画板导出脚本 ArtboardExport.inc");
        nativeFile.encoding = "UTF-8";
        if (!nativeFile.open("r")) throw new Error("无法读取 Photoshop 原生画板导出脚本");
        var nativeSource;
        try { nativeSource = nativeFile.read(); }
        finally { nativeFile.close(); }
        // Evaluate inside this invocation so Adobe declarations stay out of our module table.
        // The Adobe entry script normally supplies these values before loading the core.
        // saveFileNow also reads strTitle in its telemetry path after saving the JPG.
        var ScriptFilePath = nativeFile.parent.fsName;
        var strTitle = localize("$$$/JavaScripts/ArtboardsToFiles/Title=Artboards To Files");
        var strMessage = localize("$$$/JavaScripts/ArtboardsToFiles/Message=Artboard To Files action settings");
        var running = "abToFiles";
        eval(nativeSource);
        if (typeof getABLayerInfo !== "function" || typeof saveFileNow !== "function" ||
            typeof unArtBoard !== "function" || typeof cropFromMask !== "function") {
            throw new Error("当前 Photoshop 原生画板导出脚本接口不兼容");
        }
        var previousDocument = app.activeDocument;
        var previousDialogs = app.displayDialogs;
        var previousPlaybackDialogs = app.playbackDisplayDialogs;
        var previousUnits = app.preferences.rulerUnits;
        var temporary = null;
        var files = [];
        var options = {
            destination: folder.fsName, fileType: jpegIndex,
            jpegQuality: Math.max(0, Math.min(12, Math.round(Number(quality) * 12 / 100))),
            iccJPG: false, exportArtboardBackground: true, preserveArtboard: false
        };
        try {
            app.activeDocument = sourceDocument;
            app.displayDialogs = DialogModes.NO;
            app.playbackDisplayDialogs = DialogModes.NO;
            app.preferences.rulerUnits = Units.PIXELS;
            var info = getABLayerInfo();
            var boards = info.visible;
            if (!boards.length) throw new Error("没有可导出的可见画板");
            var index;
            for (index = 0; index < boards.length; index += 1) {
                app.activeDocument = sourceDocument;
                temporary = sourceDocument.duplicate("__原生画板导出__");
                app.activeDocument = temporary;
                setEnabled("autoNestEnabled", false);
                setEnabled("autoPositionEnabled", false);
                setEnabled("autoExpandEnabled", false);
                cleanUnseenAB(boards[index].AMid, info.all, options.exportArtboardBackground);
                var updated = getABLayerInfo().all;
                var groups = unArtBoard(updated, temporary, boards[index].AMid, false, options);
                if (!groups) throw new Error("原生画板拆分失败：" + boards[index].name);
                selectAbByOldID(boards[index].AMid, groups);
                cropFromMask();
                removeEmptyLayers(temporary);
                var expectedWidth = boards[index].right - boards[index].left;
                var expectedHeight = boards[index].bottom - boards[index].top;
                if (Math.abs(temporary.width.as("px") - expectedWidth) > 1 ||
                    Math.abs(temporary.height.as("px") - expectedHeight) > 1) {
                    throw new Error("原生画板导出尺寸不符：" + boards[index].name);
                }
                var baseName = singleSquare && boards.length === 1 ? "主图" : cleanFilename(String(boards[index].name));
                baseName = baseName.replace(/[.\s]+$/g, "") || ("画板_" + (index + 1));
                var name = baseName;
                var serial = 2;
                var file = File(folder.fsName + "/" + name + ".jpg");
                while (file.exists) {
                    if (serial > 10000) throw new Error("同名导出文件过多，请更换导出位置");
                    name = baseName + "_" + serial;
                    serial += 1;
                    file = File(folder.fsName + "/" + name + ".jpg");
                }
                try { if (temporary.mode !== DocumentMode.RGB) temporary.changeMode(ChangeMode.RGB); }
                catch (ignoreNativeRgb) {}
                saveFileNow(temporary, name, options);
                if (!file.exists || file.length <= 0) throw new Error("原生画板 JPG 未成功保存：" + name);
                files.push(file.name);
                temporary.close(SaveOptions.DONOTSAVECHANGES);
                temporary = null;
            }
            return files;
        } finally {
            if (temporary) { try { temporary.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseNative) {} }
            try { app.activeDocument = previousDocument; } catch (ignoreRestoreNativeDocument) {}
            app.displayDialogs = previousDialogs;
            app.playbackDisplayDialogs = previousPlaybackDialogs;
            app.preferences.rulerUnits = previousUnits;
        }
    }
    return { exportJpeg: exportJpeg };
};
