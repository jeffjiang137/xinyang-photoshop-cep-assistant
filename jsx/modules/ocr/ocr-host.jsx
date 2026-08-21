/* 鑫洋助理 ExtendScript 模块：ocrHost */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.ocrHost = function (deps) {
    deps = deps || {};
        var activeLayerId = deps.activeLayerId;
        var currentDocumentId = deps.currentDocumentId;
        var currentPixelSelectionBounds = deps.currentPixelSelectionBounds;
        var currentDocumentIdFor = deps.currentDocumentIdFor;
        var findLayerById = deps.findLayerById;
        var fileObject = deps.fileObject;
        var integerValue = deps.integerValue;
        var layerSize = deps.layerSize;
        var pixels = deps.pixels;
        var safeLayerName = deps.safeLayerName;
        var selectLayersByIds = deps.selectLayersByIds;
        var selectedLayerIds = deps.selectedLayerIds;
        var twoDigits = deps.twoDigits;
    var activeTextJob = null;
    var activeEraseJob = null;

        function exportSelectedLayerForOCR() {
            if (!app.documents.length) {
                throw new Error("请先打开图片，再框选文字区域或选择图片图层");
            }
            var document = app.activeDocument;
            var selectedIds = selectedLayerIds();
            var selectionBounds = currentPixelSelectionBounds(document);
            var layer = document.activeLayer;
            var sourceLayerId = -1;

            if (selectionBounds) {
                try {
                    sourceLayerId = activeLayerId();
                } catch (ignoreSelectionLayerId) {}
            } else {
                if (selectedIds.length !== 1) {
                    throw new Error(
                        "请先框选需要识别的文字区域，或在图层面板中只选择一个图片图层"
                    );
                }
                sourceLayerId = selectedIds[0];
            }

            if (!layer || layer.typename !== "ArtLayer") {
                throw new Error(
                    selectionBounds
                        ? "当前选区所在的活动图层不是图片图层，请先选中对应图片"
                        : "当前选中的不是图片图层，请重新选择"
                );
            }
            if (layer.kind === LayerKind.TEXT) {
                throw new Error(
                    selectionBounds
                        ? "请在原图片图层上保留选区后再识别"
                        : "当前选中的是文字图层，请选择原图片图层"
                );
            }
            if (!layer.visible) {
                throw new Error("当前图片图层不可见，请先显示该图层");
            }
            if (!(sourceLayerId > 0)) {
                throw new Error("无法读取当前图片图层，请重新选择后再试");
            }

            var size = layerSize(layer);
            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            var layerRight = size.left + size.width;
            var layerBottom = size.top + size.height;
            if (
                !isFinite(size.left) || !isFinite(size.top) ||
                !isFinite(size.width) || !isFinite(size.height) ||
                !isFinite(layerRight) || !isFinite(layerBottom)
            ) {
                throw new Error("无法读取当前图层的像素边界，请重新选择图片图层");
            }

            var left;
            var top;
            var right;
            var bottom;
            if (selectionBounds) {
                left = selectionBounds.left;
                top = selectionBounds.top;
                right = selectionBounds.right;
                bottom = selectionBounds.bottom;
                var overlapLeft = Math.max(left, size.left);
                var overlapTop = Math.max(top, size.top);
                var overlapRight = Math.min(right, layerRight);
                var overlapBottom = Math.min(bottom, layerBottom);
                if (!(overlapRight - overlapLeft > 1 && overlapBottom - overlapTop > 1)) {
                    throw new Error("当前选区与选中的图片图层没有重叠内容");
                }
            } else {
                left = Math.max(0, Math.floor(size.left));
                top = Math.max(0, Math.floor(size.top));
                right = Math.min(canvasWidth, Math.ceil(layerRight));
                bottom = Math.min(canvasHeight, Math.ceil(layerBottom));
            }

            var width = right - left;
            var height = bottom - top;
            if (!(width > 1 && height > 1)) {
                throw new Error(
                    selectionBounds
                        ? "当前选区范围过小，请重新框选文字区域"
                        : "当前图层在画布内没有可识别的像素内容"
                );
            }

            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var temporary = null;
            var scopeName = selectionBounds ? "selection" : "layer";
            var tempFile = new File(
                Folder.temp.fsName + "/ps_ocr_" + scopeName + "_" +
                (new Date()).getTime() + "_" + sourceLayerId + ".png"
            );

            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                temporary = app.documents.add(
                    UnitValue(width, "px"),
                    UnitValue(height, "px"),
                    document.resolution,
                    "OCR_临时图片",
                    NewDocumentMode.RGB,
                    DocumentFill.TRANSPARENT
                );
                app.activeDocument = document;
                var duplicated = layer.duplicate(
                    temporary,
                    ElementPlacement.PLACEATBEGINNING
                );
                app.activeDocument = temporary;
                var duplicatedSize = layerSize(duplicated);
                duplicated.translate(
                    size.left - left - duplicatedSize.left,
                    size.top - top - duplicatedSize.top
                );

                var pngOptions = new PNGSaveOptions();
                pngOptions.interlaced = false;
                temporary.saveAs(
                    tempFile,
                    pngOptions,
                    true,
                    Extension.LOWERCASE
                );

                return {
                    documentId: currentDocumentIdFor(document),
                    layerId: sourceLayerId,
                    layerName: String(layer.name || "选中图片"),
                    scope: scopeName,
                    scopeLabel: selectionBounds ? "当前选区" : "当前选中图片",
                    originX: left,
                    originY: top,
                    width: width,
                    height: height,
                    resolution: Number(document.resolution) || 72,
                    tempPath: tempFile.fsName,
                    fileName: tempFile.name
                };
            } finally {
                if (temporary) {
                    try {
                        temporary.close(SaveOptions.DONOTSAVECHANGES);
                    } catch (ignoreCloseOcrTemporary) {}
                }
                try {
                    app.activeDocument = document;
                    if (selectedIds.length > 1) {
                        selectLayersByIds(selectedIds);
                    } else {
                        document.activeLayer = layer;
                    }
                } catch (ignoreRestoreOcrDocument) {}
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function safeNumber(value, fallback) {
            var number = Number(value);
            return isFinite(number) ? number : fallback;
        }

        function clampNumber(value, minimum, maximum) {
            return Math.max(minimum, Math.min(maximum, value));
        }

        function solidColorFromHex(value) {
            var text = String(value || "").replace("#", "");
            if (!/^[0-9a-fA-F]{6}$/.test(text)) text = "111111";
            var color = new SolidColor();
            color.rgb.red = parseInt(text.substr(0, 2), 16);
            color.rgb.green = parseInt(text.substr(2, 2), 16);
            color.rgb.blue = parseInt(text.substr(4, 2), 16);
            return color;
        }

        function availableFonts() {
            var output = {};
            var index;
            for (index = 0; index < app.fonts.length; index += 1) {
                var font = app.fonts[index];
                try {
                    output[String(font.postScriptName).toLowerCase()] =
                        String(font.postScriptName);
                } catch (ignoreFont) {}
            }
            return output;
        }

        function firstAvailableFont(fonts, candidates) {
            var index;
            for (index = 0; index < candidates.length; index += 1) {
                var key = String(candidates[index]).toLowerCase();
                if (fonts[key]) return fonts[key];
            }
            return "";
        }

        function normalizedFontToken(value) {
            return String(value || "").toLowerCase().replace(/[\s_\-]+/g, "");
        }

        function preferredAvailableFont(fonts, preferredFamily, weight) {
            var preferred = normalizedFontToken(preferredFamily);
            if (!preferred || preferred.length < 3) return "";
            var keys = [];
            var key;
            for (key in fonts) {
                if (!fonts.hasOwnProperty(key)) continue;
                if (normalizedFontToken(key).indexOf(preferred) >= 0 ||
                    preferred.indexOf(normalizedFontToken(key)) >= 0) {
                    keys.push(key);
                }
            }
            if (!keys.length) return "";
            var requested = String(weight || "regular").toLowerCase();
            function score(fontKey) {
                var value = String(fontKey || "").toLowerCase();
                var result = 0;
                if (/black|heavy|extrabold|ultrabold/.test(value)) {
                    result += requested === "black" ? 90 : requested === "bold" ? 35 : -20;
                } else if (/semibold|demibold|bold/.test(value)) {
                    result += requested === "bold" ? 80 : requested === "black" ? 55 : -8;
                } else if (/regular|normal|book|light|thin/.test(value)) {
                    result += requested === "regular" ? 70 : -18;
                }
                result -= Math.abs(normalizedFontToken(value).length - preferred.length) * 0.05;
                return result;
            }
            keys.sort(function (left, right) { return score(right) - score(left); });
            return fonts[keys[0]] || "";
        }

        function isCompatibleOcrFamily(value, serif) {
            var token = normalizedFontToken(value);
            if (!token) return false;
            if (/sourcehan|notosans|notoserif|alibaba|alipuhui|harmonyos/.test(token)) {
                if (serif) return /serif/.test(token);
                return !/serif/.test(token);
            }
            return false;
        }

        function resolveOcrFont(fonts, style, weight, text, preferredFamily,
                weightScore, fontHeight, weightValue) {
            var serif = style === "serif";
            var requestedWeight = String(weight || "regular").toLowerCase();
            var numericWeight = safeNumber(weightValue, 0);
            var density = safeNumber(weightScore, 0);
            var height = safeNumber(fontHeight, 0);
            var contents = String(text || "");
            var containsCjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(contents);
            if (density <= 0.001) {
                if (numericWeight >= 800 || /black|heavy/.test(requestedWeight)) {
                    requestedWeight = "black";
                } else if (numericWeight >= 600 || /bold|semibold/.test(requestedWeight)) {
                    requestedWeight = "bold";
                } else {
                    requestedWeight = "regular";
                }
            }

            var cjkWeight = containsCjk;
            var blackThreshold = cjkWeight ? 0.41 : 0.35;
            var boldThreshold = cjkWeight ? 0.285 : 0.235;
            if (height < 18) {
                blackThreshold += 0.035;
                boldThreshold += 0.025;
            }
            if (contents.length <= 1) {
                blackThreshold += 0.045;
                boldThreshold += 0.035;
            }

            /* 服务字重只作为先验，仍需像素密度支持，避免常规中文被放大成粗黑。 */
            if (density <= 0.001) {
                /* 已按服务字重回退，不再用像素阈值覆盖。 */
            } else if (numericWeight >= 850 && density >= blackThreshold * 0.88) {
                requestedWeight = "black";
            } else if (numericWeight >= 650 && density >= boldThreshold * 0.84) {
                requestedWeight = "bold";
            } else if (/black|heavy/.test(requestedWeight)) {
                requestedWeight = density >= blackThreshold * 0.92
                    ? "black"
                    : density >= boldThreshold * 0.94 ? "bold" : "regular";
            } else if (/bold|semibold/.test(requestedWeight)) {
                requestedWeight = density >= boldThreshold * 0.88
                    ? "bold" : "regular";
            } else if (density >= blackThreshold && contents.length >= 2) {
                requestedWeight = "black";
            } else if (density >= boldThreshold && contents.length >= 2) {
                requestedWeight = "bold";
            } else {
                requestedWeight = "regular";
            }

            /* 只使用开源字体族：思源、Noto、阿里普惠和 HarmonyOS Sans。
               不让 OCR 的系统/商业字体提示带入最终 Photoshop 文本图层。 */
            var preferred = isCompatibleOcrFamily(preferredFamily, serif)
                ? preferredAvailableFont(fonts, preferredFamily, requestedWeight)
                : "";
            if (preferred) return preferred;

            var candidates;
            if (serif && requestedWeight === "black") {
                candidates = [
                    "SourceHanSerifCN-Heavy",
                    "SourceHanSerifSC-Heavy",
                    "NotoSerifCJKsc-Black",
                    "SourceHanSerifCN-Bold",
                    "SourceHanSerifSC-Bold",
                    "NotoSerifCJKsc-Bold"
                ];
            } else if (serif && requestedWeight === "bold") {
                candidates = [
                    "SourceHanSerifCN-Bold",
                    "SourceHanSerifSC-Bold",
                    "NotoSerifCJKsc-Bold"
                ];
            } else if (serif) {
                candidates = [
                    "SourceHanSerifCN-Regular",
                    "SourceHanSerifSC-Regular",
                    "NotoSerifCJKsc-Regular"
                ];
            } else if (requestedWeight === "black") {
                candidates = [
                    "SourceHanSansCN-Heavy",
                    "SourceHanSansSC-Heavy",
                    "AlibabaPuHuiTi-Heavy",
                    "Alibaba-PuHuiTi-Heavy",
                    "HarmonyOS_Sans_SC_Black",
                    "HarmonyOS-Sans-SC-Black",
                    "NotoSansCJKsc-Black",
                    "SourceHanSansSC-Bold"
                ];
            } else if (requestedWeight === "bold") {
                candidates = [
                    "SourceHanSansCN-Bold",
                    "SourceHanSansSC-Bold",
                    "AlibabaPuHuiTi-Bold",
                    "Alibaba-PuHuiTi-Bold",
                    "HarmonyOS_Sans_SC_Bold",
                    "HarmonyOS-Sans-SC-Bold",
                    "NotoSansCJKsc-Bold"
                ];
            } else {
                candidates = [
                    "SourceHanSansCN-Regular",
                    "SourceHanSansSC-Regular",
                    "AlibabaPuHuiTi-Regular",
                    "Alibaba-PuHuiTi-Regular",
                    "HarmonyOS_Sans_SC_Regular",
                    "HarmonyOS-Sans-SC-Regular",
                    "NotoSansCJKsc-Regular"
                ];
            }

            var font = firstAvailableFont(fonts, candidates);
            if (font) return font;
            throw new Error(
                "未找到可用开源字体。请安装思源（Source Han）、Noto 或阿里普惠体后重试"
            );
        }

        function shortTextName(value, fallback) {
            var text = String(value || "")
                .replace(/[\r\n\t]+/g, " ")
                .replace(/^\s+|\s+$/g, "");
            if (text.length > 20) text = text.substr(0, 20) + "…";
            return text || fallback;
        }

        function textPointSize(item, fallback) {
            try {
                return safeNumber(item.size.as("pt"), fallback);
            } catch (ignoreTextPointSize) {
                return fallback;
            }
        }

        function setTextPointSize(item, points) {
            item.size = UnitValue(clampNumber(points, 1, 1296), "pt");
        }

        function textTrackingLimits(contents) {
            var text = String(contents || "");
            var cjkCount = 0;
            var latinNumberCount = 0;
            var index;
            for (index = 0; index < text.length; index += 1) {
                if (/[\u3400-\u9FFF]/.test(text.charAt(index))) {
                    cjkCount += 1;
                } else if (/[A-Za-z0-9]/.test(text.charAt(index))) {
                    latinNumberCount += 1;
                }
            }
            if (cjkCount >= Math.max(2, latinNumberCount)) {
                return { minimum: -150, maximum: 140 };
            }
            if (latinNumberCount >= Math.max(2, cjkCount * 2)) {
                return { minimum: -60, maximum: 120 };
            }
            return { minimum: -70, maximum: 140 };
        }

        /*
         * 只用字号与 tracking 匹配识别框。禁止对文字图层执行 resize，
         * 保证 horizontalScale / verticalScale 始终为 100%，避免字体变形。
         */
        function fitTextLayerTypography(layer, item, box, resolution) {
            resolution = Math.max(1, safeNumber(resolution, 72));
            var measured = layerSize(layer);
            if (!(measured.width > 0 && measured.height > 0)) return;

            var contentsForFit = String(item.contents || "");
            var containsCjkForFit = /[\u3400-\u9fff\uf900-\ufaff]/.test(contentsForFit);
            var targetHeight = Math.max(
                1,
                safeNumber(box.fontHeight, safeNumber(box.height, measured.height))
            );
            /* OCR 字框通常只覆盖实体笔画，不包含字体 em 框上下留白。
               中文按实测笔画高度略微补偿，避免生成后视觉字号偏小。 */
            targetHeight *= containsCjkForFit ? 1.065 : 1.025;
            var targetWidth = Math.max(1, safeNumber(box.width, measured.width));
            if (containsCjkForFit) targetWidth *= 1.045;
            var targetTop = safeNumber(box.y, 0) + Math.max(
                0,
                (safeNumber(box.height, targetHeight) - targetHeight) / 2
            );
            var points = textPointSize(
                item,
                targetHeight * 72 / Math.max(1, resolution)
            );
            var iteration;

            for (iteration = 0; iteration < 3; iteration += 1) {
                measured = layerSize(layer);
                if (!(measured.height > 0)) break;
                var heightRatio = targetHeight / measured.height;
                if (Math.abs(heightRatio - 1) <= 0.025) break;
                points = clampNumber(
                    points * clampNumber(heightRatio, 0.45, 2.2),
                    1,
                    1296
                );
                setTextPointSize(item, points);
            }

            var contents = String(item.contents || "");
            var gaps = Math.max(0, contents.length - 1);
            var trackingLimits = textTrackingLimits(contents);
            measured = layerSize(layer);
            if (gaps > 0 && measured.width > 0) {
                var emPixels = Math.max(
                    0.1,
                    textPointSize(item, points) * resolution / 72
                );
                var tracking = Math.round(
                    (targetWidth - measured.width) * 1000 /
                    (gaps * emPixels)
                );
                try {
                    item.tracking = clampNumber(
                        tracking,
                        trackingLimits.minimum,
                        trackingLimits.maximum
                    );
                } catch (ignoreTracking) {}
                measured = layerSize(layer);
            }

            /*
             * 字间距达到下限后仍放不下时，只等比减小字号，不做横向压缩。
             */
            var widthTolerance = containsCjkForFit ? 1.11 : 1.055;
            if (measured.width > targetWidth * widthTolerance) {
                points = textPointSize(item, points) *
                    clampNumber(
                        targetWidth / measured.width,
                        containsCjkForFit ? 0.84 : 0.72,
                        1
                    );
                setTextPointSize(item, points);
                measured = layerSize(layer);
                if (gaps > 0 && measured.width > 0) {
                    try {
                        item.tracking = 0;
                    } catch (ignoreTrackingReset) {}
                    measured = layerSize(layer);
                    var resizedEmPixels = Math.max(
                        0.1,
                        textPointSize(item, points) * resolution / 72
                    );
                    var resizedTracking = Math.round(
                        (targetWidth - measured.width) * 1000 /
                        (gaps * resizedEmPixels)
                    );
                    try {
                        item.tracking = clampNumber(
                            resizedTracking,
                            trackingLimits.minimum,
                            trackingLimits.maximum
                        );
                    } catch (ignoreResizedTracking) {}
                    measured = layerSize(layer);
                }
            }

            if (Math.abs(box.angle) > 0.1 && Math.abs(box.angle) <= 180) {
                layer.rotate(box.angle, AnchorPosition.MIDDLECENTER);
            }

            measured = layerSize(layer);
            layer.translate(
                box.x - measured.left,
                targetTop - measured.top
            );
        }

        function createOneOcrTextLayer(root, line, index, fonts, fontMode, resolution) {
            var style = fontMode === "serif"
                ? "serif"
                : fontMode === "sans"
                    ? "sans"
                    : String(line.fontStyle || "sans").toLowerCase() === "serif"
                        ? "serif"
                        : "sans";
            var weight = String(line.weight || "regular").toLowerCase();
            if (weight !== "black" && weight !== "bold") weight = "regular";
            var font = resolveOcrFont(
                fonts,
                style,
                weight,
                line.text,
                line.fontFamily,
                line.weightScore,
                line.fontHeight || line.height,
                line.weightValue
            );
            var layer = root.artLayers.add();
            layer.kind = LayerKind.TEXT;
            layer.name =
                twoDigits(index + 1) + "_" +
                shortTextName(line.text, "识别文字");

            var item = layer.textItem;
            item.kind = TextType.POINTTEXT;
            item.contents = String(line.text || "");
            item.font = font;
            item.size = UnitValue(
                clampNumber(
                    safeNumber(line.height, 18) * 72 / Math.max(1, resolution) * 1.12,
                    1,
                    1296
                ),
                "pt"
            );
            item.color = solidColorFromHex(line.color);
            try {
                item.horizontalScale = 100;
                item.verticalScale = 100;
            } catch (ignoreTextScale) {}
            try {
                item.tracking = 0;
            } catch (ignoreInitialTracking) {}
            item.position = [
                UnitValue(safeNumber(line.x, 0), "px"),
                UnitValue(
                    safeNumber(line.y, 0) + safeNumber(line.height, 18),
                    "px"
                )
            ];
            try {
                item.antiAliasMethod = AntiAlias.STRONG;
            } catch (ignoreAntiAlias) {}
            if (weight === "bold" || weight === "black") {
                try {
                    /* 已命中真实 Bold/Heavy/Black 字体时不再叠加仿粗体，
                       避免笔画过度膨胀；只有常规字体回退时才启用。 */
                    item.fauxBold = !/bold|semibold|demibold|black|heavy|extrabold|ultrabold/i
                        .test(String(font || ""));
                } catch (ignoreFauxBold) {}
            }

            fitTextLayerTypography(layer, item, {
                x: safeNumber(line.x, 0),
                y: safeNumber(line.y, 0),
                width: Math.max(1, safeNumber(line.width, 1)),
                height: Math.max(1, safeNumber(line.height, 1)),
                fontHeight: Math.max(
                    1,
                    safeNumber(line.fontHeight, safeNumber(line.height, 1))
                ),
                angle: safeNumber(line.angle, 0)
            }, resolution);
            return {
                layer: layer,
                font: font
            };
        }

        function runTextJob() {
            var job = activeTextJob;
            if (!job || !job.document) throw new Error("改字任务不存在");

            var document = job.document;
            app.activeDocument = document;
            var sourceLayer = findLayerById(
                document,
                integerValue(job.sourceLayerId, -1)
            );
            if (!sourceLayer) throw new Error("原图片图层已不存在，请重新识别");
            var parent = sourceLayer.parent;
            var root = null;
            var targetContainer = parent;
            var singleLine = job.lines.length === 1;
            if (!singleLine && job.lines.length > 1) {
                var firstCenterY = safeNumber(job.lines[0].y, 0) + safeNumber(job.lines[0].height, 1) / 2;
                var firstHeight = Math.max(1, safeNumber(job.lines[0].height, 1));
                singleLine = true;
                var visualLineIndex;
                for (visualLineIndex = 1; visualLineIndex < job.lines.length; visualLineIndex += 1) {
                    var currentHeight = Math.max(1, safeNumber(job.lines[visualLineIndex].height, 1));
                    var currentCenterY = safeNumber(job.lines[visualLineIndex].y, 0) + currentHeight / 2;
                    var tolerance = Math.max(4, Math.min(firstHeight, currentHeight) * 0.48);
                    if (Math.abs(currentCenterY - firstCenterY) > tolerance) {
                        singleLine = false;
                        break;
                    }
                }
            }

            /*
             * 单个视觉行（即使因颜色/字号拆成多个文字段）直接在原图层正上方
             * 创建同级文字图层，不再额外套组。多行结果继续创建 OCR 组。
             */
            if (!singleLine) {
                try {
                    root = parent.layerSets.add();
                } catch (ignoreNestedTextGroup) {
                    root = document.layerSets.add();
                }
                root.name = "改字_OCR_" + safeLayerName(
                    job.sourceLayerName,
                    "选中图片"
                );
                try {
                    root.move(sourceLayer, ElementPlacement.PLACEBEFORE);
                } catch (ignoreMoveTextGroupAboveSource) {}
                targetContainer = root;
            }

            var fonts = availableFonts();
            var usedFonts = {};
            var created = 0;
            var createdLayer = null;
            var lineIndex;
            for (lineIndex = 0; lineIndex < job.lines.length; lineIndex += 1) {
                var createdText = createOneOcrTextLayer(
                    targetContainer,
                    job.lines[lineIndex],
                    lineIndex,
                    fonts,
                    job.fontMode,
                    Number(document.resolution) || 72
                );
                createdLayer = createdText.layer;
                if (singleLine) {
                    try { createdLayer.move(sourceLayer, ElementPlacement.PLACEBEFORE); } catch (ignoreMoveSingleSegmentAboveSource) {}
                }
                usedFonts[createdText.font] = true;
                created += 1;
            }

            if (!created) {
                if (root) {
                    try { root.remove(); } catch (ignoreEmptyRootRemove) {}
                }
                throw new Error("没有可生成的 OCR 文字行");
            }

            if (singleLine && createdLayer) {
                try { createdLayer.move(sourceLayer, ElementPlacement.PLACEBEFORE); } catch (ignoreMoveSingleTextAboveSource) {}
                document.activeLayer = createdLayer;
            } else {
                document.activeLayer = root;
            }

            var fontNames = [];
            var fontName;
            for (fontName in usedFonts) {
                if (usedFonts.hasOwnProperty(fontName)) fontNames.push(fontName);
            }
            job.result = {
                groups: singleLine ? 0 : 1,
                layers: created,
                singleLine: singleLine,
                fontSummary: fontNames.join("、")
            };
        }

        function createEditableTextLayers(options) {
            if (!app.documents.length) {
                throw new Error("识别来源文档已经关闭");
            }
            var document = app.activeDocument;
            var expectedDocumentId = integerValue(
                options && options.documentId,
                -1
            );
            if (currentDocumentId() !== expectedDocumentId) {
                throw new Error("当前文档已切换，请重新识别选中图片");
            }

            var sourceLayerId = integerValue(
                options && options.sourceLayerId,
                -1
            );
            var sourceLayer = findLayerById(document, sourceLayerId);
            if (!sourceLayer) {
                throw new Error("原图片图层已不存在，请重新识别");
            }
            var lines = options && options.lines ? options.lines : [];
            if (!(lines instanceof Array) || !lines.length) {
                var legacyGroups = options && options.groups ? options.groups : [];
                lines = [];
                if (legacyGroups instanceof Array) {
                    var legacyIndex;
                    for (legacyIndex = 0; legacyIndex < legacyGroups.length; legacyIndex += 1) {
                        if (legacyGroups[legacyIndex] && legacyGroups[legacyIndex].lines) {
                            lines = lines.concat(legacyGroups[legacyIndex].lines);
                        }
                    }
                }
            }
            if (!(lines instanceof Array) || !lines.length) {
                throw new Error("没有可生成的 OCR 文字");
            }

            if (lines.length > 500) {
                throw new Error("单次最多生成 500 行文字，请拆分图片后重试");
            }

            var fontMode = String(options && options.fontMode || "auto");
            if (fontMode !== "sans" && fontMode !== "serif") fontMode = "auto";
            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var previousHistory = document.activeHistoryState;
            var startedAt = (new Date()).getTime();

            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                activeTextJob = {
                    document: document,
                    sourceLayerName: String(
                        options && options.sourceLayerName || "选中图片"
                    ),
                    sourceLayerId: sourceLayerId,
                    fontMode: fontMode,
                    lines: lines,
                    result: null
                };
                document.suspendHistory(
                    "OCR 原位生成可编辑文字",
                    "LongStitchCEP._runTextJob()"
                );
                if (!activeTextJob.result) {
                    throw new Error("Photoshop 未返回文字图层生成结果");
                }
                activeTextJob.result.elapsedMs =
                    (new Date()).getTime() - startedAt;
                return activeTextJob.result;
            } catch (error) {
                try {
                    document.activeHistoryState = previousHistory;
                } catch (ignoreTextRollback) {}
                throw error;
            } finally {
                activeTextJob = null;
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function normalizedEraseBox(value, canvasWidth, canvasHeight) {
            var x = clampNumber(safeNumber(value && value.x, 0), 0, canvasWidth);
            var y = clampNumber(safeNumber(value && value.y, 0), 0, canvasHeight);
            var right = clampNumber(
                x + Math.max(1, safeNumber(value && value.width, 1)),
                0,
                canvasWidth
            );
            var bottom = clampNumber(
                y + Math.max(1, safeNumber(value && value.height, 1)),
                0,
                canvasHeight
            );
            return {
                x: Math.floor(x),
                y: Math.floor(y),
                width: Math.max(1, Math.ceil(right) - Math.floor(x)),
                height: Math.max(1, Math.ceil(bottom) - Math.floor(y))
            };
        }

        function isTextEraseLayer(layer) {
            try {
                return !!(
                    layer &&
                    layer.typename === "ArtLayer" &&
                    layer.kind === LayerKind.TEXT
                );
            } catch (ignoreTextEraseKind) {
                return false;
            }
        }

        /*
         * 修复结果层只保留了已处理的文字区域；它不能再作为下一次
         * 内容识别填充的来源，否则 Photoshop 会因没有足够源像素而失败。
         */
        function isGeneratedEraseRepairLayer(layer) {
            var name = "";
            try { name = String(layer && layer.name || ""); }
            catch (ignoreGeneratedRepairName) {}
            return /^原文字擦除_(?:PS内容识别|背景纯色填充|横向拉伸|纵向拉伸|LaMa)_/.test(name);
        }

        function collectTextEraseLayers(layer, output, seen) {
            if (!layer) return;
            if (layer.typename === "LayerSet") {
                var childIndex;
                for (childIndex = 0; childIndex < layer.layers.length; childIndex += 1) {
                    collectTextEraseLayers(layer.layers[childIndex], output, seen);
                }
                return;
            }
            if (!isTextEraseLayer(layer)) return;
            var id = -1;
            try { id = integerValue(layer.id, -1); } catch (ignoreEraseLayerId) {}
            if (!(id > 0) || seen[String(id)]) return;
            seen[String(id)] = true;
            output.push(layer);
        }

        function eraseSourceBelowTextLayer(document, textLayer, counts) {
            var cursor = textLayer;
            while (cursor && cursor.parent) {
                var parent = cursor.parent;
                var index;
                for (index = 0; index < parent.layers.length; index += 1) {
                    if (parent.layers[index] === cursor) break;
                }
                for (index += 1; index < parent.layers.length; index += 1) {
                    var candidate = parent.layers[index];
                    if (!candidate || candidate.typename !== "ArtLayer" ||
                        isTextEraseLayer(candidate) || isGeneratedEraseRepairLayer(candidate)) continue;
                    try { if (!candidate.visible) continue; } catch (ignoreEraseSourceVisibility) {}
                    var id = integerValue(candidate.id, -1);
                    if (id > 0) counts[String(id)] = (counts[String(id)] || 0) + 1;
                    return;
                }
                if (parent === document) break;
                cursor = parent;
            }
        }

        function resolveEraseSourceLayer(document, textLayers, fallback) {
            var counts = {};
            var index;
            for (index = 0; index < textLayers.length; index += 1) {
                eraseSourceBelowTextLayer(document, textLayers[index], counts);
            }
            var bestId = -1;
            var bestCount = 0;
            for (var key in counts) {
                if (counts.hasOwnProperty(key) && counts[key] > bestCount) {
                    bestId = integerValue(key, -1);
                    bestCount = counts[key];
                }
            }
            var resolved = bestId > 0 ? findLayerById(document, bestId) : null;
            if (resolved && resolved.typename === "ArtLayer") return resolved;
            return fallback && fallback.typename === "ArtLayer" ? fallback : null;
        }

        function selectedTextEraseRegions(options) {
            if (!app.documents.length) {
                throw new Error("请先打开图片并选择需要擦除原字的文字图层或文字组");
            }
            var document = app.activeDocument;
            var expectedDocumentId = integerValue(
                options && options.documentId,
                -1
            );
            if (currentDocumentId() !== expectedDocumentId) {
                throw new Error("当前文档已切换，请重新识别选中图片");
            }
            var sourceLayerId = integerValue(
                options && options.sourceLayerId,
                -1
            );
            var sourceLayer = findLayerById(document, sourceLayerId);

            var selectedIds = selectedLayerIds();
            if (!selectedIds.length) {
                throw new Error("请选择需要擦除原字的文字图层或文字组");
            }
            if (selectedIds.length > 80) {
                throw new Error("单次最多选择 80 个文字图层或文字组");
            }

            var selectedTextLayers = [];
            var seenTextIds = {};
            var groupCount = 0;
            var invalidCount = 0;
            var rootIndex;
            for (rootIndex = 0; rootIndex < selectedIds.length; rootIndex += 1) {
                var selectedLayer = findLayerById(document, selectedIds[rootIndex]);
                if (!selectedLayer) {
                    invalidCount += 1;
                    continue;
                }
                if (selectedLayer.typename === "LayerSet") {
                    groupCount += 1;
                    collectTextEraseLayers(selectedLayer, selectedTextLayers, seenTextIds);
                } else if (isTextEraseLayer(selectedLayer)) {
                    collectTextEraseLayers(selectedLayer, selectedTextLayers, seenTextIds);
                } else {
                    invalidCount += 1;
                }
            }

            if (!selectedTextLayers.length) {
                if (groupCount > 0) {
                    throw new Error("选中的文字组中没有可擦除的文字图层");
                }
                throw new Error("当前选择中没有可擦除的文字图层或文字组");
            }
            if (selectedTextLayers.length > 80) {
                throw new Error(
                    "选中的文字组共包含 " + selectedTextLayers.length +
                    " 个文字图层，单次最多擦除 80 个"
                );
            }
            if (invalidCount > 0) {
                throw new Error(
                    "当前选择混有 " + invalidCount +
                    " 个非文字图层，请只选择文字图层或文字组"
                );
            }

            sourceLayer = resolveEraseSourceLayer(document, selectedTextLayers, sourceLayer);
            if (!sourceLayer) {
                throw new Error("未找到当前文字图层下方可用于擦除的图片图层");
            }
            sourceLayerId = integerValue(sourceLayer.id, -1);

            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            var boxes = [];
            var textLayerIds = [];
            var names = [];
            var hiddenCount = 0;
            var index;
            for (index = 0; index < selectedTextLayers.length; index += 1) {
                var layer = selectedTextLayers[index];
                var layerId = integerValue(layer.id, -1);
                try {
                    if (!layer.visible) hiddenCount += 1;
                } catch (ignoreEraseVisibility) {}

                var size = layerSize(layer);
                if (!(size.width > 0 && size.height > 0)) {
                    throw new Error("无法读取文字图层“" + layer.name + "”的实际边界");
                }
                var horizontalPadding = Math.max(
                    2,
                    Math.min(18, Math.round(size.height * 0.12))
                );
                var verticalPadding = Math.max(
                    1,
                    Math.min(10, Math.round(size.height * 0.08))
                );
                boxes.push(normalizedEraseBox({
                    x: size.left - horizontalPadding,
                    y: size.top - verticalPadding,
                    width: size.width + horizontalPadding * 2,
                    height: size.height + verticalPadding * 2
                }, canvasWidth, canvasHeight));
                textLayerIds.push(layerId);
                names.push(String(layer.name || "文字图层"));
            }

            textLayerIds.sort(function (left, right) {
                return left - right;
            });
            return {
                documentId: currentDocumentId(),
                sourceLayerId: sourceLayerId,
                sourceLayerName: String(sourceLayer.name || "文字下方图片"),
                count: boxes.length,
                boxes: boxes,
                textLayerIds: textLayerIds,
                restoreLayerIds: selectedIds,
                selectionKey: textLayerIds.join(","),
                layerNames: names,
                groupCount: groupCount,
                hiddenCount: hiddenCount
            };
        }

        function selectRectangle(document, box) {
            document.selection.select([
                [box.x, box.y],
                [box.x + box.width, box.y],
                [box.x + box.width, box.y + box.height],
                [box.x, box.y + box.height]
            ]);
        }

        function extendRectangleSelection(document, box) {
            document.selection.select([
                [box.x, box.y],
                [box.x + box.width, box.y],
                [box.x + box.width, box.y + box.height],
                [box.x, box.y + box.height]
            ], SelectionType.EXTEND);
        }

        function retainOnlyEraseBoxes(document, layer, boxes) {
            if (!boxes || !boxes.length) {
                throw new Error("修复图层缺少选中文字范围");
            }
            document.activeLayer = layer;
            selectRectangle(document, boxes[0]);
            var index;
            for (index = 1; index < boxes.length; index += 1) {
                extendRectangleSelection(document, boxes[index]);
            }
            document.selection.invert();
            document.selection.clear();
            document.selection.deselect();
        }

        function rasterizeForRepair(document, layer) {
            document.activeLayer = layer;
            try {
                if (layer.isBackgroundLayer) layer.isBackgroundLayer = false;
            } catch (ignoreBackgroundUnlock) {}
            try {
                if (layer.kind !== LayerKind.NORMAL) {
                    layer.rasterize(RasterizeType.ENTIRELAYER);
                }
            } catch (rasterizeError) {
                try {
                    executeAction(
                        stringIDToTypeID("rasterizeLayer"),
                        new ActionDescriptor(),
                        DialogModes.NO
                    );
                } catch (fallbackRasterizeError) {
                    throw new Error("无法栅格化修复副本：" + fallbackRasterizeError.message);
                }
            }
        }

        function contentAwareFillSelection() {
            var descriptor = new ActionDescriptor();
            descriptor.putEnumerated(
                charIDToTypeID("Usng"),
                charIDToTypeID("FlCn"),
                stringIDToTypeID("contentAware")
            );
            descriptor.putUnitDouble(
                charIDToTypeID("Opct"),
                charIDToTypeID("#Prc"),
                100
            );
            descriptor.putEnumerated(
                charIDToTypeID("Md  "),
                charIDToTypeID("BlnM"),
                charIDToTypeID("Nrml")
            );
            executeAction(
                charIDToTypeID("Fl  "),
                descriptor,
                DialogModes.NO
            );
        }

        function createContentAwareRepairPatch(document, sourceLayer, root, box, index) {
            var attempt;
            var lastError = null;
            for (attempt = 0; attempt < 2; attempt += 1) {
                var patch = null;
                try {
                    /* 每个区域均从完整原始背景复制，绝不复用局部化后的补片。 */
                    patch = sourceLayer.duplicate();
                    patch.name = "PS内容识别临时采样_" + (index + 1);
                    patch.move(root, ElementPlacement.PLACEATBEGINNING);
                    rasterizeForRepair(document, patch);
                    document.activeLayer = patch;
                    selectRectangle(document, box);
                    try {
                        document.selection.feather(attempt === 0
                            ? Math.max(1, Math.min(4, Math.round(box.height * 0.04)))
                            : 0);
                    } catch (ignoreContentAwareFeather) {}
                    contentAwareFillSelection();
                    document.selection.deselect();
                    retainOnlyEraseBoxes(document, patch, [box]);
                    patch.name = "PS内容识别修复_" + (index + 1);
                    return patch;
                } catch (error) {
                    lastError = error;
                    try { document.selection.deselect(); } catch (ignoreContentAwareDeselect) {}
                    if (patch) {
                        try { patch.remove(); } catch (ignoreContentAwarePatchRemove) {}
                    }
                }
            }
            throw lastError || new Error("PS 内容识别填充失败");
        }

        function eraseBackgroundColor(document, box) {
            var width = pixels(document.width);
            var height = pixels(document.height);
            var offset = Math.max(4, Math.min(24, Math.round(Math.min(box.width, box.height) * 0.18)));
            var points = [
                [box.x - offset, box.y + box.height / 2],
                [box.x + box.width + offset, box.y + box.height / 2],
                [box.x + box.width / 2, box.y - offset],
                [box.x + box.width / 2, box.y + box.height + offset]
            ];
            var reds = [], greens = [], blues = [], index;
            for (index = 0; index < points.length; index += 1) {
                var x = Math.max(0, Math.min(width - 1, Math.round(points[index][0])));
                var y = Math.max(0, Math.min(height - 1, Math.round(points[index][1])));
                var sampler = null;
                try {
                    sampler = document.colorSamplers.add([UnitValue(x, "px"), UnitValue(y, "px")]);
                    var rgb = sampler.color.rgb;
                    reds.push(Number(rgb.red));
                    greens.push(Number(rgb.green));
                    blues.push(Number(rgb.blue));
                } catch (ignoreColorSampler) {
                } finally {
                    if (sampler) {
                        try { sampler.remove(); } catch (ignoreSamplerRemove) {}
                    }
                }
            }
            if (!reds.length) throw new Error("无法读取文字周边的背景颜色");
            reds.sort(function (a, b) { return a - b; });
            greens.sort(function (a, b) { return a - b; });
            blues.sort(function (a, b) { return a - b; });
            var middle = Math.floor(reds.length / 2);
            var color = new SolidColor();
            color.rgb.red = reds[middle];
            color.rgb.green = greens[middle];
            color.rgb.blue = blues[middle];
            return color;
        }

        function rectanglesOverlapWithPadding(left, right, padding) {
            var pad = Math.max(0, safeNumber(padding, 0));
            return !(
                left.x + left.width <= right.x - pad ||
                left.x >= right.x + right.width + pad ||
                left.y + left.height <= right.y - pad ||
                left.y >= right.y + right.height + pad
            );
        }

        function stretchSampleCandidates(
            box,
            mode,
            canvasWidth,
            canvasHeight,
            sourceBounds,
            avoidBoxes
        ) {
            var sourceLeft = Math.max(
                0,
                Math.floor(safeNumber(sourceBounds && sourceBounds.left, 0))
            );
            var sourceTop = Math.max(
                0,
                Math.floor(safeNumber(sourceBounds && sourceBounds.top, 0))
            );
            var sourceRight = Math.min(
                canvasWidth,
                Math.ceil(
                    sourceLeft +
                    Math.max(1, safeNumber(sourceBounds && sourceBounds.width, canvasWidth))
                )
            );
            var sourceBottom = Math.min(
                canvasHeight,
                Math.ceil(
                    sourceTop +
                    Math.max(1, safeNumber(sourceBounds && sourceBounds.height, canvasHeight))
                )
            );
            var candidates = [];
            var stripSize;
            var guard;
            if (mode === "horizontal") {
                stripSize = Math.max(
                    8,
                    Math.min(36, Math.round(Math.max(12, box.height * 0.32)))
                );
                stripSize = Math.min(stripSize, Math.max(1, sourceRight - sourceLeft));
                guard = Math.max(4, Math.min(28, Math.round(box.height * 0.18)));
            } else {
                stripSize = Math.max(
                    6,
                    Math.min(28, Math.round(Math.max(10, box.height * 0.22)))
                );
                stripSize = Math.min(stripSize, Math.max(1, sourceBottom - sourceTop));
                guard = Math.max(3, Math.min(22, Math.round(box.height * 0.14)));
            }

            var step = Math.max(4, Math.round(stripSize * 0.75));
            var offsets = [guard, guard + step, guard + step * 2, guard + step * 3];
            var offsetIndex;
            for (offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
                var distance = offsets[offsetIndex];
                if (mode === "horizontal") {
                    var leftX = box.x - distance - stripSize;
                    if (leftX >= sourceLeft) {
                        candidates.push({
                            x: leftX,
                            y: box.y,
                            width: stripSize,
                            height: box.height,
                            distance: distance,
                            side: "left"
                        });
                    }
                    var rightX = box.x + box.width + distance;
                    if (rightX + stripSize <= sourceRight) {
                        candidates.push({
                            x: rightX,
                            y: box.y,
                            width: stripSize,
                            height: box.height,
                            distance: distance,
                            side: "right"
                        });
                    }
                } else {
                    var topY = box.y - distance - stripSize;
                    if (topY >= sourceTop) {
                        candidates.push({
                            x: box.x,
                            y: topY,
                            width: box.width,
                            height: stripSize,
                            distance: distance,
                            side: "top"
                        });
                    }
                    var bottomY = box.y + box.height + distance;
                    if (bottomY + stripSize <= sourceBottom) {
                        candidates.push({
                            x: box.x,
                            y: bottomY,
                            width: box.width,
                            height: stripSize,
                            distance: distance,
                            side: "bottom"
                        });
                    }
                }
            }

            var normalized = [];
            var candidateIndex;
            for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
                var raw = candidates[candidateIndex];
                var current = normalizedEraseBox(raw, canvasWidth, canvasHeight);
                current.distance = raw.distance;
                current.side = raw.side;
                current.clean = true;
                if (avoidBoxes && avoidBoxes.length) {
                    var avoidIndex;
                    var avoidPadding = Math.max(2, Math.min(10, Math.round(guard * 0.35)));
                    for (avoidIndex = 0; avoidIndex < avoidBoxes.length; avoidIndex += 1) {
                        if (rectanglesOverlapWithPadding(current, avoidBoxes[avoidIndex], avoidPadding)) {
                            current.clean = false;
                            break;
                        }
                    }
                }
                normalized.push(current);
            }

            normalized.sort(function (left, right) {
                if (left.clean !== right.clean) return left.clean ? -1 : 1;
                if (left.distance !== right.distance) return left.distance - right.distance;
                if (mode === "horizontal") {
                    if (left.side === "left" && right.side !== "left") return -1;
                    if (right.side === "left" && left.side !== "left") return 1;
                } else {
                    if (left.side === "top" && right.side !== "top") return -1;
                    if (right.side === "top" && left.side !== "top") return 1;
                }
                return 0;
            });
            return normalized;
        }

        function fallbackStretchSample(
            box,
            mode,
            canvasWidth,
            canvasHeight,
            sourceBounds
        ) {
            var sourceLeft = Math.max(0, Math.floor(safeNumber(sourceBounds && sourceBounds.left, 0)));
            var sourceTop = Math.max(0, Math.floor(safeNumber(sourceBounds && sourceBounds.top, 0)));
            var sourceRight = Math.min(
                canvasWidth,
                Math.ceil(sourceLeft + Math.max(1, safeNumber(sourceBounds && sourceBounds.width, canvasWidth)))
            );
            var sourceBottom = Math.min(
                canvasHeight,
                Math.ceil(sourceTop + Math.max(1, safeNumber(sourceBounds && sourceBounds.height, canvasHeight)))
            );
            if (mode === "horizontal") {
                var width = Math.max(1, Math.min(12, Math.max(1, sourceRight - sourceLeft)));
                var x = box.x - width >= sourceLeft
                    ? box.x - width
                    : Math.min(sourceRight - width, box.x + box.width);
                return normalizedEraseBox({
                    x: Math.max(sourceLeft, x),
                    y: box.y,
                    width: width,
                    height: box.height
                }, canvasWidth, canvasHeight);
            }
            var height = Math.max(1, Math.min(10, Math.max(1, sourceBottom - sourceTop)));
            var y = box.y - height >= sourceTop
                ? box.y - height
                : Math.min(sourceBottom - height, box.y + box.height);
            return normalizedEraseBox({
                x: box.x,
                y: Math.max(sourceTop, y),
                width: box.width,
                height: height
            }, canvasWidth, canvasHeight);
        }

        function pasteStretchSample(document, sourceLayer, candidates, fallback) {
            var candidateIndex;
            for (candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
                var candidate = candidates[candidateIndex];
                document.activeLayer = sourceLayer;
                selectRectangle(document, candidate);
                try {
                    document.selection.copy(false);
                    document.selection.deselect();
                    var patch = document.paste();
                    if (!patch) patch = document.activeLayer;
                    return { patch: patch, sample: candidate };
                } catch (candidateCopyError) {
                    try { document.selection.deselect(); } catch (ignoreCandidateDeselect) {}
                }
            }
            document.activeLayer = sourceLayer;
            selectRectangle(document, fallback);
            try {
                document.selection.copy(false);
            } catch (copyError) {
                document.selection.deselect();
                throw new Error("文字附近没有可用于拉伸的干净像素");
            }
            document.selection.deselect();
            var fallbackPatch = document.paste();
            if (!fallbackPatch) fallbackPatch = document.activeLayer;
            return { patch: fallbackPatch, sample: fallback };
        }

        function expandedStretchEraseBox(document, box) {
            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            /* OCR 文字框通常不包含外沿的抗锯齿像素；扩大 3～6px 才能把残影一并覆盖。 */
            var padding = Math.max(3, Math.min(6, Math.round(Math.min(box.width, box.height) * 0.08)));
            var left = Math.max(0, Math.floor(box.x - padding));
            var top = Math.max(0, Math.floor(box.y - padding));
            var right = Math.min(canvasWidth, Math.ceil(box.x + box.width + padding));
            var bottom = Math.min(canvasHeight, Math.ceil(box.y + box.height + padding));
            return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
        }

        function createStretchPatch(document, sourceLayer, root, box, mode, avoidBoxes) {
            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            var sourceBounds = layerSize(sourceLayer);
            var candidates = stretchSampleCandidates(
                box,
                mode,
                canvasWidth,
                canvasHeight,
                sourceBounds,
                avoidBoxes
            );
            var fallback = fallbackStretchSample(
                box,
                mode,
                canvasWidth,
                canvasHeight,
                sourceBounds
            );
            var picked = pasteStretchSample(document, sourceLayer, candidates, fallback);
            var patch = picked.patch;
            var sample = picked.sample;
            patch.name = mode === "horizontal"
                ? "横向拉伸补片_智能取样"
                : "纵向拉伸补片_智能取样";
            patch.move(root, ElementPlacement.PLACEATBEGINNING);

            /*
             * v2.2.04：先把较宽的邻近干净像素带压缩成 2px 纹理剖面，再拉伸。
             * 这样会把采样带内零散的文字抗锯齿/小污点平均掉，同时保留与拉伸方向
             * 垂直的渐变与明暗变化，避免旧算法直接放大边缘脏像素形成长条拖影。
             */
            var profileSize = 2;
            var previousInterpolation = null;
            try {
                previousInterpolation = app.preferences.interpolation;
                app.preferences.interpolation = ResampleMethod.BICUBIC;
            } catch (ignoreStretchInterpolation) {}
            try {
                var currentSize = layerSize(patch);
                if (mode === "horizontal" && currentSize.width > profileSize) {
                    patch.resize(
                        clampNumber(profileSize / Math.max(1, currentSize.width) * 100, 1, 100),
                        100,
                        AnchorPosition.MIDDLECENTER
                    );
                } else if (mode === "vertical" && currentSize.height > profileSize) {
                    patch.resize(
                        100,
                        clampNumber(profileSize / Math.max(1, currentSize.height) * 100, 1, 100),
                        AnchorPosition.MIDDLECENTER
                    );
                }

                currentSize = layerSize(patch);
                var horizontalScale = mode === "horizontal"
                    ? box.width / Math.max(1, currentSize.width) * 100
                    : 100;
                var verticalScale = mode === "vertical"
                    ? box.height / Math.max(1, currentSize.height) * 100
                    : 100;
                patch.resize(
                    clampNumber(horizontalScale, 1, 10000),
                    clampNumber(verticalScale, 1, 10000),
                    AnchorPosition.MIDDLECENTER
                );
            } finally {
                if (previousInterpolation !== null) {
                    try { app.preferences.interpolation = previousInterpolation; }
                    catch (ignoreRestoreStretchInterpolation) {}
                }
            }
            var size = layerSize(patch);
            patch.translate(box.x - size.left, box.y - size.top);
            return patch;
        }

        function hidePreviousRepairLayer(job, replacementLayer) {
            var previousId = integerValue(job.previousRepairLayerId, -1);
            if (!(previousId > 0)) return false;
            var previous = findLayerById(job.document, previousId);
            if (
                !previous ||
                previous === job.sourceLayer ||
                (replacementLayer && previous === replacementLayer)
            ) {
                return false;
            }
            try {
                previous.visible = false;
                return true;
            } catch (ignorePreviousRepairVisibility) {
                return false;
            }
        }

        function runEraseJob() {
            var job = activeEraseJob;
            if (!job || !job.document || !job.sourceLayer) {
                throw new Error("文字擦除任务不存在");
            }
            var document = job.document;
            var sourceLayer = job.sourceLayer;
            app.activeDocument = document;

            if (job.mode === "lama") {
                var repairedDocument = null;
                try {
                    repairedDocument = app.open(job.repairedFile);
                    if (repairedDocument.layers.length > 1) repairedDocument.flatten();
                    var repairedLayer = repairedDocument.activeLayer.duplicate(
                        document,
                        ElementPlacement.PLACEATBEGINNING
                    );
                    repairedDocument.close(SaveOptions.DONOTSAVECHANGES);
                    repairedDocument = null;
                    app.activeDocument = document;
                    repairedLayer.name = "原文字擦除_LaMa_" +
                        safeLayerName(job.sourceLayerName, "选中图片");
                    var repairedSize = layerSize(repairedLayer);
                    repairedLayer.translate(
                        job.originX - repairedSize.left,
                        job.originY - repairedSize.top
                    );
                    retainOnlyEraseBoxes(document, repairedLayer, job.boxes);
                    repairedLayer.move(sourceLayer, ElementPlacement.PLACEBEFORE);
                    hidePreviousRepairLayer(job, repairedLayer);
                    document.activeLayer = repairedLayer;
                    job.result = {
                        layers: 1,
                        layerId: repairedLayer.id,
                        mode: "lama"
                    };
                    selectLayersByIds(job.restoreLayerIds && job.restoreLayerIds.length ? job.restoreLayerIds : job.textLayerIds);
                    return;
                } finally {
                    if (repairedDocument) {
                        try {
                            repairedDocument.close(SaveOptions.DONOTSAVECHANGES);
                        } catch (ignoreCloseRepairedDocument) {}
                    }
                    try {
                        app.activeDocument = document;
                    } catch (ignoreRestoreInpaintDocument) {}
                }
            }

            if (job.mode === "contentAware") {
                var contentAwareRoot = document.layerSets.add();
                contentAwareRoot.name = "原文字擦除_PS内容识别_临时";
                contentAwareRoot.move(sourceLayer, ElementPlacement.PLACEBEFORE);
                var contentAwareFailures = [];
                var contentAwareSuccesses = 0;
                var contentAwareIndex;
                for (contentAwareIndex = 0; contentAwareIndex < job.boxes.length; contentAwareIndex += 1) {
                    try {
                        createContentAwareRepairPatch(
                            document,
                            sourceLayer,
                            contentAwareRoot,
                            job.boxes[contentAwareIndex],
                            contentAwareIndex
                        );
                        contentAwareSuccesses += 1;
                    } catch (contentAwareError) {
                        contentAwareFailures.push({
                            index: contentAwareIndex,
                            layerId: integerValue(job.textLayerIds[contentAwareIndex], -1),
                            bounds: job.boxes[contentAwareIndex],
                            error: String(contentAwareError && contentAwareError.message || contentAwareError)
                        });
                    }
                }
                if (!contentAwareSuccesses) {
                    try { contentAwareRoot.remove(); } catch (ignoreEmptyContentAwareRoot) {}
                    throw new Error("PS 内容识别填充未能处理任何文字区域：" +
                        (contentAwareFailures.length ? contentAwareFailures[0].error : "未知错误"));
                }
                var contentAwareRepair = contentAwareRoot.merge();
                contentAwareRepair.name = "原文字擦除_PS内容识别_" +
                    safeLayerName(job.sourceLayerName, "选中图片");
                hidePreviousRepairLayer(job, contentAwareRepair);
                document.activeLayer = contentAwareRepair;
                job.result = {
                    layers: 1,
                    layerId: contentAwareRepair.id,
                    mode: "contentAware",
                    processedRegions: contentAwareSuccesses,
                    failedRegions: contentAwareFailures
                };
                selectLayersByIds(job.restoreLayerIds && job.restoreLayerIds.length ? job.restoreLayerIds : job.textLayerIds);
                return;
            }

            if (job.mode === "solidFill") {
                var repair = sourceLayer.duplicate();
                repair.name = (job.mode === "solidFill"
                    ? "原文字擦除_背景纯色填充_"
                    : "原文字擦除_PS内容识别_") +
                    safeLayerName(job.sourceLayerName, "选中图片");
                repair.move(sourceLayer, ElementPlacement.PLACEBEFORE);
                rasterizeForRepair(document, repair);

                var fillIndex;
                for (fillIndex = 0; fillIndex < job.boxes.length; fillIndex += 1) {
                    document.activeLayer = repair;
                    selectRectangle(document, job.boxes[fillIndex]);
                    try { document.selection.feather(job.mode === "solidFill" ? 3 : Math.max(1, Math.min(4, Math.round(job.boxes[fillIndex].height * 0.04)))); } catch (ignoreFeather) {}
                    document.selection.fill(eraseBackgroundColor(document, job.boxes[fillIndex]), ColorBlendMode.NORMAL, 100, false);
                    document.selection.deselect();
                }
                retainOnlyEraseBoxes(document, repair, job.boxes);
                hidePreviousRepairLayer(job, repair);
                document.activeLayer = repair;
                job.result = {
                    layers: 1,
                    layerId: repair.id,
                    mode: job.mode
                };
                selectLayersByIds(job.restoreLayerIds && job.restoreLayerIds.length ? job.restoreLayerIds : job.textLayerIds);
                return;
            }

            var root = document.layerSets.add();
            root.name = (job.mode === "horizontal"
                ? "原文字擦除_横向拉伸_"
                : "原文字擦除_纵向拉伸_") +
                safeLayerName(job.sourceLayerName, "选中图片");
            root.move(sourceLayer, ElementPlacement.PLACEBEFORE);

            var index;
            var stretchBoxes = [];
            for (index = 0; index < job.boxes.length; index += 1) {
                stretchBoxes.push(expandedStretchEraseBox(document, job.boxes[index]));
            }
            for (index = 0; index < stretchBoxes.length; index += 1) {
                createStretchPatch(
                    document,
                    sourceLayer,
                    root,
                    stretchBoxes[index],
                    job.mode,
                    stretchBoxes
                );
            }
            if (!root.layers.length) {
                try {
                    root.remove();
                } catch (ignoreEmptyRepairRoot) {}
                throw new Error("没有生成可用的拉伸修复补片");
            }
            var merged = root.merge();
            merged.name = (job.mode === "horizontal"
                ? "原文字擦除_横向拉伸_"
                : "原文字擦除_纵向拉伸_") +
                safeLayerName(job.sourceLayerName, "选中图片");
            hidePreviousRepairLayer(job, merged);
            document.activeLayer = merged;
            job.result = {
                layers: 1,
                layerId: merged.id,
                mode: job.mode
            };
            selectLayersByIds(job.restoreLayerIds && job.restoreLayerIds.length ? job.restoreLayerIds : job.textLayerIds);
        }

        function eraseOriginalText(options) {
            if (!app.documents.length) throw new Error("识别来源文档已经关闭");
            var document = app.activeDocument;
            if (currentDocumentId() !== integerValue(options && options.documentId, -1)) {
                throw new Error("当前文档已切换，请重新识别选中图片");
            }
            var sourceLayerId = integerValue(options && options.sourceLayerId, -1);
            var sourceLayer = findLayerById(document, sourceLayerId);
            if (!sourceLayer || sourceLayer.typename !== "ArtLayer") {
                throw new Error("原图片图层已不存在或不是可修复的图片图层");
            }
            var mode = String(options && options.mode || "horizontal");
            if (mode !== "horizontal" &&
                mode !== "vertical" &&
                mode !== "solidFill" &&
                mode !== "contentAware") {
                throw new Error("不支持的文字擦除方式");
            }
            var inputBoxes = options && options.boxes ? options.boxes : [];
            if (!(inputBoxes instanceof Array) || !inputBoxes.length) {
                throw new Error("没有可擦除的文字范围");
            }
            if (inputBoxes.length > 80) {
                throw new Error("单次最多擦除 80 个文字范围");
            }
            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            var boxes = [];
            var boxIndex;
            for (boxIndex = 0; boxIndex < inputBoxes.length; boxIndex += 1) {
                boxes.push(normalizedEraseBox(
                    inputBoxes[boxIndex],
                    canvasWidth,
                    canvasHeight
                ));
            }

            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var previousHistory = document.activeHistoryState;
            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                activeEraseJob = {
                    document: document,
                    sourceLayer: sourceLayer,
                    sourceLayerName: String(
                        options && options.sourceLayerName || sourceLayer.name
                    ),
                    mode: mode,
                    boxes: boxes,
                    textLayerIds: options && options.textLayerIds
                        ? options.textLayerIds
                        : [],
                    restoreLayerIds: options && options.restoreLayerIds
                        ? options.restoreLayerIds
                        : (options && options.textLayerIds ? options.textLayerIds : []),
                    previousRepairLayerId: integerValue(
                        options && options.previousRepairLayerId,
                        -1
                    ),
                    result: null
                };
                document.suspendHistory(
                    "擦除图片原文字",
                    "LongStitchCEP._runEraseJob()"
                );
                if (!activeEraseJob.result) {
                    throw new Error("Photoshop 未返回文字擦除结果");
                }
                return activeEraseJob.result;
            } catch (error) {
                try {
                    document.selection.deselect();
                } catch (ignoreEraseDeselect) {}
                try {
                    document.activeHistoryState = previousHistory;
                } catch (ignoreEraseRollback) {}
                throw error;
            } finally {
                activeEraseJob = null;
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function applyInpaintResult(options) {
            if (!app.documents.length) throw new Error("识别来源文档已经关闭");
            var document = app.activeDocument;
            if (currentDocumentId() !== integerValue(options && options.documentId, -1)) {
                throw new Error("当前文档已切换，请重新识别选中图片");
            }
            var sourceLayerId = integerValue(options && options.sourceLayerId, -1);
            var sourceLayer = findLayerById(document, sourceLayerId);
            if (!sourceLayer) throw new Error("原图片图层已不存在，请重新识别");
            var repairedFile = fileObject(options && options.repairedPath);
            var inputBoxes = options && options.boxes ? options.boxes : [];
            if (!(inputBoxes instanceof Array) || !inputBoxes.length) {
                throw new Error("没有选中文字图层对应的擦除范围");
            }
            if (inputBoxes.length > 80) {
                throw new Error("单次最多擦除 80 个文字图层");
            }
            var canvasWidth = pixels(document.width);
            var canvasHeight = pixels(document.height);
            var boxes = [];
            var boxIndex;
            for (boxIndex = 0; boxIndex < inputBoxes.length; boxIndex += 1) {
                boxes.push(normalizedEraseBox(
                    inputBoxes[boxIndex],
                    canvasWidth,
                    canvasHeight
                ));
            }
            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var previousHistory = document.activeHistoryState;
            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                activeEraseJob = {
                    document: document,
                    sourceLayer: sourceLayer,
                    sourceLayerName: String(
                        options && options.sourceLayerName || sourceLayer.name
                    ),
                    mode: "lama",
                    repairedFile: repairedFile,
                    originX: safeNumber(options && options.originX, 0),
                    originY: safeNumber(options && options.originY, 0),
                    boxes: boxes,
                    textLayerIds: options && options.textLayerIds
                        ? options.textLayerIds
                        : [],
                    restoreLayerIds: options && options.restoreLayerIds
                        ? options.restoreLayerIds
                        : (options && options.textLayerIds ? options.textLayerIds : []),
                    previousRepairLayerId: integerValue(
                        options && options.previousRepairLayerId,
                        -1
                    ),
                    result: null
                };
                document.suspendHistory(
                    "LaMa 擦除图片原文字",
                    "LongStitchCEP._runEraseJob()"
                );
                if (!activeEraseJob.result) {
                    throw new Error("Photoshop 未返回 LaMa 修复图层结果");
                }
                return activeEraseJob.result;
            } catch (error) {
                try {
                    document.activeHistoryState = previousHistory;
                } catch (ignoreInpaintRollback) {}
                throw error;
            } finally {
                activeEraseJob = null;
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }


        /* v1.8.0 常用工具、文档预设与文字排版；v1.9.0 图层与文字进阶 */

    return {
            exportSelectedLayerForOCR: exportSelectedLayerForOCR,
            runTextJob: runTextJob,
            createEditableTextLayers: createEditableTextLayers,
            selectedTextEraseRegions: selectedTextEraseRegions,
            runEraseJob: runEraseJob,
            eraseOriginalText: eraseOriginalText,
            applyInpaintResult: applyInpaintResult
    };
};
