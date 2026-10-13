(function () {
    $.global.XinyangHostModules.smartSnap = function (deps) {
    var pixels = deps.pixels;
    var selectedLayerIds = deps.selectedLayerIds;
    var selectLayersByIds = deps.selectLayersByIds;
    var suspendToolsHistory = deps.suspendToolsHistory;
    function toolsApplySmartSnap(options) {
        if (!app.documents.length) throw new Error("请先打开文档并选择要吸附的图层");
        options = options || {};
        var document = app.activeDocument;
        var ids = selectedLayerIds();
        if (!ids.length) throw new Error("请先选择要吸附的图层");
        var distance = Math.max(1, Math.min(200, Number(options && options.distance) || 20));
        var selected = [], index, layer;
        var selectedMap = {}, byId = {};
        for (index = 0; index < ids.length; index += 1) selectedMap[String(ids[index])] = true;
        function indexLayers(container) {
            var i, item;
            for (i = 0; i < container.layers.length; i += 1) {
                item = container.layers[i]; byId[String(item.id)] = item;
                if (item.typename === "LayerSet") indexLayers(item);
            }
        }
        indexLayers(document);
        function selectedAncestor(item) {
            var parent = item.parent;
            while (parent && parent.typename === "LayerSet") {
                if (selectedMap[String(parent.id)]) return true;
                parent = parent.parent;
            }
            return false;
        }
        function ancestorOfSelection(item) {
            var j, parent;
            for (j = 0; j < selected.length; j += 1) {
                parent = selected[j].parent;
                while (parent && parent.typename === "LayerSet") {
                    if (Number(parent.id) === Number(item.id)) return true;
                    parent = parent.parent;
                }
            }
            return false;
        }
        for (index = 0; index < ids.length; index += 1) {
            layer = byId[String(ids[index])];
            if (!layer) throw new Error("选择已变化，请重新选择图层");
            var owner = layer;
            while (owner && owner.typename !== "Document") {
                if (owner.allLocked || owner.positionLocked) throw new Error("请先解除选中图层及父组的位置锁定");
                owner = owner.parent;
            }
            if (!selectedAncestor(layer)) selected.push(layer);
        }
        function boxOf(layers) {
            var result = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }, i, b;
            for (i = 0; i < layers.length; i += 1) { b = layers[i].bounds; result.left = Math.min(result.left, pixels(b[0])); result.top = Math.min(result.top, pixels(b[1])); result.right = Math.max(result.right, pixels(b[2])); result.bottom = Math.max(result.bottom, pixels(b[3])); }
            return result;
        }
        var moving = boxOf(selected);
        if (!isFinite(moving.left + moving.top + moving.right + moving.bottom)) throw new Error("图层没有有效边界");
        function containsLayer(list, item) { var i; for (i = 0; i < list.length; i += 1) if (Number(list[i].id) === Number(item.id)) return true; return false; }
        var candidates = [];
        function collect(layers) { var i, item; for (i = 0; i < layers.length; i += 1) { item = layers[i]; if (!item.visible || containsLayer(selected, item)) continue; if (!ancestorOfSelection(item)) candidates.push(boxOf([item])); if (item.typename === "LayerSet") collect(item.layers); } }
        collect(document.layers);
        var bestX = null, bestY = null;
        function consider(axis, delta, label) {
            if (!isFinite(delta) || Math.abs(delta) > distance) return;
            var current = axis === "x" ? bestX : bestY;
            if (!current || Math.abs(delta) < Math.abs(current.delta)) { if (axis === "x") bestX = { delta: delta, label: label }; else bestY = { delta: delta, label: label }; }
        }
        function compareBox(target, label) {
            if ((label === "画布" && options.canvasEdges) || (label !== "画布" && options.layerEdges)) { consider("x", target.left - moving.left, label + "左边缘"); consider("x", target.right - moving.right, label + "右边缘"); consider("x", target.left - moving.right, label + "左边缘"); consider("x", target.right - moving.left, label + "右边缘"); consider("y", target.top - moving.top, label + "上边缘"); consider("y", target.bottom - moving.bottom, label + "下边缘"); consider("y", target.top - moving.bottom, label + "上边缘"); consider("y", target.bottom - moving.top, label + "下边缘"); }
            if (options.centers) { consider("x", (target.left + target.right - moving.left - moving.right) / 2, label + "水平中心"); consider("y", (target.top + target.bottom - moving.top - moving.bottom) / 2, label + "垂直中心"); }
        }
        for (index = 0; index < candidates.length; index += 1) compareBox(candidates[index], "图层");
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
            for (index = 0; index < candidates.length; index += 1) { candidateBox = candidates[index]; if (candidateBox.right <= moving.left && (!leftNeighbor || candidateBox.right > leftNeighbor.right)) leftNeighbor = candidateBox; if (candidateBox.left >= moving.right && (!rightNeighbor || candidateBox.left < rightNeighbor.left)) rightNeighbor = candidateBox; if (candidateBox.bottom <= moving.top && (!topNeighbor || candidateBox.bottom > topNeighbor.bottom)) topNeighbor = candidateBox; if (candidateBox.top >= moving.bottom && (!bottomNeighbor || candidateBox.top < bottomNeighbor.top)) bottomNeighbor = candidateBox; }
            if (leftNeighbor && rightNeighbor) consider("x", (leftNeighbor.right + rightNeighbor.left - (moving.right - moving.left)) / 2 - moving.left, "水平等距");
            if (topNeighbor && bottomNeighbor) consider("y", (topNeighbor.bottom + bottomNeighbor.top - (moving.bottom - moving.top)) / 2 - moving.top, "垂直等距");
        }
        var dx = bestX ? bestX.delta : 0, dy = bestY ? bestY.delta : 0;
        if ((!bestX && !bestY) || (dx === 0 && dy === 0)) return { processed: 0, xTarget: "未找到水平目标", yTarget: "未找到垂直目标" };
        return suspendToolsHistory(document, "鑫洋助理：磁吸模式", function () { for (index = 0; index < selected.length; index += 1) selected[index].translate(UnitValue(dx, "px"), UnitValue(dy, "px")); selectLayersByIds(ids); return { processed: selected.length, offsetX: dx, offsetY: dy, xTarget: bestX ? bestX.label : "未命中水平目标", yTarget: bestY ? bestY.label : "未命中垂直目标" }; });
    }

    return { toolsApplySmartSnap: toolsApplySmartSnap };
    };
}());
