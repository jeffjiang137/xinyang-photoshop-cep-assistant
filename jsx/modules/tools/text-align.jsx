/* Plain text alignment does not need a cold DOM layer-tree lookup. */
var XinyangHostModules = $.global.XinyangHostModules;
if (!XinyangHostModules) {
    XinyangHostModules = {};
    $.global.XinyangHostModules = XinyangHostModules;
}
XinyangHostModules.textAlign = function (deps) {
    var key = stringIDToTypeID;
    var nativeAlignmentAction = {
        left: "AdLf",
        right: "AdRg",
        hCenter: "AdCH",
        top: "AdTp",
        bottom: "AdBt",
        vCenter: "AdCV"
    };
    function readIndex(index) {
        var ref = new ActionReference();
        ref.putIndex(key("layer"), index);
        try { return executeActionGet(ref); } catch (ignoreOutsideDocument) { return null; }
    }
    function flag(desc, name) { return desc.hasKey(key(name)) && desc.getBoolean(key(name)); }
    function tryAlignTextLayers(document, ids, action) {
        // Keep the slow path for horizontal-center alignment; it preserves the
        // panel's established behavior for text bounds. AdCV is the native
        // Photoshop operation for aligning selected text layers vertically.
        if (action !== "vCenter") return null;
        var started = new Date().getTime();
        var nativeAction = nativeAlignmentAction[action];
        if (!nativeAction) return null;
        var indexOffset = null;
        var i;
        // Finish eligibility checks before changing anything. Mixed selections,
        // clipping bases, clipped text and linked layers retain the general path.
        for (i = 0; i < ids.length; i += 1) {
            var ref = new ActionReference();
            ref.putIdentifier(key("layer"), ids[i]);
            var desc = executeActionGet(ref);
            if (!desc.hasKey(key("layerKind")) || desc.getInteger(key("layerKind")) !== 3 || flag(desc,"group")) return null;
            if (desc.hasKey(key("linkedLayerIDs")) && desc.getList(key("linkedLayerIDs")).count) return null;
            var itemIndex = desc.getInteger(key("itemIndex"));
            if (indexOffset === null) {
                var probe = readIndex(itemIndex);
                if (probe && probe.hasKey(key("layerID")) && probe.getInteger(key("layerID")) === ids[i]) indexOffset = 0;
                else {
                    probe = readIndex(itemIndex - 1);
                    if (!probe || !probe.hasKey(key("layerID")) || probe.getInteger(key("layerID")) !== ids[i]) return null;
                    indexOffset = -1;
                }
            }
            var upper = readIndex(itemIndex + indexOffset + 1);
            if (upper && (flag(upper,"group") ||
                (upper.hasKey(key("layerSection")) && typeIDToStringID(upper.getEnumerationValue(key("layerSection"))) === "layerSectionEnd"))) return null;
            if (desc.hasKey(key("layerLocking"))) {
                var locking = desc.getObjectValue(key("layerLocking"));
                if (flag(locking,"protectAll") || flag(locking,"protectPosition")) throw new Error("请先解锁需要对齐的文字图层");
            }
        }
        var activeId = deps.activeLayerId ? deps.activeLayerId() : ids[ids.length - 1];
        var orderedIds = [], activeFound = false;
        for (i = 0; i < ids.length; i += 1) {
            if (ids[i] === activeId) activeFound = true;
            else orderedIds.push(ids[i]);
        }
        if (activeFound) orderedIds.push(activeId);
        else orderedIds = ids.slice(0);
        if (deps.selectLayersByIds) deps.selectLayersByIds(orderedIds);
        // The native align action must run as its own Photoshop history step.
        // Running it inside suspendHistory can raise Photoshop's generic error.
        try {
            executeAction(charIDToTypeID(nativeAction),undefined,DialogModes.NO);
        } catch (ignoreNativeAlignmentFailure) {
            // Photoshop versions that reject AdCV can still use the validated
            // layer-translation path in layer-tools.jsx.
            return null;
        }
        return {processed:ids.length,action:action,fastPath:true,nativeAlignment:true,moveActions:1,
            elapsedMs:new Date().getTime()-started};
    }
    return {tryAlignTextLayers:tryAlignTextLayers};
};
