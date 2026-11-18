/* Local RMBG result placement. Source layers remain untouched. */
var XinyangHostModules = $.global.XinyangHostModules;
XinyangHostModules.cutout = function (deps) {
    var pending = null;
    function applyResult() {
        var p = pending, d = app.activeDocument, temp = null, added = null, savedSelection = null, cutoutSelection = null, rgbLayer = null;
        try {
            try { d.selection.bounds; savedSelection = d.channels.add(); d.selection.store(savedSelection); } catch (ignoreNoSelection) {}
            d.activeChannels = d.componentChannels;
            d.selection.deselect();
            temp = app.open(new File(p.path));
            if (Number(temp.width.as('px')) !== Number(p.source.width) || Number(temp.height.as('px')) !== Number(p.source.height)) throw new Error('抠图结果尺寸与原图不一致');
            var before = temp.activeLayer.bounds;
            var offsetX = Number(before[0].as('px')), offsetY = Number(before[1].as('px'));
            var imported = temp.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING);
            temp.close(SaveOptions.DONOTSAVECHANGES); temp = null;
            app.activeDocument = d; d.activeLayer = imported; added = imported;
            /* Align visible bounds using the result canvas origin, independent of duplicate placement. */
            var after = imported.bounds;
            imported.translate(UnitValue(Number(p.source.originX) + offsetX - Number(after[0].as('px')), 'px'), UnitValue(Number(p.source.originY) + offsetY - Number(after[1].as('px')), 'px'));
            var original = deps.findLayerById(d, Number(p.source.layerId));
            if (original && !original.isBackgroundLayer) imported.move(original, ElementPlacement.PLACEBEFORE);
            imported.name = p.mask ? '抠图结果（可编辑蒙版）' : '抠图结果（透明图层）';
            if (p.mask) {
                // Load the result alpha as a selection using Photoshop's stable channel API.
                var selection = new ActionDescriptor(), target = new ActionReference(), alpha = new ActionReference();
                target.putProperty(charIDToTypeID('Chnl'), charIDToTypeID('fsel'));
                selection.putReference(charIDToTypeID('null'), target);
                alpha.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Trsp'));
                selection.putReference(charIDToTypeID('T   '), alpha);
                executeAction(charIDToTypeID('setd'), selection, DialogModes.NO);
                cutoutSelection = d.channels.add();
                d.selection.store(cutoutSelection);
                d.selection.deselect();
                d.activeChannels = d.componentChannels;
                // Keep original RGB behind the mask, so painting white can recover pixels.
                temp = app.open(new File(p.source.tempPath));
                var rgb = temp.activeLayer.duplicate(d, ElementPlacement.PLACEATBEGINNING);
                temp.close(SaveOptions.DONOTSAVECHANGES); temp = null;
                rgbLayer = rgb;
                app.activeDocument = d; d.activeChannels = d.componentChannels; d.activeLayer = rgb;
                d.selection.deselect();
                var rgbBounds = rgb.bounds;
                rgb.translate(UnitValue(Number(p.source.originX) - Number(rgbBounds[0].as('px')), 'px'), UnitValue(Number(p.source.originY) - Number(rgbBounds[1].as('px')), 'px'));
                rgb.move(imported, ElementPlacement.PLACEBEFORE);
                imported.remove(); added = rgb;
                rgb.name = '抠图结果（可编辑蒙版）';
                d.activeLayer = rgb;
                d.activeChannels = d.componentChannels;
                d.selection.load(cutoutSelection);
                var mask = new ActionDescriptor(), at = new ActionReference();
                mask.putClass(charIDToTypeID('Nw  '), charIDToTypeID('Chnl'));
                at.putEnumerated(charIDToTypeID('Chnl'), charIDToTypeID('Chnl'), charIDToTypeID('Msk '));
                mask.putReference(charIDToTypeID('At  '), at);
                mask.putEnumerated(charIDToTypeID('Usng'), charIDToTypeID('UsrM'), charIDToTypeID('RvlS'));
                executeAction(charIDToTypeID('Mk  '), mask, DialogModes.NO);
            }
        } catch (error) {
            if (temp) try { temp.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
            app.activeDocument = d;
            if (rgbLayer && rgbLayer !== added) try { rgbLayer.remove(); } catch (ignoreRemoveRgb) {}
            if (added) try { added.remove(); } catch (ignoreRemove) {}
            throw error;
        } finally {
            app.activeDocument = d;
            try {
                d.activeChannels = d.componentChannels;
                if (savedSelection) d.selection.load(savedSelection);
                else d.selection.deselect();
            } finally {
                if (cutoutSelection) cutoutSelection.remove();
                if (savedSelection) savedSelection.remove();
                d.activeChannels = d.componentChannels;
            }
        }
    }
    return {
        run: applyResult,
        toolsApplyCutout: function (payload) {
            if (!app.documents.length) throw new Error('原文档已关闭');
            var d = app.activeDocument;
            if (Number(deps.currentDocumentIdFor(d)) !== Number(payload.source.documentId)) throw new Error('文档已切换，请回到原文档重试');
            if (!new File(payload.path).exists) throw new Error('抠图结果文件不存在');
            var sourceLayer = deps.findLayerById(d, Number(payload.source.layerId));
            if (!sourceLayer) throw new Error('原图片图层已删除，请重新抠图');
            pending = payload;
            try { d.suspendHistory('本机模型抠图', 'LongStitchCEP.toolsRunCutout()'); }
            finally { pending = null; }
            return {ok:true};
        }
    };
};
