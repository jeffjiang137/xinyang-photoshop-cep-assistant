/* Native snapping and non-destructive script memory collection. */
(function () {
    var modules = $.global.XinyangHostModules;
    modules.memorySnap = function () {
        function toolsNativeSnapDiagnostics() {
            var ref = new ActionReference();
            ref.putProperty(stringIDToTypeID("property"), stringIDToTypeID("menuBarInfo"));
            ref.putEnumerated(stringIDToTypeID("application"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var menu = executeActionGet(ref).getObjectValue(stringIDToTypeID("menuBarInfo"));
            var result = { ok: true, version: String(app.version), documents: app.documents.length, viewMenus: [] };
            function scalarFields(item) {
                var fields = {}, i, key, name, type;
                for (i = 0; i < item.count; i += 1) {
                    key = item.getKey(i);
                    try { name = typeIDToStringID(key); } catch (ignoreKey) { name = String(key); }
                    if (!name) name = String(key);
                    type = item.getType(key);
                    if (type === DescValueType.BOOLEANTYPE) fields[name] = item.getBoolean(key);
                    else if (type === DescValueType.INTEGERTYPE) fields[name] = item.getInteger(key);
                    else if (type === DescValueType.STRINGTYPE) fields[name] = item.getString(key);
                }
                return fields;
            }
            function visit(item, inView, depth) {
                if (depth > 4 || result.viewMenus.length >= 120) return;
                var title = "", keys = ["name", "title"], i, key;
                for (i = 0; i < keys.length; i += 1) {
                    key = stringIDToTypeID(keys[i]);
                    try {
                        if (item.hasKey(key)) {
                            title = item.getString(key).replace(/&/g, "").replace(/\t.*$/, "").replace(/\s*\([A-Za-z]\)\s*$/, "").replace(/^\s+|\s+$/g, "");
                            if (/^(View|视图|檢視|視圖)$/i.test(title)) inView = true;
                        }
                    } catch (ignoreName) {}
                }
                if (inView) result.viewMenus.push(scalarFields(item));
                key = stringIDToTypeID("submenu");
                if (item.hasKey(key)) {
                    var list = item.getList(key);
                    for (i = 0; i < list.count; i += 1) visit(list.getObjectValue(i), inView, depth + 1);
                }
            }
            visit(menu, false, 0);
            try { result.liveSnapEnabled = snapState(); } catch (error) { result.liveSnapError = String(error.message || error); }
            return result;
        }
        function snapState() {
            var ref = new ActionReference();
            ref.putProperty(stringIDToTypeID("property"), stringIDToTypeID("menuBarInfo"));
            ref.putEnumerated(stringIDToTypeID("application"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            var info = executeActionGet(ref).getObjectValue(stringIDToTypeID("menuBarInfo"));
            function scan(item, inView) {
                var keys = ["title", "name"], i, key, title, found;
                for (i = 0; i < keys.length; i += 1) {
                    key = stringIDToTypeID(keys[i]);
                    if (!item.hasKey(key)) continue;
                    try { title = item.getString(key).replace(/&/g, "").replace(/\t.*$/, "").replace(/\s*\(&?[A-Za-z]\)\s*$/, "").replace(/^\s+|\s+$/g, ""); } catch (ignoreTitle) { continue; }
                    if (/^(View|视图|檢視|視圖)$/i.test(title)) inView = true;
                    if (inView && /^(Snap|对齐|吸附|貼齊|貼附)$/i.test(title) && item.hasKey(stringIDToTypeID("command"))) {
                        return item.getInteger(stringIDToTypeID("command"));
                    }
                }
                key = stringIDToTypeID("submenu");
                if (item.hasKey(key)) {
                    var list = item.getList(key);
                    for (i = 0; i < list.count; i += 1) {
                        found = scan(list.getObjectValue(i), inView);
                        if (found !== null) return found;
                    }
                }
                return null;
            }
            var commandId = scan(info, false);
            if (commandId === null) throw new Error("无法定位 PS 磁吸命令；可使用“立即吸附”");
            // menuBarInfo.checked is cached until Photoshop rebuilds the menu.
            // Only use that tree to locate the command, never as current state.
            var request = new ActionDescriptor();
            var target = new ActionReference();
            target.putEnumerated(stringIDToTypeID("application"), stringIDToTypeID("ordinal"), stringIDToTypeID("targetEnum"));
            request.putReference(stringIDToTypeID("null"), target);
            request.putString(stringIDToTypeID("command"), "getCommandEnabled");
            request.putInteger(stringIDToTypeID("commandID"), commandId);
            var response = executeAction(stringIDToTypeID("uiInfo"), request, DialogModes.NO);
            var state = response.getObjectValue(stringIDToTypeID("result"));
            if (!state.hasKey(stringIDToTypeID("checked"))) throw new Error("PS 未返回实时磁吸状态");
            return state.getBoolean(stringIDToTypeID("checked"));
        }
        function toolsConfigureNativeSnap(options) {
            if (!app.documents.length) throw new Error("请先打开文档");
            var current = snapState();
            if (options && options.readOnly) return { enabled: current };
            var enabled = options && typeof options.enabled === "boolean" ? options.enabled : !current;
            if (current === enabled) return { enabled: current, verificationPending: false };
            app.runMenuItem(stringIDToTypeID("snap"));
            // Menu checked state may update only after this host invocation ends.
            // The panel performs bounded read-only verification in later calls.
            return { requestedEnabled: enabled, verificationPending: true };
        }
        function toolsReleaseMemory() {
            // Photoshop image/history caches are deliberately untouched.
            if (typeof $.gc !== "function") throw new Error("当前宿主不支持脚本垃圾回收");
            $.gc();
            return { collected: true, documents: app.documents.length, historyPreserved: true, clipboardPreserved: true };
        }
        return { toolsConfigureNativeSnap: toolsConfigureNativeSnap, toolsReleaseMemory: toolsReleaseMemory, toolsNativeSnapDiagnostics: toolsNativeSnapDiagnostics };
    };
}());
