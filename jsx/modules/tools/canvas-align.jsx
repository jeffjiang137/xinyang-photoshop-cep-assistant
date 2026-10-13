/* Canvas alignment: bounded descriptor reads and one native move. */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}
XinyangHostModules.canvasAlign = function (deps) {
    var key = stringIDToTypeID;

    function moveSelection(dx, dy) {
        var ref = new ActionReference();
        ref.putEnumerated(key("layer"), key("ordinal"), key("targetEnum"));
        var action = new ActionDescriptor();
        action.putReference(key("null"), ref);
        var offset = new ActionDescriptor();
        offset.putUnitDouble(key("horizontal"), key("pixelsUnit"), dx);
        offset.putUnitDouble(key("vertical"), key("pixelsUnit"), dy);
        action.putObject(key("to"), key("offset"), offset);
        executeAction(key("move"), action, DialogModes.NO);
    }

    function sameLayerIds(first, second) {
        if (first.length !== second.length) return false;
        var found = {}, index;
        for (index = 0; index < first.length; index += 1) found["id_" + first[index]] = true;
        for (index = 0; index < second.length; index += 1) {
            if (!found["id_" + second[index]]) return false;
        }
        return true;
    }

    function alignLayersOnCanvas(axis) {
        if (!app.documents.length) throw new Error("请先打开文档并选择图层");
        var started = new Date().getTime();
        var document = app.activeDocument;
        var ids = deps.selectedLayerIds();
        if (!ids.length) throw new Error("请先选择需要基于画布对齐的图层");
        if (!/^(horizontal|vertical|top)$/.test(axis)) throw new Error("未知画布对齐方式");
        var byId = {}, byIndex = {}, reads = 0, indexOffset = null;

        function booleanValue(desc, name) {
            return desc.hasKey(key(name)) && desc.getBoolean(key(name));
        }
        function readIndex(index) {
            if (byIndex[index]) return byIndex[index];
            var ref = new ActionReference();
            ref.putIndex(key("layer"), index);
            var desc;
            try { desc = executeActionGet(ref); reads += 1; }
            catch (ignoreIndexOutsideDocument) { return null; }
            return remember(desc, index);
        }
        function remember(desc, index) {
            var section = typeIDToStringID(desc.getEnumerationValue(key("layerSection")));
            var id = section === "layerSectionEnd" ? -1 : desc.getInteger(key("layerID"));
            var record = section === "layerSectionEnd" ? null : byId[id];
            if (!record) {
                record = { id: id, desc: desc, index: index,
                    section: section,
                    clipped: booleanValue(desc, "group"), visible: booleanValue(desc, "visible") };
                if (section !== "layerSectionEnd") byId[id] = record;
            }
            record.index = index;
            byIndex[index] = record;
            return record;
        }
        function readId(id) {
            if (byId[id]) return byId[id];
            var ref = new ActionReference();
            ref.putIdentifier(key("layer"), id);
            var desc = executeActionGet(ref); reads += 1;
            var itemIndex = desc.getInteger(key("itemIndex"));
            if (indexOffset === null) {
                // Hosts differ in whether itemIndex includes the background slot.
                var probe = readIndex(itemIndex);
                if (probe && probe.id === id) indexOffset = 0;
                else {
                    probe = readIndex(itemIndex - 1);
                    if (!probe || probe.id !== id) throw new Error("无法确认 Photoshop 图层索引");
                    indexOffset = -1;
                }
            }
            return remember(desc, itemIndex + indexOffset);
        }
        function children(record) {
            if (record.children) return record.children;
            var output = [], cursor = record.index - 1;
            while (cursor >= 0) {
                var child = readIndex(cursor);
                if (!child) break;
                if (child.section === "layerSectionEnd") {
                    record.endIndex = cursor;
                    record.children = output;
                    return output;
                }
                output.push(child);
                if (child.section === "layerSectionStart") {
                    children(child);
                    cursor = child.endIndex - 1;
                } else cursor -= 1;
            }
            throw new Error("无法读取完整的图层组");
        }
        function nextBelow(record) {
            if (record.section === "layerSectionStart") children(record);
            return readIndex(record.endIndex !== undefined ? record.endIndex - 1 : record.index - 1);
        }
        function clippingBase(record) {
            while (record && record.clipped) record = nextBelow(record);
            if (!record || record.section === "layerSectionEnd") throw new Error("无法读取剪贴蒙版底层");
            return record;
        }
        function nextAbove(record) {
            var candidate = readIndex(record.index + 1);
            if (candidate && candidate.section === "layerSectionStart") return null;
            if (!candidate || candidate.section !== "layerSectionEnd") return candidate;
            var depth = 1, cursor = candidate.index + 1;
            while ((candidate = readIndex(cursor))) {
                if (candidate.section === "layerSectionEnd") depth += 1;
                if (candidate.section === "layerSectionStart") depth -= 1;
                if (!depth) return candidate;
                cursor += 1;
            }
            throw new Error("无法读取上方剪贴图层组");
        }
        function clippingStack(base) {
            if (base.stack) return base.stack;
            var list = [base], member = nextAbove(base);
            while (member && member.clipped) {
                list.push(member);
                member = nextAbove(member);
            }
            base.stack = list;
            return list;
        }
        function union(a, b) {
            if (!b) return a;
            if (!a) return { left:b.left, top:b.top, right:b.right, bottom:b.bottom };
            a.left = Math.min(a.left,b.left); a.top = Math.min(a.top,b.top);
            a.right = Math.max(a.right,b.right); a.bottom = Math.max(a.bottom,b.bottom);
            return a;
        }
        function rawBounds(record) {
            var desc = record.desc;
            var bounds = desc.getObjectValue(key(desc.hasKey(key("boundsNoEffects")) ? "boundsNoEffects" : "bounds"));
            var box = {left:bounds.getUnitDoubleValue(key("left")),top:bounds.getUnitDoubleValue(key("top")),
                right:bounds.getUnitDoubleValue(key("right")),bottom:bounds.getUnitDoubleValue(key("bottom"))};
            return box.right > box.left && box.bottom > box.top ? box : null;
        }
        function visibleBounds(record) {
            if (record.section !== "layerSectionStart") return rawBounds(record);
            var list = children(record), box = null;
            for (var i = 0; i < list.length; i += 1) {
                if (list[i].visible && !list[i].clipped) box = union(box, visibleBounds(list[i]));
            }
            // Intersect the visible children with the enclosing group's mask bounds.
            var outer = rawBounds(record);
            if (box && outer) {
                box.left = Math.max(box.left,outer.left); box.top = Math.max(box.top,outer.top);
                box.right = Math.min(box.right,outer.right); box.bottom = Math.min(box.bottom,outer.bottom);
            }
            return box && box.right > box.left && box.bottom > box.top ? box : null;
        }
        function contains(parent, child) {
            if (parent.section !== "layerSectionStart") return false;
            children(parent);
            return child.index < parent.index && child.index > parent.endIndex;
        }
        var candidates = [], seen = {}, i, j;
        for (i = 0; i < ids.length; i += 1) {
            var base = clippingBase(readId(ids[i]));
            if (!seen[base.id]) { candidates.push(base); seen[base.id] = true; }
        }
        var roots = [];
        for (i = 0; i < candidates.length; i += 1) {
            var nested = false;
            for (j = 0; j < candidates.length; j += 1) {
                if (i === j) continue;
                var parentStack = clippingStack(candidates[j]);
                for (var parentIndex = 0; parentIndex < parentStack.length; parentIndex += 1) {
                    if (contains(parentStack[parentIndex],candidates[i])) { nested = true; break; }
                }
                if (nested) break;
            }
            if (!nested) roots.push(candidates[i]);
        }
        var box = null, moveIds = [], moving = {};
        for (i = 0; i < roots.length; i += 1) {
            box = union(box, visibleBounds(roots[i]));
            var member = roots[i];
            do {
                if (!moving[member.id]) {
                    var desc = member.desc;
                    if (booleanValue(desc,"background")) throw new Error("请先解锁背景图层");
                    if (desc.hasKey(key("layerLocking"))) {
                        var locking = desc.getObjectValue(key("layerLocking"));
                        if (booleanValue(locking,"protectAll") || booleanValue(locking,"protectPosition")) {
                            throw new Error("请先解锁需要居中的图层及其剪贴图片");
                        }
                    }
                    moveIds.push(member.id); moving[member.id] = true;
                }
                member = nextAbove(member);
            } while (member && member.clipped);
        }
        if (!box) throw new Error("当前选择中没有可见内容");
        var dx = axis === "horizontal" ? deps.pixels(document.width)/2 - (box.left+box.right)/2 : 0;
        var dy = axis === "vertical" ? deps.pixels(document.height)/2 - (box.top+box.bottom)/2 : axis === "top" ? -box.top : 0;
        var result = {processed:moveIds.length,axis:axis,offsetX:dx,offsetY:dy,descriptorReads:reads,moveActions:0};
        if (Math.abs(dx) <= 0.01 && Math.abs(dy) <= 0.01) {
            result.skipped = true; result.elapsedMs = new Date().getTime()-started; return result;
        }
        var name = axis === "horizontal" ? "水平居中" : axis === "vertical" ? "垂直居中" : "顶部对齐";
        return deps.suspendToolsHistory(document, "鑫洋助理：基于画布" + name, function () {
            var selectionChanged = !sameLayerIds(ids, moveIds);
            try {
                if (selectionChanged) {
                    if (!deps.selectLayersByIds) throw new Error("无法建立画布对齐目标选区");
                    deps.selectLayersByIds(moveIds);
                }
                // Move the entire target set once. Repeating a layer-targeted
                // move while a multi-selection is active can move the whole set
                // repeatedly, amplifying the offset on every invocation.
                moveSelection(dx, dy);
                result.moveActions = 1;
            } finally {
                if (selectionChanged) deps.selectLayersByIds(ids);
            }
            result.elapsedMs = new Date().getTime()-started;
            return result;
        });
    }
    function toolsCenterLayersOnCanvas(options) {
        var axis = String(options && options.axis || "horizontal");
        if (axis === "h" || axis === "x" || axis === "horizontalCenter") axis = "horizontal";
        if (axis === "v" || axis === "y" || axis === "verticalCenter") axis = "vertical";
        if (axis !== "horizontal" && axis !== "vertical") throw new Error("未知画布居中方式");
        return alignLayersOnCanvas(axis);
    }

    function toolsAlignLayersToCanvasTop() {
        return alignLayersOnCanvas("top");
    }

    function toolsCenterLayersHorizontallyOnCanvas() {
        return alignLayersOnCanvas("horizontal");
    }

    function toolsCenterLayersVerticallyOnCanvas() {
        return alignLayersOnCanvas("vertical");
    }

    // Keep the vertical command on a unique method name so an already resident
    // CEP host cannot route it through an older canvas-top implementation.
    function toolsCenterLayersVerticallyOnCanvasV2309() {
        return alignLayersOnCanvas("vertical");
    }

    return {
        toolsCenterLayersOnCanvas: toolsCenterLayersOnCanvas,
        toolsAlignLayersToCanvasTop: toolsAlignLayersToCanvasTop,
        toolsCenterLayersHorizontallyOnCanvas: toolsCenterLayersHorizontallyOnCanvas,
        toolsCenterLayersVerticallyOnCanvas: toolsCenterLayersVerticallyOnCanvas,
        toolsCenterLayersVerticallyOnCanvasV2309: toolsCenterLayersVerticallyOnCanvasV2309
    };
};
