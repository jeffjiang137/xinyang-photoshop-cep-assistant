/* 鑫洋助理 ExtendScript 模块：stitchSlice */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}

XinyangHostModules.stitchSlice = function (deps) {
    deps = deps || {};
        var activeLayerId = deps.activeLayerId;
        var clearLayerClippingMask = deps.clearLayerClippingMask;
        var clearStitchSourceClippingMasks = deps.clearStitchSourceClippingMasks;
        var collectImageLayers = deps.collectImageLayers;
        var convertToSmartObject = deps.convertToSmartObject;
        var createSourceLayer = deps.createSourceLayer;
        var createStitchWhiteBackground = deps.createStitchWhiteBackground;
        var currentDocumentIdFor = deps.currentDocumentIdFor;
        var displayFileName = deps.displayFileName;
        var fileObject = deps.fileObject;
        var fillDocumentWhite = deps.fillDocumentWhite;
        var findLayerById = deps.findLayerById;
        var initializeSpacingState = deps.initializeSpacingState;
        var integerValue = deps.integerValue;
        var isSmartObjectLayer = deps.isSmartObjectLayer;
        var layerSize = deps.layerSize;
        var loadSpacingState = deps.loadSpacingState;
        var loadStitchSourceState = deps.loadStitchSourceState;
        var moveLayerToBottom = deps.moveLayerToBottom;
        var normalizedSpacing = deps.normalizedSpacing;
        var pixels = deps.pixels;
        var safeLayerName = deps.safeLayerName;
        var saveSpacingState = deps.saveSpacingState;
        var saveStitchSourceState = deps.saveStitchSourceState;
        var selectLayersByIds = deps.selectLayersByIds;
        var selectedLayerIds = deps.selectedLayerIds;
        var twoDigits = deps.twoDigits;
        var MAX_CANVAS_HEIGHT = deps.MAX_CANVAS_HEIGHT;
        var INITIAL_CANVAS_HEIGHT = deps.INITIAL_CANVAS_HEIGHT;
    var activeJob = null;
    var activeSpacingJob = null;
    var activeSliceJob = null;

        function importOne(target, file, targetWidth, y, index) {
            var sourceLayer = createSourceLayer(target, file, targetWidth);
            var layer = convertToSmartObject(
                target,
                sourceLayer.layer
            );
            var size = layerSize(layer);

            if (!(size.width > 0 && size.height > 0)) {
                throw new Error("无法读取图片尺寸：" + displayFileName(file));
            }

            if (sourceLayer.needsScale) {
                var scalePercent = targetWidth * 100 / size.width;
                layer.resize(
                    scalePercent,
                    scalePercent,
                    AnchorPosition.MIDDLECENTER
                );
                size = layerSize(layer);
            }

            /*
             * Photoshop 对智能对象的百分比缩放会保留子像素精度，随后在
             * 图层边界与画布栅格相交时偶尔向内取整。理论上等宽的图片便会
             * 少覆盖最右侧一个像素，露出长图的白色背景。按实际 bounds 再
             * 校正一次，并额外覆盖极小的子像素余量，保证画布边缘无缝。
             */
            if (size.width < targetWidth) {
                layer.resize(
                    (targetWidth + 0.01) * 100 / size.width,
                    (targetWidth + 0.01) * 100 / size.width,
                    AnchorPosition.MIDDLECENTER
                );
                size = layerSize(layer);
            }

            var targetHeight = Math.max(1, Math.round(size.height));
            var requiredHeight = y + targetHeight;
            if (requiredHeight > MAX_CANVAS_HEIGHT) {
                throw new Error(
                    "拼接后高度约为 " + requiredHeight +
                    " px，超过 Photoshop 画布高度上限 " +
                    MAX_CANVAS_HEIGHT + " px。请减少图片数量后分批拼接。"
                );
            }

            /*
             * 画布只向下扩展，已完成的图层位置不会变化。
             * 图片始终保留为嵌入式智能对象，后续缩放与替换均保持非破坏性。
             */
            target.resizeCanvas(
                UnitValue(targetWidth, "px"),
                UnitValue(requiredHeight, "px"),
                AnchorPosition.TOPCENTER
            );

            size = layerSize(layer);
            layer.translate(-size.left, y - size.top);

            layer.name =
                twoDigits(index + 1) + "_" +
                safeLayerName(displayFileName(file), "图片_" + (index + 1));
            moveLayerToBottom(target, layer);
            clearLayerClippingMask(layer);
            target.activeLayer = layer;

            return {
                height: targetHeight,
                layerId: activeLayerId(),
                usedFallback: sourceLayer.usedFallback
            };
        }

        function runActiveJob() {
            var job = activeJob;
            if (!job || !job.target) throw new Error("拼接任务不存在");

            var totalHeight = 0;
            var fallbackCount = 0;
            var sourceLayerIds = [];
            var index;

            app.activeDocument = job.target;
            for (index = 0; index < job.files.length; index += 1) {
                var imported = importOne(
                    job.target,
                    job.files[index],
                    job.width,
                    totalHeight,
                    index
                );
                totalHeight += imported.height;
                sourceLayerIds.push(imported.layerId);
                if (imported.usedFallback) fallbackCount += 1;
            }

            /*
             * 若最后一次计算存在亚像素差异，统一收口为整数高度。
             */
            job.target.resizeCanvas(
                UnitValue(job.width, "px"),
                UnitValue(Math.max(1, totalHeight), "px"),
                AnchorPosition.TOPCENTER
            );
            createStitchWhiteBackground(job.target);
            /* 白底移动后再解除一次，确保最后一张图片不会嵌入白底。 */
            clearStitchSourceClippingMasks(job.target, sourceLayerIds);

            /*
             * 创建白底会把锁定的“00_白色背景”留为当前图层。v2.2.02 恢复
             * 到最后一张拼图源图片，避免用户进入“间距”页后直接对着白底操作。
             */
            if (sourceLayerIds.length) {
                try {
                    var lastSourceLayer = findLayerById(
                        job.target,
                        sourceLayerIds[sourceLayerIds.length - 1]
                    );
                    if (lastSourceLayer) job.target.activeLayer = lastSourceLayer;
                } catch (ignoreRestoreStitchSelection) {}
            }

            var stitchSourceStateSaved = saveStitchSourceState(
                job.target,
                sourceLayerIds,
                job.files.length && job.files[0].parent
                    ? job.files[0].parent.fsName
                    : ""
            );
            var spacingStateSaved = initializeSpacingState(
                job.target,
                sourceLayerIds
            );
            job.result = {
                width: job.width,
                height: totalHeight,
                layers: job.files.length,
                smartObjects: job.files.length,
                fallbackCount: fallbackCount,
                stitchSourceStateSaved: stitchSourceStateSaved,
                spacingStateSaved: spacingStateSaved
            };
        }

        function findEntryById(entries, id) {
            var index;
            for (index = 0; index < entries.length; index += 1) {
                if (entries[index].id === id) return entries[index];
            }
            return null;
        }

        /*
         * v2.2.02：间距目标不再要求用户必须先点中原始拼图智能对象。
         * 当选中的是文字、形状、剪切层或后加装饰层时，优先按垂直重叠量
         * 映射到它视觉所在的拼图源图片；没有实际重叠时再取垂直中心最近项。
         */
        function resolveSpacingTargetEntry(document, entries, selectedId) {
            var exact = findEntryById(entries, selectedId);
            if (exact) {
                return {
                    entry: exact,
                    mapped: false,
                    selectedLayerName: exact.layer.name
                };
            }

            var selectedLayer = findLayerById(document, selectedId);
            if (!selectedLayer) return null;

            var selectedSize;
            try {
                selectedSize = layerSize(selectedLayer);
            } catch (ignoreSelectedBounds) {
                return null;
            }
            if (!(selectedSize.width > 0 && selectedSize.height > 0)) return null;

            var selectedTop = selectedSize.top;
            var selectedBottom = selectedSize.top + selectedSize.height;
            var selectedCenter = (selectedTop + selectedBottom) / 2;
            var best = null;
            var bestOverlap = -1;
            var bestDistance = Infinity;
            var index;

            for (index = 0; index < entries.length; index += 1) {
                var entry = entries[index];
                var size = entry.size || layerSize(entry.layer);
                var top = size.top;
                var bottom = size.top + size.height;
                var overlap = Math.max(0, Math.min(selectedBottom, bottom) - Math.max(selectedTop, top));
                var center = (top + bottom) / 2;
                var distance = Math.abs(center - selectedCenter);

                if (overlap > bestOverlap ||
                    (overlap === bestOverlap && distance < bestDistance)) {
                    best = entry;
                    bestOverlap = overlap;
                    bestDistance = distance;
                }
            }

            if (!best) return null;
            return {
                entry: best,
                mapped: true,
                selectedLayerName: selectedLayer.name,
                overlapPx: Math.max(0, Math.round(bestOverlap)),
                distancePx: Math.max(0, Math.round(bestDistance))
            };
        }

        function checkLayersUnlocked(entries) {
            var index;
            for (index = 0; index < entries.length; index += 1) {
                var layer = entries[index].layer;
                if (
                    layer.allLocked ||
                    layer.positionLocked
                ) {
                    throw new Error(
                        "图层“" + layer.name + "”已锁定，请先解锁后再调整间距"
                    );
                }
            }
        }

        function runSpacingJob() {
            var job = activeSpacingJob;
            if (!job || !job.document) throw new Error("间距调整任务不存在");

            var document = job.document;
            app.activeDocument = document;

            /*
             * v2.2.02：仅重排最初拼图导入的源图片。旧实现 collectImageLayers()
             * 会把锁定的“00_白色背景”和后加文字/装饰层一起收进来，最终在
             * checkLayersUnlocked() 阶段被白底锁定状态拦截，表现为“间距无法调整”。
             */
            var entries = collectSpacingSourceEntries(document);
            if (!entries.length) {
                throw new Error("当前文档中没有可调整的拼图源图片图层");
            }
            checkLayersUnlocked(entries);

            var resolvedTarget = resolveSpacingTargetEntry(
                document,
                entries,
                job.selectedId
            );
            if (!resolvedTarget || !resolvedTarget.entry) {
                throw new Error("无法定位当前内容对应的拼图源图片");
            }
            var selected = resolvedTarget.entry;
            var targetId = selected.id;

            var state = loadSpacingState(document);
            var index;
            for (index = 0; index < entries.length; index += 1) {
                var entryKey = String(entries[index].id);
                state.layers[entryKey] = normalizedSpacing(
                    state.layers[entryKey]
                );
            }

            var previousTargetSpacing = normalizedSpacing(
                state.layers[String(targetId)]
            );
            state.layers[String(targetId)] = {
                side: job.side,
                top: job.top,
                bottom: job.bottom
            };

            var canvasWidth = Math.round(pixels(document.width));
            var currentCanvasHeight = Math.round(pixels(document.height));
            var targetLayerWidth = canvasWidth - job.side * 2;
            if (targetLayerWidth < 1) {
                throw new Error(
                    "左右边距不能大于或等于 " +
                    Math.floor(canvasWidth / 2) + " px"
                );
            }

            document.activeLayer = selected.layer;
            var selectedSize = layerSize(selected.layer);
            var scalePercent = targetLayerWidth * 100 / selectedSize.width;
            if (Math.abs(scalePercent - 100) > 0.0001) {
                selected.layer.resize(
                    scalePercent,
                    scalePercent,
                    AnchorPosition.MIDDLECENTER
                );
            }

            selectedSize = layerSize(selected.layer);
            selected.layer.translate(
                job.side - selectedSize.left,
                0
            );

            /*
             * v2.2.03：上/下间距允许为负数。
             * 相邻图片的实际间隙 = 上一张 bottom + 当前张 top；负数会产生重叠。
             * 先在虚拟坐标中计算所有图片的位置和内容边界，再整体平移到 y >= 0，
             * 从而避免第一张设置负上间距时被 Photoshop 临时裁掉。最后一张的负下间距
             * 只参与与后续图片的关系，不会故意裁掉最后一张图片本身。
             */
            var layout = [];
            var cursor = 0;
            var minContentTop = Infinity;
            var maxContentBottom = -Infinity;
            var finalCursor = 0;

            for (index = 0; index < entries.length; index += 1) {
                var settings = normalizedSpacing(
                    state.layers[String(entries[index].id)]
                );
                entries[index].size = layerSize(entries[index].layer);
                var itemHeight = Math.max(1, Math.round(entries[index].size.height));

                cursor += settings.top;
                var desiredTop = cursor;
                var desiredBottom = desiredTop + itemHeight;
                layout.push({
                    entry: entries[index],
                    settings: settings,
                    top: desiredTop,
                    bottom: desiredBottom
                });

                if (desiredTop < minContentTop) minContentTop = desiredTop;
                if (desiredBottom > maxContentBottom) maxContentBottom = desiredBottom;

                cursor = desiredBottom + settings.bottom;
                finalCursor = cursor;
            }

            if (!isFinite(minContentTop)) minContentTop = 0;
            if (!isFinite(maxContentBottom)) maxContentBottom = 1;

            var minExtent = Math.min(0, minContentTop);
            var maxExtent = Math.max(maxContentBottom, finalCursor);
            var verticalShift = -minExtent;
            var totalHeight = Math.max(1, Math.round(maxExtent - minExtent));

            /*
             * 正数“下间距”是把后续内容向下推开。重排时不能因为顺便
             * 收口了旧画布中的空白而让用户看到总高度反而变短；这会被
             * 误认为正数仍在折叠。仅在本次下间距比该图层原值增加时，
             * 为画布保留至少相同的增量。减少数值或负数重叠仍允许收口。
             */
            var bottomIncrease = Math.max(0, job.bottom) -
                Math.max(0, previousTargetSpacing.bottom);
            if (bottomIncrease > 0) {
                totalHeight = Math.max(
                    totalHeight,
                    currentCanvasHeight + bottomIncrease
                );
            }

            if (totalHeight > MAX_CANVAS_HEIGHT) {
                throw new Error(
                    "调整后画布高度约为 " + totalHeight +
                    " px，超过 Photoshop 画布高度上限 " +
                    MAX_CANVAS_HEIGHT + " px"
                );
            }

            /*
             * 先扩展到安全画布，再按预计算坐标移动全部源图层，最后收口到精确高度。
             * 安全高度至少覆盖目标布局，负间距情况下也不会在移动过程中先裁图。
             */
            document.resizeCanvas(
                UnitValue(canvasWidth, "px"),
                UnitValue(
                    Math.max(currentCanvasHeight, totalHeight),
                    "px"
                ),
                AnchorPosition.TOPCENTER
            );

            for (index = 0; index < layout.length; index += 1) {
                var item = layout[index];
                var current = item.entry;
                var currentSettings = item.settings;
                var currentSize = layerSize(current.layer);
                var targetTop = item.top + verticalShift;

                current.layer.translate(
                    currentSettings.side - currentSize.left,
                    targetTop - currentSize.top
                );
            }

            document.resizeCanvas(
                UnitValue(canvasWidth, "px"),
                UnitValue(totalHeight, "px"),
                AnchorPosition.TOPCENTER
            );
            refreshStitchWhiteBackground(document);
            document.activeLayer = selected.layer;

            job.result = {
                layerName: selected.layer.name,
                side: job.side,
                top: job.top,
                bottom: job.bottom,
                bottomIncrease: bottomIncrease,
                width: canvasWidth,
                height: totalHeight,
                layers: entries.length,
                mappedFromLayer: resolvedTarget.mapped
                    ? String(resolvedTarget.selectedLayerName || "")
                    : "",
                mappedOverlapPx: resolvedTarget.mapped
                    ? Number(resolvedTarget.overlapPx || 0)
                    : 0,
                spacingStateSaved: saveSpacingState(document, state)
            };
        }

        function applyLayerSpacing(options) {
            if (!app.documents.length) {
                throw new Error("请先创建或打开分层长图");
            }

            var document = app.activeDocument;
            var selectedIds = selectedLayerIds();
            if (selectedIds.length !== 1) {
                throw new Error("请在 Photoshop 图层面板中只选择一个图片图层");
            }

            var side = integerValue(options && options.side, 0);
            var top = integerValue(options && options.top, 0);
            var bottom = integerValue(options && options.bottom, 0);
            var previousDialogs = app.displayDialogs;
            var previousHistory = document.activeHistoryState;
            var startedAt = (new Date()).getTime();

            try {
                app.displayDialogs = DialogModes.NO;
                activeSpacingJob = {
                    document: document,
                    selectedId: selectedIds[0],
                    side: side,
                    top: top,
                    bottom: bottom,
                    result: null
                };

                document.suspendHistory(
                    "调整图片间距",
                    "$.global.LongStitchCEP._runSpacingJob()"
                );
                if (!activeSpacingJob.result) {
                    throw new Error("Photoshop 未返回间距调整结果");
                }
                activeSpacingJob.result.elapsedMs =
                    (new Date()).getTime() - startedAt;
                return activeSpacingJob.result;
            } catch (error) {
                try {
                    document.activeHistoryState = previousHistory;
                } catch (ignoreRollback) {}
                throw error;
            } finally {
                activeSpacingJob = null;
                app.displayDialogs = previousDialogs;
            }
        }

        function uniqueIntegerValues(values) {
            values.sort(function (left, right) {
                return left - right;
            });
            var output = [];
            var index;
            for (index = 0; index < values.length; index += 1) {
                var value = Math.round(Number(values[index]));
                if (!isFinite(value)) continue;
                if (!output.length || output[output.length - 1] !== value) {
                    output.push(value);
                }
            }
            return output;
        }


        function enforceSmartSliceGuideSpacing(boundaries, canvasHeight) {
            // Final safety check before Photoshop creates guides/slices. This must
            // match the panel-side analyzer so no near-duplicate guide is restored.
            var minimumGap = 200;
            var maximumGap = 2500;
            var normalized = uniqueIntegerValues(boundaries || []);
            if (!normalized.length || normalized[0] !== 0) normalized.unshift(0);
            if (normalized[normalized.length - 1] !== canvasHeight) {
                normalized.push(canvasHeight);
            }

            var compact = [0];
            var index;
            for (index = 1; index < normalized.length - 1; index += 1) {
                var current = Math.max(0, Math.min(canvasHeight, normalized[index]));
                if (current - compact[compact.length - 1] < minimumGap) continue;
                compact.push(current);
            }
            if (
                compact.length > 1 &&
                canvasHeight - compact[compact.length - 1] < minimumGap
            ) {
                compact.pop();
            }
            compact.push(canvasHeight);

            var output = [0];
            for (index = 1; index < compact.length; index += 1) {
                var start = output[output.length - 1];
                var end = compact[index];
                var span = end - start;
                if (span > maximumGap) {
                    var pieces = Math.ceil(span / maximumGap);
                    var pieceIndex;
                    for (pieceIndex = 1; pieceIndex < pieces; pieceIndex += 1) {
                        var cut = Math.round(start + span * pieceIndex / pieces);
                        if (cut - output[output.length - 1] < minimumGap) continue;
                        output.push(cut);
                    }
                }
                if (end > output[output.length - 1]) output.push(end);
            }
            return uniqueIntegerValues(output);
        }

        /*
         * v1.6.9 及更早版本没有独立的拼图源记录。仅在兼容旧文档时，
         * 从最初的间距状态中恢复“序号名 + 智能对象”的源图层；文字、
         * 普通像素修复层和后加图层不会进入兼容结果。
         */
        function legacyStitchSourceIds(document) {
            var state = loadSpacingState(document);
            var output = [];
            var key;
            for (key in state.layers) {
                if (!state.layers.hasOwnProperty(key)) continue;
                var id = integerValue(key, -1);
                var layer = findLayerById(document, id);
                if (
                    layer &&
                    layer.typename === "ArtLayer" &&
                    isSmartObjectLayer(layer) &&
                    /^\d{2,}_/.test(String(layer.name || ""))
                ) {
                    output.push(id);
                }
            }
            return output;
        }

        function collectStitchSourceEntries(document) {
            var state = loadStitchSourceState(document);
            /*
             * 间距允许负数，图片一旦重叠就不能再以“当前 Y 坐标”推断
             * 拼图顺序。否则将某张图的下间距改为正数时，已经重叠的
             * 图层可能被重新排序，正间距会施加到错误的相邻图片上，表现为
             * 继续折叠。新建拼图时保存的 layerIds 本身就是从上到下的稳定
             * 源图顺序，必须优先保持它的原始顺序。
             */
            var hasRecordedOrder = state.layerIds && state.layerIds.length;
            var ids = hasRecordedOrder
                ? state.layerIds
                : legacyStitchSourceIds(document);
            var output = [];
            var seen = {};
            var index;

            for (index = 0; index < ids.length; index += 1) {
                var id = integerValue(ids[index], -1);
                if (id < 0 || seen[String(id)]) continue;
                seen[String(id)] = true;

                var layer = findLayerById(document, id);
                if (!layer || layer.typename !== "ArtLayer") continue;

                var size;
                try {
                    size = layerSize(layer);
                } catch (ignoreSourceBounds) {
                    continue;
                }
                if (!(size.width > 0 && size.height > 0)) continue;
                output.push({
                    id: id,
                    layer: layer,
                    size: size
                });
            }

            /* 旧 PSD 没有稳定源图记录时，才退回按当前视觉位置排序。 */
            if (!hasRecordedOrder) {
                output.sort(function (left, right) {
                    return left.size.top - right.size.top ||
                        left.size.left - right.size.left;
                });
            }
            return output;
        }

        /*
         * v2.2.02 间距专用图层集合。优先使用拼图时写入 XMP 的稳定源图层 ID，
         * 这样后加文字、修复层、剪切层和锁定白底都不会被误移动。
         * 对极老 PSD 没有 stitchSourceState 的情况，仅回退到“序号名 + 智能对象”。
         */
        function collectSpacingSourceEntries(document) {
            var entries = collectStitchSourceEntries(document);
            if (entries.length) return entries;

            var all = collectImageLayers(document);
            var output = [];
            var index;
            for (index = 0; index < all.length; index += 1) {
                var layer = all[index].layer;
                var name = String(layer && layer.name || "");
                if (name === "00_白色背景") continue;
                if (!/^\d{2,}_/.test(name)) continue;
                if (!isSmartObjectLayer(layer)) continue;
                output.push(all[index]);
            }
            output.sort(function (left, right) {
                return left.size.top - right.size.top ||
                    left.size.left - right.size.left;
            });
            return output;
        }

        function refreshStitchWhiteBackground(document) {
            var background = null;
            var index;
            for (index = 0; index < document.layers.length; index += 1) {
                if (String(document.layers[index].name || "") === "00_白色背景") {
                    background = document.layers[index];
                    break;
                }
            }
            if (!background || background.typename !== "ArtLayer") return false;

            var wasLocked = false;
            try { wasLocked = !!background.allLocked; } catch (ignoreReadBgLock) {}
            try { background.allLocked = false; } catch (ignoreUnlockBg) {}

            var previous = document.activeLayer;
            try {
                document.activeLayer = background;
                var white = new SolidColor();
                white.rgb.red = 255;
                white.rgb.green = 255;
                white.rgb.blue = 255;
                document.selection.selectAll();
                document.selection.fill(white, ColorBlendMode.NORMAL, 100, false);
                document.selection.deselect();
                moveLayerToBottom(document, background);
                return true;
            } catch (ignoreRefreshBackground) {
                try { document.selection.deselect(); } catch (ignoreBgDeselect) {}
                return false;
            } finally {
                try { background.allLocked = true; } catch (ignoreRelockBg) {}
                try { if (previous && previous !== background) document.activeLayer = previous; } catch (ignoreRestoreBgActive) {}
            }
        }

        function clippedSliceLayerSize(layer, canvasWidth, canvasHeight) {
            var size = layerSize(layer);
            var left = Math.max(0, Math.min(canvasWidth, size.left));
            var top = Math.max(0, Math.min(canvasHeight, size.top));
            var right = Math.max(
                0,
                Math.min(canvasWidth, size.left + size.width)
            );
            var bottom = Math.max(
                0,
                Math.min(canvasHeight, size.top + size.height)
            );
            return {
                left: left,
                top: top,
                width: Math.max(0, right - left),
                height: Math.max(0, bottom - top)
            };
        }

        function smartSliceLayerKind(layer) {
            if (layer.typename === "LayerSet") return "group";
            if (layer.typename !== "ArtLayer") return "other";
            try {
                if (layer.kind === LayerKind.TEXT) return "text";
                if (
                    layer.kind === LayerKind.SOLIDFILL ||
                    layer.kind === LayerKind.GRADIENTFILL ||
                    layer.kind === LayerKind.PATTERNFILL
                ) {
                    return "shape";
                }
            } catch (ignoreSliceLayerKind) {}
            return "image";
        }

        /*
         * 分层 PSD 的图层提示只用于保护完整内容板块，不直接生成切片。
         * 高度适中的图层组视为一个原子板块；覆盖大部分长图的总组或背景
         * 会继续向下展开，避免一个全画布组阻止所有候选切口。
         */
        function collectSmartSliceLayerHints(document) {
            var canvasWidth = Math.max(1, pixels(document.width));
            var canvasHeight = Math.max(1, pixels(document.height));
            var output = [];

            function walk(container, depth, parentId) {
                var index;
                for (index = 0; index < container.layers.length; index += 1) {
                    var layer = container.layers[index];
                    try {
                        if (!layer.visible) continue;
                    } catch (ignoreVisibility) {}

                    var size;
                    try {
                        size = clippedSliceLayerSize(
                            layer,
                            canvasWidth,
                            canvasHeight
                        );
                    } catch (ignoreHintBounds) {
                        continue;
                    }
                    if (!(size.width > 1 && size.height > 1)) continue;

                    var kind = smartSliceLayerKind(layer);
                    var layerId = -1;
                    try {
                        layerId = layer.id;
                    } catch (ignoreHintId) {}

                    if (layer.typename === "LayerSet") {
                        var name = String(layer.name || "");
                        var namedSection = /屏|模块|海报|场景|参数|优势|工厂|流程|页尾|section|screen|banner|module/i.test(
                            name
                        );
                        var atomicHeight = Math.max(
                            canvasWidth * 2.8,
                            900
                        );
                        var atomic = (
                            size.height <= atomicHeight ||
                            (
                                namedSection &&
                                size.height <= canvasWidth * 4
                            )
                        ) && size.height < canvasHeight * 0.72;

                        if (atomic) {
                            output.push({
                                id: layerId,
                                name: name,
                                kind: "group",
                                depth: depth,
                                parentId: parentId,
                                atomic: true,
                                left: size.left,
                                top: size.top,
                                width: size.width,
                                height: size.height
                            });
                        } else {
                            walk(layer, depth + 1, layerId);
                        }
                        continue;
                    }

                    output.push({
                        id: layerId,
                        name: String(layer.name || ""),
                        kind: kind,
                        depth: depth,
                        parentId: parentId,
                        atomic: false,
                        left: size.left,
                        top: size.top,
                        width: size.width,
                        height: size.height
                    });
                }
            }

            walk(document, 0, -1);
            output.sort(function (left, right) {
                return left.top - right.top ||
                    left.left - right.left ||
                    left.depth - right.depth;
            });
            return output;
        }

        function prepareSmartSliceAnalysis() {
            if (!app.documents.length) {
                throw new Error("请先打开需要切片的长图或分层 PSD");
            }

            var document = app.activeDocument;
            var canvasWidth = Math.max(
                1,
                Math.round(pixels(document.width))
            );
            var canvasHeight = Math.max(
                1,
                Math.round(pixels(document.height))
            );
            var stitchEntries = collectStitchSourceEntries(document);
            if (stitchEntries.length) {
                return {
                    mode: "stitch",
                    documentId: currentDocumentIdFor(document),
                    width: canvasWidth,
                    height: canvasHeight,
                    sources: stitchEntries.length
                };
            }

            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var temporary = null;
            var tempFile = new File(
                Folder.temp.fsName + "/ps_smart_slice_" +
                (new Date()).getTime() + ".png"
            );

            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                try {
                    temporary = document.duplicate(
                        "智能切片_临时分析图",
                        true
                    );
                } catch (duplicateMergedError) {
                    temporary = document.duplicate("智能切片_临时分析图");
                    temporary.flatten();
                }
                app.activeDocument = temporary;

                try {
                    if (temporary.mode !== DocumentMode.RGB) {
                        temporary.changeMode(ChangeMode.RGB);
                    }
                } catch (ignorePreviewMode) {}
                try {
                    temporary.bitsPerChannel = BitsPerChannelType.EIGHT;
                } catch (ignorePreviewBits) {}

                var maxPreviewWidth = 480;
                var maxPreviewHeight = 24000;
                var scale = Math.min(
                    1,
                    maxPreviewWidth / canvasWidth,
                    maxPreviewHeight / canvasHeight
                );
                var previewWidth = Math.max(
                    2,
                    Math.round(canvasWidth * scale)
                );
                var previewHeight = Math.max(
                    2,
                    Math.round(canvasHeight * scale)
                );
                if (
                    previewWidth !== canvasWidth ||
                    previewHeight !== canvasHeight
                ) {
                    temporary.resizeImage(
                        UnitValue(previewWidth, "px"),
                        UnitValue(previewHeight, "px"),
                        document.resolution,
                        ResampleMethod.BICUBIC
                    );
                }

                var pngOptions = new PNGSaveOptions();
                pngOptions.interlaced = false;
                temporary.saveAs(
                    tempFile,
                    pngOptions,
                    true,
                    Extension.LOWERCASE
                );

                return {
                    mode: "smart",
                    documentId: currentDocumentIdFor(document),
                    width: canvasWidth,
                    height: canvasHeight,
                    previewWidth: previewWidth,
                    previewHeight: previewHeight,
                    tempPath: tempFile.fsName,
                    fileName: tempFile.name,
                    layerHints: collectSmartSliceLayerHints(document)
                };
            } finally {
                if (temporary) {
                    try {
                        temporary.close(SaveOptions.DONOTSAVECHANGES);
                    } catch (ignoreCloseSlicePreview) {}
                }
                try {
                    app.activeDocument = document;
                } catch (ignoreRestoreSliceDocument) {}
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function clearAllDocumentGuides() {
            try {
                executeAction(
                    stringIDToTypeID("clearAllGuides"),
                    undefined,
                    DialogModes.NO
                );
            } catch (ignoreClearGuidesAction) {
                try {
                    app.activeDocument.guides.removeAll();
                } catch (ignoreClearGuidesDom) {}
            }
        }

        function clearAllDocumentSlices() {
            var reference = new ActionReference();
            reference.putEnumerated(
                stringIDToTypeID("slice"),
                stringIDToTypeID("ordinal"),
                stringIDToTypeID("allEnum")
            );
            var descriptor = new ActionDescriptor();
            descriptor.putReference(stringIDToTypeID("target"), reference);
            executeAction(
                stringIDToTypeID("delete"),
                descriptor,
                DialogModes.NO
            );
        }

        function makeSlicesFromGuides() {
            var reference = new ActionReference();
            reference.putClass(stringIDToTypeID("slice"));
            var descriptor = new ActionDescriptor();
            descriptor.putReference(stringIDToTypeID("target"), reference);
            descriptor.putClass(
                stringIDToTypeID("using"),
                stringIDToTypeID("guides")
            );
            executeAction(
                stringIDToTypeID("make"),
                descriptor,
                DialogModes.NO
            );
        }

        function runSliceJob() {
            var job = activeSliceJob;
            if (!job || !job.document) throw new Error("切片任务不存在");

            var document = job.document;
            app.activeDocument = document;
            var canvasHeight = Math.max(
                1,
                Math.round(pixels(document.height))
            );
            var entries = [];
            var boundaries = [];
            var index;

            if (job.boundaries && job.boundaries.length) {
                boundaries.push(0);
                boundaries.push(canvasHeight);
                for (
                    index = 0;
                    index < job.boundaries.length;
                    index += 1
                ) {
                    boundaries.push(
                        Math.max(
                            0,
                            Math.min(
                                canvasHeight,
                                Math.round(Number(job.boundaries[index]))
                            )
                        )
                    );
                }
            } else {
                entries = collectStitchSourceEntries(document);
                if (!entries.length) {
                    throw new Error(
                        "当前文档中没有找到由拼图功能导入的原始图片图层"
                    );
                }
                boundaries = [0, canvasHeight];
                for (index = 0; index < entries.length; index += 1) {
                    var top = Math.max(
                        0,
                        Math.min(
                            canvasHeight,
                            Math.round(entries[index].size.top)
                        )
                    );
                    var bottom = Math.max(
                        0,
                        Math.min(
                            canvasHeight,
                            Math.round(
                                entries[index].size.top +
                                entries[index].size.height
                            )
                        )
                    );
                    if (bottom <= top) continue;
                    boundaries.push(top);
                    boundaries.push(bottom);
                }
            }
            boundaries = uniqueIntegerValues(boundaries);
            if (job.boundaries && job.boundaries.length) {
                boundaries = enforceSmartSliceGuideSpacing(
                    boundaries,
                    canvasHeight
                );
            }
            if (boundaries.length < 2) {
                throw new Error("没有找到可用的智能切片边界");
            }

            /*
             * 必须先清除当前参考线和旧切片，否则 Photoshop 的“从参考线
             * 建立切片”会把用户后加参考线也一起计算，造成额外切片。
             */
            clearAllDocumentGuides();
            try {
                clearAllDocumentSlices();
            } catch (ignoreClearSlices) {}

            var guideCount = 0;
            for (index = 0; index < boundaries.length; index += 1) {
                var y = boundaries[index];
                if (y <= 0 || y >= canvasHeight) continue;
                document.guides.add(
                    Direction.HORIZONTAL,
                    UnitValue(y, "px")
                );
                guideCount += 1;
            }

            if (guideCount) {
                makeSlicesFromGuides();
            }

            job.result = {
                sources: entries.length,
                mode: job.boundaries && job.boundaries.length
                    ? "smart"
                    : "stitch",
                guides: guideCount,
                slices: Math.max(1, boundaries.length - 1),
                boundaries: boundaries
            };
        }

        function createStitchSlices() {
            if (!app.documents.length) {
                throw new Error("请先创建或打开由拼图功能生成的分层长图");
            }

            var document = app.activeDocument;
            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var previousHistory = document.activeHistoryState;
            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                activeSliceJob = {
                    document: document,
                    result: null
                };
                document.suspendHistory(
                    "按拼图图片边缘生成参考线和切片",
                    "$.global.LongStitchCEP._runSliceJob()"
                );
                if (!activeSliceJob.result) {
                    throw new Error("Photoshop 未返回切片结果");
                }
                return activeSliceJob.result;
            } catch (error) {
                try {
                    document.activeHistoryState = previousHistory;
                } catch (ignoreSliceRollback) {}
                throw error;
            } finally {
                activeSliceJob = null;
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function createSmartSlices(options) {
            if (!app.documents.length) {
                throw new Error("请先打开需要切片的长图或分层 PSD");
            }
            var document = app.activeDocument;
            var requestedDocumentId = integerValue(
                options && options.documentId,
                -1
            );
            if (
                requestedDocumentId > 0 &&
                currentDocumentIdFor(document) !== requestedDocumentId
            ) {
                throw new Error("分析期间 Photoshop 文档已切换，请重新切片");
            }

            var boundaries = options && options.boundaries;
            if (!(boundaries instanceof Array) || boundaries.length < 2) {
                throw new Error("没有找到足够可靠的内容板块切口");
            }

            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var previousHistory = document.activeHistoryState;
            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                activeSliceJob = {
                    document: document,
                    boundaries: boundaries,
                    result: null
                };
                document.suspendHistory(
                    "按内容板块智能生成参考线和切片",
                    "$.global.LongStitchCEP._runSliceJob()"
                );
                if (!activeSliceJob.result) {
                    throw new Error("Photoshop 未返回智能切片结果");
                }
                return activeSliceJob.result;
            } catch (error) {
                try {
                    document.activeHistoryState = previousHistory;
                } catch (ignoreSmartSliceRollback) {}
                throw error;
            } finally {
                activeSliceJob = null;
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function sliceDescriptorNumber(descriptor, key) {
            try { return descriptor.getInteger(key); } catch (ignoreInteger) {}
            try { return descriptor.getDouble(key); } catch (ignoreDouble) {}
            try { return descriptor.getUnitDoubleValue(key); } catch (ignoreUnitDouble) {}
            return 0;
        }

        function sliceDescriptorEnum(descriptor, key) {
            try {
                var value = descriptor.getEnumerationValue(key);
                var text = typeIDToStringID(value);
                if (text) return text;
                return typeIDToCharID(value);
            } catch (ignoreSliceEnum) {
                return "";
            }
        }

        function collectDocumentSlices(document) {
            var originalDocument = app.activeDocument;
            var output = [];
            try {
                app.activeDocument = document;
                var reference = new ActionReference();
                reference.putEnumerated(
                    stringIDToTypeID("document"),
                    stringIDToTypeID("ordinal"),
                    stringIDToTypeID("targetEnum")
                );
                var documentDescriptor = executeActionGet(reference);
                var slicesKey = stringIDToTypeID("slices");
                if (!documentDescriptor.hasKey(slicesKey)) return output;
                var slicesContainer = documentDescriptor.getObjectValue(slicesKey);
                if (!slicesContainer.hasKey(slicesKey)) return output;
                var sliceDescriptors = slicesContainer.getList(slicesKey);
                var index;
                for (index = 0; index < sliceDescriptors.count; index += 1) {
                    var current = sliceDescriptors.getObjectValue(index);
                    var boundsKey = stringIDToTypeID("bounds");
                    if (!current.hasKey(boundsKey)) continue;
                    var bounds = current.getObjectValue(boundsKey);
                    var item = {
                        id: 0,
                        group: 0,
                        name: "",
                        type: "",
                        origin: "",
                        top: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("top"))),
                        left: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("left"))),
                        bottom: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("bottom"))),
                        right: Math.round(sliceDescriptorNumber(bounds, stringIDToTypeID("right")))
                    };
                    try { item.id = current.getInteger(stringIDToTypeID("sliceID")); } catch (ignoreSliceId) {}
                    try { item.group = current.getInteger(stringIDToTypeID("groupID")); } catch (ignoreSliceGroup) {}
                    try {
                        if (current.hasKey(stringIDToTypeID("name"))) {
                            item.name = current.getString(stringIDToTypeID("name"));
                        }
                    } catch (ignoreSliceName) {}
                    item.type = sliceDescriptorEnum(current, stringIDToTypeID("type"));
                    item.origin = sliceDescriptorEnum(current, stringIDToTypeID("origin"));
                    if (item.right > item.left && item.bottom > item.top) {
                        output.push(item);
                    }
                }
            } finally {
                try { app.activeDocument = originalDocument; } catch (ignoreRestoreSliceDocument) {}
            }
            output.sort(function (left, right) {
                return left.top - right.top || left.left - right.left || left.id - right.id;
            });
            return output;
        }

        function sliceDescriptorBounds(descriptor) {
            if (!descriptor) return null;
            var top = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("top")));
            var left = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("left")));
            var bottom = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("bottom")));
            var right = Math.round(sliceDescriptorNumber(descriptor, stringIDToTypeID("right")));
            if (!(right > left && bottom > top)) return null;
            return { top: top, left: left, bottom: bottom, right: right };
        }

        function sliceDescriptorObjectBounds(descriptor, keyName) {
            try {
                var key = stringIDToTypeID(keyName);
                if (!descriptor.hasKey(key)) return null;
                return sliceDescriptorBounds(descriptor.getObjectValue(key));
            } catch (ignoreSliceObjectBounds) {
                return null;
            }
        }

        function sliceArtboardInfo(document, layer, index) {
            if (!layer || layer.typename !== "LayerSet") return null;
            try {
                app.activeDocument = document;
                document.activeLayer = layer;
                var reference = new ActionReference();
                reference.putEnumerated(
                    stringIDToTypeID("layer"),
                    stringIDToTypeID("ordinal"),
                    stringIDToTypeID("targetEnum")
                );
                var descriptor = executeActionGet(reference);
                var enabledKey = stringIDToTypeID("artboardEnabled");
                if (!descriptor.hasKey(enabledKey) || !descriptor.getBoolean(enabledKey)) return null;

                var bounds = null;
                var artboardKey = stringIDToTypeID("artboard");
                if (descriptor.hasKey(artboardKey)) {
                    try {
                        var artboard = descriptor.getObjectValue(artboardKey);
                        bounds = sliceDescriptorObjectBounds(artboard, "artboardRect");
                        if (!bounds) bounds = sliceDescriptorBounds(artboard);
                    } catch (ignoreArtboardObject) {}
                }
                if (!bounds) bounds = sliceDescriptorObjectBounds(descriptor, "artboardRect");
                if (!bounds) bounds = sliceDescriptorObjectBounds(descriptor, "boundsNoEffects");
                if (!bounds) bounds = sliceDescriptorObjectBounds(descriptor, "bounds");
                if (!bounds) {
                    try {
                        var domBounds = layer.bounds;
                        bounds = {
                            left: Math.round(pixels(domBounds[0])),
                            top: Math.round(pixels(domBounds[1])),
                            right: Math.round(pixels(domBounds[2])),
                            bottom: Math.round(pixels(domBounds[3]))
                        };
                    } catch (ignoreArtboardDomBounds) {}
                }
                if (!bounds || !(bounds.right > bounds.left && bounds.bottom > bounds.top)) return null;
                return {
                    index: index,
                    id: layer.id || 0,
                    name: String(layer.name || ("画板_" + index)),
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                };
            } catch (ignoreArtboardDescriptor) {
                return null;
            }
        }

        function collectDocumentArtboards(document) {
            var previousDocument = app.activeDocument;
            var selectedIds = [];
            var output = [];
            try {
                app.activeDocument = document;
                try { selectedIds = selectedLayerIds(); } catch (ignoreSelectedArtboards) {}
                var index;
                for (index = 0; index < document.layers.length; index += 1) {
                    var item = sliceArtboardInfo(document, document.layers[index], output.length + 1);
                    if (item) output.push(item);
                }
            } finally {
                try {
                    app.activeDocument = document;
                    if (selectedIds.length) selectLayersByIds(selectedIds);
                } catch (ignoreRestoreArtboardSelection) {}
                try { app.activeDocument = previousDocument; } catch (ignoreRestoreArtboardDocument) {}
            }
            output.sort(function (left, right) {
                return left.top - right.top || left.left - right.left || left.index - right.index;
            });
            return output;
        }

        function sliceIsOnlyAutomaticCanvasSlice(slices, canvasWidth, canvasHeight) {
            if (!slices || slices.length !== 1) return false;
            var item = slices[0];
            /* 单个覆盖整张画布的切片，无论来源字段是否可用，导出结果都等同当前画布。 */
            return item.left <= 0 && item.top <= 0 &&
                item.right >= canvasWidth && item.bottom >= canvasHeight;
        }

        function sliceSafeFileName(value, fallback) {
            var name = String(value || fallback || "导出");
            name = name.replace(/[\\\/:*?"<>|]/g, "_");
            name = name.replace(/^\s+|\s+$/g, "").replace(/[\.\s]+$/g, "");
            if (!name) name = String(fallback || "导出");
            if (name.length > 80) name = name.slice(0, 80);
            return name;
        }

        function sliceUniqueOutputFile(folder, baseName, extension) {
            var safeBase = sliceSafeFileName(baseName, "导出");
            var ext = String(extension || "png").replace(/^\./, "");
            var file = new File(folder.fsName + "/" + safeBase + "." + ext);
            var serial = 2;
            while (file.exists) {
                file = new File(folder.fsName + "/" + safeBase + "_" + serial + "." + ext);
                serial += 1;
                if (serial > 10000) throw new Error("同名导出文件过多，请清理导出目录");
            }
            return file;
        }

        function sliceSaveForWebJpeg(document, outputFile, quality) {
            var webQuality = Math.max(55, Math.min(95, Math.round(Number(quality) || 82)));
            try { if (document.mode !== DocumentMode.RGB) document.changeMode(ChangeMode.RGB); } catch (ignoreSliceWebMode) {}
            try { document.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreSliceWebBits) {}
            /* JPEG 不支持透明区域：以白色合成，避免导出出现黑底。 */
            fillDocumentWhite(document);
            try {
                document.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, false);
            } catch (ignoreSliceWebProfile) {}
            var web = new ExportOptionsSaveForWeb();
            web.format = SaveDocumentType.JPEG;
            web.quality = webQuality;
            web.optimized = true;
            web.includeProfile = false;
            web.interlaced = false;
            web.transparency = false;
            try { web.blur = 0; } catch (ignoreSliceWebBlur) {}
            document.exportDocument(outputFile, ExportType.SAVEFORWEB, web);
        }

        function getSliceExportDefaultFolder() {
            var folder = null;
            var source = "desktop";
            if (app.documents.length) {
                var document = app.activeDocument;
                /* 用户点击导出时，保存过的当前 PSD/PSB 所在目录始终优先。 */
                try {
                    if (document.path && document.path.exists) {
                        folder = document.path;
                        source = "document";
                    }
                } catch (ignoreUnsavedDocumentPath) {}
                /* 未保存的新文档才回退到拼图导入素材所在目录。 */
                if (!folder) {
                    var stitchState = loadStitchSourceState(document);
                    if (stitchState.sourceFolder) {
                        var importedFolder = new Folder(stitchState.sourceFolder);
                        if (importedFolder.exists) {
                            folder = importedFolder;
                            source = "import";
                        }
                    }
                }
            }
            if (!folder) folder = Folder.desktop;
            return {
                path: folder.fsName,
                source: source
            };
        }

        function exportDocumentSlices(options) {
            if (!app.documents.length) {
                throw new Error("请先打开需要导出的 Photoshop 文档");
            }
            options = options || {};
            var webQuality = Math.max(55, Math.min(95, Math.round(Number(options.quality) || 82)));
            var folderPath = String(options.folder || options.path || "").replace(/^\s+|\s+$/g, "");
            if (!folderPath) throw new Error("请选择导出文件夹");
            var selectedFolder = new Folder(folderPath);
            if (!selectedFolder.exists && !selectedFolder.create()) {
                throw new Error("无法创建所选导出文件夹：" + selectedFolder.fsName);
            }

            var sourceDocument = app.activeDocument;
            var canvasWidth = Math.max(1, Math.round(pixels(sourceDocument.width)));
            var canvasHeight = Math.max(1, Math.round(pixels(sourceDocument.height)));
            var artboards = collectDocumentArtboards(sourceDocument);
            var slices = [];
            var sliceReadFallback = false;
            /*
             * 切片描述读取在部分 Photoshop 版本/文档中可能不存在或返回异常结构。
             * 这里绝不再把“没有用户切片”视为错误：读取不到切片就按完整画布导出。
             */
            if (!artboards.length) {
                try {
                    slices = collectDocumentSlices(sourceDocument) || [];
                } catch (ignoreCollectDocumentSlices) {
                    slices = [];
                    sliceReadFallback = true;
                }
            }
            var mode = "slices";
            if (artboards.length) {
                mode = "artboards";
            } else if (!slices.length || sliceIsOnlyAutomaticCanvasSlice(slices, canvasWidth, canvasHeight)) {
                mode = "canvas";
                slices = [];
            }

            /* 单张结果直接导出至用户所选文件夹；多张结果才建立批次子文件夹。 */
            var plannedOutputCount = mode === "canvas" ? 1 : 0;
            var outputIndex;
            var sourceItems = mode === "artboards" ? artboards : slices;
            if (mode !== "canvas") {
                for (outputIndex = 0; outputIndex < sourceItems.length; outputIndex += 1) {
                    if (
                        sourceItems[outputIndex].right > sourceItems[outputIndex].left &&
                        sourceItems[outputIndex].bottom > sourceItems[outputIndex].top
                    ) {
                        plannedOutputCount += 1;
                    }
                }
            }

            var baseExportFolderName = mode === "artboards"
                ? "画板导出"
                : (canvasWidth === 790 ? "详情页切片" : (canvasWidth === 1920 ? "首页切片" : "切片"));
            var exportFolderName = baseExportFolderName;
            var exportFolder = selectedFolder;
            var folderSerial = 2;
            if (plannedOutputCount !== 1) {
                exportFolder = new Folder(selectedFolder.fsName + "/" + exportFolderName);
                while (exportFolder.exists) {
                    exportFolderName = baseExportFolderName + "_" + folderSerial;
                    exportFolder = new Folder(selectedFolder.fsName + "/" + exportFolderName);
                    folderSerial += 1;
                    if (folderSerial > 10000) {
                        throw new Error("同名导出文件夹过多，请更换导出位置");
                    }
                }
                if (!exportFolder.create()) {
                    throw new Error("无法创建导出文件夹：" + exportFolder.fsName);
                }
            }

            var previousDialogs = app.displayDialogs;
            var previousUnits = app.preferences.rulerUnits;
            var flattenedSource = null;
            var outputDocument = null;
            var exportedFiles = [];
            try {
                app.displayDialogs = DialogModes.NO;
                app.preferences.rulerUnits = Units.PIXELS;
                flattenedSource = sourceDocument.duplicate("__鑫洋切片导出源__", true);
                try {
                    if (flattenedSource.mode !== DocumentMode.RGB) flattenedSource.changeMode(ChangeMode.RGB);
                } catch (ignoreSliceExportMode) {}
                try { flattenedSource.bitsPerChannel = BitsPerChannelType.EIGHT; } catch (ignoreSliceExportBits) {}

                var index;
                if (mode === "canvas") {
                    app.activeDocument = flattenedSource;
                    var canvasFile = sliceUniqueOutputFile(exportFolder, "画布", "jpg");
                    sliceSaveForWebJpeg(flattenedSource, canvasFile, webQuality);
                    exportedFiles.push(canvasFile.name);
                } else if (mode === "artboards") {
                    for (index = 0; index < artboards.length; index += 1) {
                        var board = artboards[index];
                        if (!(board.right > board.left && board.bottom > board.top)) continue;
                        app.activeDocument = flattenedSource;
                        outputDocument = flattenedSource.duplicate("__画板_" + (index + 1) + "__", true);
                        outputDocument.crop([
                            UnitValue(board.left, "px"),
                            UnitValue(board.top, "px"),
                            UnitValue(board.right, "px"),
                            UnitValue(board.bottom, "px")
                        ]);
                        var boardFile = sliceUniqueOutputFile(
                            exportFolder,
                            sliceSafeFileName(board.name, "画板_" + (index + 1)),
                            "jpg"
                        );
                        sliceSaveForWebJpeg(outputDocument, boardFile, webQuality);
                        exportedFiles.push(boardFile.name);
                        outputDocument.close(SaveOptions.DONOTSAVECHANGES);
                        outputDocument = null;
                    }
                } else {
                    for (index = 0; index < slices.length; index += 1) {
                        var item = slices[index];
                        var left = Math.max(0, Math.min(canvasWidth - 1, item.left));
                        var top = Math.max(0, Math.min(canvasHeight - 1, item.top));
                        var right = Math.max(left + 1, Math.min(canvasWidth, item.right));
                        var bottom = Math.max(top + 1, Math.min(canvasHeight, item.bottom));
                        if (!(right > left && bottom > top)) continue;

                        app.activeDocument = flattenedSource;
                        outputDocument = flattenedSource.duplicate("__切片_" + (index + 1) + "__", true);
                        outputDocument.crop([
                            UnitValue(left, "px"),
                            UnitValue(top, "px"),
                            UnitValue(right, "px"),
                            UnitValue(bottom, "px")
                        ]);
                        var outputFile = sliceUniqueOutputFile(exportFolder, "切片_" + (exportedFiles.length + 1), "jpg");
                        sliceSaveForWebJpeg(outputDocument, outputFile, webQuality);
                        exportedFiles.push(outputFile.name);
                        outputDocument.close(SaveOptions.DONOTSAVECHANGES);
                        outputDocument = null;
                    }
                }

                if (!exportedFiles.length) {
                    throw new Error(mode === "artboards" ? "没有识别到可导出的有效画板" : "没有导出任何图片");
                }
                return {
                    count: exportedFiles.length,
                    folder: exportFolder.fsName,
                    files: exportedFiles.slice(0, 50),
                    mode: mode,
                    format: "jpg",
                    quality: webQuality,
                    sourceFolder: selectedFolder.fsName,
                    usedSourceFolderDirectly: plannedOutputCount === 1,
                    sliceReadFallback: sliceReadFallback
                };
            } finally {
                if (outputDocument) {
                    try { outputDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseSliceOutput) {}
                }
                if (flattenedSource) {
                    try { flattenedSource.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreCloseFlattenedSource) {}
                }
                try { app.activeDocument = sourceDocument; } catch (ignoreRestoreSourceDocument) {}
                app.preferences.rulerUnits = previousUnits;
                app.displayDialogs = previousDialogs;
            }
        }

        function createLongStitch(options) {
            var paths = options && options.files ? options.files : [];
            var targetWidth = integerValue(options && options.width, 790);
            var previousDialogs = app.displayDialogs;
            var target = null;
            var files = [];
            var startedAt = (new Date()).getTime();
            var index;

            if (!paths.length) throw new Error("请先拖入需要拼接的图片");
            if (targetWidth !== 790 && targetWidth !== 1920) {
                throw new Error("画布宽度只支持 790px 或 1920px");
            }

            /*
             * 在创建文档前一次性确认文件存在，避免路径错误留下半成品。
             */
            for (index = 0; index < paths.length; index += 1) {
                files.push(fileObject(paths[index]));
            }

            try {
                app.displayDialogs = DialogModes.NO;
                var documentName = targetWidth === 790 ? "模板" : "首页";
                target = app.documents.add(
                    UnitValue(targetWidth, "px"),
                    UnitValue(INITIAL_CANVAS_HEIGHT, "px"),
                    72,
                    documentName,
                    NewDocumentMode.RGB,
                    DocumentFill.TRANSPARENT
                );

                activeJob = {
                    target: target,
                    files: files,
                    width: targetWidth,
                    result: null
                };

                /*
                 * 所有置入、缩放与定位合并成一条历史记录，
                 * 显著减少 Photoshop 逐步记录和重绘的开销。
                 */
                target.suspendHistory(
                    "创建 " + targetWidth + "px 分层长图",
                    "$.global.LongStitchCEP._runActiveJob()"
                );

                if (!activeJob.result) throw new Error("Photoshop 未返回拼接结果");
                activeJob.result.elapsedMs = (new Date()).getTime() - startedAt;
                app.activeDocument = target;
                return activeJob.result;
            } catch (error) {
                if (target) {
                    try {
                        target.close(SaveOptions.DONOTSAVECHANGES);
                    } catch (ignoreClose) {}
                }
                throw error;
            } finally {
                activeJob = null;
                app.displayDialogs = previousDialogs;
            }
        }

    return {
            runActiveJob: runActiveJob,
            runSpacingJob: runSpacingJob,
            applyLayerSpacing: applyLayerSpacing,
            collectSpacingSourceEntries: collectSpacingSourceEntries,
            prepareSmartSliceAnalysis: prepareSmartSliceAnalysis,
            runSliceJob: runSliceJob,
            createStitchSlices: createStitchSlices,
            createSmartSlices: createSmartSlices,
            getSliceExportDefaultFolder: getSliceExportDefaultFolder,
            exportDocumentSlices: exportDocumentSlices,
            createLongStitch: createLongStitch
    };
};
