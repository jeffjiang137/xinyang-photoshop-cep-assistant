/* 鑫洋助理 ExtendScript 模块：frameTools */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.frameTools = function (deps) {
    deps = deps || {};
        var integerValue = deps.integerValue;
        var layerNumericId = deps.layerNumericId;
        var layerSize = deps.layerSize;
        var pixels = deps.pixels;
        var selectLayersByIds = deps.selectLayersByIds;
        var selectedLayerIds = deps.selectedLayerIds;
        var suspendToolsHistory = deps.suspendToolsHistory;
        var toolCreateShapeRectangle = deps.toolCreateShapeRectangle;
        var toolHexColor = deps.toolHexColor;
        var toolLayerById = deps.toolLayerById;
        var toolLayerFillColor = deps.toolLayerFillColor;
        var toolLayerStrokeColor = deps.toolLayerStrokeColor;
        var toolLayerVisualBounds = deps.toolLayerVisualBounds;
        var toolSolidColorFromHex = deps.toolSolidColorFromHex;
        var toolsApplyRectangleSettings = deps.toolsApplyRectangleSettings;


        function frameTrim(value) {
            return String(value === undefined || value === null ? "" : value)
                .replace(/^\s+|\s+$/g, "");
        }

        function frameUnitPixels(value, fallback) {
            var text = frameTrim(value);
            if (!text) return Number(fallback) || 0;
            text = text.replace(/，/g, ".");
            if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
                return Number(text) || 0;
            }
            try {
                return Number(UnitValue(text).as("px")) || 0;
            } catch (ignoreFrameUnit) {
                throw new Error("无法识别尺寸：" + text);
            }
        }

        function frameFontPoints(value, fallbackPixels, document) {
            var text = frameTrim(value);
            var resolution = Math.max(1, Number(document.resolution) || 72);
            if (!text) return Math.max(1, Number(fallbackPixels) * 72 / resolution);
            text = text.replace(/，/g, ".");
            var match = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z]*)$/i);
            if (!match) throw new Error("无法识别字号：" + text);
            var number = Number(match[1]);
            var unit = String(match[2] || "px").toLowerCase();
            if (!(number > 0)) throw new Error("字号必须大于 0");
            if (unit === "pt") return number;
            if (unit === "mm") return number / 25.4 * 72;
            if (unit === "px") return number * 72 / resolution;
            throw new Error("字号仅支持 px、mm 或 pt");
        }

        function frameParseColumns(expression) {
            var text = frameTrim(expression)
                .replace(/\s+/g, "")
                .replace(/：/g, ":")
                .replace(/＞/g, ">")
                .replace(/％/g, "%")
                .replace(/＝/g, "=");
            var weights = [];
            var count;
            var index;
            var match;
            if (!text) throw new Error("存在空白的行列数表达式");

            if (/^\d+$/.test(text)) {
                count = parseInt(text, 10);
                if (count < 1 || count > 100) throw new Error("每行框架数量需在 1—100 之间");
                for (index = 0; index < count; index += 1) weights.push(1);
                return weights;
            }

            if (text.indexOf(":") >= 0) {
                var pieces = text.split(":");
                if (pieces.length > 100) throw new Error("单行最多生成 100 个框架");
                for (index = 0; index < pieces.length; index += 1) {
                    var ratio = Number(pieces[index]);
                    if (!(ratio > 0)) throw new Error("比例表达式必须全部大于 0：" + text);
                    weights.push(ratio);
                }
                return weights;
            }

            match = text.match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))=(\d+)>(\d+)$/);
            if (match) {
                var emphasizedRatio = Number(match[1]);
                var emphasizedIndex = parseInt(match[2], 10);
                count = parseInt(match[3], 10) + 1;
                if (!(emphasizedRatio > 0) || count < 1 || count > 100 || emphasizedIndex < 1 || emphasizedIndex > count) {
                    throw new Error("比例指定表达式无效：" + text);
                }
                for (index = 0; index < count; index += 1) weights.push(1);
                weights[emphasizedIndex - 1] = emphasizedRatio;
                return weights;
            }

            match = text.match(/^(\d+)=(\d+)%([+]?(?:\d+(?:\.\d*)?|\.\d+))$/);
            if (match) {
                count = parseInt(match[1], 10);
                var percentIndex = parseInt(match[2], 10);
                var percent = Number(match[3]);
                if (count < 1 || count > 100 || percentIndex < 1 || percentIndex > count || !(percent > 0 && percent <= 100)) {
                    throw new Error("百分比表达式无效：" + text);
                }
                if (count === 1) {
                    if (Math.abs(percent - 100) > 0.0001) throw new Error("单个框架的占比必须为 100%");
                    return [100];
                }
                var remaining = (100 - percent) / (count - 1);
                if (!(remaining > 0)) throw new Error("其它框架没有可分配的宽度");
                for (index = 0; index < count; index += 1) weights.push(remaining);
                weights[percentIndex - 1] = percent;
                return weights;
            }

            throw new Error("无法识别表达式“" + text + "”，请展开表达式使用说明");
        }

        function frameCanvasBounds(document) {
            return {
                left: 0,
                top: 0,
                right: Math.max(1, pixels(document.width)),
                bottom: Math.max(1, pixels(document.height))
            };
        }

        function frameCreateShapeEllipse(document, bounds, colorValue) {
            var color = toolHexColor(colorValue);
            try {
                var make = new ActionDescriptor();
                var reference = new ActionReference();
                reference.putClass(stringIDToTypeID("contentLayer"));
                make.putReference(charIDToTypeID("null"), reference);

                var using = new ActionDescriptor();
                var fill = new ActionDescriptor();
                var rgb = new ActionDescriptor();
                rgb.putDouble(charIDToTypeID("Rd  "), color.red);
                rgb.putDouble(charIDToTypeID("Grn "), color.green);
                rgb.putDouble(charIDToTypeID("Bl  "), color.blue);
                fill.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), rgb);
                using.putObject(charIDToTypeID("Type"), stringIDToTypeID("solidColorLayer"), fill);

                var ellipse = new ActionDescriptor();
                ellipse.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), bounds.top);
                ellipse.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), bounds.left);
                ellipse.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), bounds.bottom);
                ellipse.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), bounds.right);
                using.putObject(charIDToTypeID("Shp "), charIDToTypeID("Elps"), ellipse);

                var strokeStyle = new ActionDescriptor();
                strokeStyle.putInteger(stringIDToTypeID("strokeStyleVersion"), 2);
                strokeStyle.putBoolean(stringIDToTypeID("strokeEnabled"), false);
                strokeStyle.putBoolean(stringIDToTypeID("fillEnabled"), true);
                using.putObject(stringIDToTypeID("strokeStyle"), stringIDToTypeID("strokeStyle"), strokeStyle);

                make.putObject(charIDToTypeID("Usng"), stringIDToTypeID("contentLayer"), using);
                executeAction(charIDToTypeID("Mk  "), make, DialogModes.NO);
                return document.activeLayer;
            } catch (ellipseError) {
                throw new Error("当前 Photoshop 无法创建圆形框架：" + (ellipseError.message || String(ellipseError)));
            }
        }

        function frameMoveLayerToBox(layer, box, horizontal, vertical) {
            var size = layerSize(layer);
            var targetLeft = box.left;
            var targetTop = box.top;
            if (horizontal === "center") targetLeft = box.left + (box.right - box.left - size.width) / 2;
            else if (horizontal === "right") targetLeft = box.right - size.width;
            if (vertical === "middle") targetTop = box.top + (box.bottom - box.top - size.height) / 2;
            else if (vertical === "bottom") targetTop = box.bottom - size.height;
            layer.translate(UnitValue(targetLeft - size.left, "px"), UnitValue(targetTop - size.top, "px"));
        }

        function frameCreateText(document, parent, contents, name, sizePt, colorValue, box, horizontal, vertical) {
            var layer = document.artLayers.add();
            layer.kind = LayerKind.TEXT;
            layer.name = name;
            var item = layer.textItem;
            item.kind = TextType.POINTTEXT;
            item.contents = contents;
            item.size = UnitValue(Math.max(1, sizePt), "pt");
            item.color = toolSolidColorFromHex(colorValue);
            item.justification = Justification.LEFT;
            try { item.useAutoLeading = true; } catch (ignoreFrameAutoLeading) {}
            item.position = [UnitValue(box.left, "px"), UnitValue(box.top + Math.max(8, sizePt * Number(document.resolution || 72) / 72), "px")];
            layer.move(parent, ElementPlacement.INSIDE);
            frameMoveLayerToBox(layer, box, horizontal, vertical);
            return layer;
        }

        function frameTextLayout(styleIndex) {
            styleIndex = Math.max(1, Math.min(9, integerValue(styleIndex, 1)));
            return {
                external: styleIndex <= 3,
                horizontal: styleIndex === 1 || styleIndex === 4 || styleIndex === 7
                    ? "left"
                    : styleIndex === 2 || styleIndex === 5 || styleIndex === 8
                        ? "center"
                        : "right",
                vertical: styleIndex >= 7 ? "middle" : "bottom"
            };
        }

        function frameCreate(options) {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            options = options || {};
            var document = app.activeDocument;
            var type = Math.max(0, Math.min(2, integerValue(options.type, 0)));
            var sourceLines = options.lines instanceof Array ? options.lines : [];
            var activeLines = [];
            var index;
            for (index = 0; index < sourceLines.length; index += 1) {
                if (!frameTrim(sourceLines[index] && sourceLines[index].value)) continue;
                activeLines.push({
                    sourceIndex: index,
                    value: frameTrim(sourceLines[index].value),
                    height: frameTrim(sourceLines[index].height)
                });
            }
            if (!activeLines.length) throw new Error("请至少填写一行列数表达式");

            var rowSpace = Math.max(0, frameUnitPixels(options.rowSpace, 8));
            var colSpace = Math.max(0, frameUnitPixels(options.colSpace, 8));
            var area = frameCanvasBounds(document);
            var areaWidth = area.right - area.left;
            var areaHeight = area.bottom - area.top;
            var usableHeight = areaHeight - rowSpace * Math.max(0, activeLines.length - 1);
            if (!(usableHeight > 0)) throw new Error("行间距过大，画布没有可用高度");

            var baseRowHeight = usableHeight / activeLines.length;
            var rowHeights = [];
            var totalHeight = rowSpace * Math.max(0, activeLines.length - 1);
            for (index = 0; index < activeLines.length; index += 1) {
                var explicitHeight = type === 0 && activeLines[index].height
                    ? frameUnitPixels(activeLines[index].height, baseRowHeight)
                    : baseRowHeight;
                if (!(explicitHeight > 0)) throw new Error("第 " + (activeLines[index].sourceIndex + 1) + " 行高度必须大于 0");
                rowHeights.push(explicitHeight);
                totalHeight += explicitHeight;
            }
            if (totalHeight > areaHeight + 0.5) {
                throw new Error("各行高度与间距合计超出画布高度 " + Math.round(areaHeight) + "px");
            }

            var defaultMainPixels = Math.max(16, Math.min(36, baseRowHeight * 0.11));
            var defaultSubPixels = Math.max(10, Math.min(22, defaultMainPixels * 0.58));
            var mainPt = frameFontPoints(options.t1, defaultMainPixels, document);
            var subPt = frameFontPoints(options.t2, defaultSubPixels, document);
            var pxPerPt = Math.max(0.1, Number(document.resolution) || 72) / 72;
            var mainPx = mainPt * pxPerPt;
            var subPx = subPt * pxPerPt;
            var textLayout = frameTextLayout(options.titleStyleIndex);
            var fillColor = "#dcdcdc";
            var textColor = "#555555";
            var previousUnits = app.preferences.rulerUnits;

            try {
                app.preferences.rulerUnits = Units.PIXELS;
                return suspendToolsHistory(document, "鑫洋助理：生成自定义框架", function () {
                    var root = document.layerSets.add();
                    root.name = "自定义框架";
                    var createdIds = [];
                    var created = 0;
                    var currentTop = area.top;
                    var rowIndex;
                    for (rowIndex = 0; rowIndex < activeLines.length; rowIndex += 1) {
                        var weights = frameParseColumns(activeLines[rowIndex].value);
                        var weightTotal = 0;
                        var weightIndex;
                        for (weightIndex = 0; weightIndex < weights.length; weightIndex += 1) weightTotal += weights[weightIndex];
                        var rowHeight = rowHeights[rowIndex];
                        var rowBottom = currentTop + rowHeight;
                        var usableWidth = areaWidth - colSpace * Math.max(0, weights.length - 1);
                        if (!(usableWidth > 0)) throw new Error("第 " + (activeLines[rowIndex].sourceIndex + 1) + " 行列间距过大");
                        var rowGroup = root.layerSets.add();
                        rowGroup.name = "第" + (activeLines[rowIndex].sourceIndex + 1) + "行";
                        var currentLeft = area.left;
                        var columnIndex;
                        for (columnIndex = 0; columnIndex < weights.length; columnIndex += 1) {
                            var cellWidth = columnIndex === weights.length - 1
                                ? area.right - currentLeft
                                : usableWidth * weights[columnIndex] / weightTotal;
                            var cell = {
                                left: currentLeft,
                                top: currentTop,
                                right: currentLeft + cellWidth,
                                bottom: rowBottom
                            };
                            var externalReserve = textLayout.external
                                ? Math.min(rowHeight * 0.42, Math.max(18, mainPx + subPx + 8))
                                : 0;
                            var shapeArea = {
                                left: cell.left,
                                top: cell.top,
                                right: cell.right,
                                bottom: Math.max(cell.top + 1, cell.bottom - externalReserve)
                            };
                            var shapeBounds;
                            if (type === 0) {
                                shapeBounds = shapeArea;
                            } else {
                                var side = Math.max(1, Math.min(shapeArea.right - shapeArea.left, shapeArea.bottom - shapeArea.top));
                                shapeBounds = {
                                    left: shapeArea.left + (shapeArea.right - shapeArea.left - side) / 2,
                                    top: shapeArea.top + (shapeArea.bottom - shapeArea.top - side) / 2,
                                    right: shapeArea.left + (shapeArea.right - shapeArea.left + side) / 2,
                                    bottom: shapeArea.top + (shapeArea.bottom - shapeArea.top + side) / 2
                                };
                            }

                            var shape = type === 1
                                ? frameCreateShapeEllipse(document, shapeBounds, fillColor)
                                : toolCreateShapeRectangle(document, shapeBounds, 0, fillColor);
                            shape.name = "第" + (activeLines[rowIndex].sourceIndex + 1) + "行_第" + (columnIndex + 1) + "列";
                            shape.move(rowGroup, ElementPlacement.INSIDE);
                            createdIds.push(layerNumericId(shape));
                            created += 1;

                            var padding = Math.max(3, Math.min(10, Math.min(cellWidth, rowHeight) * 0.035));
                            var titleRegion;
                            var titleVertical;
                            if (textLayout.external) {
                                titleRegion = {
                                    left: cell.left + padding,
                                    top: shapeArea.bottom + 2,
                                    right: cell.right - padding,
                                    bottom: cell.bottom - padding
                                };
                                titleVertical = "middle";
                            } else if (textLayout.vertical === "middle") {
                                titleRegion = {
                                    left: shapeBounds.left + padding,
                                    top: shapeBounds.top + padding,
                                    right: shapeBounds.right - padding,
                                    bottom: shapeBounds.bottom - padding
                                };
                                titleVertical = "middle";
                            } else {
                                titleRegion = {
                                    left: shapeBounds.left + padding,
                                    top: Math.max(shapeBounds.top + padding, shapeBounds.bottom - mainPx - subPx - 10),
                                    right: shapeBounds.right - padding,
                                    bottom: shapeBounds.bottom - padding
                                };
                                titleVertical = "bottom";
                            }

                            var titleHeight = Math.max(8, mainPx + 2);
                            var subtitleHeight = Math.max(7, subPx + 2);
                            var contentHeight = titleHeight + subtitleHeight + 2;
                            var blockTop = titleVertical === "middle"
                                ? titleRegion.top + Math.max(0, (titleRegion.bottom - titleRegion.top - contentHeight) / 2)
                                : Math.max(titleRegion.top, titleRegion.bottom - contentHeight);
                            var mainBox = {
                                left: titleRegion.left,
                                top: blockTop,
                                right: titleRegion.right,
                                bottom: blockTop + titleHeight
                            };
                            var subBox = {
                                left: titleRegion.left,
                                top: mainBox.bottom + 2,
                                right: titleRegion.right,
                                bottom: Math.min(titleRegion.bottom, mainBox.bottom + 2 + subtitleHeight)
                            };
                            frameCreateText(document, rowGroup, "主标题", "主标题", mainPt, textColor, mainBox, textLayout.horizontal, "middle");
                            frameCreateText(document, rowGroup, "副标题", "副标题", subPt, textColor, subBox, textLayout.horizontal, "middle");

                            currentLeft = cell.right + colSpace;
                        }
                        currentTop = rowBottom + rowSpace;
                    }
                    document.activeLayer = root;
                    return {
                        created: created,
                        rows: activeLines.length,
                        type: type,
                        groupId: layerNumericId(root),
                        canvasWidth: areaWidth,
                        canvasHeight: areaHeight
                    };
                });
            } finally {
                app.preferences.rulerUnits = previousUnits;
            }
        }

        function frameMergeShape() {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档并选择矩形");
            var document = app.activeDocument;
            var ids = selectedLayerIds();
            if (ids.length < 2) throw new Error("请至少选择两个矩形形状图层");
            var layers = [];
            var bounds = { left: 1e20, top: 1e20, right: -1e20, bottom: -1e20 };
            var parent = null;
            var fillColor = "";
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.SOLIDFILL) {
                    throw new Error("只能合并纯色矩形或形状图层");
                }
                var visual = toolLayerVisualBounds(layer);
                bounds.left = Math.min(bounds.left, visual.left);
                bounds.top = Math.min(bounds.top, visual.top);
                bounds.right = Math.max(bounds.right, visual.right);
                bounds.bottom = Math.max(bounds.bottom, visual.bottom);
                if (!parent) {
                    try { parent = layer.parent; } catch (ignoreFrameMergeParent) {}
                }
                if (!fillColor) {
                    fillColor = toolLayerFillColor(ids[index], layer) || toolLayerStrokeColor(ids[index]);
                }
                layers.push(layer);
            }
            if (!(bounds.right > bounds.left && bounds.bottom > bounds.top)) {
                throw new Error("选中矩形没有可用边界");
            }
            if (!fillColor) fillColor = "#dcdcdc";
            return suspendToolsHistory(document, "鑫洋助理：合并选中矩形", function () {
                var output = toolCreateShapeRectangle(document, bounds, 0, fillColor);
                output.name = "合并选中矩形";
                if (parent && parent.typename === "LayerSet") {
                    try { output.move(parent, ElementPlacement.INSIDE); } catch (ignoreMoveMergedFrame) {}
                }
                for (index = 0; index < layers.length; index += 1) {
                    try { layers[index].remove(); } catch (ignoreRemoveMergedSource) {}
                }
                var outputId = layerNumericId(output);
                if (outputId > 0) selectLayersByIds([outputId]);
                return {
                    processed: ids.length,
                    mergedId: outputId,
                    vector: output.typename === "ArtLayer" && output.kind === LayerKind.SOLIDFILL,
                    bounds: bounds
                };
            });
        }

        function setShape(options) {
            options = options || {};
            options.applySize = true;
            return toolsApplyRectangleSettings(options);
        }

    return {
            frameCreate: frameCreate,
            frameMergeShape: frameMergeShape,
            setShape: setShape
    };
};
