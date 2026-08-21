/* 鑫洋助理 ExtendScript 模块：guides */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.guides = function (deps) {
    deps = deps || {};
        var currentPixelSelectionBounds = deps.currentPixelSelectionBounds;
        var findLayerById = deps.findLayerById;
        var layerNumericId = deps.layerNumericId;
        var layerSize = deps.layerSize;
        var pixels = deps.pixels;
        var selectedLayerIds = deps.selectedLayerIds;
        var toolCollectLayersRecursive = deps.toolCollectLayersRecursive;
        var toolCreateShapeRectangle = deps.toolCreateShapeRectangle;
        var toolSetShapeFill = deps.toolSetShapeFill;


        function guideClamp(value, minimum, maximum) {
            value = Number(value);
            if (!isFinite(value)) value = minimum;
            return Math.max(minimum, Math.min(maximum, value));
        }

        function guideUnitPixels(value, axisSize, resolution) {
            var text = String(value === undefined || value === null ? "" : value)
                .replace(/^\s+|\s+$/g, "")
                .toLowerCase();
            if (!text) return null;
            if (text.indexOf("%") >= 0) {
                var percent = parseFloat(text);
                return isFinite(percent) ? axisSize * percent / 100 : null;
            }
            var number = parseFloat(text);
            if (!isFinite(number)) return null;
            if (/cm$/.test(text)) return number / 2.54 * resolution;
            if (/mm$/.test(text)) return number / 25.4 * resolution;
            if (/in$/.test(text)) return number * resolution;
            if (/pt$/.test(text)) return number / 72 * resolution;
            if (/pc$/.test(text)) return number / 6 * resolution;
            return number;
        }

        function guideBoundsFromLayers(document, ids) {
            var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            var found = 0;
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = findLayerById(document, ids[index]);
                if (!layer) continue;
                try {
                    var size = layerSize(layer);
                    if (!(size.width > 0 && size.height > 0)) continue;
                    left = Math.min(left, size.left);
                    top = Math.min(top, size.top);
                    right = Math.max(right, size.left + size.width);
                    bottom = Math.max(bottom, size.top + size.height);
                    found += 1;
                } catch (ignoreLayerBounds) {}
            }
            if (!found) return null;
            return {
                left: left,
                top: top,
                right: right,
                bottom: bottom,
                width: right - left,
                height: bottom - top,
                source: ids.length > 1 ? "selected-layers" : "layer"
            };
        }

        function guideResolveBounds(document, useSelectionLayer, forceCanvas) {
            var canvas = {
                left: 0,
                top: 0,
                right: pixels(document.width),
                bottom: pixels(document.height),
                width: pixels(document.width),
                height: pixels(document.height),
                source: "canvas"
            };
            if (forceCanvas || !useSelectionLayer) return canvas;
            var selection = currentPixelSelectionBounds(document);
            if (selection) {
                selection.source = "selection";
                return selection;
            }
            var ids = selectedLayerIds();
            var layerBounds = guideBoundsFromLayers(document, ids);
            if (layerBounds) return layerBounds;
            return canvas;
        }

        function guideCurrentContext(options) {
            if (!app.documents.length) {
                return { hasDocument: false, source: "none", width: 0, height: 0 };
            }
            var document = app.activeDocument;
            var bounds = guideResolveBounds(
                document,
                options && options.isLayer !== false,
                options && options.forceCanvas === true
            );
            return {
                hasDocument: true,
                source: bounds.source,
                bounds: bounds,
                documentWidth: pixels(document.width),
                documentHeight: pixels(document.height),
                resolution: Number(document.resolution) || 72,
                selectedLayerCount: selectedLayerIds().length,
                hasSelection: !!currentPixelSelectionBounds(document)
            };
        }

        function guideHasAt(document, direction, position) {
            var index;
            for (index = 0; index < document.guides.length; index += 1) {
                var item = document.guides[index];
                try {
                    if (item.direction === direction &&
                        Math.abs(pixels(item.coordinate) - position) <= 0.6) {
                        return true;
                    }
                } catch (ignoreGuideRead) {}
            }
            return false;
        }

        function guideAddAt(document, direction, position, maximum) {
            position = Number(position);
            if (!isFinite(position)) return 0;
            position = guideClamp(position, 0, maximum);
            if (guideHasAt(document, direction, position)) return 0;
            document.guides.add(direction, UnitValue(position, "px"));
            return 1;
        }

        function guideAddVertical(document, position) {
            return guideAddAt(document, Direction.VERTICAL, position, pixels(document.width));
        }

        function guideAddHorizontal(document, position) {
            return guideAddAt(document, Direction.HORIZONTAL, position, pixels(document.height));
        }

        function guidePositiveCount(value) {
            var number = Math.round(Number(String(value || "").replace(/[^\d.-]/g, "")) || 0);
            return number > 0 ? Math.min(number, 200) : 0;
        }

        function guideCreateAxisGrid(document, start, end, count, itemSize, gap, vertical) {
            var added = 0;
            var available = Math.max(0, end - start);
            if (!(available > 0) || !(count > 0)) return 0;
            if (!(itemSize > 0)) {
                gap = Math.max(0, Number(gap) || 0);
                itemSize = Math.max(0, (available - gap * Math.max(0, count - 1)) / count);
            } else if (!(gap >= 0)) {
                gap = count > 1 ? Math.max(0, (available - itemSize * count) / (count - 1)) : 0;
            }
            var total = itemSize * count + gap * Math.max(0, count - 1);
            var cursor = start + Math.max(0, (available - total) / 2);
            var index;
            for (index = 0; index < count; index += 1) {
                added += vertical
                    ? guideAddVertical(document, cursor)
                    : guideAddHorizontal(document, cursor);
                cursor += itemSize;
                added += vertical
                    ? guideAddVertical(document, cursor)
                    : guideAddHorizontal(document, cursor);
                cursor += gap;
            }
            return added;
        }

        function guideCreate(options) {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            options = options || {};
            var document = app.activeDocument;
            var bounds = guideResolveBounds(document, options.isLayer !== false, false);
            var resolution = Number(document.resolution) || 72;
            var width = Math.max(1, bounds.width);
            var height = Math.max(1, bounds.height);
            var leftPadding = guideUnitPixels(options.paddingLeft, width, resolution);
            var rightPadding = guideUnitPixels(options.paddingRight, width, resolution);
            var topPadding = guideUnitPixels(options.paddingTop, height, resolution);
            var bottomPadding = guideUnitPixels(options.paddingBottom, height, resolution);
            var innerLeft = bounds.left + Math.max(0, leftPadding || 0);
            var innerRight = bounds.right - Math.max(0, rightPadding || 0);
            var innerTop = bounds.top + Math.max(0, topPadding || 0);
            var innerBottom = bounds.bottom - Math.max(0, bottomPadding || 0);
            if (!(innerRight > innerLeft && innerBottom > innerTop)) {
                throw new Error("边距超过当前范围，请检查输入值");
            }
            var added = 0;
            if (leftPadding !== null) added += guideAddVertical(document, innerLeft);
            if (rightPadding !== null) added += guideAddVertical(document, innerRight);
            if (topPadding !== null) added += guideAddHorizontal(document, innerTop);
            if (bottomPadding !== null) added += guideAddHorizontal(document, innerBottom);

            var columns = guidePositiveCount(options.column);
            var rows = guidePositiveCount(options.row);
            var columnWidth = guideUnitPixels(options.columnWidth, innerRight - innerLeft, resolution);
            var rowHeight = guideUnitPixels(options.rowHeight, innerBottom - innerTop, resolution);
            var columnSpace = guideUnitPixels(options.columnSpace, innerRight - innerLeft, resolution);
            var rowSpace = guideUnitPixels(options.rowSpace, innerBottom - innerTop, resolution);
            if (!columns && columnWidth > 0) {
                columns = Math.max(1, Math.floor(((innerRight - innerLeft) + Math.max(0, columnSpace || 0)) /
                    (columnWidth + Math.max(0, columnSpace || 0))));
            }
            if (!rows && rowHeight > 0) {
                rows = Math.max(1, Math.floor(((innerBottom - innerTop) + Math.max(0, rowSpace || 0)) /
                    (rowHeight + Math.max(0, rowSpace || 0))));
            }
            if (columns) added += guideCreateAxisGrid(
                document, innerLeft, innerRight, columns,
                columnWidth, columnSpace, true
            );
            if (rows) added += guideCreateAxisGrid(
                document, innerTop, innerBottom, rows,
                rowHeight, rowSpace, false
            );

            var colCenter = guideUnitPixels(options.colCenter, width, resolution);
            var rowCenter = guideUnitPixels(options.rowCenter, height, resolution);
            if (colCenter !== null) {
                if (Math.abs(colCenter) < 0.01) {
                    added += guideAddVertical(document, bounds.left + width / 2);
                } else {
                    added += guideAddVertical(document, bounds.left + width / 2 - Math.abs(colCenter) / 2);
                    added += guideAddVertical(document, bounds.left + width / 2 + Math.abs(colCenter) / 2);
                }
            }
            if (rowCenter !== null) {
                if (Math.abs(rowCenter) < 0.01) {
                    added += guideAddHorizontal(document, bounds.top + height / 2);
                } else {
                    added += guideAddHorizontal(document, bounds.top + height / 2 - Math.abs(rowCenter) / 2);
                    added += guideAddHorizontal(document, bounds.top + height / 2 + Math.abs(rowCenter) / 2);
                }
            }
            if (!added) throw new Error("没有可创建的参考线，请至少填写一个参数");
            return { added: added, source: bounds.source, bounds: bounds };
        }

        function guideAdd(options) {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            options = options || {};
            var document = app.activeDocument;
            var bounds = guideResolveBounds(document, true, !!options.full);
            var param = String(options.param || "");
            var added = 0;
            if (param === "guide-left") added += guideAddVertical(document, bounds.left);
            else if (param === "guide-right") added += guideAddVertical(document, bounds.right);
            else if (param === "guide-top") added += guideAddHorizontal(document, bounds.top);
            else if (param === "guide-bottom") added += guideAddHorizontal(document, bounds.bottom);
            else if (param === "guide-center") added += guideAddVertical(document, bounds.left + bounds.width / 2);
            else if (param === "guide-middle") added += guideAddHorizontal(document, bounds.top + bounds.height / 2);
            else throw new Error("未知快捷参考线类型");
            return { added: added, source: bounds.source, position: param };
        }

        /* 图牛式 GuideGuide 兼容入口：统一由一个宿主方法分发快捷参考线。 */
        function GuideGuide(options) {
            options = options || {};
            var action = String(options.action || options.fn || options.type || "");
            if (action === "add" || action === "addGuide" || action === "quick") {
                return guideAdd({
                    param: options.param || options.position || options.guideType,
                    full: !!(options.full || options.forceCanvas)
                });
            }
            if (action === "context") return guideCurrentContext(options);
            if (action === "create") return guideCreate(options);
            if (action === "clear") return guideClear(options);
            throw new Error("未知参考线操作：" + action);
        }

        function guideClear(options) {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            options = options || {};
            var document = app.activeDocument;
            var horizontalOnly = !!options.clearRowGuides;
            var verticalOnly = !!options.clearColGuides;
            var removed = 0;
            var index;
            if (!horizontalOnly && !verticalOnly) {
                removed = document.guides.length;
                document.guides.removeAll();
                return { removed: removed, direction: "all" };
            }
            for (index = document.guides.length - 1; index >= 0; index -= 1) {
                var item = document.guides[index];
                var remove = false;
                try {
                    if (horizontalOnly && item.direction === Direction.HORIZONTAL) remove = true;
                    if (verticalOnly && item.direction === Direction.VERTICAL) remove = true;
                    if (remove) { item.remove(); removed += 1; }
                } catch (ignoreGuideRemove) {}
            }
            return { removed: removed, direction: horizontalOnly && verticalOnly ? "all" : horizontalOnly ? "horizontal" : "vertical" };
        }

        function guideLineShape(document, group, x1, y1, x2, y2, colorValue, thickness, name) {
            var dx = x2 - x1;
            var dy = y2 - y1;
            var length = Math.sqrt(dx * dx + dy * dy);
            if (!(length > 0.5)) return null;
            var centerX = (x1 + x2) / 2;
            var centerY = (y1 + y2) / 2;
            var size = Math.max(1, Number(thickness) || 1.5);
            var layer = toolCreateShapeRectangle(document, {
                left: centerX - length / 2,
                top: centerY - size / 2,
                right: centerX + length / 2,
                bottom: centerY + size / 2
            }, 0, colorValue || "#39A9FF", true);
            layer.name = name || "构图线";
            var angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (Math.abs(angle) > 0.01) layer.rotate(angle, AnchorPosition.MIDDLECENTER);
            try { layer.opacity = 78; } catch (ignoreLineOpacity) {}
            if (group) layer.move(group, ElementPlacement.INSIDE);
            return layer;
        }

        function guidePatternGroup(document, label) {
            var group = document.layerSets.add();
            group.name = "鑫洋参考线_" + label + "_色1";
            return group;
        }

        function guidePatternBounds(document) {
            return guideResolveBounds(document, true, false);
        }

        function guideCreateComposition(options) {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            options = options || {};
            var document = app.activeDocument;
            var bounds = guidePatternBounds(document);
            var left = bounds.left, top = bounds.top, right = bounds.right, bottom = bounds.bottom;
            var width = bounds.width, height = bounds.height;
            var cx = left + width / 2, cy = top + height / 2;
            var fn = String(options.fn || "golden1");
            var labels = {
                golden1:"黄金矩形", golden2:"黄金矩形", golden3:"黄金矩形", golden4:"黄金矩形",
                golden5:"螺旋线", golden6:"螺旋线", golden7:"黄金分割", golden8:"黄金分割",
                golden9:"十字格", golden10:"九宫格", golden11:"黄金比例", golden12:"交叉线",
                golden13:"V字形", golden14:"V字形", golden15:"对角线", golden16:"对角线",
                golden17:"黄金切割", golden18:"黄金切割", golden19:"三分切割", golden20:"三分切割",
                golden21:"垂直切割"
            };
            var group = guidePatternGroup(document, labels[fn] || "构图");
            var color = "#39A9FF";
            var thickness = Math.max(1, Math.min(width, height) / 700);
            var count = 0;
            function line(x1,y1,x2,y2,name){ if (guideLineShape(document, group, x1,y1,x2,y2,color,thickness,name)) count += 1; }
            function vertical(ratio){ line(left + width * ratio, top, left + width * ratio, bottom, "垂直构图线"); }
            function horizontal(ratio){ line(left, top + height * ratio, right, top + height * ratio, "水平构图线"); }
            var phiA = 0.382, phiB = 0.618;
            if (fn === "golden1") { vertical(phiB); horizontal(phiB); line(left,top,right,bottom,"黄金对角线"); }
            else if (fn === "golden2") { vertical(phiA); horizontal(phiA); line(left,bottom,right,top,"黄金对角线"); }
            else if (fn === "golden3") { vertical(phiA); horizontal(phiB); line(left,top,right,bottom,"黄金对角线"); }
            else if (fn === "golden4") { vertical(phiB); horizontal(phiA); line(left,bottom,right,top,"黄金对角线"); }
            else if (fn === "golden5" || fn === "golden6") {
                var reverse = fn === "golden6";
                var r1 = reverse ? phiA : phiB;
                vertical(r1); horizontal(phiB);
                line(left, top + height * phiB, left + width * r1, top + height * phiB, "螺旋分段");
                line(left + width * r1, top, left + width * r1, top + height * phiB, "螺旋分段");
                line(left + width * r1, top, right, bottom, "螺旋引导线");
            }
            else if (fn === "golden7") { vertical(phiA); vertical(phiB); }
            else if (fn === "golden8") { horizontal(phiA); horizontal(phiB); }
            else if (fn === "golden9") { vertical(0.5); horizontal(0.5); }
            else if (fn === "golden10") { vertical(1/3); vertical(2/3); horizontal(1/3); horizontal(2/3); }
            else if (fn === "golden11") { vertical(phiA); vertical(phiB); horizontal(phiA); horizontal(phiB); }
            else if (fn === "golden12") { line(left,top,right,bottom,"交叉线"); line(left,bottom,right,top,"交叉线"); }
            else if (fn === "golden13") { line(left,top,cx,bottom,"V字形"); line(right,top,cx,bottom,"V字形"); }
            else if (fn === "golden14") { line(left,bottom,cx,top,"V字形"); line(right,bottom,cx,top,"V字形"); }
            else if (fn === "golden15") { line(left,top,right,bottom,"对角线"); }
            else if (fn === "golden16") { line(left,bottom,right,top,"对角线"); }
            else if (fn === "golden17") { vertical(phiA); horizontal(phiB); line(left,top,right,bottom,"黄金切割"); }
            else if (fn === "golden18") { horizontal(phiA); vertical(phiB); line(left,bottom,right,top,"黄金切割"); }
            else if (fn === "golden19") { vertical(1/3); vertical(2/3); }
            else if (fn === "golden20") { horizontal(1/3); horizontal(2/3); }
            else { vertical(0.5); }
            document.activeLayer = group;
            return { created: count, pattern: labels[fn] || fn, source: bounds.source };
        }

        function guideCreatePerspective(options) {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            options = options || {};
            var document = app.activeDocument;
            var bounds = guidePatternBounds(document);
            var left=bounds.left, top=bounds.top, right=bounds.right, bottom=bounds.bottom;
            var cx=left+bounds.width/2, cy=top+bounds.height/2;
            var mode=String(options.mode || "perspective");
            var group=guidePatternGroup(document, mode === "horizon" ? "水平线" : "透视线");
            var color="#39A9FF", thick=Math.max(1,Math.min(bounds.width,bounds.height)/700), count=0;
            function line(x1,y1,x2,y2,name){ if(guideLineShape(document,group,x1,y1,x2,y2,color,thick,name)) count+=1; }
            line(left,cy,right,cy,"水平线");
            if(mode !== "horizon"){
                line(left,top,cx,cy,"透视线"); line(right,top,cx,cy,"透视线");
                line(left,bottom,cx,cy,"透视线"); line(right,bottom,cx,cy,"透视线");
                line(left,top+bounds.height*0.25,cx,cy,"透视线");
                line(left,top+bounds.height*0.75,cx,cy,"透视线");
                line(right,top+bounds.height*0.25,cx,cy,"透视线");
                line(right,top+bounds.height*0.75,cx,cy,"透视线");
            }
            document.activeLayer=group;
            return {created:count,mode:mode,source:bounds.source};
        }

        function guideCollectOverlayGroups(container, output) {
            output = output || [];
            if (!container || !container.layers) return output;
            var index;
            for (index = 0; index < container.layers.length; index += 1) {
                var layer = container.layers[index];
                if (layer.typename === "LayerSet") {
                    if (String(layer.name || "").indexOf("鑫洋参考线_") === 0) output.push(layer);
                    guideCollectOverlayGroups(layer, output);
                }
            }
            return output;
        }

        function guideToggleOverlays() {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            var groups = guideCollectOverlayGroups(app.activeDocument, []);
            if (!groups.length) throw new Error("当前文档没有构图或透视线图层");
            var anyVisible = false, index;
            for (index=0; index<groups.length; index+=1) if (groups[index].visible) { anyVisible=true; break; }
            for (index=0; index<groups.length; index+=1) groups[index].visible = !anyVisible;
            return {groups:groups.length,visible:!anyVisible};
        }

        function guideChangeOverlayColor() {
            if (!app.documents.length) throw new Error("请先打开 Photoshop 文档");
            var document=app.activeDocument;
            var groups=guideCollectOverlayGroups(document,[]);
            if(!groups.length) throw new Error("当前文档没有构图或透视线图层");
            var colors=["#39A9FF","#FF4D9D","#FFD43B","#FFFFFF"];
            var currentIndex=0;
            var match=String(groups[0].name||"").match(/_色(\d+)$/);
            if(match) currentIndex=(Number(match[1])||1)-1;
            var nextIndex=(currentIndex+1)%colors.length;
            var changed=0, i, j;
            for(i=0;i<groups.length;i+=1){
                groups[i].name=String(groups[i].name||"").replace(/_色\d+$/,"")+"_色"+(nextIndex+1);
                var layers=toolCollectLayersRecursive(groups[i],[]);
                for(j=0;j<layers.length;j+=1){
                    var layer=layers[j];
                    if(layer.typename==="ArtLayer" && layer.kind===LayerKind.SOLIDFILL){
                        try { toolSetShapeFill(layerNumericId(layer),colors[nextIndex]); changed+=1; } catch(ignoreColor){}
                    }
                }
            }
            return {changed:changed,color:colors[nextIndex]};
        }

    return {
            GuideGuide: GuideGuide,
            guideCurrentContext: guideCurrentContext,
            guideCreate: guideCreate,
            guideAdd: guideAdd,
            guideClear: guideClear,
            guideCreateComposition: guideCreateComposition,
            guideCreatePerspective: guideCreatePerspective,
            guideToggleOverlays: guideToggleOverlays,
            guideChangeOverlayColor: guideChangeOverlayColor
    };
};
