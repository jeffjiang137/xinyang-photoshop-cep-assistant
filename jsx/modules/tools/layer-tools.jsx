/* 鑫洋助理 ExtendScript 模块：layerTools（v2.2.58） */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.layerTools = function (deps) {
    deps = deps || {};
    var pixels = deps.pixels;
    var layerSize = deps.layerSize;
    var integerValue = deps.integerValue;
    var activeLayerId = deps.activeLayerId;
    var selectedLayerIds = deps.selectedLayerIds;
    var selectLayersByIds = deps.selectLayersByIds;
    var layerNumericId = deps.layerNumericId;
    var suspendToolsHistory = deps.suspendToolsHistory;
    var toolArrayContains = deps.toolArrayContains;
    var toolCollectAllLayersInPanelOrder = deps.toolCollectAllLayersInPanelOrder;
    var toolCollectGroupChildren = deps.toolCollectGroupChildren;
    var toolCollectLayers = deps.toolCollectLayers;
    var toolHexColor = deps.toolHexColor;
    var toolHexPad = deps.toolHexPad;
    var toolLayerById = deps.toolLayerById;
    var toolLayerGroupedState = deps.toolLayerGroupedState;
    var toolLayerId = deps.toolLayerId;
    var toolLayerIsDescendantOf = deps.toolLayerIsDescendantOf;
    var toolLayerSort = deps.toolLayerSort;
    var toolLayerType = deps.toolLayerType;
    var toolSetLayerGroupedState = deps.toolSetLayerGroupedState;
    var toolSolidColorFromHex = deps.toolSolidColorFromHex;
    var toolSolidColorHex = deps.toolSolidColorHex;

    function toolCreateSwapMarker(layer, suffix) {
        var parent = layer.parent;
        if (!parent || !parent.artLayers) throw new Error("无法读取图层所在位置");
        var marker = parent.artLayers.add();
        marker.name = "__XINYANG_SWAP_SLOT_" + suffix + "__";
        try { marker.visible = false; } catch (ignoreMarkerVisible) {}
        marker.move(layer, ElementPlacement.PLACEBEFORE);
        return marker;
    }

    function toolRemoveSwapMarker(marker) {
        if (!marker) return;
        try { marker.remove(); } catch (ignoreRemoveSwapMarker) {}
    }

    function toolSwapLayerSlots(first, second, firstGrouped, secondGrouped) {
        if (toolLayerIsDescendantOf(first, second) || toolLayerIsDescendantOf(second, first)) {
            throw new Error("不能互换父级组与其内部子图层");
        }
        var firstMarker = null;
        var secondMarker = null;
        var completed = false;
        try {
            firstMarker = toolCreateSwapMarker(first, "A");
            secondMarker = toolCreateSwapMarker(second, "B");

            toolSetLayerGroupedState(first, false);
            toolSetLayerGroupedState(second, false);

            first.move(secondMarker, ElementPlacement.PLACEAFTER);
            second.move(firstMarker, ElementPlacement.PLACEAFTER);
            completed = true;
        } finally {
            if (!completed) {
                try { if (firstMarker) first.move(firstMarker, ElementPlacement.PLACEAFTER); } catch (ignoreRestoreFirstSlot) {}
                try { if (secondMarker) second.move(secondMarker, ElementPlacement.PLACEAFTER); } catch (ignoreRestoreSecondSlot) {}
            }
            toolRemoveSwapMarker(firstMarker);
            toolRemoveSwapMarker(secondMarker);
            toolSetLayerGroupedState(first, firstGrouped);
            toolSetLayerGroupedState(second, secondGrouped);
        }
    }

    function toolMoveLayerCenterTo(layer, centerX, centerY) {
        var size = layerSize(layer);
        var currentX = size.left + size.width / 2;
        var currentY = size.top + size.height / 2;
        layer.translate(
            UnitValue(centerX - currentX, "px"),
            UnitValue(centerY - currentY, "px")
        );
    }

    function toolFlipCurrentLayerSelection(horizontal, anchor) {
        var transform = new ActionDescriptor();
        transform.putEnumerated(
            charIDToTypeID("FTcs"),
            charIDToTypeID("QCSt"),
            anchor || charIDToTypeID("Qcsa")
        );
        transform.putUnitDouble(charIDToTypeID("Wdth"), charIDToTypeID("#Prc"), horizontal ? -100 : 100);
        transform.putUnitDouble(charIDToTypeID("Hght"), charIDToTypeID("#Prc"), horizontal ? 100 : -100);
        executeAction(charIDToTypeID("Trnf"), transform, DialogModes.NO);
    }

    function toolGroupCurrentLayerSelection(document) {
        var group = new ActionDescriptor();
        var newGroup = new ActionReference();
        var selectedLayers = new ActionReference();
        newGroup.putClass(stringIDToTypeID("layerSection"));
        selectedLayers.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        group.putReference(charIDToTypeID("null"), newGroup);
        group.putReference(charIDToTypeID("From"), selectedLayers);
        executeAction(charIDToTypeID("Mk  "), group, DialogModes.NO);
        var createdGroup = document.activeLayer;
        if (createdGroup && createdGroup.typename === "LayerSet") return createdGroup;
        if (createdGroup && createdGroup.parent && createdGroup.parent.typename === "LayerSet") {
            return createdGroup.parent;
        }
        throw new Error("未能取得临时编组");
    }

    function toolUngroupCurrentLayerSelection() {
        executeAction(stringIDToTypeID("ungroupLayersEvent"), new ActionDescriptor(), DialogModes.NO);
    }

    function toolsQuickTransform(options) {
        if (!app.documents.length) {
            throw new Error("请先打开 Photoshop 文档并选择图层");
        }
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要变换的图层");
        var action = String(options && options.action || "");
        if (!/^(flipHorizontal|flipVertical|flipHorizontalCenter|flipVerticalCenter|flipLeftEdge|flipRightEdge|flipBottomEdge|flipTopEdge|rotateLeft|rotateRight|swapPosition)$/.test(action)) {
            throw new Error("未知的变换方式");
        }
        if (action === "swapPosition" && ids.length !== 2) {
            throw new Error("位置互换需要准确选择两个图层");
        }
        var previousUnits = app.preferences.rulerUnits;
        try {
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(
                document,
                "鑫洋助理：快捷变换",
                function () {
                    if (action === "swapPosition") {
                        var first = toolLayerById(document, ids[0]);
                        var firstSize = layerSize(first);
                        var firstGrouped = toolLayerGroupedState(first);
                        var second = toolLayerById(document, ids[1]);
                        var secondSize = layerSize(second);
                        var secondGrouped = toolLayerGroupedState(second);
                        var firstCenterX = firstSize.left + firstSize.width / 2;
                        var firstCenterY = firstSize.top + firstSize.height / 2;
                        var secondCenterX = secondSize.left + secondSize.width / 2;
                        var secondCenterY = secondSize.top + secondSize.height / 2;
                        var hasEmbeddedImage = firstGrouped || secondGrouped;
                        var orderSwapped = false;
                        try {
                            /* Ordinary layers swap only their canvas positions. Preserve the
                               existing slot-and-clipping restoration path for embedded images. */
                            if (hasEmbeddedImage) {
                                toolSwapLayerSlots(first, second, firstGrouped, secondGrouped);
                                orderSwapped = true;
                            }
                            toolMoveLayerCenterTo(first, secondCenterX, secondCenterY);
                            toolMoveLayerCenterTo(second, firstCenterX, firstCenterY);
                        } catch (swapError) {
                            try { toolMoveLayerCenterTo(first, firstCenterX, firstCenterY); } catch (ignoreRestoreFirstCenter) {}
                            try { toolMoveLayerCenterTo(second, secondCenterX, secondCenterY); } catch (ignoreRestoreSecondCenter) {}
                            if (orderSwapped) {
                                try { toolSwapLayerSlots(first, second, firstGrouped, secondGrouped); } catch (ignoreRestoreOrder) {}
                            }
                            throw swapError;
                        }
                        selectLayersByIds(ids);
                        return {
                            processed: 2,
                            orderSwapped: orderSwapped,
                            clippingPreserved: hasEmbeddedImage
                        };
                    }
                    if (/^flip/.test(action)) {
                        var grouped = false;
                        var temporaryGroup = null;
                        try {
                            temporaryGroup = toolGroupCurrentLayerSelection(document);
                            grouped = true;
                            document.activeLayer = temporaryGroup;
                            if (action === "flipHorizontal" || action === "flipHorizontalCenter") {
                                toolFlipCurrentLayerSelection(true, charIDToTypeID("Qcsa"));
                            } else if (action === "flipVertical" || action === "flipVerticalCenter") {
                                toolFlipCurrentLayerSelection(false, charIDToTypeID("Qcsa"));
                            } else if (action === "flipLeftEdge") {
                                toolFlipCurrentLayerSelection(true, charIDToTypeID("Qcs4"));
                            } else if (action === "flipRightEdge") {
                                toolFlipCurrentLayerSelection(true, charIDToTypeID("Qcs6"));
                            } else if (action === "flipBottomEdge") {
                                toolFlipCurrentLayerSelection(false, charIDToTypeID("Qcs8"));
                            } else if (action === "flipTopEdge") {
                                toolFlipCurrentLayerSelection(false, charIDToTypeID("Qcs2"));
                            }
                        } finally {
                            if (grouped) {
                                document.activeLayer = temporaryGroup;
                                toolUngroupCurrentLayerSelection();
                            }
                        }
                        return { processed: ids.length, collective: ids.length > 1, nativeTransform: true };
                    }
                    var index;
                    var processed = 0;
                    for (index = 0; index < ids.length; index += 1) {
                        var layer = toolLayerById(document, ids[index]);
                        if (action === "rotateLeft") {
                            layer.rotate(-90, AnchorPosition.MIDDLECENTER);
                        } else if (action === "rotateRight") {
                            layer.rotate(90, AnchorPosition.MIDDLECENTER);
                        }
                        processed += 1;
                    }
                    selectLayersByIds(ids);
                    return {
                        processed: processed,
                        collective: false
                    };
                }
            );
        } finally {
            app.preferences.rulerUnits = previousUnits;
        }
    }

    function toolTransformAnchor(point) {
        var anchors = {
            1: AnchorPosition.TOPLEFT,
            2: AnchorPosition.TOPCENTER,
            3: AnchorPosition.TOPRIGHT,
            4: AnchorPosition.MIDDLELEFT,
            5: AnchorPosition.MIDDLECENTER,
            6: AnchorPosition.MIDDLERIGHT,
            7: AnchorPosition.BOTTOMLEFT,
            8: AnchorPosition.BOTTOMCENTER,
            9: AnchorPosition.BOTTOMRIGHT
        };
        return anchors[integerValue(point, 1)] || AnchorPosition.TOPLEFT;
    }

    function toolFloatValue(value, fallback) {
        var parsed = parseFloat(String(value === undefined || value === null ? "" : value));
        return isFinite(parsed) ? parsed : Number(fallback || 0);
    }

    function toolsCustomTransform(options) {
        if (!app.documents.length) throw new Error("请先打开 Photoshop 文档并选择图层");
        var document = app.activeDocument;
        var sourceIds = selectedLayerIds();
        if (!sourceIds.length) throw new Error("请先选择需要生成变换的图层");
        var repetNumber = Math.max(0, integerValue(options && options.repetNumber, 0));
        if (!repetNumber) throw new Error("复制数量必须大于 0");
        var scale = toolFloatValue(options && options.scale, 100);
        if (!(scale > 0)) scale = 100;
        var colSpace = toolFloatValue(options && options.colSpace, 0);
        var rowSpace = toolFloatValue(options && options.rowSpace, 0);
        var angle = toolFloatValue(options && options.angle, 0);
        var transparent = toolFloatValue(options && options.transparent, 0);
        var anchor = toolTransformAnchor(options && options.point);
        var previousUnits = app.preferences.rulerUnits;
        try {
            app.preferences.rulerUnits = Units.PIXELS;
            return suspendToolsHistory(document, "鑫洋助理：自定义变换", function () {
                var selected = sourceIds.slice(0);
                var created = 0;
                var sourceIndex;
                for (sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex += 1) {
                    var previous = toolLayerById(document, sourceIds[sourceIndex]);
                    var copyIndex;
                    for (copyIndex = 0; copyIndex < repetNumber; copyIndex += 1) {
                        document.activeLayer = previous;
                        var duplicate = previous.duplicate();
                        try { duplicate.move(previous, ElementPlacement.PLACEBEFORE); } catch (ignoreTransformOrder) {}
                        if (Math.abs(scale - 100) > 0.000001) duplicate.resize(scale, scale, anchor);
                        if (Math.abs(angle) > 0.000001) duplicate.rotate(angle, anchor);
                        if (Math.abs(colSpace) > 0.000001 || Math.abs(rowSpace) > 0.000001) {
                            duplicate.translate(UnitValue(colSpace, "px"), UnitValue(rowSpace, "px"));
                        }
                        try {
                            duplicate.opacity = Math.max(0, Math.min(100, Number(previous.opacity) - transparent));
                        } catch (ignoreTransformOpacity) {}
                        previous = duplicate;
                        selected.push(layerNumericId(duplicate));
                        created += 1;
                    }
                }
                selectLayersByIds(selected);
                return {
                    processed: sourceIds.length,
                    created: created,
                    repetNumber: repetNumber,
                    point: integerValue(options && options.point, 1)
                };
            });
        } finally {
            app.preferences.rulerUnits = previousUnits;
        }
    }

    function toolsCreateDocumentPreset(options) {
        var width = Math.max(1, integerValue(options && options.width, 790));
        var height = Math.max(1, integerValue(options && options.height, 1404));
        var dpi = Math.max(1, integerValue(options && options.dpi, 72));
        var name = String(options && options.name || "新建文档");
        var background = String(options && options.background || "white");
        var guides = options && options.guides instanceof Array
            ? options.guides
            : [];
        if (width > 300000 || height > 300000) {
            throw new Error("文档宽高不能超过 300000px");
        }
        var fill = background === "transparent"
            ? DocumentFill.TRANSPARENT
            : DocumentFill.WHITE;
        var previousUnits = app.preferences.rulerUnits;
        var document = null;
        try {
            app.preferences.rulerUnits = Units.PIXELS;
            document = app.documents.add(
                UnitValue(width, "px"),
                UnitValue(height, "px"),
                dpi,
                name,
                NewDocumentMode.RGB,
                fill
            );
            var added = 0;
            var index;
            for (index = 0; index < guides.length; index += 1) {
                var guide = guides[index] || {};
                var value = Number(guide.value);
                if (!isFinite(value)) continue;
                if (guide.direction === "horizontal") {
                    document.guides.add(
                        Direction.HORIZONTAL,
                        UnitValue(value, "px")
                    );
                } else {
                    document.guides.add(
                        Direction.VERTICAL,
                        UnitValue(value, "px")
                    );
                }
                added += 1;
            }
            return {
                name: name,
                width: width,
                height: height,
                dpi: dpi,
                guides: added
            };
        } catch (error) {
            if (document) {
                try {
                    document.close(SaveOptions.DONOTSAVECHANGES);
                } catch (ignoreCloseDocument) {}
            }
            throw error;
        } finally {
            app.preferences.rulerUnits = previousUnits;
        }
    }

    function toolRenameNumber(value, width) {
        var text = String(Math.max(0, integerValue(value, 0)));
        while (text.length < width) text = "0" + text;
        return text;
    }

    function toolFormatLayerName(pattern, number, digits) {
        var value = String(number);
        var output = String(pattern || "图层###");
        output = output.replace(/%%n/g, value).replace(/%n/g, value);
        output = output.replace(/#+/g, function (hashes) {
            return toolRenameNumber(number, Math.max(digits, hashes.length));
        });
        if (output === pattern && output.indexOf("#") < 0 && output.indexOf("%n") < 0) {
            output += toolRenameNumber(number, digits);
        }
        return output;
    }

    function toolsBatchRenameLayers(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要重命名的图层");
        var targets = [];
        var seen = {};
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            var candidates = [layer];
            if (options && options.includeChildren && layer.typename === "LayerSet") {
                toolCollectGroupChildren(layer, candidates);
            }
            var itemIndex;
            for (itemIndex = 0; itemIndex < candidates.length; itemIndex += 1) {
                var id = toolLayerId(document, candidates[itemIndex]);
                if (!seen[id]) {
                    seen[id] = true;
                    targets.push(candidates[itemIndex]);
                }
            }
        }
        targets = toolLayerSort(targets, String(options && options.sort || "layer"));
        var pattern = String(options && options.pattern || "图层###");
        var start = integerValue(options && options.start, 1);
        var digits = Math.max(1, Math.min(6, integerValue(options && options.digits, 3)));
        var descending = pattern.indexOf("%%n") >= 0;
        return suspendToolsHistory(document, "鑫洋助理：批量重命名", function () {
            for (index = 0; index < targets.length; index += 1) {
                var number = descending
                    ? start + targets.length - 1 - index
                    : start + index;
                targets[index].name = toolFormatLayerName(pattern, number, digits);
            }
            selectLayersByIds(ids);
            return { renamed: targets.length, pattern: pattern };
        });
    }

    function toolLayerDescriptor(id) {
        var reference = new ActionReference();
        reference.putIdentifier(charIDToTypeID("Lyr "), integerValue(id, -1));
        return executeActionGet(reference);
    }

    function toolDescriptorColorHex(colorDescriptor) {
        function value(charKey, stringKey) {
            var key = charIDToTypeID(charKey);
            if (colorDescriptor.hasKey(key)) return colorDescriptor.getDouble(key);
            key = stringIDToTypeID(stringKey);
            if (colorDescriptor.hasKey(key)) return colorDescriptor.getDouble(key);
            return 0;
        }
        return "#" + toolHexPad(value("Rd  ", "red")) +
            toolHexPad(value("Grn ", "green")) +
            toolHexPad(value("Bl  ", "blue"));
    }

    function toolLayerFillColor(id, layer) {
        try {
            if (layer.typename === "ArtLayer" && layer.kind === LayerKind.TEXT) {
                return toolSolidColorHex(layer.textItem.color);
            }
            var descriptor = toolLayerDescriptor(id);
            var adjustmentKey = stringIDToTypeID("adjustment");
            if (!descriptor.hasKey(adjustmentKey)) return "";
            var list = descriptor.getList(adjustmentKey);
            if (!list.count) return "";
            var adjustment = list.getObjectValue(0);
            var colorKey = stringIDToTypeID("color");
            if (!adjustment.hasKey(colorKey)) return "";
            return toolDescriptorColorHex(adjustment.getObjectValue(colorKey));
        } catch (ignoreFillColor) {
            return "";
        }
    }

    function toolLayerStrokeColor(id) {
        try {
            var descriptor = toolLayerDescriptor(id);
            var enabledKey = stringIDToTypeID("strokeEnabled");
            if (descriptor.hasKey(enabledKey) && !descriptor.getBoolean(enabledKey)) return "";

            var strokeInfoKey = stringIDToTypeID("AGMStrokeStyleInfo");
            if (descriptor.hasKey(strokeInfoKey)) {
                var strokeInfo = descriptor.getObjectValue(strokeInfoKey);
                var contentKey = stringIDToTypeID("strokeStyleContent");
                if (strokeInfo.hasKey(contentKey)) {
                    var content = strokeInfo.getObjectValue(contentKey);
                    var colorKey = stringIDToTypeID("color");
                    if (content.hasKey(colorKey)) {
                        return toolDescriptorColorHex(content.getObjectValue(colorKey));
                    }
                }
            }

            var effectsKey = stringIDToTypeID("layerEffects");
            if (descriptor.hasKey(effectsKey)) {
                var effects = descriptor.getObjectValue(effectsKey);
                var frameKey = stringIDToTypeID("frameFX");
                if (effects.hasKey(frameKey)) {
                    var frame = effects.getObjectValue(frameKey);
                    var frameEnabledKey = stringIDToTypeID("enabled");
                    if (!frame.hasKey(frameEnabledKey) || frame.getBoolean(frameEnabledKey)) {
                        var frameColorKey = stringIDToTypeID("color");
                        if (frame.hasKey(frameColorKey)) {
                            return toolDescriptorColorHex(frame.getObjectValue(frameColorKey));
                        }
                    }
                }
            }
        } catch (ignoreStrokeColor) {}
        return "";
    }

    function toolLayerLabel(id) {
        try {
            var descriptor = toolLayerDescriptor(id);
            var key = stringIDToTypeID("color");
            if (!descriptor.hasKey(key)) return "none";
            return typeIDToStringID(descriptor.getEnumerationValue(key));
        } catch (ignoreLabel) {
            return "none";
        }
    }

    function toolSmartObjectSource(id) {
        try {
            var descriptor = toolLayerDescriptor(id);
            var smartKey = stringIDToTypeID("smartObject");
            if (!descriptor.hasKey(smartKey)) return "";
            var smart = descriptor.getObjectValue(smartKey);
            var keys = ["link", "fileReference", "placed", "documentID"];
            var index;
            for (index = 0; index < keys.length; index += 1) {
                var key = stringIDToTypeID(keys[index]);
                if (!smart.hasKey(key)) continue;
                try { return String(smart.getPath(key).fsName || smart.getPath(key)); } catch (ignorePath) {}
                try { return String(smart.getString(key)); } catch (ignoreString) {}
                try { return String(smart.getInteger(key)); } catch (ignoreInteger) {}
            }
        } catch (ignoreSmartSource) {}
        return "";
    }

    function toolLayerSignature(document, layer, criteria) {
        var id = toolLayerId(document, layer);
        var size;
        try { size = layerSize(layer); } catch (ignoreSize) { size = { width: 0, height: 0 }; }
        var signature = {
            id: id,
            name: String(layer.name || ""),
            type: toolLayerType(layer),
            width: size.width,
            height: size.height,
            text: "",
            font: "",
            fillColor: "",
            strokeColor: "",
            label: "",
            smartSource: ""
        };
        if (toolArrayContains(criteria, "text") || toolArrayContains(criteria, "font")) {
            if (signature.type === "text") {
                signature.text = String(layer.textItem.contents || "");
                signature.font = String(layer.textItem.font || "");
            }
        }
        if (toolArrayContains(criteria, "fillColor")) signature.fillColor = toolLayerFillColor(id, layer);
        if (toolArrayContains(criteria, "strokeColor")) signature.strokeColor = toolLayerStrokeColor(id);
        if (toolArrayContains(criteria, "label")) signature.label = toolLayerLabel(id);
        if (toolArrayContains(criteria, "smartSource")) signature.smartSource = toolSmartObjectSource(id);
        return signature;
    }

    function toolSignaturesMatch(reference, candidate, criteria, tolerance) {
        var index;
        for (index = 0; index < criteria.length; index += 1) {
            var criterion = criteria[index];
            if (criterion === "name" && candidate.name !== reference.name) return false;
            if (criterion === "type" && candidate.type !== reference.type) return false;
            if (criterion === "size" && (
                Math.abs(candidate.width - reference.width) > tolerance ||
                Math.abs(candidate.height - reference.height) > tolerance
            )) return false;
            if (criterion === "text" && candidate.text !== reference.text) return false;
            if (criterion === "font" && candidate.font !== reference.font) return false;
            if (criterion === "fillColor" && candidate.fillColor !== reference.fillColor) return false;
            if (criterion === "strokeColor" && candidate.strokeColor !== reference.strokeColor) return false;
            if (criterion === "label" && candidate.label !== reference.label) return false;
            if (criterion === "smartSource" && candidate.smartSource !== reference.smartSource) return false;
        }
        return true;
    }

    function toolSetLayerLabel(ids, colorName) {
        var colorMap = {
            yellow: "yellowColor",
            green: "grain"
        };
        colorName = colorMap[colorName] || colorName || "none";
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var set = new ActionDescriptor();
            var reference = new ActionReference();
            reference.putIdentifier(charIDToTypeID("Lyr "), ids[index]);
            set.putReference(charIDToTypeID("null"), reference);
            var target = new ActionDescriptor();
            target.putEnumerated(
                stringIDToTypeID("color"),
                stringIDToTypeID("color"),
                stringIDToTypeID(colorName || "none")
            );
            set.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), target);
            executeAction(charIDToTypeID("setd"), set, DialogModes.NO);
        }
    }

    function toolsFindSimilarLayers(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择参考图层");
        var document = app.activeDocument;
        var selectedIds = selectedLayerIds();
        if (!selectedIds.length) throw new Error("请先选择一个参考图层");
        var quickType = String(options && options.quickType || "");
        var criteria = options && options.criteria ? options.criteria : [];
        if (quickType === "textColor") criteria = ["type", "fillColor"];
        else if (quickType === "textContent") criteria = ["type", "text"];
        else if (quickType === "shapeSize") criteria = ["type", "size"];
        else if (quickType === "shapeFill") criteria = ["type", "fillColor"];
        else if (quickType === "shapeStroke") criteria = ["type", "strokeColor"];
        else if (quickType) throw new Error("未知的查找相同类型");
        if (!(criteria instanceof Array) || !criteria.length) throw new Error("请至少选择一个查找条件");
        var referenceId;
        try { referenceId = activeLayerId(); } catch (ignoreActiveFindReference) { referenceId = selectedIds[0]; }
        var referenceLayer = toolLayerById(document, referenceId);
        var reference = toolLayerSignature(document, referenceLayer, criteria);
        if ((quickType === "textColor" || quickType === "textContent") && reference.type !== "text") {
            throw new Error("请先选择文字图层作为参考");
        }
        if ((quickType === "shapeSize" || quickType === "shapeFill" || quickType === "shapeStroke") && reference.type !== "solidFill") {
            throw new Error("请先选择形状图层作为参考");
        }
        if (toolArrayContains(criteria, "text") && reference.type !== "text") {
            throw new Error("文字内容条件需要选择文字图层作为参考");
        }
        if (toolArrayContains(criteria, "font") && reference.type !== "text") {
            throw new Error("字体条件需要选择文字图层作为参考");
        }
        if (toolArrayContains(criteria, "fillColor") && !reference.fillColor) {
            throw new Error("参考图层没有可读取的文字或形状填充颜色");
        }
        if (toolArrayContains(criteria, "smartSource") && !reference.smartSource) {
            throw new Error("参考图层不是可读取源文件的智能对象");
        }
        if (toolArrayContains(criteria, "strokeColor") && !reference.strokeColor) {
            throw new Error("参考形状没有可读取的边框颜色");
        }
        var allLayers = [];
        toolCollectLayers(document, allLayers, true);
        var matched = [];
        var tolerance = Math.max(0, Number(options && options.tolerance) || 0);
        var index;
        for (index = 0; index < allLayers.length; index += 1) {
            var signature = toolLayerSignature(document, allLayers[index], criteria);
            if (toolSignaturesMatch(reference, signature, criteria, tolerance)) {
                matched.push(signature.id);
            }
        }
        if (!matched.length) throw new Error("没有找到匹配图层");
        if (String(options && options.action || "select") === "label") {
            suspendToolsHistory(document, "鑫洋助理：标记相同图层", function () {
                toolSetLayerLabel(matched, String(options && options.label || "yellow"));
                return true;
            });
        }
        selectLayersByIds(matched);
        return { matched: matched.length, criteria: criteria };
    }

    function toolSetShapeFill(id, colorValue) {
        selectLayersByIds([id]);
        var color = toolHexColor(colorValue);
        var set = new ActionDescriptor();
        var reference = new ActionReference();
        reference.putEnumerated(
            stringIDToTypeID("contentLayer"),
            stringIDToTypeID("ordinal"),
            stringIDToTypeID("targetEnum")
        );
        set.putReference(stringIDToTypeID("null"), reference);
        var solid = new ActionDescriptor();
        var rgb = new ActionDescriptor();
        rgb.putDouble(stringIDToTypeID("red"), color.red);
        rgb.putDouble(stringIDToTypeID("green"), color.green);
        rgb.putDouble(stringIDToTypeID("blue"), color.blue);
        solid.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), rgb);
        set.putObject(stringIDToTypeID("to"), stringIDToTypeID("solidColorLayer"), solid);
        executeAction(stringIDToTypeID("set"), set, DialogModes.NO);
    }

    function toolSetShapeStroke(id, colorValue, width) {
        var descriptor = toolLayerDescriptor(id);
        var effectsKey = stringIDToTypeID("layerEffects");
        var effects = descriptor.hasKey(effectsKey)
            ? descriptor.getObjectValue(effectsKey)
            : new ActionDescriptor();
        var color = toolHexColor(colorValue);
        var stroke = new ActionDescriptor();
        stroke.putBoolean(stringIDToTypeID("enabled"), Number(width) > 0);
        stroke.putBoolean(stringIDToTypeID("present"), Number(width) > 0);
        stroke.putBoolean(stringIDToTypeID("showInDialog"), true);
        stroke.putEnumerated(
            stringIDToTypeID("style"),
            stringIDToTypeID("frameStyle"),
            stringIDToTypeID("insideFrame")
        );
        stroke.putEnumerated(
            stringIDToTypeID("paintType"),
            stringIDToTypeID("frameFill"),
            stringIDToTypeID("solidColor")
        );
        stroke.putEnumerated(
            stringIDToTypeID("mode"),
            stringIDToTypeID("blendMode"),
            stringIDToTypeID("normal")
        );
        stroke.putUnitDouble(stringIDToTypeID("opacity"), stringIDToTypeID("percentUnit"), 100);
        stroke.putUnitDouble(stringIDToTypeID("size"), stringIDToTypeID("pixelsUnit"), Math.max(0, Number(width) || 0));
        var rgb = new ActionDescriptor();
        rgb.putDouble(stringIDToTypeID("red"), color.red);
        rgb.putDouble(stringIDToTypeID("green"), color.green);
        rgb.putDouble(stringIDToTypeID("blue"), color.blue);
        stroke.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), rgb);
        effects.putObject(stringIDToTypeID("frameFX"), stringIDToTypeID("frameFX"), stroke);
        var set = new ActionDescriptor();
        var reference = new ActionReference();
        reference.putIdentifier(charIDToTypeID("Lyr "), id);
        set.putReference(charIDToTypeID("null"), reference);
        set.putObject(charIDToTypeID("T   "), stringIDToTypeID("layerEffects"), effects);
        executeAction(charIDToTypeID("setd"), set, DialogModes.NO);
    }

    function toolSetLiveShapeGeometry(id, bounds, radius) {
        radius = Math.max(0, Math.min(
            Number(radius) || 0,
            Math.max(0, (bounds.right - bounds.left) / 2),
            Math.max(0, (bounds.bottom - bounds.top) / 2)
        ));
        try {
            selectLayersByIds([id]);
            var change = new ActionDescriptor();
            var reference = new ActionReference();
            reference.putEnumerated(
                stringIDToTypeID("path"),
                stringIDToTypeID("ordinal"),
                stringIDToTypeID("targetEnum")
            );
            change.putReference(stringIDToTypeID("null"), reference);
            var target = new ActionDescriptor();
            target.putInteger(stringIDToTypeID("unitValueQuadVersion"), 1);
            target.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), bounds.top);
            target.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), bounds.left);
            target.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), bounds.bottom);
            target.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), bounds.right);
            target.putUnitDouble(stringIDToTypeID("topLeft"), charIDToTypeID("#Pxl"), radius);
            target.putUnitDouble(stringIDToTypeID("topRight"), charIDToTypeID("#Pxl"), radius);
            target.putUnitDouble(stringIDToTypeID("bottomLeft"), charIDToTypeID("#Pxl"), radius);
            target.putUnitDouble(stringIDToTypeID("bottomRight"), charIDToTypeID("#Pxl"), radius);
            change.putObject(stringIDToTypeID("to"), stringIDToTypeID("rectangle"), target);
            executeAction(stringIDToTypeID("changePathDetails"), change, DialogModes.NO);
            return true;
        } catch (ignoreGeometry) {
            return false;
        }
    }

    function toolSetLiveShapeRadius(id, radius) {
        try {
            selectLayersByIds([id]);
            var change = new ActionDescriptor();
            var reference = new ActionReference();
            reference.putEnumerated(
                stringIDToTypeID("path"),
                stringIDToTypeID("ordinal"),
                stringIDToTypeID("targetEnum")
            );
            change.putReference(stringIDToTypeID("null"), reference);
            var target = new ActionDescriptor();
            var radii = new ActionDescriptor();
            radii.putUnitDouble(stringIDToTypeID("topLeft"), stringIDToTypeID("pixelsUnit"), radius);
            radii.putUnitDouble(stringIDToTypeID("topRight"), stringIDToTypeID("pixelsUnit"), radius);
            radii.putUnitDouble(stringIDToTypeID("bottomLeft"), stringIDToTypeID("pixelsUnit"), radius);
            radii.putUnitDouble(stringIDToTypeID("bottomRight"), stringIDToTypeID("pixelsUnit"), radius);
            target.putObject(stringIDToTypeID("keyOriginRRectRadii"), stringIDToTypeID("radii"), radii);
            change.putObject(stringIDToTypeID("to"), stringIDToTypeID("customShape"), target);
            executeAction(stringIDToTypeID("changePathDetails"), change, DialogModes.NO);
            return true;
        } catch (ignoreRadius) {
            return false;
        }
    }

    function toolsApplyRectangleSettings(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择形状图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要设置的形状图层");
        return suspendToolsHistory(document, "鑫洋助理：矩形批量设置", function () {
            var processedIds = [];
            var processed = 0;
            var skipped = 0;
            var radiusSkipped = 0;
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.SOLIDFILL) {
                    skipped += 1;
                    continue;
                }
                if (options && options.applySize) {
                    var current = layerSize(layer);
                    if (current.width > 0 && current.height > 0) {
                        layer.resize(
                            Math.max(0.01, Number(options.width) || current.width) / current.width * 100,
                            Math.max(0.01, Number(options.height) || current.height) / current.height * 100,
                            AnchorPosition.MIDDLECENTER
                        );
                    }
                }
                if (options && options.applyFill) toolSetShapeFill(ids[index], options.fill);
                if (options && options.applyStroke) toolSetShapeStroke(ids[index], options.stroke, options.strokeWidth);
                if (options && options.applyOpacity) layer.opacity = Math.max(0, Math.min(100, Number(options.opacity) || 0));
                if (options && options.applyRadius && !toolSetLiveShapeRadius(ids[index], Math.max(0, Number(options.radius) || 0))) {
                    radiusSkipped += 1;
                }
                processed += 1;
                processedIds.push(ids[index]);
            }
            if (!processed) throw new Error("当前选择中没有纯色形状图层");
            selectLayersByIds(processedIds);
            return {
                processed: processed,
                skipped: skipped,
                radiusSkipped: radiusSkipped
            };
        });
    }

    function toolsSmartObject(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要处理的图层");
        var action = String(options && options.action || "convert");
        return suspendToolsHistory(document, action === "rasterize"
            ? "鑫洋助理：栅格化智能对象"
            : "鑫洋助理：转换为智能对象", function () {
            var resultIds = [];
            var processed = 0;
            var skipped = 0;
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                document.activeLayer = layer;
                if (action === "rasterize") {
                    if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.SMARTOBJECT) {
                        skipped += 1;
                        continue;
                    }
                    layer.rasterize(RasterizeType.ENTIRELAYER);
                    document.activeLayer = layer;
                    resultIds.push(activeLayerId());
                    processed += 1;
                    continue;
                }
                if (layer.typename === "ArtLayer" && layer.kind === LayerKind.SMARTOBJECT) {
                    skipped += 1;
                    resultIds.push(ids[index]);
                    continue;
                }
                executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
                resultIds.push(activeLayerId());
                processed += 1;
            }
            if (!processed && !resultIds.length) throw new Error("没有可处理的图层");
            if (resultIds.length) selectLayersByIds(resultIds);
            return { processed: processed, skipped: skipped };
        });
    }

    function toolsScaleLayers(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要缩放的图层");
        var percent = Number(options && options.percent);
        if (!(percent > 0 && percent <= 1000)) throw new Error("缩放比例必须在 1—1000 之间");
        return suspendToolsHistory(document, "鑫洋助理：按比例缩放", function () {
            var processed = 0;
            var index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                try {
                    layer.resize(percent, percent, AnchorPosition.MIDDLECENTER);
                    processed += 1;
                } catch (ignoreScaleLayer) {}
            }
            if (!processed) throw new Error("当前选择中没有可缩放的图层");
            selectLayersByIds(ids);
            return { processed: processed, percent: percent };
        });
    }

    function toolsAlignLayers(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择多个图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (ids.length < 2) throw new Error("图层对齐至少需要选择两个图层");
        var action = String(options && options.action || "left");
        if (!/^(left|hCenter|right|top|vCenter|bottom)$/.test(action)) throw new Error("未知对齐方式");
        var layers = [];
        var bounds = [];
        var minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            var size = layerSize(layer);
            layers.push(layer);
            bounds.push(size);
            minLeft = Math.min(minLeft, size.left);
            minTop = Math.min(minTop, size.top);
            maxRight = Math.max(maxRight, size.left + size.width);
            maxBottom = Math.max(maxBottom, size.top + size.height);
        }
        var centerX = (minLeft + maxRight) / 2;
        var centerY = (minTop + maxBottom) / 2;
        return suspendToolsHistory(document, "鑫洋助理：图层对齐", function () {
            var processed = 0;
            for (index = 0; index < layers.length; index += 1) {
                var box = bounds[index];
                var dx = 0, dy = 0;
                if (action === "left") dx = minLeft - box.left;
                else if (action === "hCenter") dx = centerX - (box.left + box.width / 2);
                else if (action === "right") dx = maxRight - (box.left + box.width);
                else if (action === "top") dy = minTop - box.top;
                else if (action === "vCenter") dy = centerY - (box.top + box.height / 2);
                else if (action === "bottom") dy = maxBottom - (box.top + box.height);
                layers[index].translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
                processed += 1;
            }
            selectLayersByIds(ids);
            return { processed: processed, action: action };
        });
    }

    function toolsCenterLayersOnCanvas(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要基于画布居中的图层");
        var axis = String(options && options.axis || "horizontal") === "vertical" ? "vertical" : "horizontal";
        var layers = [];
        var minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
        var index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            var size = layerSize(layer);
            layers.push(layer);
            minLeft = Math.min(minLeft, size.left);
            minTop = Math.min(minTop, size.top);
            maxRight = Math.max(maxRight, size.left + size.width);
            maxBottom = Math.max(maxBottom, size.top + size.height);
        }
        var canvasCenterX = pixels(document.width) / 2;
        var canvasCenterY = pixels(document.height) / 2;
        var selectionCenterX = (minLeft + maxRight) / 2;
        var selectionCenterY = (minTop + maxBottom) / 2;
        var dx = axis === "horizontal" ? canvasCenterX - selectionCenterX : 0;
        var dy = axis === "vertical" ? canvasCenterY - selectionCenterY : 0;
        return suspendToolsHistory(document, axis === "vertical" ? "鑫洋助理：基于画布垂直居中" : "鑫洋助理：基于画布水平居中", function () {
            var processed = 0;
            for (index = 0; index < layers.length; index += 1) {
                try {
                    layers[index].translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
                    processed += 1;
                } catch (ignoreCanvasCenterLayer) {}
            }
            if (!processed) throw new Error("当前选择中没有可移动的图层");
            selectLayersByIds(ids);
            return { processed: processed, axis: axis, offsetX: dx, offsetY: dy };
        });
    }

    function toolsDistributeLayersEvenly(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择多个图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (ids.length < 3) throw new Error("水平或垂直分布至少需要选择三个图层");
        var axis = String(options && options.axis || "horizontal") === "vertical" ? "vertical" : "horizontal";
        var items = [], index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            items.push({ id: ids[index], layer: layer, size: layerSize(layer) });
        }
        items.sort(function (a, b) {
            return axis === "vertical" ? a.size.top - b.size.top : a.size.left - b.size.left;
        });
        var firstStart = axis === "vertical" ? items[0].size.top : items[0].size.left;
        var lastEnd = axis === "vertical"
            ? items[items.length - 1].size.top + items[items.length - 1].size.height
            : items[items.length - 1].size.left + items[items.length - 1].size.width;
        var totalSize = 0;
        for (index = 0; index < items.length; index += 1) totalSize += axis === "vertical" ? items[index].size.height : items[index].size.width;
        var gap = (lastEnd - firstStart - totalSize) / (items.length - 1);
        return suspendToolsHistory(document, axis === "vertical" ? "鑫洋助理：垂直分布" : "鑫洋助理：水平分布", function () {
            var cursor = firstStart;
            var processed = 0;
            for (index = 0; index < items.length; index += 1) {
                var item = items[index];
                if (index > 0 && index < items.length - 1) {
                    var currentStart = axis === "vertical" ? item.size.top : item.size.left;
                    var delta = cursor - currentStart;
                    try {
                        item.layer.translate(
                            UnitValue(axis === "horizontal" ? delta : 0, "px"),
                            UnitValue(axis === "vertical" ? delta : 0, "px")
                        );
                        processed += 1;
                    } catch (ignoreEvenDistributionLayer) {}
                } else {
                    processed += 1;
                }
                cursor += (axis === "vertical" ? item.size.height : item.size.width) + gap;
            }
            selectLayersByIds(ids);
            return { processed: processed, axis: axis, gap: gap };
        });
    }

    function toolSetColorOverlay(id, colorValue) {
        var descriptor = toolLayerDescriptor(id);
        var effectsKey = stringIDToTypeID("layerEffects");
        var effects = descriptor.hasKey(effectsKey)
            ? descriptor.getObjectValue(effectsKey)
            : new ActionDescriptor();
        var color = toolHexColor(colorValue);
        var overlay = new ActionDescriptor();
        overlay.putBoolean(stringIDToTypeID("enabled"), true);
        overlay.putBoolean(stringIDToTypeID("present"), true);
        overlay.putBoolean(stringIDToTypeID("showInDialog"), true);
        overlay.putEnumerated(
            stringIDToTypeID("mode"),
            stringIDToTypeID("blendMode"),
            stringIDToTypeID("normal")
        );
        overlay.putUnitDouble(stringIDToTypeID("opacity"), stringIDToTypeID("percentUnit"), 100);
        var rgb = new ActionDescriptor();
        rgb.putDouble(stringIDToTypeID("red"), color.red);
        rgb.putDouble(stringIDToTypeID("green"), color.green);
        rgb.putDouble(stringIDToTypeID("blue"), color.blue);
        overlay.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), rgb);
        effects.putObject(stringIDToTypeID("solidFill"), stringIDToTypeID("solidFill"), overlay);
        var set = new ActionDescriptor();
        var reference = new ActionReference();
        reference.putIdentifier(charIDToTypeID("Lyr "), id);
        set.putReference(charIDToTypeID("null"), reference);
        set.putObject(charIDToTypeID("T   "), stringIDToTypeID("layerEffects"), effects);
        executeAction(charIDToTypeID("setd"), set, DialogModes.NO);
    }

    function toolFillNormalLayerPixels(document, id, colorValue) {
        selectLayersByIds([id]);
        var setSelection = new ActionDescriptor();
        var selectionRef = new ActionReference();
        selectionRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
        setSelection.putReference(charIDToTypeID("null"), selectionRef);
        var transparencyRef = new ActionReference();
        transparencyRef.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Trsp"));
        setSelection.putReference(charIDToTypeID("T   "), transparencyRef);
        executeAction(charIDToTypeID("setd"), setSelection, DialogModes.NO);
        document.selection.fill(toolSolidColorFromHex(colorValue), ColorBlendMode.NORMAL, 100, false);
        document.selection.deselect();
    }

    function toolsAutoFillForeground(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要填色的图层");
        var hasTypeOptions = options && (options.text !== undefined || options.shape !== undefined || options.normal !== undefined);
        var allowText = hasTypeOptions ? !!options.text : true;
        var allowShape = hasTypeOptions ? !!options.shape : true;
        var allowNormal = hasTypeOptions ? !!options.normal : true;
        if (!allowText && !allowShape && !allowNormal) throw new Error("请至少启用一种自动填色图层类型");
        var colorSet = String(options && options.colorSet || "foregroundColor").toLowerCase();
        var sourceColor = colorSet.indexOf("background") >= 0 ? app.backgroundColor : app.foregroundColor;
        var colorValue = toolSolidColorHex(sourceColor);
        return suspendToolsHistory(document, "鑫洋助理：自动填充颜色", function () {
            var processed = 0, skipped = 0, index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                try {
                    if (layer.typename === "ArtLayer" && layer.kind === LayerKind.TEXT) {
                        if (!allowText) { skipped += 1; continue; }
                        layer.textItem.color = toolSolidColorFromHex(colorValue);
                    } else if (layer.typename === "ArtLayer" && layer.kind === LayerKind.SOLIDFILL) {
                        if (!allowShape) { skipped += 1; continue; }
                        toolSetShapeFill(ids[index], colorValue);
                    } else if (layer.typename === "ArtLayer" && layer.kind === LayerKind.NORMAL) {
                        if (!allowNormal) { skipped += 1; continue; }
                        toolFillNormalLayerPixels(document, ids[index], colorValue);
                    } else {
                        skipped += 1;
                        continue;
                    }
                    processed += 1;
                } catch (ignoreAutoFill) { skipped += 1; }
            }
            if (!processed) throw new Error("当前选择中没有符合设置的可填色图层");
            selectLayersByIds(ids);
            return { processed: processed, skipped: skipped, color: colorValue, colorSet: colorSet };
        });
    }

    function toolPlainFind(values, key) {
        var index;
        for (index = 0; index < values.length; index += 1) {
            if (Number(values[index].key) === Number(key)) return values[index];
        }
        return null;
    }

    function toolPlainPointCoordinates(pointValues) {
        var horizontal = toolPlainFind(pointValues, stringIDToTypeID("horizontal"));
        var vertical = toolPlainFind(pointValues, stringIDToTypeID("vertical"));
        if (!horizontal || !vertical) return null;
        return { h: horizontal, v: vertical, x: Number(horizontal.value), y: Number(vertical.value) };
    }

    function toolCollectPathPoints(pathValues, output) {
        var componentsItem = toolPlainFind(pathValues, stringIDToTypeID("pathComponents"));
        if (!componentsItem || !(componentsItem.value instanceof Array)) return;
        var componentIndex, subIndex, pointIndex;
        for (componentIndex = 0; componentIndex < componentsItem.value.length; componentIndex += 1) {
            var component = componentsItem.value[componentIndex];
            if (!component || !(component.value instanceof Array)) continue;
            var subpathsItem = toolPlainFind(component.value, stringIDToTypeID("subpathListKey"));
            if (!subpathsItem || !(subpathsItem.value instanceof Array)) continue;
            for (subIndex = 0; subIndex < subpathsItem.value.length; subIndex += 1) {
                var subpath = subpathsItem.value[subIndex];
                if (!subpath || !(subpath.value instanceof Array)) continue;
                var pointsItem = toolPlainFind(subpath.value, stringIDToTypeID("points"));
                if (!pointsItem || !(pointsItem.value instanceof Array)) continue;
                for (pointIndex = 0; pointIndex < pointsItem.value.length; pointIndex += 1) {
                    var point = pointsItem.value[pointIndex];
                    if (!point || !(point.value instanceof Array)) continue;
                    var anchorItem = toolPlainFind(point.value, stringIDToTypeID("anchor"));
                    if (!anchorItem || !(anchorItem.value instanceof Array)) continue;
                    var anchor = toolPlainPointCoordinates(anchorItem.value);
                    if (!anchor) continue;
                    var forwardItem = toolPlainFind(point.value, stringIDToTypeID("forward"));
                    var backwardItem = toolPlainFind(point.value, stringIDToTypeID("backward"));
                    output.push({
                        anchor: anchor,
                        forward: forwardItem && forwardItem.value instanceof Array ? toolPlainPointCoordinates(forwardItem.value) : null,
                        backward: backwardItem && backwardItem.value instanceof Array ? toolPlainPointCoordinates(backwardItem.value) : null,
                        originalX: anchor.x,
                        originalY: anchor.y,
                        targetX: anchor.x,
                        targetY: anchor.y
                    });
                }
            }
        }
    }

    function toolSnapPointDimension(points, property, targetProperty, tolerance, threshold) {
        var sorted = points.slice(0).sort(function (a, b) { return a[property] - b[property]; });
        var groups = [];
        var group = [];
        var index;
        for (index = 0; index < sorted.length; index += 1) {
            if (!group.length || Math.abs(sorted[index][property] - group[group.length - 1][property]) <= tolerance) {
                group.push(sorted[index]);
            } else {
                groups.push(group);
                group = [sorted[index]];
            }
        }
        if (group.length) groups.push(group);
        for (index = 0; index < groups.length; index += 1) {
            var current = groups[index];
            var sum = 0, itemIndex;
            for (itemIndex = 0; itemIndex < current.length; itemIndex += 1) sum += current[itemIndex][property];
            var shared = sum / current.length;
            var snappedShared = Math.round(shared);
            if (Math.abs(snappedShared - shared) <= threshold) {
                for (itemIndex = 0; itemIndex < current.length; itemIndex += 1) current[itemIndex][targetProperty] = snappedShared;
            }
        }
    }

    function toolGetVectorMaskPathPlain(id) {
        selectLayersByIds([id]);
        var reference = new ActionReference();
        reference.putEnumerated(
            stringIDToTypeID("path"),
            stringIDToTypeID("path"),
            stringIDToTypeID("vectorMask")
        );
        var descriptor = executeActionGet(reference);
        var key = stringIDToTypeID("pathContents");
        if (!descriptor.hasKey(key)) throw new Error("形状图层没有可编辑的矢量路径");
        return toolDescriptorToPlain(descriptor.getObjectValue(key));
    }

    function toolSetVectorMaskPathPlain(id, values) {
        selectLayersByIds([id]);
        var set = new ActionDescriptor();
        var reference = new ActionReference();
        reference.putEnumerated(
            stringIDToTypeID("path"),
            stringIDToTypeID("path"),
            stringIDToTypeID("vectorMask")
        );
        set.putReference(charIDToTypeID("null"), reference);
        set.putObject(charIDToTypeID("T   "), stringIDToTypeID("pathClass"), toolPlainToDescriptor(values));
        executeAction(charIDToTypeID("setd"), set, DialogModes.NO);
    }

    function toolsApplySmartSnap(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择要吸附的图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择要吸附的图层");
        var distance = Math.max(1, Math.min(200, Number(options && options.distance) || 20));
        var selected = [], index, layer;
        for (index = 0; index < ids.length; index += 1) selected.push(toolLayerById(document, ids[index]));
        function boxOf(layers) {
            var result = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }, i, b;
            for (i = 0; i < layers.length; i += 1) { b = layers[i].bounds; result.left = Math.min(result.left, pixels(b[0])); result.top = Math.min(result.top, pixels(b[1])); result.right = Math.max(result.right, pixels(b[2])); result.bottom = Math.max(result.bottom, pixels(b[3])); }
            return result;
        }
        var moving = boxOf(selected);
        function containsLayer(list, item) { var i; for (i = 0; i < list.length; i += 1) if (list[i] === item) return true; return false; }
        var candidates = [];
        function collect(layers) { var i, item; for (i = 0; i < layers.length; i += 1) { item = layers[i]; if (!item.visible || item.allLocked || containsLayer(selected, item)) continue; candidates.push(item); if (item.typename === "LayerSet") collect(item.layers); } }
        collect(document.layers);
        var bestX = null, bestY = null;
        function consider(axis, delta, label) {
            if (Math.abs(delta) > distance) return;
            var current = axis === "x" ? bestX : bestY;
            if (!current || Math.abs(delta) < Math.abs(current.delta)) { if (axis === "x") bestX = { delta: delta, label: label }; else bestY = { delta: delta, label: label }; }
        }
        function compareBox(target, label) {
            if (options.layerEdges) { consider("x", target.left - moving.left, label + "左边缘"); consider("x", target.right - moving.right, label + "右边缘"); consider("x", target.left - moving.right, label + "左边缘"); consider("x", target.right - moving.left, label + "右边缘"); consider("y", target.top - moving.top, label + "上边缘"); consider("y", target.bottom - moving.bottom, label + "下边缘"); consider("y", target.top - moving.bottom, label + "上边缘"); consider("y", target.bottom - moving.top, label + "下边缘"); }
            if (options.centers) { consider("x", (target.left + target.right - moving.left - moving.right) / 2, label + "水平中心"); consider("y", (target.top + target.bottom - moving.top - moving.bottom) / 2, label + "垂直中心"); }
        }
        for (index = 0; index < candidates.length; index += 1) compareBox(boxOf([candidates[index]]), "图层");
        var canvas = { left: 0, top: 0, right: pixels(document.width), bottom: pixels(document.height) };
        if (options.canvasEdges) compareBox(canvas, "画布");
        if (options.guides) {
            for (index = 0; index < document.guides.length; index += 1) {
                var guide = document.guides[index], coordinate = pixels(guide.coordinate);
                if (guide.direction === Direction.VERTICAL) { consider("x", coordinate - moving.left, "垂直参考线"); consider("x", coordinate - moving.right, "垂直参考线"); if (options.centers) consider("x", coordinate - (moving.left + moving.right) / 2, "垂直参考线中心"); }
                else { consider("y", coordinate - moving.top, "水平参考线"); consider("y", coordinate - moving.bottom, "水平参考线"); if (options.centers) consider("y", coordinate - (moving.top + moving.bottom) / 2, "水平参考线中心"); }
            }
        }
        if (options.equalSpacing && candidates.length >= 2) {
            var leftNeighbor = null, rightNeighbor = null, topNeighbor = null, bottomNeighbor = null, candidateBox;
            for (index = 0; index < candidates.length; index += 1) { candidateBox = boxOf([candidates[index]]); if (candidateBox.right <= moving.left && (!leftNeighbor || candidateBox.right > leftNeighbor.right)) leftNeighbor = candidateBox; if (candidateBox.left >= moving.right && (!rightNeighbor || candidateBox.left < rightNeighbor.left)) rightNeighbor = candidateBox; if (candidateBox.bottom <= moving.top && (!topNeighbor || candidateBox.bottom > topNeighbor.bottom)) topNeighbor = candidateBox; if (candidateBox.top >= moving.bottom && (!bottomNeighbor || candidateBox.top < bottomNeighbor.top)) bottomNeighbor = candidateBox; }
            if (leftNeighbor && rightNeighbor) consider("x", (leftNeighbor.right + rightNeighbor.left - (moving.right - moving.left)) / 2 - moving.left, "水平等距");
            if (topNeighbor && bottomNeighbor) consider("y", (topNeighbor.bottom + bottomNeighbor.top - (moving.bottom - moving.top)) / 2 - moving.top, "垂直等距");
        }
        var dx = bestX ? bestX.delta : 0, dy = bestY ? bestY.delta : 0;
        if (!bestX && !bestY) return { processed: 0, xTarget: "未找到水平目标", yTarget: "未找到垂直目标" };
        return suspendToolsHistory(document, "鑫洋助理：磁吸模式", function () { for (index = 0; index < selected.length; index += 1) selected[index].translate(UnitValue(dx, "px"), UnitValue(dy, "px")); selectLayersByIds(ids); return { processed: selected.length, offsetX: dx, offsetY: dy, xTarget: bestX ? bestX.label : "未命中水平目标", yTarget: bestY ? bestY.label : "未命中垂直目标" }; });
    }

    function toolsSnapShapeAnchors(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择形状图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要修正的形状图层");
        var threshold = Math.max(0, Math.min(0.51, Number(options && options.threshold) || 0.51));
        var tolerance = Math.max(0.001, Math.min(1, Number(options && options.collinearTolerance) || 0.08));
        return suspendToolsHistory(document, "鑫洋助理：修正模糊", function () {
            var processed = 0, skipped = 0, movedAnchors = 0, index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.SOLIDFILL) { skipped += 1; continue; }
                try {
                    var plain = toolGetVectorMaskPathPlain(ids[index]);
                    var points = [];
                    toolCollectPathPoints(plain, points);
                    if (!points.length) { skipped += 1; continue; }
                    toolSnapPointDimension(points, "originalX", "targetX", tolerance, threshold);
                    toolSnapPointDimension(points, "originalY", "targetY", tolerance, threshold);
                    var pointIndex, layerMoved = 0;
                    for (pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
                        var point = points[pointIndex];
                        var dx = point.targetX - point.originalX;
                        var dy = point.targetY - point.originalY;
                        if (Math.abs(dx) < 0.000001 && Math.abs(dy) < 0.000001) continue;
                        point.anchor.h.value = point.targetX;
                        point.anchor.v.value = point.targetY;
                        if (point.forward) { point.forward.h.value += dx; point.forward.v.value += dy; }
                        if (point.backward) { point.backward.h.value += dx; point.backward.v.value += dy; }
                        layerMoved += 1;
                    }
                    if (layerMoved) {
                        toolSetVectorMaskPathPlain(ids[index], plain);
                        movedAnchors += layerMoved;
                        processed += 1;
                    } else skipped += 1;
                } catch (ignoreSnapPath) { skipped += 1; }
            }
            if (!processed) throw new Error("没有找到可吸附的形状锚点；请确认选择的是纯色形状图层");
            selectLayersByIds(ids);
            return { processed: processed, skipped: skipped, movedAnchors: movedAnchors, threshold: threshold };
        });
    }

    function toolShapeAppearanceInfo(id, layer) {
        try {
            var descriptor = toolLayerDescriptor(id);
            var strokeInfoKey = stringIDToTypeID("AGMStrokeStyleInfo");
            var legacyStrokeStyleKey = stringIDToTypeID("strokeStyle");
            var strokeStyle = descriptor.hasKey(strokeInfoKey)
                ? descriptor.getObjectValue(strokeInfoKey)
                : (descriptor.hasKey(legacyStrokeStyleKey)
                    ? descriptor.getObjectValue(legacyStrokeStyleKey)
                    : new ActionDescriptor());
            var fillEnabledKey = stringIDToTypeID("fillEnabled");
            var strokeEnabledKey = stringIDToTypeID("strokeEnabled");
            var fillEnabled = true;
            var strokeEnabled = false;

            if (descriptor.hasKey(fillEnabledKey)) fillEnabled = descriptor.getBoolean(fillEnabledKey);
            else if (strokeStyle.hasKey(fillEnabledKey)) fillEnabled = strokeStyle.getBoolean(fillEnabledKey);

            if (descriptor.hasKey(strokeEnabledKey)) strokeEnabled = descriptor.getBoolean(strokeEnabledKey);
            else if (strokeStyle.hasKey(strokeEnabledKey)) strokeEnabled = strokeStyle.getBoolean(strokeEnabledKey);

            var fillColor = toolLayerFillColor(id, layer);
            var strokeColor = "";
            var contentKey = stringIDToTypeID("strokeStyleContent");
            if (strokeStyle.hasKey(contentKey)) {
                var content = strokeStyle.getObjectValue(contentKey);
                var colorKey = stringIDToTypeID("color");
                if (content.hasKey(colorKey)) strokeColor = toolDescriptorColorHex(content.getObjectValue(colorKey));
            }

            var widthKey = stringIDToTypeID("strokeStyleLineWidth");
            var width = strokeStyle.hasKey(widthKey) ? strokeStyle.getUnitDoubleValue(widthKey) : 1;
            return {
                fillColor: fillColor,
                fillEnabled: fillEnabled,
                strokeColor: strokeColor,
                strokeEnabled: strokeEnabled,
                strokeWidth: Math.max(0.1, Number(width) || 1),
                strokeStyle: strokeStyle
            };
        } catch (ignoreShapeAppearance) {
            return null;
        }
    }

    function toolPutNativeStrokeDefaults(strokeStyle, width) {
        var versionKey = stringIDToTypeID("strokeStyleVersion");
        if (!strokeStyle.hasKey(versionKey)) strokeStyle.putInteger(versionKey, 2);

        var widthKey = stringIDToTypeID("strokeStyleLineWidth");
        strokeStyle.putUnitDouble(widthKey, stringIDToTypeID("pixelsUnit"), Math.max(0.1, Number(width) || 1));

        var dashOffsetKey = stringIDToTypeID("strokeStyleLineDashOffset");
        if (!strokeStyle.hasKey(dashOffsetKey)) {
            strokeStyle.putUnitDouble(dashOffsetKey, stringIDToTypeID("pixelsUnit"), 0);
        }

        var miterKey = stringIDToTypeID("strokeStyleMiterLimit");
        if (!strokeStyle.hasKey(miterKey)) strokeStyle.putDouble(miterKey, 100);

        var capKey = stringIDToTypeID("strokeStyleLineCapType");
        if (!strokeStyle.hasKey(capKey)) {
            strokeStyle.putEnumerated(
                capKey,
                stringIDToTypeID("strokeStyleLineCapType"),
                stringIDToTypeID("strokeStyleButtCap")
            );
        }

        var joinKey = stringIDToTypeID("strokeStyleLineJoinType");
        if (!strokeStyle.hasKey(joinKey)) {
            strokeStyle.putEnumerated(
                joinKey,
                stringIDToTypeID("strokeStyleLineJoinType"),
                stringIDToTypeID("strokeStyleMiterJoin")
            );
        }

        var alignKey = stringIDToTypeID("strokeStyleLineAlignment");
        if (!strokeStyle.hasKey(alignKey)) {
            strokeStyle.putEnumerated(
                alignKey,
                stringIDToTypeID("strokeStyleLineAlignment"),
                stringIDToTypeID("strokeStyleAlignInside")
            );
        }

        var scaleLockKey = stringIDToTypeID("strokeStyleScaleLock");
        if (!strokeStyle.hasKey(scaleLockKey)) strokeStyle.putBoolean(scaleLockKey, false);

        var adjustKey = stringIDToTypeID("strokeStyleStrokeAdjust");
        if (!strokeStyle.hasKey(adjustKey)) strokeStyle.putBoolean(adjustKey, false);

        var dashSetKey = stringIDToTypeID("strokeStyleLineDashSet");
        if (!strokeStyle.hasKey(dashSetKey)) strokeStyle.putList(dashSetKey, new ActionList());

        var blendKey = stringIDToTypeID("strokeStyleBlendMode");
        if (!strokeStyle.hasKey(blendKey)) {
            strokeStyle.putEnumerated(
                blendKey,
                stringIDToTypeID("blendMode"),
                stringIDToTypeID("normal")
            );
        }

        var opacityKey = stringIDToTypeID("strokeStyleOpacity");
        if (!strokeStyle.hasKey(opacityKey)) {
            strokeStyle.putUnitDouble(opacityKey, stringIDToTypeID("percentUnit"), 100);
        }

        var resolutionKey = stringIDToTypeID("strokeStyleResolution");
        if (!strokeStyle.hasKey(resolutionKey)) {
            strokeStyle.putDouble(resolutionKey, Number(app.activeDocument.resolution) || 72);
        }
    }

    function toolSetNativeShapeAppearance(id, fillColorValue, fillEnabled, strokeColorValue, strokeEnabled, width, sourceStrokeStyle) {
        selectLayersByIds([id]);
        var fillColor = toolHexColor(fillColorValue || strokeColorValue || "#000000");
        var strokeColor = toolHexColor(strokeColorValue || fillColorValue || "#000000");
        var strokeStyle = sourceStrokeStyle || new ActionDescriptor();

        toolPutNativeStrokeDefaults(strokeStyle, width);
        strokeStyle.putBoolean(stringIDToTypeID("fillEnabled"), !!fillEnabled);
        strokeStyle.putBoolean(stringIDToTypeID("strokeEnabled"), !!strokeEnabled);

        var strokeContent = new ActionDescriptor();
        var strokeRgb = new ActionDescriptor();
        strokeRgb.putDouble(stringIDToTypeID("red"), strokeColor.red);
        strokeRgb.putDouble(stringIDToTypeID("green"), strokeColor.green);
        strokeRgb.putDouble(stringIDToTypeID("blue"), strokeColor.blue);
        strokeContent.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), strokeRgb);
        strokeStyle.putObject(
            stringIDToTypeID("strokeStyleContent"),
            stringIDToTypeID("solidColorLayer"),
            strokeContent
        );

        var set = new ActionDescriptor();
        var reference = new ActionReference();
        reference.putEnumerated(
            stringIDToTypeID("contentLayer"),
            stringIDToTypeID("ordinal"),
            stringIDToTypeID("targetEnum")
        );
        set.putReference(stringIDToTypeID("null"), reference);

        var solid = new ActionDescriptor();
        var fillRgb = new ActionDescriptor();
        fillRgb.putDouble(stringIDToTypeID("red"), fillColor.red);
        fillRgb.putDouble(stringIDToTypeID("green"), fillColor.green);
        fillRgb.putDouble(stringIDToTypeID("blue"), fillColor.blue);
        solid.putObject(stringIDToTypeID("color"), stringIDToTypeID("RGBColor"), fillRgb);
        /*
         * 原生形状的描边描述符属于 contentLayer 外层，而不是 solidColorLayer
         * 本身。按创建形状时的层级组装 set 描述符，才能真实修改属性栏中的
         * 填充、描边开关、颜色和粗细，不产生任何图层样式。
         */
        var contentLayer = new ActionDescriptor();
        contentLayer.putObject(charIDToTypeID("Type"), stringIDToTypeID("solidColorLayer"), solid);
        contentLayer.putObject(
            stringIDToTypeID("AGMStrokeStyleInfo"),
            stringIDToTypeID("strokeStyle"),
            strokeStyle
        );
        set.putObject(stringIDToTypeID("to"), stringIDToTypeID("contentLayer"), contentLayer);
        executeAction(stringIDToTypeID("set"), set, DialogModes.NO);
    }

    function toolsSwapShapeFillStroke() {
        if (!app.documents.length) throw new Error("请先打开文档并选择形状图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择形状图层");
        return suspendToolsHistory(document, "鑫洋助理：填充线框互换", function () {
            var processed = 0, skipped = 0, index;
            for (index = 0; index < ids.length; index += 1) {
                var layer = toolLayerById(document, ids[index]);
                if (layer.typename !== "ArtLayer" || layer.kind !== LayerKind.SOLIDFILL) { skipped += 1; continue; }

                var appearance = toolShapeAppearanceInfo(ids[index], layer);
                if (!appearance || (!appearance.fillEnabled && !appearance.strokeEnabled)) { skipped += 1; continue; }
                if (appearance.fillEnabled && !appearance.fillColor) { skipped += 1; continue; }
                if (appearance.strokeEnabled && !appearance.strokeColor) { skipped += 1; continue; }

                var nextFillEnabled = appearance.strokeEnabled;
                var nextStrokeEnabled = appearance.fillEnabled;
                var nextFillColor = appearance.strokeEnabled
                    ? appearance.strokeColor
                    : (appearance.fillColor || appearance.strokeColor || "#000000");
                var nextStrokeColor = appearance.fillEnabled
                    ? appearance.fillColor
                    : (appearance.strokeColor || appearance.fillColor || "#000000");

                toolSetNativeShapeAppearance(
                    ids[index],
                    nextFillColor,
                    nextFillEnabled,
                    nextStrokeColor,
                    nextStrokeEnabled,
                    appearance.strokeWidth,
                    appearance.strokeStyle
                );
                processed += 1;
            }
            if (!processed) throw new Error("没有找到可互换填充与原生描边的形状图层");
            selectLayersByIds(ids);
            return { processed: processed, skipped: skipped, nativeShapeAppearance: true };
        });
    }

    function toolsDistributeLayers(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择多个图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (ids.length < 2) throw new Error("按间距分布至少需要选择两个图层");
        var direction = integerValue(options && options.direction, -1);
        var axis = direction === 1 || String(options && options.axis || "horizontal") === "vertical" ? "vertical" : "horizontal";
        var gap = Number(options && options.space !== undefined ? options.space : options && options.gap);
        if (!isFinite(gap)) gap = 0;
        var orderMode = integerValue(options && options.order, 0) === 1 ? 1 : 0;
        var layers = [], index;
        for (index = 0; index < ids.length; index += 1) {
            var layer = toolLayerById(document, ids[index]);
            layers.push({ id: ids[index], layer: layer, size: layerSize(layer) });
        }
        if (orderMode === 1) {
            layers.sort(function (a, b) {
                return axis === "vertical" ? a.size.top - b.size.top : a.size.left - b.size.left;
            });
        } else {
            var panelLayers = toolCollectAllLayersInPanelOrder(document, []);
            var ranks = {};
            for (index = 0; index < panelLayers.length; index += 1) ranks[String(layerNumericId(panelLayers[index]))] = index;
            layers.sort(function (a, b) {
                var ar = ranks[String(a.id)], br = ranks[String(b.id)];
                if (ar === undefined) ar = 999999;
                if (br === undefined) br = 999999;
                return ar - br;
            });
        }
        return suspendToolsHistory(document, "鑫洋助理：按间距分布", function () {
            var cursor = axis === "vertical" ? layers[0].size.top : layers[0].size.left;
            for (index = 0; index < layers.length; index += 1) {
                var item = layers[index];
                if (index > 0) {
                    var delta = cursor - (axis === "vertical" ? item.size.top : item.size.left);
                    item.layer.translate(
                        UnitValue(axis === "horizontal" ? delta : 0, "px"),
                        UnitValue(axis === "vertical" ? delta : 0, "px")
                    );
                }
                cursor += (axis === "vertical" ? item.size.height : item.size.width) + gap;
            }
            selectLayersByIds(ids);
            return { processed: layers.length, axis: axis, direction: axis === "vertical" ? 1 : 0, gap: gap, order: orderMode };
        });
    }

    function toolsReplaceElements(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择源元素和目标元素");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (ids.length < 2) throw new Error("请至少选择一个源元素和一个目标元素");
        var sourceId = activeLayerId();
        var source = toolLayerById(document, sourceId);
        var targets = [];
        var index;
        for (index = 0; index < ids.length; index += 1) if (ids[index] !== sourceId) targets.push(ids[index]);
        if (!targets.length) throw new Error("请将源图层设为当前活动图层，并同时选择目标图层");
        return suspendToolsHistory(document, "鑫洋助理：元素组替换", function () {
            var createdIds = [], replaced = 0;
            for (index = 0; index < targets.length; index += 1) {
                var target = toolLayerById(document, targets[index]);
                var targetBox = layerSize(target);
                var duplicate = source.duplicate();
                duplicate.name = target.name;
                try { duplicate.move(target, ElementPlacement.PLACEBEFORE); } catch (ignoreMoveOrder) {}
                var duplicateBox = layerSize(duplicate);
                if (options && options.matchBounds && duplicateBox.width > 0 && duplicateBox.height > 0) {
                    duplicate.resize(
                        targetBox.width / duplicateBox.width * 100,
                        targetBox.height / duplicateBox.height * 100,
                        AnchorPosition.MIDDLECENTER
                    );
                    duplicateBox = layerSize(duplicate);
                }
                duplicate.translate(
                    UnitValue((targetBox.left + targetBox.width / 2) - (duplicateBox.left + duplicateBox.width / 2), "px"),
                    UnitValue((targetBox.top + targetBox.height / 2) - (duplicateBox.top + duplicateBox.height / 2), "px")
                );
                document.activeLayer = duplicate;
                createdIds.push(activeLayerId());
                target.remove();
                replaced += 1;
            }
            selectLayersByIds(createdIds);
            return { replaced: replaced, sourceId: sourceId };
        });
    }

    function toolSetMainLayerColor(id, layer, colorValue) {
        if (layer.typename === "ArtLayer" && layer.kind === LayerKind.TEXT) {
            layer.textItem.color = toolSolidColorFromHex(colorValue);
            return true;
        }
        if (layer.typename === "ArtLayer" && layer.kind === LayerKind.SOLIDFILL) {
            toolSetShapeFill(id, colorValue);
            return true;
        }
        return false;
    }

    function toolsSwapLayerColors() {
        if (!app.documents.length) throw new Error("请先打开文档并选择两个文字或形状图层");
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (ids.length !== 2) throw new Error("图层颜色互换需要准确选择两个图层");
        var first = toolLayerById(document, ids[0]);
        var second = toolLayerById(document, ids[1]);
        var firstColor = toolLayerFillColor(ids[0], first);
        var secondColor = toolLayerFillColor(ids[1], second);
        if (!firstColor || !secondColor) throw new Error("仅支持文字图层或纯色形状图层的主颜色互换");
        return suspendToolsHistory(document, "鑫洋助理：图层颜色互换", function () {
            if (!toolSetMainLayerColor(ids[0], first, secondColor) || !toolSetMainLayerColor(ids[1], second, firstColor)) {
                throw new Error("当前图层类型不支持颜色互换");
            }
            selectLayersByIds(ids);
            return { processed: 2, firstColor: firstColor, secondColor: secondColor };
        });
    }

    return {
        toolCreateSwapMarker: toolCreateSwapMarker,
        toolRemoveSwapMarker: toolRemoveSwapMarker,
        toolSwapLayerSlots: toolSwapLayerSlots,
        toolMoveLayerCenterTo: toolMoveLayerCenterTo,
        toolFlipCurrentLayerSelection: toolFlipCurrentLayerSelection,
        toolGroupCurrentLayerSelection: toolGroupCurrentLayerSelection,
        toolUngroupCurrentLayerSelection: toolUngroupCurrentLayerSelection,
        toolsQuickTransform: toolsQuickTransform,
        toolTransformAnchor: toolTransformAnchor,
        toolFloatValue: toolFloatValue,
        toolsCustomTransform: toolsCustomTransform,
        toolsCreateDocumentPreset: toolsCreateDocumentPreset,
        toolRenameNumber: toolRenameNumber,
        toolFormatLayerName: toolFormatLayerName,
        toolsBatchRenameLayers: toolsBatchRenameLayers,
        toolLayerDescriptor: toolLayerDescriptor,
        toolDescriptorColorHex: toolDescriptorColorHex,
        toolLayerFillColor: toolLayerFillColor,
        toolLayerStrokeColor: toolLayerStrokeColor,
        toolLayerLabel: toolLayerLabel,
        toolSmartObjectSource: toolSmartObjectSource,
        toolLayerSignature: toolLayerSignature,
        toolSignaturesMatch: toolSignaturesMatch,
        toolSetLayerLabel: toolSetLayerLabel,
        toolsFindSimilarLayers: toolsFindSimilarLayers,
        toolSetShapeFill: toolSetShapeFill,
        toolSetShapeStroke: toolSetShapeStroke,
        toolSetLiveShapeGeometry: toolSetLiveShapeGeometry,
        toolSetLiveShapeRadius: toolSetLiveShapeRadius,
        toolsApplyRectangleSettings: toolsApplyRectangleSettings,
        toolsSmartObject: toolsSmartObject,
        toolsScaleLayers: toolsScaleLayers,
        toolsAlignLayers: toolsAlignLayers,
        toolsCenterLayersOnCanvas: toolsCenterLayersOnCanvas,
        toolsDistributeLayersEvenly: toolsDistributeLayersEvenly,
        toolSetColorOverlay: toolSetColorOverlay,
        toolFillNormalLayerPixels: toolFillNormalLayerPixels,
        toolsAutoFillForeground: toolsAutoFillForeground,
        toolPlainFind: toolPlainFind,
        toolPlainPointCoordinates: toolPlainPointCoordinates,
        toolCollectPathPoints: toolCollectPathPoints,
        toolSnapPointDimension: toolSnapPointDimension,
        toolGetVectorMaskPathPlain: toolGetVectorMaskPathPlain,
        toolSetVectorMaskPathPlain: toolSetVectorMaskPathPlain,
        toolsApplySmartSnap: toolsApplySmartSnap,
        toolsSnapShapeAnchors: toolsSnapShapeAnchors,
        toolShapeAppearanceInfo: toolShapeAppearanceInfo,
        toolPutNativeStrokeDefaults: toolPutNativeStrokeDefaults,
        toolSetNativeShapeAppearance: toolSetNativeShapeAppearance,
        toolsSwapShapeFillStroke: toolsSwapShapeFillStroke,
        toolsDistributeLayers: toolsDistributeLayers,
        toolsReplaceElements: toolsReplaceElements,
        toolSetMainLayerColor: toolSetMainLayerColor,
        toolsSwapLayerColors: toolsSwapLayerColors
    };
};
