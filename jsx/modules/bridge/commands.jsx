/* Adapted from the installed Codex Photoshop Bridge; loaded only by module-loader.jsx. */
(function () {
    var XinyangHostModules = $.global.XinyangHostModules;
    if (!XinyangHostModules) {
        XinyangHostModules = {};
        $.global.XinyangHostModules = XinyangHostModules;
    }
    XinyangHostModules.photoshopBridge = function () {
function xinyangBridgeJSONParse(text){return eval('('+text+')');}
function xinyangBridgeJSONStringify(value){
  var type=typeof value,i,key,items=[];
  if(value===null)return 'null';
  if(type==='string')return '"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\x00-\x1F]/g,function(ch){var code=ch.charCodeAt(0),hex;if(code===8)return '\\b';if(code===9)return '\\t';if(code===10)return '\\n';if(code===12)return '\\f';if(code===13)return '\\r';hex=code.toString(16);return '\\u'+('0000'+hex).slice(-4);})+'"';
  if(type==='number'||type==='boolean')return String(value);
  if(type==='undefined'||type==='function')return 'null';
  if(value instanceof Array){for(i=0;i<value.length;i++)items.push(xinyangBridgeJSONStringify(value[i]));return '['+items.join(',')+']';}
  for(key in value)if(value.hasOwnProperty(key)&&typeof value[key]!=='function'&&typeof value[key]!=='undefined')items.push(xinyangBridgeJSONStringify(String(key))+':'+xinyangBridgeJSONStringify(value[key]));
  return '{'+items.join(',')+'}';
}

function xinyangBridgeError(message){ return xinyangBridgeJSONStringify({ok:false,error:String(message),errorLine:message&&message.line||null}); }
function xinyangBridgeLayerInfo(layer){return {id:layer.id,name:layer.name,kind:String(layer.kind),visible:layer.visible,opacity:layer.opacity,bounds:[Number(layer.bounds[0]),Number(layer.bounds[1]),Number(layer.bounds[2]),Number(layer.bounds[3])],isGroup:layer.typename==='LayerSet'};}
function xinyangBridgeLayers(container,out,parentId){for(var i=0;i<container.layers.length;i++){var l=container.layers[i],x=xinyangBridgeLayerInfo(l);x.parentId=parentId===undefined?null:parentId;x.order=i;if(l.kind===LayerKind.TEXT){try{x.text=xinyangBridgeTextInfo(l.textItem)}catch(ignoreText){}}if(l.typename==='LayerSet'){x.children=[];xinyangBridgeLayers(l,x.children,l.id)}out.push(x)}}
function xinyangBridgeHistoryFingerprint(d){var count=null,name=null,saved=null;try{count=d.historyStates.length;}catch(e){}try{name=String(d.activeHistoryState.name);}catch(e){}try{saved=!!d.saved;}catch(e){}return {documentId:Number(d.id),historyCount:count,activeHistoryName:name,saved:saved};}
function xinyangBridgeFingerprintMatches(expected,actual){if(!expected||!actual)return true;
if(expected.documentId!==undefined&&String(expected.documentId)!==String(actual.documentId))return false;
if(expected.historyCount!==undefined&&actual.historyCount!==null&&Number(expected.historyCount)!==Number(actual.historyCount))return false;
if(expected.activeHistoryName!==undefined&&actual.activeHistoryName!==null&&String(expected.activeHistoryName)!==String(actual.activeHistoryName))return false;
return true;
}
function xinyangBridgeDocumentInfo(){if(!app.documents.length)throw Error('Photoshop 中没有打开的文档');var d=app.activeDocument, layers=[];xinyangBridgeLayers(d,layers);return {ok:true,documentId:Number(d.id),historyFingerprint:xinyangBridgeHistoryFingerprint(d),document:{name:d.name,path:d.fullName?d.fullName.fsName:null,width:Number(d.width),height:Number(d.height),resolution:d.resolution,mode:String(d.mode),layers:layers}}}
function xinyangBridgeRuntimeProbe(){var count=app.documents.length,active=null,fingerprint=null;if(count){try{active=Number(app.activeDocument.id);fingerprint=xinyangBridgeHistoryFingerprint(app.activeDocument);}catch(ignore){active=null;fingerprint=null}}return {ok:true,photoshop:'READY',runtimeVersion:'p0-bounded-preview-v2',previewBoundedRegion:true,documents:count,activeDocumentId:active,historyFingerprint:fingerprint,modal:'UNKNOWN'};}
function xinyangBridgeMemoryCleanup(c){var level=String(c&&c.level||'soft').toLowerCase(),documents=app.documents.length,result={ok:true,level:level,documents:documents,gc:false,purged:false,skipped:false};
try{$.gc();
result.gc=true;
}catch(gcError){result.ok=false;
result.error={code:'MEMORY_SOFT_CLEANUP_FAILED',message:String(gcError)};
if(level!=='aggressive')return result;
}if(level==='aggressive'){if((c&&c.requireZeroDocuments!==false)&&documents!==0){result.skipped=true;
result.reason='USER_DOCUMENTS_OPEN';
return result;
}try{app.purge(PurgeTarget.ALLCACHES);
result.purged=true;
}catch(purgeError){result.ok=false;
result.error={code:'MEMORY_AGGRESSIVE_CLEANUP_FAILED',message:String(purgeError)};
}try{$.gc();
result.gcAfterPurge=true;
}catch(gcAfterPurgeError){result.gcAfterPurge=false;
result.gcAfterPurgeError=String(gcAfterPurgeError);
}}result.documents=app.documents.length;
return result;
}
function xinyangBridgeFind(id) {
    var targetId = Number(id), key = String(targetId), found;
    if (xinyangBridgeBatchLayerIndex) {
        found = xinyangBridgeBatchLayerIndex[key];
    } else {
        function walk(container) {
            var i, layer, nested;
            for (i = 0; i < container.layers.length; i++) {
                layer = container.layers[i];
                if (Number(layer.id) === targetId) return layer;
                if (layer.typename === 'LayerSet') {
                    nested = walk(layer);
                    if (nested) return nested;
                }
            }
            return null;
        }
        found = walk(app.activeDocument);
    }
    if (!found) throw Error('找不到图层 ' + id);
    return found;
}
function xinyangBridgeBuildLayerIndex(container,index){for(var i=0;i<container.layers.length;i++){var l=container.layers[i];try{index[String(Number(l.id))]=l;}catch(ignoreIndex){}if(l.typename==='LayerSet')xinyangBridgeBuildLayerIndex(l,index);}return index;}
function xinyangBridgeInvalidateBatchLayerIndex(){xinyangBridgeBatchLayerIndex=null;}function xinyangBridgeSelect(id){app.activeDocument.activeLayer=xinyangBridgeFind(id);}
function xinyangBridgeActionSelect(id, add){var ref=new ActionReference(),desc=new ActionDescriptor();ref.putIdentifier(charIDToTypeID('Lyr '),id);desc.putReference(charIDToTypeID('null'),ref);desc.putBoolean(charIDToTypeID('MkVs'),false);if(add)desc.putEnumerated(stringIDToTypeID('selectionModifier'),stringIDToTypeID('selectionModifierType'),stringIDToTypeID('addToSelection'));executeAction(charIDToTypeID('slct'),desc,DialogModes.NO);}
function xinyangBridgePlace(path, name){var d=app.activeDocument;var f=File(path);if(!f.exists)throw Error('素材不存在：'+path);var desc=new ActionDescriptor();desc.putPath(charIDToTypeID('null'),f);executeAction(charIDToTypeID('Plc '),desc,DialogModes.NO);if(name)d.activeLayer.name=name;return xinyangBridgeLayerInfo(d.activeLayer)}
function xinyangBridgePlaceLinked(path,name){var f=File(path),d=new ActionDescriptor();if(!f.exists)throw Error('素材不存在：'+path);d.putPath(charIDToTypeID('null'),f);executeAction(stringIDToTypeID('placedLayerPlaceLinked'),d,DialogModes.NO);if(name)app.activeDocument.activeLayer.name=name;return xinyangBridgeLayerInfo(app.activeDocument.activeLayer)}
function xinyangBridgePlaceMany(items){var layers=[];for(var i=0;i<items.length;i++)layers.push(xinyangBridgePlace(items[i].path,items[i].name));return {ok:true,layers:layers};}
function xinyangBridgeReplaceSmart(id,path){xinyangBridgeSelect(id);var f=File(path);if(!f.exists)throw Error('素材不存在：'+path);var d=new ActionDescriptor();d.putPath(charIDToTypeID('null'),f);executeAction(stringIDToTypeID('placedLayerReplaceContents'),d,DialogModes.NO);return {ok:true,layer:xinyangBridgeLayerInfo(app.activeDocument.activeLayer)}}
function xinyangBridgeColor(value){var c=new SolidColor(),v=value;if(typeof v==='string'){v=v.replace('#','');if(v.length!==6)throw Error('Color must be #RRGGBB');c.rgb.red=parseInt(v.substr(0,2),16);c.rgb.green=parseInt(v.substr(2,2),16);c.rgb.blue=parseInt(v.substr(4,2),16)}else if(v&&v.r!==undefined){c.rgb.red=v.r;c.rgb.green=v.g;c.rgb.blue=v.b}else throw Error('Color must be #RRGGBB or {r,g,b}');return c;}
function xinyangBridgeJustification(value){var map={left:Justification.LEFT,center:Justification.CENTER,right:Justification.RIGHT,leftJustified:Justification.LEFTJUSTIFIED,centerJustified:Justification.CENTERJUSTIFIED,rightJustified:Justification.RIGHTJUSTIFIED,full:Justification.FULLYJUSTIFIED};if(!map[value])throw Error('Unsupported text alignment: '+value);return map[value];}
function xinyangBridgeText(c){var l,t;
if(c.layerId){l=xinyangBridgeFind(c.layerId);
if(l.kind!==LayerKind.TEXT)throw Error('Target is not a text layer')}else{l=app.activeDocument.artLayers.add();
l.kind=LayerKind.TEXT;
l.name=c.name||'Codex Text'}t=l.textItem;
if(c.text!==undefined)t.contents=c.text;
if(c.x!==undefined||c.y!==undefined){var p=t.position;
t.position=[c.x!==undefined?c.x:p[0],c.y!==undefined?c.y:p[1]]}if(c.size!==undefined)t.size=UnitValue(c.size,'px');
if(c.font!==undefined)t.font=c.font;
if(c.color!==undefined)t.color=xinyangBridgeColor(c.color);
if(c.justification!==undefined)t.justification=xinyangBridgeJustification(c.justification);
if(c.tracking!==undefined)t.tracking=c.tracking;
if(c.leading!==undefined)t.leading=UnitValue(c.leading,'px');
if(c.horizontalScale!==undefined)t.horizontalScale=c.horizontalScale;
if(c.verticalScale!==undefined)t.verticalScale=c.verticalScale;
if(c.baselineShift!==undefined)t.baselineShift=UnitValue(c.baselineShift,'px');
if(c.fauxBold!==undefined)t.fauxBold=c.fauxBold;
if(c.fauxItalic!==undefined)t.fauxItalic=c.fauxItalic;
if(c.underline!==undefined)t.underline=c.underline;
if(c.strikeThru!==undefined)t.strikeThru=c.strikeThru;
if(c.boxWidth!==undefined)t.width=UnitValue(Number(c.boxWidth),'px');
if(c.boxHeight!==undefined)t.height=UnitValue(Number(c.boxHeight),'px');
return {ok:true,layer:xinyangBridgeLayerInfo(l),text:xinyangBridgeTextInfo(t)}}
function xinyangBridgeTextInfo(t){var rgb=t.color.rgb,leading=null;try{leading=Number(t.leading)}catch(ignore){}return {contents:t.contents,font:t.font,size:Number(t.size),color:{r:Math.round(rgb.red),g:Math.round(rgb.green),b:Math.round(rgb.blue)},tracking:t.tracking,leading:leading,horizontalScale:t.horizontalScale,verticalScale:t.verticalScale,justification:String(t.justification)};}
function xinyangBridgeSetTextStyleRanges(c){var l=xinyangBridgeFind(c.layerId),base=new ActionReference(),getd,tk,old,oldStyle,list,rr,r,style,clr,rgb,i,sd,ref;
if(l.kind!==LayerKind.TEXT)throw Error('Target is not a text layer');
if(!c.ranges||!c.ranges.length)throw Error('ranges is required');
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
getd=executeActionGet(ref);
tk=getd.getObjectValue(stringIDToTypeID('textKey'));
old=tk.getList(stringIDToTypeID('textStyleRange')).getObjectValue(0);
oldStyle=old.getObjectValue(stringIDToTypeID('textStyle'));
list=new ActionList();
for(i=0;i<c.ranges.length;i++){rr=c.ranges[i];
r=new ActionDescriptor();
r.putInteger(charIDToTypeID('From'),rr.from);
r.putInteger(charIDToTypeID('T   '),rr.to);
style=oldStyle;
if(rr.fontPostScriptName!==undefined)style.putString(stringIDToTypeID('fontPostScriptName'),rr.fontPostScriptName);
if(rr.fontFamily!==undefined)style.putString(charIDToTypeID('FntN'),rr.fontFamily);
if(rr.fontStyle!==undefined)style.putString(charIDToTypeID('fontStyleName'),rr.fontStyle);
if(rr.fontSize!==undefined)style.putUnitDouble(charIDToTypeID('Sz  '),charIDToTypeID('#Pnt'),rr.fontSize);
if(rr.tracking!==undefined)style.putInteger(charIDToTypeID('tracking'),rr.tracking);
if(rr.horizontalScale!==undefined)style.putDouble(charIDToTypeID('HrzS'),rr.horizontalScale);
if(rr.verticalScale!==undefined)style.putDouble(charIDToTypeID('VrtS'),rr.verticalScale);
if(rr.color){clr=new ActionDescriptor();
rgb=new ActionDescriptor();
rgb.putDouble(charIDToTypeID('Rd  '),rr.color.r);
rgb.putDouble(charIDToTypeID('Grn '),rr.color.g);
rgb.putDouble(charIDToTypeID('Bl  '),rr.color.b);
clr.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),rgb);
style.putObject(stringIDToTypeID('color'),charIDToTypeID('RGBC'),rgb);
}r.putObject(stringIDToTypeID('textStyle'),stringIDToTypeID('textStyle'),style);
list.putObject(stringIDToTypeID('textStyleRange'),r);
}tk.putList(stringIDToTypeID('textStyleRange'),list);
sd=new ActionDescriptor();
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
sd.putReference(charIDToTypeID('null'),ref);
sd.putObject(charIDToTypeID('T   '),stringIDToTypeID('textLayer'),tk);
executeAction(charIDToTypeID('setd'),sd,DialogModes.NO);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeApplyTextRangesToPsd(c){if(!c||!c.path||!c.outputPath)throw Error('path and outputPath are required');
var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result=null;
try{if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextStyleRanges(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeSetTextStyleRangesV2(c){var l=xinyangBridgeFind(c.layerId),ref=new ActionReference(),getd,tk,old,style,list,r,rr,sd,clr,rgb,i;
if(l.kind!==LayerKind.TEXT)throw Error('Target is not a text layer');
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
getd=executeActionGet(ref);
tk=getd.getObjectValue(stringIDToTypeID('textKey'));
old=tk.getList(stringIDToTypeID('textStyleRange')).getObjectValue(0);
style=old.getObjectValue(charIDToTypeID('TxtS'));
list=new ActionList();
for(i=0;i<c.ranges.length;i++){rr=c.ranges[i];
r=new ActionDescriptor();
r.putInteger(charIDToTypeID('From'),rr.from);
r.putInteger(charIDToTypeID('T   '),rr.to);
if(rr.fontSize!==undefined)style.putUnitDouble(charIDToTypeID('Sz  '),charIDToTypeID('#Pnt'),rr.fontSize);
if(rr.tracking!==undefined)style.putInteger(charIDToTypeID('Trck'),rr.tracking);
if(rr.color){rgb=new ActionDescriptor();
rgb.putDouble(charIDToTypeID('Rd  '),rr.color.r);
rgb.putDouble(charIDToTypeID('Grn '),rr.color.g);
rgb.putDouble(charIDToTypeID('Bl  '),rr.color.b);
style.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),rgb);
}r.putObject(charIDToTypeID('TxtS'),charIDToTypeID('TxtS'),style);
list.putObject(charIDToTypeID('TxtS'),r);
}tk.putList(stringIDToTypeID('textStyleRange'),list);
sd=new ActionDescriptor();
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
sd.putReference(charIDToTypeID('null'),ref);
sd.putObject(charIDToTypeID('T   '),charIDToTypeID('TxLr'),tk);
executeAction(charIDToTypeID('setd'),sd,DialogModes.NO);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeCloneDescriptor(src){var out=new ActionDescriptor(),i,k,t;
for(i=0;i<src.count;i++){k=src.getKey(i);
t=src.getType(k);
try{if(t===DescValueType.BOOLEANTYPE)out.putBoolean(k,src.getBoolean(k));
else if(t===DescValueType.STRINGTYPE)out.putString(k,src.getString(k));
else if(t===DescValueType.INTEGERTYPE)out.putInteger(k,src.getInteger(k));
else if(t===DescValueType.DOUBLETYPE)out.putDouble(k,src.getDouble(k));
else if(t===DescValueType.UNITDOUBLE)out.putUnitDouble(k,src.getUnitDoubleType(k),src.getUnitDoubleValue(k));
else if(t===DescValueType.ENUMERATEDTYPE)out.putEnumerated(k,src.getEnumerationType(k),src.getEnumerationValue(k));
else if(t===DescValueType.OBJECTTYPE)out.putObject(k,src.getObjectType(k),xinyangBridgeCloneDescriptor(src.getObjectValue(k)));
else if(t===DescValueType.LISTTYPE){var list=src.getList(k),copy=new ActionList(),j,lt,lk;
for(j=0;j<list.count;j++){lt=list.getType(j);
if(lt===DescValueType.OBJECTTYPE)copy.putObject(list.getObjectType(j),xinyangBridgeCloneDescriptor(list.getObjectValue(j)));
else if(lt===DescValueType.STRINGTYPE)copy.putString(list.getString(j));
else if(lt===DescValueType.INTEGER)copy.putInteger(list.getInteger(j));
else if(lt===DescValueType.DOUBLETYPE)copy.putDouble(list.getDouble(j));
else if(lt===DescValueType.UNITDOUBLE)copy.putUnitDouble(list.getUnitDoubleType(j),list.getUnitDoubleValue(j));
}out.putList(k,copy);
}}catch(ignore){}}return out;
}
function xinyangBridgeSetTextStyleRangesV4(c){var l=xinyangBridgeFind(c.layerId),ref=new ActionReference(),getd,tk,old,list,r,rr,style,sd,rgb,i;
if(l.kind!==LayerKind.TEXT)throw Error('Target is not a text layer');
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
getd=executeActionGet(ref);
tk=getd.getObjectValue(stringIDToTypeID('textKey'));
old=tk.getList(stringIDToTypeID('textStyleRange')).getObjectValue(0);
list=new ActionList();
for(i=0;i<c.ranges.length;i++){rr=c.ranges[i];
r=new ActionDescriptor();
r.putInteger(charIDToTypeID('From'),rr.from);
r.putInteger(charIDToTypeID('T   '),rr.to);
style=xinyangBridgeCloneDescriptor(old.getObjectValue(charIDToTypeID('TxtS')));
if(rr.fontSize!==undefined)style.putUnitDouble(stringIDToTypeID('size'),charIDToTypeID('#Pnt'),rr.fontSize);
if(rr.tracking!==undefined)style.putInteger(stringIDToTypeID('tracking'),rr.tracking);
if(rr.color){rgb=new ActionDescriptor();
rgb.putDouble(charIDToTypeID('Rd  '),rr.color.r);
rgb.putDouble(charIDToTypeID('Grn '),rr.color.g);
rgb.putDouble(charIDToTypeID('Bl  '),rr.color.b);
style.putObject(stringIDToTypeID('color'),charIDToTypeID('RGBC'),rgb);
}r.putObject(charIDToTypeID('TxtS'),charIDToTypeID('TxtS'),style);
list.putObject(charIDToTypeID('TxtS'),r);
}tk.putList(stringIDToTypeID('textStyleRange'),list);
sd=new ActionDescriptor();
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
sd.putReference(charIDToTypeID('null'),ref);
sd.putObject(charIDToTypeID('T   '),charIDToTypeID('TxLr'),tk);
executeAction(charIDToTypeID('setd'),sd,DialogModes.NO);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeApplyTextRangesToPsdV4(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextStyleRangesV4(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeSetTextStyleRangesV5(c) {
  var l = xinyangBridgeFind(c.layerId);
  var ref = new ActionReference();
  var getd;
  var tk;
  var old;
  var list = new ActionList();
  var r;
  var rr;
  var style;
  var sd;
  var rgb;
  var i;
  if (l.kind !== LayerKind.TEXT) throw Error('Target is not a text layer');
  ref.putIdentifier(charIDToTypeID('Lyr '), l.id);
  getd = executeActionGet(ref);
  tk = getd.getObjectValue(stringIDToTypeID('textKey'));
  old = tk.getList(stringIDToTypeID('textStyleRange')).getObjectValue(0);
  if (!c.ranges || !c.ranges.length) throw Error('ranges is required');
  for (i = 0; i < c.ranges.length; i += 1) {
    rr = c.ranges[i];
    r = new ActionDescriptor();
    r.putInteger(charIDToTypeID('From'), rr.from);
    r.putInteger(charIDToTypeID('T   '), rr.to);
    style = xinyangBridgeCloneDescriptor(old.getObjectValue(stringIDToTypeID('TxtS')));
    if (rr.fontPostScriptName !== undefined) style.putString(stringIDToTypeID('fontPostScriptName'), rr.fontPostScriptName);
    if (rr.fontFamily !== undefined) style.putString(charIDToTypeID('FntN'), rr.fontFamily);
    if (rr.fontStyle !== undefined) style.putString(stringIDToTypeID('fontStyleName'), rr.fontStyle);
    if (rr.fauxBold !== undefined) style.putBoolean(stringIDToTypeID('syntheticBold'), !!rr.fauxBold);
    if (rr.fauxItalic !== undefined) style.putBoolean(stringIDToTypeID('syntheticItalic'), !!rr.fauxItalic);
    if (rr.fontSize !== undefined) {
      style.putUnitDouble(stringIDToTypeID('size'), charIDToTypeID('#Pnt'), rr.fontSize);
      style.putUnitDouble(stringIDToTypeID('impliedFontSize'), charIDToTypeID('#Pnt'), rr.fontSize);
    }
    if (rr.tracking !== undefined) style.putInteger(stringIDToTypeID('tracking'), rr.tracking);
    if (rr.horizontalScale !== undefined) style.putDouble(stringIDToTypeID('horizontalScale'), Number(rr.horizontalScale));
    if (rr.verticalScale !== undefined) style.putDouble(stringIDToTypeID('verticalScale'), Number(rr.verticalScale));
    if (rr.baselineShift !== undefined) style.putUnitDouble(stringIDToTypeID('baselineShift'), charIDToTypeID('#Pnt'), Number(rr.baselineShift));
    if (rr.color) {
      rgb = new ActionDescriptor();
      rgb.putDouble(charIDToTypeID('Rd  '), rr.color.r);
      rgb.putDouble(charIDToTypeID('Grn '), rr.color.g);
      rgb.putDouble(charIDToTypeID('Bl  '), rr.color.b);
      style.putObject(stringIDToTypeID('color'), charIDToTypeID('RGBC'), rgb);
    }
    r.putObject(charIDToTypeID('TxtS'), charIDToTypeID('TxtS'), style);
    list.putObject(charIDToTypeID('TxtS'), r);
  }
  tk.putList(stringIDToTypeID('textStyleRange'), list);
  sd = new ActionDescriptor();
  ref = new ActionReference();
  ref.putIdentifier(charIDToTypeID('Lyr '), l.id);
  sd.putReference(charIDToTypeID('null'), ref);
  sd.putObject(charIDToTypeID('T   '), charIDToTypeID('TxLr'), tk);
  executeAction(charIDToTypeID('setd'), sd, DialogModes.NO);
  return { ok: true, layer: xinyangBridgeLayerInfo(l) };
}
function xinyangBridgeApplyTextRangesToPsdV5(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextStyleRangesV5(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeSetTextTransformMatrix(c){var l=xinyangBridgeFind(c.layerId),ref=new ActionReference(),getd,tk,m,sd;
if(l.kind!==LayerKind.TEXT)throw Error('Target is not a text layer');
if(!c.matrix)throw Error('matrix is required');
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
getd=executeActionGet(ref);
tk=getd.getObjectValue(stringIDToTypeID('textKey'));
m=new ActionDescriptor();
m.putDouble(stringIDToTypeID('xx'),c.matrix.xx);
m.putDouble(stringIDToTypeID('xy'),c.matrix.xy);
m.putDouble(stringIDToTypeID('yx'),c.matrix.yx);
m.putDouble(stringIDToTypeID('yy'),c.matrix.yy);
m.putDouble(stringIDToTypeID('tx'),c.matrix.tx);
m.putDouble(stringIDToTypeID('ty'),c.matrix.ty);
tk.putObject(stringIDToTypeID('transform'),charIDToTypeID('Trnf'),m);
sd=new ActionDescriptor();
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
sd.putReference(charIDToTypeID('null'),ref);
sd.putObject(charIDToTypeID('T   '),charIDToTypeID('TxLr'),tk);
executeAction(charIDToTypeID('setd'),sd,DialogModes.NO);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeApplyTextTransformToPsd(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextTransformMatrix(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeApplyTextTransformToPsdV2(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result,layer,t;
 if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextTransformMatrix(c);
if(c.preserveFontSize!==undefined){layer=xinyangBridgeFind(c.layerId);
t=layer.textItem.contents;
xinyangBridgeSetTextStyleRangesV5({layerId:c.layerId,ranges:[{from:0,to:t.length,fontSize:c.preserveFontSize}]});
}if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeApplyTextTransformToPsdV3(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result,layer,t,writeSize;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextTransformMatrix(c);
if(c.preserveFontSize!==undefined){layer=xinyangBridgeFind(c.layerId);
t=layer.textItem.contents;
writeSize=c.preserveFontSize*(c.matrix.xx===undefined?1:c.matrix.xx);
xinyangBridgeSetTextStyleRangesV5({layerId:c.layerId,ranges:[{from:0,to:t.length,fontSize:writeSize}]});
}if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeSetSmartObjectQuad(c){var l=xinyangBridgeFind(c.layerId),ref,d,sm,more,list,sd,after,am,al,err=0;
if(!c.quad||c.quad.length!==8)throw Error('quad must contain 8 numbers');
if(l.kind!==LayerKind.SMARTOBJECT)throw Error('Target is not a smart object');
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
d=executeActionGet(ref);
sm=d.getObjectValue(stringIDToTypeID('smartObject'));
more=d.getObjectValue(stringIDToTypeID('smartObjectMore'));
list=new ActionList();
for(var i=0;i<8;i++)list.putDouble(Number(c.quad[i]));
more.putList(stringIDToTypeID('transform'),list);
d.putObject(stringIDToTypeID('smartObjectMore'),stringIDToTypeID('smartObjectMore'),more);
sd=new ActionDescriptor();
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
sd.putReference(charIDToTypeID('null'),ref);
sd.putObject(charIDToTypeID('T   '),stringIDToTypeID('layer'),d);
executeAction(charIDToTypeID('setd'),sd,DialogModes.NO);
after=executeActionGet(ref);
try{am=after.getObjectValue(stringIDToTypeID('smartObjectMore')).getList(stringIDToTypeID('transform'));
for(i=0;i<8;i++){al=am.getDouble(i);
err=Math.max(err,Math.abs(al-Number(c.quad[i])));
}}catch(e){err=999999;
}if(err>0.5)return {ok:true,executed:true,verified:false,error:{code:'PHOTOSHOP_SMART_OBJECT_QUAD_NOT_APPLIED',message:'Action completed but read-back Quad differs',maxError:err},layer:xinyangBridgeLayerInfo(l)};
return {ok:true,executed:true,verified:true,maxError:err,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeDescriptorSnapshot(c){var l=xinyangBridgeFind(c.layerId),ref,d,more,out={layerId:l.id,name:l.name,kind:String(l.kind),keys:[]};
ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),l.id);
d=executeActionGet(ref);
function keyName(k){try{return typeIDToStringID(k);
}catch(e){try{return typeIDToCharID(k);
}catch(x){return String(k);
}}}for(var i=0;i<d.count;i++){var k=d.getKey(i),n=keyName(k),t=d.getType(k),v=null;
try{if(t===DescValueType.DOUBLETYPE)v=d.getDouble(k);
else if(t===DescValueType.INTEGERTYPE)v=d.getInteger(k);
else if(t===DescValueType.BOOLEANTYPE)v=d.getBoolean(k);
else if(t===DescValueType.STRINGTYPE)v=d.getString(k);
else if(t===DescValueType.ENUMERATEDTYPE)v={'enumType':d.getEnumerationType(k),'enumValue':d.getEnumerationValue(k)};
else if(t===DescValueType.LISTTYPE){var q=d.getList(k),a=[];
for(var j=0;j<q.count;j++){try{a.push(q.getDouble(j));
}catch(e){a.push(null);
}}v=a;
}else if(t===DescValueType.OBJECTTYPE){var o=d.getObjectValue(k);
if(n==='smartObjectMore'){try{var q2=o.getList(stringIDToTypeID('transform')),a2=[];
for(var z=0;z<q2.count;z++)a2.push(q2.getDouble(z));
v={transform:a2};
}catch(e){v={object:true};
}}else v={object:true};
} }catch(e){v={readError:String(e)};
}out.keys.push({name:n,type:String(t),value:v});
}return out;
}
function xinyangBridgeSnapshotLayerDescriptorPsd(c){var f=File(c.path),before=null,opened=null,result;if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);try{if(app.documents.length)before=app.activeDocument;opened=app.open(f);result=xinyangBridgeDescriptorSnapshot(c);result.sourcePath=f.fsName;return result;}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);}catch(e){}if(before)try{app.activeDocument=before;}catch(e){}}}
function xinyangBridgeTransformLayerPsd(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeTransform(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeMoveLayerByDelta(c){var l=xinyangBridgeFind(c.layerId);if(c.dx===undefined||c.dy===undefined)throw Error('dx and dy are required');l.translate(UnitValue(Number(c.dx),'px'),UnitValue(Number(c.dy),'px'));return {ok:true,executed:true,verified:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeMoveLayerByDeltaPsd(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeMoveLayerByDelta(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeFindDocumentById(id){for(var i=0;i<app.documents.length;i++){try{if(Number(app.documents[i].id)===Number(id))return app.documents[i];}catch(e){}}return null;}
function xinyangBridgeActivateDocumentForCommand(c){if(!c||c.documentId===undefined||c.documentId===null)return;var skip={open_document_session:true,close_document_session:true,close_document:true};if(skip[c.action])return;var d=xinyangBridgeFindDocumentById(c.documentId);if(!d)throw Error('PHOTOSHOP_DOCUMENT_CONTEXT_LOST');app.activeDocument=d;}
function xinyangBridgeOpenDocumentSession(c){var f=File(c.path),original=app.documents.length?app.activeDocument:null,doc=null,opened=false;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
for(var i=0;i<app.documents.length;i++){try{if(String(app.documents[i].fullName.fsName).toLowerCase()===String(f.fsName).toLowerCase()){doc=app.documents[i];
break;
}}catch(e){}}if(!doc){doc=app.open(f);
opened=true;
}app.activeDocument=doc;
return {ok:true,documentId:Number(doc.id),path:f.fsName,openedBySession:opened,originalActiveDocumentId:original?Number(original.id):null};
}
function xinyangBridgeCloseDocumentSession(c){var doc=xinyangBridgeFindDocumentById(c.documentId);
if(!doc)throw Error('PHOTOSHOP_DOCUMENT_CONTEXT_LOST');
if(c.openedBySession)doc.close(SaveOptions.DONOTSAVECHANGES);
if(c.originalActiveDocumentId){var old=xinyangBridgeFindDocumentById(c.originalActiveDocumentId);
if(old)app.activeDocument=old;
}return {ok:true,documentId:Number(c.documentId),closed:!!c.openedBySession,restored:!!(c.originalActiveDocumentId&&xinyangBridgeFindDocumentById(c.originalActiveDocumentId))};
}
function xinyangBridgeCloseDocument(c){var doc=xinyangBridgeFindDocumentById(c.documentId);if(!doc)throw Error('PHOTOSHOP_DOCUMENT_CONTEXT_LOST');doc.close(SaveOptions.DONOTSAVECHANGES);return {ok:true,documentId:Number(c.documentId),closed:true,save:'DONOTSAVECHANGES'};}
function xinyangBridgeDeleteLayer(c){if(c.layerId===undefined||c.layerId===null)throw Error('layerId is required');
var d=app.activeDocument,l=xinyangBridgeFind(c.layerId),name=l.name,removed=false;
try{d.activeLayer=l;
}catch(ignoreActive){}try{l.allLocked=false;
}catch(ignoreUnlock){}try{l.remove();
removed=true;
}catch(domError){var desc=new ActionDescriptor(),ref=new ActionReference();
ref.putIdentifier(charIDToTypeID('Lyr '),Number(l.id));
desc.putReference(charIDToTypeID('null'),ref);
executeAction(charIDToTypeID('Dlt '),desc,DialogModes.NO);
removed=true;
}if(!removed)throw Error('图层删除失败 '+c.layerId);
return {ok:true,deletedLayerId:c.layerId,name:name};
}
function xinyangBridgeCreateEmptyDocument(c){var fill=c&&c.backgroundFill==='transparent'?DocumentFill.TRANSPARENT:DocumentFill.WHITE;var d=app.documents.add(c.width,c.height,c.resolution||72,c.name||'RoundTrip-B',NewDocumentMode.RGB,fill);return {ok:true,documentId:Number(d.id),width:d.width,height:d.height,backgroundFill:c&&c.backgroundFill||'white'};}
function xinyangBridgeSaveDocument(c){var d=(c&&c.documentId===undefined&&app.documents.length)?app.activeDocument:xinyangBridgeFindDocumentById(c.documentId);if(!d)throw Error('PHOTOSHOP_DOCUMENT_CONTEXT_LOST');if(c.path){var f=File(c.path);if(!f.parent.exists)f.parent.create();d.saveAs(f,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);}else d.save();return {ok:true,documentId:Number(d.id),path:c.path||null};}
function xinyangBridgeInspectPsdCanonicalToFile(c){if(!c||!c.path||!c.outputPath)throw Error('path and outputPath are required');
if(typeof $.global.xinyangBridgeInspectPsdCanonical!=='function')throw Error('PHOTOSHOP_INSPECT_MODULE_NOT_LOADED');
var result=$.global.xinyangBridgeInspectPsdCanonical(c),f=File(c.outputPath);
if(!f.parent.exists)f.parent.create();
f.encoding='UTF-8';
if(!f.open('w'))throw Error('PHOTOSHOP_CANONICAL_OUTPUT_OPEN_FAILED: '+f.error);
f.write(xinyangBridgeJSONStringify(result));
f.close();
return {ok:true,path:f.fsName,sourcePreview:result.sourcePreview||null};
}
function xinyangBridgeApplySmartObjectQuadToPsd(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetSmartObjectQuad(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeApplyTextRangesToPsdV2(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result=null;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextStyleRangesV2(c);
if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeApplyTextRangesToPsdV3(c){var f=File(c.path),out=File(c.outputPath),before=null,opened=null,result,layer,ranges,i,ca,col;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
result=xinyangBridgeSetTextStyleRangesV2(c);
layer=xinyangBridgeFind(c.layerId);
ranges=layer.textItem.textStyleRanges;
for(i=0;i<c.ranges.length&&i<ranges.length;i++){ca=ranges[i].characterAttributes;
if(c.ranges[i].fontSize!==undefined)ca.size=UnitValue(c.ranges[i].fontSize,'pt');
if(c.ranges[i].tracking!==undefined)ca.tracking=c.ranges[i].tracking;
if(c.ranges[i].color){col=xinyangBridgeColor(c.ranges[i].color);
ca.color=col;
}}if(!out.parent.exists)out.parent.create();
opened.saveAs(out,new PhotoshopSaveOptions(),true,Extension.LOWERCASE);
result.path=out.fsName;
return result;
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){}if(before)try{app.activeDocument=before;
}catch(e){}}}
function xinyangBridgeSetLayer(c){var l=xinyangBridgeFind(c.layerId);
if(c.name!==undefined)l.name=c.name;
if(c.visible!==undefined)l.visible=c.visible;
if(c.opacity!==undefined){if(c.opacity<0||c.opacity>100)throw Error('Opacity must be between 0 and 100');
l.opacity=c.opacity}if(c.allLocked!==undefined)l.allLocked=c.allLocked;
if(c.blendMode!==undefined){if(!BlendMode[c.blendMode])throw Error('Unsupported blend mode: '+c.blendMode);
l.blendMode=BlendMode[c.blendMode]}if(c.x!==undefined||c.y!==undefined)l.translate(UnitValue(c.x||0,'px'),UnitValue(c.y||0,'px'));
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
// Batch property updates avoid hundreds of UI/bridge round trips when resetting a reconstruction pass.
function xinyangBridgeSetManyLayers(c){if(!c.layers||!c.layers.length)throw Error('layers is required');var out=[];for(var i=0;i<c.layers.length;i++){var item=c.layers[i],l=xinyangBridgeFind(item.layerId);if(item.visible!==undefined)l.visible=item.visible;if(item.opacity!==undefined)l.opacity=item.opacity;if(item.name!==undefined)l.name=item.name;out.push(xinyangBridgeLayerInfo(l));}return {ok:true,layers:out};}
function xinyangBridgeShape(c){var l=xinyangBridgeFind(c.layerId);if(l.kind!==LayerKind.SOLIDFILL)throw Error('Target is not a solid-fill shape layer');if(c.fill!==undefined)l.adjustment[0].color=xinyangBridgeColor(c.fill);if(c.opacity!==undefined)l.opacity=c.opacity;if(c.name!==undefined)l.name=c.name;if(c.visible!==undefined)l.visible=c.visible;return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeApplyStyle(c){var l=xinyangBridgeFind(c.layerId);xinyangBridgeSelect(c.layerId);if(c.styleName!==undefined)l.applyStyle(c.styleName);else if(c.fromLayerId!==undefined)xinyangBridgeCopyStyle(c.fromLayerId,c.layerId);else throw Error('Provide styleName or fromLayerId');return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeLayerDetailsFromLayer(l){var out={ok:true,layer:xinyangBridgeLayerInfo(l)};if(l.kind===LayerKind.TEXT)out.text=xinyangBridgeTextInfo(l.textItem);if(l.kind===LayerKind.SOLIDFILL){var rgb=l.adjustment[0].color.rgb;out.shape={fill:{r:Math.round(rgb.red),g:Math.round(rgb.green),b:Math.round(rgb.blue)}}}return out;}
function xinyangBridgeLayerDetails(c){return xinyangBridgeLayerDetailsFromLayer(xinyangBridgeFind(c.layerId));}
function xinyangBridgeLayerDetailsMany(c){if(!c||!c.layerIds||!c.layerIds.length)throw Error('layerIds is required');
var wanted={},actual={},out=[],errors=[],i,j,l,id;
for(i=0;i<c.layerIds.length;i++)wanted[String(c.layerIds[i])]=true;
function walk(container){var k,child;
for(k=0;k<container.layers.length;k++){child=container.layers[k];
id=String(child.id);
if(wanted[id])actual[id]=child;
if(child.typename==='LayerSet')walk(child);
}}if(xinyangBridgeBatchLayerIndex)actual=xinyangBridgeBatchLayerIndex;else walk(app.activeDocument);
for(i=0;i<c.layerIds.length;i++){id=String(c.layerIds[i]);
if(!actual[id]){errors.push({layerId:c.layerIds[i],error:'找不到图层 '+c.layerIds[i]});
continue;
}try{out.push(xinyangBridgeLayerDetailsFromLayer(actual[id]));
}catch(e){errors.push({layerId:c.layerIds[i],error:String(e)});
}}return {ok:errors.length===0,layers:out,errors:errors,historyFingerprint:xinyangBridgeHistoryFingerprint(app.activeDocument)};
}
function xinyangBridgeAdjustmentKind(type){var map={levels:LayerKind.LEVELS,curves:LayerKind.CURVES,brightness_contrast:LayerKind.BRIGHTNESSCONTRAST,hue_saturation:LayerKind.HUESATURATION,color_balance:LayerKind.COLORBALANCE,black_white:LayerKind.BLACKANDWHITE,vibrance:LayerKind.VIBRANCE,photo_filter:LayerKind.PHOTOFILTER,gradient_map:LayerKind.GRADIENTMAP,exposure:LayerKind.EXPOSURE,channel_mixer:LayerKind.CHANNELMIXER,selective_color:LayerKind.SELECTIVECOLOR};
if(!map[type])throw Error('Unsupported adjustment type: '+type);
return map[type];
}
function xinyangBridgeCreateAdjustment(c){var l=app.activeDocument.artLayers.add();l.kind=xinyangBridgeAdjustmentKind(c.type);l.name=c.name||c.type;if(c.opacity!==undefined)l.opacity=c.opacity;if(c.visible!==undefined)l.visible=c.visible;if(c.values!==undefined)l.adjustment=c.values;return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeSetAdjustment(c){var l=xinyangBridgeFind(c.layerId);if(l.adjustment===undefined)throw Error('Target is not an adjustment layer');if(c.values!==undefined)l.adjustment=c.values;if(c.opacity!==undefined)l.opacity=c.opacity;if(c.visible!==undefined)l.visible=c.visible;if(c.name!==undefined)l.name=c.name;return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeApplyFilter(c){var l=xinyangBridgeFind(c.layerId);
if(!c.confirm)throw Error('Destructive filters require confirm:true');
xinyangBridgeSelect(c.layerId);
if(c.filter==='gaussian_blur')l.applyGaussianBlur(c.radius);
else if(c.filter==='unsharp_mask')l.applyUnSharpMask(c.amount,c.radius,c.threshold);
else if(c.filter==='add_noise')l.applyAddNoise(c.amount,c.distribution==='gaussian'?NoiseDistribution.GAUSSIAN:NoiseDistribution.UNIFORM,!!c.monochromatic);
else if(c.filter==='motion_blur')l.applyMotionBlur(c.angle,c.distance);
else if(c.filter==='smart_blur')l.applySmartBlur(c.radius,c.threshold,c.quality==='high'?BlurQuality.HIGH:c.quality==='low'?BlurQuality.LOW:BlurQuality.MEDIUM,c.mode==='edge_only'?BlurMode.EDGEONLY:c.mode==='overlay_edge'?BlurMode.OVERLAYEDGE:BlurMode.NORMAL);
else if(c.filter==='sharpen')l.applySharpen();
else if(c.filter==='sharpen_edges')l.applySharpenEdges();
else throw Error('Unsupported filter: '+c.filter);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeSelectTool(c){var map={move:'moveTool',brush:'paintbrushTool',blur:'blurTool',smudge:'smudgeTool',pen:'penTool',marquee:'marqueeRectTool',lasso:'lassoTool',quick_select:'quickSelectTool',magic_wand:'magicWandTool'};if(!map[c.tool])throw Error('Unsupported tool: '+c.tool);app.currentTool=map[c.tool];return {ok:true,tool:app.currentTool};}
function xinyangBridgeSelection(c){var d=app.activeDocument,points=[],i,p;
if(c.mode==='all')d.selection.selectAll();
else if(c.mode==='deselect')d.selection.deselect();
else if(c.mode==='inverse')d.selection.invert();
else if(c.mode==='subject')executeAction(stringIDToTypeID('autoCutout'),new ActionDescriptor(),DialogModes.NO);
else if(c.mode==='rectangle'){if(c.x===undefined||c.y===undefined||c.width===undefined||c.height===undefined)throw Error('Rectangle selection requires x, y, width and height');
d.selection.select([[c.x,c.y],[c.x+c.width,c.y],[c.x+c.width,c.y+c.height],[c.x,c.y+c.height]],SelectionType.REPLACE,c.feather||0,c.antiAlias!==false)}else if(c.mode==='polygon'){if(!c.points||c.points.length<3)throw Error('Polygon selection requires at least three points');
for(i=0;i<c.points.length;i++){p=c.points[i];
points.push([p[0],p[1]])}d.selection.select(points,SelectionType.REPLACE,c.feather||0,c.antiAlias!==false)}else if(c.mode==='feather')d.selection.feather(c.radius);
else if(c.mode==='expand')d.selection.expand(c.amount);
else if(c.mode==='contract')d.selection.contract(c.amount);
else throw Error('Unsupported selection mode: '+c.mode);
return {ok:true,mode:c.mode};
}
function xinyangBridgeStrokeSelection(c){var d=app.activeDocument,map={inside:StrokeLocation.INSIDE,center:StrokeLocation.CENTER,outside:StrokeLocation.OUTSIDE};if(!c.confirm)throw Error('Stroking pixels requires confirm:true');if(c.width===undefined)throw Error('Stroke requires width');d.selection.stroke(xinyangBridgeColor(c.color||'#000000'),c.width,map[c.location||'inside'],ColorBlendMode.NORMAL,c.opacity===undefined?100:c.opacity,false);return {ok:true};}
function xinyangBridgeBuildSubpaths(c){var subs=[],i,j,sp,pp,pt;
if(!c.subpaths||!c.subpaths.length)throw Error('Path requires subpaths');
for(i=0;i<c.subpaths.length;i++){sp=new SubPathInfo();
sp.closed=c.subpaths[i].closed!==false;
sp.operation=ShapeOperation.SHAPEADD;
sp.entireSubPath=[];
for(j=0;j<c.subpaths[i].points.length;j++){pt=c.subpaths[i].points[j];
pp=new PathPointInfo();
pp.kind=pt.kind==='smooth'?PointKind.SMOOTHPOINT:PointKind.CORNERPOINT;
pp.anchor=pt.anchor;
pp.leftDirection=pt.leftDirection||pt.anchor;
pp.rightDirection=pt.rightDirection||pt.anchor;
sp.entireSubPath.push(pp)}subs.push(sp)}return subs;
}
function xinyangBridgeCreatePath(c){var d=app.activeDocument,path=d.pathItems.add(c.name||'Codex Path',xinyangBridgeBuildSubpaths(c));return {ok:true,name:path.name};}
// Replaces a named work path while retaining a fully editable set of anchor handles.
function xinyangBridgeUpsertPath(c){var d=app.activeDocument,n=c.name||'Codex Path',old;try{old=d.pathItems.getByName(n);old.remove()}catch(ignore){}var path=d.pathItems.add(n,xinyangBridgeBuildSubpaths(c));return {ok:true,name:path.name};}
function xinyangBridgeStrokePath(c){var d=app.activeDocument,path=d.pathItems.getByName(c.name);if(!c.confirm)throw Error('Path stroking requires confirm:true');if(c.tool)xinyangBridgeSelectTool({tool:c.tool});path.strokePath(c.tool==='blur'?ToolType.BLUR:c.tool==='smudge'?ToolType.SMUDGE:ToolType.BRUSH);return {ok:true};}
function xinyangBridgeCreateFill(c){var l=app.activeDocument.artLayers.add();
if(c.type==='solid'){l.kind=LayerKind.SOLIDFILL;
l.adjustment[0].color=xinyangBridgeColor(c.color||'#ffffff')}else if(c.type==='gradient'){l.kind=LayerKind.GRADIENTFILL;
if(c.values!==undefined)l.adjustment=c.values}else if(c.type==='pattern'){l.kind=LayerKind.PATTERNFILL;
if(c.values!==undefined)l.adjustment=c.values}else throw Error('Fill type must be solid, gradient or pattern');
l.name=c.name||('Codex '+c.type+' fill');
if(c.opacity!==undefined)l.opacity=c.opacity;
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeGroup(c){var d=app.activeDocument,g,l,i;
if(c.mode==='create'){g=d.layerSets.add();
g.name=c.name||'Codex Group';
if(c.layerIds)for(i=0;i<c.layerIds.length;i++)xinyangBridgeFind(c.layerIds[i]).move(g,ElementPlacement.INSIDE);
d.activeLayer=g;
return {ok:true,group:xinyangBridgeLayerInfo(g)}}if(c.mode==='add'){g=xinyangBridgeFind(c.groupId);
if(g.typename!=='LayerSet')throw Error('Target is not a group');
if(!c.layerIds||!c.layerIds.length)throw Error('Group add requires layerIds');
for(i=0;i<c.layerIds.length;i++)xinyangBridgeFind(c.layerIds[i]).move(g,ElementPlacement.INSIDE);
return {ok:true,group:xinyangBridgeLayerInfo(g)}}if(c.mode==='remove'){l=xinyangBridgeFind(c.layerId);
l.move(d,ElementPlacement.PLACEATBEGINNING);
return {ok:true,layer:xinyangBridgeLayerInfo(l)}}if(c.mode==='ungroup'){g=xinyangBridgeFind(c.groupId);
if(g.typename!=='LayerSet')throw Error('Target is not a group');
while(g.layers.length)g.layers[0].move(d,ElementPlacement.PLACEATBEGINNING);
g.remove();
return {ok:true}}throw Error('Unsupported group mode: '+c.mode);
}
function xinyangBridgeSelectMaskChannel(){var desc=new ActionDescriptor(),ref=new ActionReference();ref.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));desc.putReference(charIDToTypeID('null'),ref);executeAction(charIDToTypeID('slct'),desc,DialogModes.NO);}
function xinyangBridgeLayerMask(c){var d=app.activeDocument,desc,ref,using,props,mode=c.mode;
xinyangBridgeSelect(c.layerId);
if(mode==='add_white'||mode==='add_black'||mode==='reveal_selection'||mode==='hide_selection'){desc=new ActionDescriptor();
desc.putClass(charIDToTypeID('Nw  '),charIDToTypeID('Chnl'));
ref=new ActionReference();
ref.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));
desc.putReference(charIDToTypeID('At  '),ref);
using=mode==='add_white'?'RvlA':mode==='add_black'?'HdAl':mode==='reveal_selection'?'RvlS':'HdSl';
desc.putEnumerated(charIDToTypeID('Usng'),charIDToTypeID('UsrM'),charIDToTypeID(using));
executeAction(charIDToTypeID('Mk  '),desc,DialogModes.NO);
return {ok:true}}if(mode==='delete'){if(!c.confirm)throw Error('Deleting a layer mask requires confirm:true');
desc=new ActionDescriptor();
ref=new ActionReference();
ref.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));
desc.putReference(charIDToTypeID('null'),ref);
executeAction(charIDToTypeID('Dlt '),desc,DialogModes.NO);
return {ok:true}}if(mode==='select'){xinyangBridgeSelectMaskChannel();
return {ok:true}}if(mode==='invert'){xinyangBridgeSelectMaskChannel();
executeAction(charIDToTypeID('Invr'),undefined,DialogModes.NO);
return {ok:true}}if(mode==='fill'){if(c.color===undefined)throw Error('Mask fill requires color');
xinyangBridgeSelectMaskChannel();
d.selection.fill(xinyangBridgeColor(c.color),ColorBlendMode.NORMAL,c.opacity===undefined?100:c.opacity,false);
return {ok:true}}if(mode==='apply'){if(!c.confirm)throw Error('Applying a layer mask requires confirm:true');
executeAction(stringIDToTypeID('applyLayerMask'),undefined,DialogModes.NO);
return {ok:true}}if(mode==='enable'||mode==='disable'||mode==='link'||mode==='unlink'){desc=new ActionDescriptor();
ref=new ActionReference();
ref.putEnumerated(charIDToTypeID('Lyr '),charIDToTypeID('Ordn'),charIDToTypeID('Trgt'));
desc.putReference(charIDToTypeID('null'),ref);
props=new ActionDescriptor();
if(mode==='enable'||mode==='disable')props.putBoolean(stringIDToTypeID('userMaskEnabled'),mode==='enable');
else props.putBoolean(stringIDToTypeID('userMaskLinked'),mode==='link');
desc.putObject(charIDToTypeID('T   '),charIDToTypeID('Lyr '),props);
executeAction(charIDToTypeID('setd'),desc,DialogModes.NO);
return {ok:true}}throw Error('Unsupported mask mode: '+mode);
}
function xinyangBridgeSetLayerStyle(c){var l=xinyangBridgeFind(c.layerId);
xinyangBridgeSelect(c.layerId);
if(c.mode==='apply'){if(!c.styleName)throw Error('Style apply requires styleName');
l.applyStyle(c.styleName)}else if(c.mode==='copy'){if(!c.fromLayerId)throw Error('Style copy requires fromLayerId');
xinyangBridgeCopyStyle(c.fromLayerId,c.layerId)}else if(c.mode==='clear'){if(!c.confirm)throw Error('Clearing layer styles requires confirm:true');
executeAction(stringIDToTypeID('clearLayerStyle'),undefined,DialogModes.NO)}else throw Error('Style mode must be apply, copy or clear');
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeClippingMask(c){
var mode=c.mode;
if(mode!=='create'&&mode!=='release'&&mode!=='toggle')throw Error('Clipping mask mode must be create, release or toggle');
var layer=xinyangBridgeFind(c.layerId);
if(!layer||layer.typename!=='ArtLayer')throw Error('Clipping mask target must be an ArtLayer');
xinyangBridgeSelect(c.layerId);
var before=Boolean(layer.grouped),desired=mode==='toggle'?!before:mode==='create';
if(before!==desired)layer.grouped=desired;
if(Boolean(layer.grouped)!==desired)throw Error('Clipping mask state verification failed');
return {ok:true,grouped:desired,changed:before!==desired,layer:xinyangBridgeLayerInfo(layer)};
}
function xinyangBridgeLoadSelection(c){var desc=new ActionDescriptor(),target=new ActionReference(),source=new ActionReference();
target.putProperty(charIDToTypeID('Chnl'),charIDToTypeID('fsel'));
desc.putReference(charIDToTypeID('null'),target);
source.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Trsp'));
source.putIdentifier(charIDToTypeID('Lyr '),c.layerId);
desc.putReference(charIDToTypeID('T   '),source);
if(c.operation==='add')desc.putEnumerated(stringIDToTypeID('selectionModifier'),stringIDToTypeID('selectionModifierType'),stringIDToTypeID('addToSelection'));
else if(c.operation==='subtract')desc.putEnumerated(stringIDToTypeID('selectionModifier'),stringIDToTypeID('selectionModifierType'),stringIDToTypeID('removeFromSelection'));
else if(c.operation==='intersect')desc.putEnumerated(stringIDToTypeID('selectionModifier'),stringIDToTypeID('selectionModifierType'),stringIDToTypeID('intersectWithSelection'));
executeAction(charIDToTypeID('setd'),desc,DialogModes.NO);
return {ok:true};
}
function xinyangBridgeFlip(c){var d=app.activeDocument,l;
if(c.direction!=='horizontal'&&c.direction!=='vertical')throw Error('Flip direction must be horizontal or vertical');
if(c.scope==='canvas'){d.flipCanvas(c.direction==='horizontal'?Direction.HORIZONTAL:Direction.VERTICAL);
return {ok:true}}l=xinyangBridgeFind(c.layerId);
l.resize(c.direction==='horizontal'?-100:100,c.direction==='vertical'?-100:100,AnchorPosition.MIDDLECENTER);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeAnchor(value){var m={topLeft:AnchorPosition.TOPLEFT,topCenter:AnchorPosition.TOPCENTER,topRight:AnchorPosition.TOPRIGHT,middleLeft:AnchorPosition.MIDDLELEFT,center:AnchorPosition.MIDDLECENTER,middleRight:AnchorPosition.MIDDLERIGHT,bottomLeft:AnchorPosition.BOTTOMLEFT,bottomCenter:AnchorPosition.BOTTOMCENTER,bottomRight:AnchorPosition.BOTTOMRIGHT};
if(value===undefined)return AnchorPosition.MIDDLECENTER;
if(!m[value])throw Error('Unsupported transform anchor: '+value);
return m[value];
}
function xinyangBridgeTransform(c){var l=xinyangBridgeFind(c.layerId),b=l.bounds,x=Number(b[0]),y=Number(b[1]),a=xinyangBridgeAnchor(c.anchor);
if(c.x!==undefined||c.y!==undefined)l.translate(UnitValue((c.x!==undefined?c.x:x)-x,'px'),UnitValue((c.y!==undefined?c.y:y)-y,'px'));
if(c.scaleX!==undefined||c.scaleY!==undefined)l.resize(c.scaleX===undefined?100:c.scaleX,c.scaleY===undefined?c.scaleX:c.scaleY,a);
if(c.rotate!==undefined)l.rotate(c.rotate,a);
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeCopyStyle(fromId,toId){xinyangBridgeSelect(fromId);executeAction(stringIDToTypeID('copyEffects'),undefined,DialogModes.NO);xinyangBridgeSelect(toId);executeAction(stringIDToTypeID('pasteEffects'),undefined,DialogModes.NO);return {ok:true};}
function xinyangBridgeAlign(ids,how){if(!ids||ids.length<2)throw Error('对齐至少需要两个图层');for(var i=0;i<ids.length;i++)xinyangBridgeActionSelect(ids[i],i>0);var key={left:'AdLf',right:'AdRg',top:'AdTp',bottom:'AdBt',horizontal:'AdCH',vertical:'AdCV'}[how];if(!key)throw Error('不支持的对齐方式');executeAction(charIDToTypeID(key),undefined,DialogModes.NO);return {ok:true};}
function xinyangBridgeExport(c){var d=app.activeDocument, f=File(c.path);if(!f.parent.exists)f.parent.create();if(c.format==='jpg'){var o=new ExportOptionsSaveForWeb();o.format=SaveDocumentType.JPEG;o.quality=c.quality||80;d.exportDocument(f,ExportType.SAVEFORWEB,o)}else{var p=new PNGSaveOptions();d.saveAs(f,p,true,Extension.LOWERCASE)}return {ok:true,path:f.fsName};}
function xinyangBridgeExportLayer(c){var l=xinyangBridgeFind(c.layerId),b=l.bounds,box=[b[0],b[1],b[2],b[3]],source=app.activeDocument,copy=source.duplicate();try{copy.crop(box);return xinyangBridgeExport(c)}finally{copy.close(SaveOptions.DONOTSAVECHANGES);app.activeDocument=source}}

/* OCR bridge actions.  OCR itself runs outside ExtendScript in panel.js. */
function xinyangBridgeOcrNumber(value){try{if(value&&typeof value.as==='function')return Number(value.as('px'));}catch(ignoreOcrUnit){}return Number(value);}
function xinyangBridgeOcrSelectionBounds(document){try{var b=document.selection.bounds,left=xinyangBridgeOcrNumber(b[0]),top=xinyangBridgeOcrNumber(b[1]),right=xinyangBridgeOcrNumber(b[2]),bottom=xinyangBridgeOcrNumber(b[3]);if(isFinite(left)&&isFinite(top)&&isFinite(right)&&isFinite(bottom)&&right-left>1&&bottom-top>1)return {left:left,top:top,right:right,bottom:bottom};}catch(ignoreNoOcrSelection){}return null;}
function xinyangBridgeOcrTextName(value,fallback){var text=String(value||'').replace(/[\r\n\t]+/g,' ').replace(/^\s+|\s+$/g,'');if(text.length>24)text=text.substr(0,24)+'…';return text||fallback;}
function xinyangBridgeOcrFontToken(value){return String(value||'').toLowerCase().replace(/[\s_\-]+/g,'');}
function xinyangBridgeOcrResolveFont(line,c){var requested=[],i,j,key,font,token,fonts=[];
if(line){requested.push(line.font,line.fontPostScriptName,line.fontFamily);
}if(c){requested.push(c.font,c.fontPostScriptName);
}requested.push('MicrosoftYaHei','MicrosoftYaHeiUI','SourceHanSansCN-Regular','SourceHanSansSC-Regular','NotoSansCJKsc-Regular','ArialMT');
try{for(i=0;i<app.fonts.length;i++){font=app.fonts[i];
fonts.push({name:String(font.postScriptName||''),family:String(font.familyName||'')});
}}catch(ignoreOcrFonts){}for(i=0;i<requested.length;i++){token=xinyangBridgeOcrFontToken(requested[i]);
if(!token)continue;
for(j=0;j<fonts.length;j++){key=xinyangBridgeOcrFontToken(fonts[j].name);
if(key===token||xinyangBridgeOcrFontToken(fonts[j].family)===token||key.indexOf(token)>=0||token.indexOf(key)>=0)return fonts[j].name;
}}return '';
}
function xinyangBridgeOcrExportImage(c){
  if(!app.documents.length)throw Error('请先打开图片，再框选文字区域或选择图片图层');
  var document=app.activeDocument,selection=xinyangBridgeOcrSelectionBounds(document),sourceLayerId=c&&(c.layerId!==undefined?c.layerId:c.sourceLayerId),layer,previousDialogs=app.displayDialogs,previousUnits=app.preferences.rulerUnits,temporary=null;
  if(sourceLayerId!==undefined&&sourceLayerId!==null){layer=xinyangBridgeFind(sourceLayerId);document.activeLayer=layer;}else{layer=document.activeLayer;sourceLayerId=layer?layer.id:-1;}
  if(!layer||layer.typename!=='ArtLayer')throw Error(selection?'当前选区所在的活动图层不是图片图层，请先选中对应图片':'当前选中的不是图片图层，请重新选择');
  if(layer.kind===LayerKind.TEXT)throw Error('当前选中的是文字图层，请选择原图片图层');
  if(!layer.visible)throw Error('当前图片图层不可见，请先显示该图层');
  if(!(Number(sourceLayerId)>0))throw Error('无法读取当前图片图层，请重新选择后再试');
  var b=layer.bounds,size={left:xinyangBridgeOcrNumber(b[0]),top:xinyangBridgeOcrNumber(b[1]),right:xinyangBridgeOcrNumber(b[2]),bottom:xinyangBridgeOcrNumber(b[3])};
  if(!isFinite(size.left)||!isFinite(size.top)||!isFinite(size.right)||!isFinite(size.bottom))throw Error('无法读取当前图层的像素边界，请重新选择图片图层');
  size.width=size.right-size.left;size.height=size.bottom-size.top;
  var canvasWidth=Math.max(1,Math.round(xinyangBridgeOcrNumber(document.width))),canvasHeight=Math.max(1,Math.round(xinyangBridgeOcrNumber(document.height))),left,top,right,bottom;
  if(selection){left=selection.left;top=selection.top;right=selection.right;bottom=selection.bottom;if(Math.min(right,size.right)-Math.max(left,size.left)<=1||Math.min(bottom,size.bottom)-Math.max(top,size.top)<=1)throw Error('当前选区与选中的图片图层没有重叠内容');}
  else{left=Math.max(0,Math.floor(size.left));top=Math.max(0,Math.floor(size.top));right=Math.min(canvasWidth,Math.ceil(size.right));bottom=Math.min(canvasHeight,Math.ceil(size.bottom));}
  var width=Math.max(1,Math.ceil(right-left)),height=Math.max(1,Math.ceil(bottom-top));
  if(!(width>1&&height>1))throw Error('当前识别范围过小，请重新框选文字区域或选择图片图层');
  var tempFile=new File(Folder.temp.fsName+'/xinyangBridge_ps_ocr_'+(new Date()).getTime()+'_'+Number(sourceLayerId)+'.png');
  try{
    app.displayDialogs=DialogModes.NO;app.preferences.rulerUnits=Units.PIXELS;
    temporary=app.documents.add(UnitValue(width,'px'),UnitValue(height,'px'),document.resolution,'Codex OCR 临时图片',NewDocumentMode.RGB,DocumentFill.TRANSPARENT);
    app.activeDocument=document;
    var duplicated=layer.duplicate(temporary,ElementPlacement.PLACEATBEGINNING);app.activeDocument=temporary;
    var duplicatedBounds=duplicated.bounds,duplicatedLeft=xinyangBridgeOcrNumber(duplicatedBounds[0]),duplicatedTop=xinyangBridgeOcrNumber(duplicatedBounds[1]);
    duplicated.translate(UnitValue(size.left-left-duplicatedLeft,'px'),UnitValue(size.top-top-duplicatedTop,'px'));
    var pngOptions=new PNGSaveOptions();pngOptions.interlaced=false;temporary.saveAs(tempFile,pngOptions,true,Extension.LOWERCASE);
    return {ok:true,documentId:Number(document.id),layerId:Number(sourceLayerId),layerName:String(layer.name||'选中图片'),scope:selection?'selection':'layer',scopeLabel:selection?'当前选区':'当前选中图片',originX:left,originY:top,width:width,height:height,resolution:Number(document.resolution)||72,tempPath:tempFile.fsName,fileName:tempFile.name};
  }finally{
    if(temporary)try{temporary.close(SaveOptions.DONOTSAVECHANGES);}catch(ignoreCloseOcrTemp){}
    try{app.activeDocument=document;document.activeLayer=layer;}catch(ignoreRestoreOcrLayer){}
    app.preferences.rulerUnits=previousUnits;app.displayDialogs=previousDialogs;
  }
}
function xinyangBridgeOcrCreateTextLayers(c){
  if(!app.documents.length)throw Error('识别来源文档已经关闭');
  var document=app.activeDocument;if(c&&c.documentId!==undefined&&Number(document.id)!==Number(c.documentId))throw Error('当前文档已切换，请重新识别选中图片');
  var sourceLayer=xinyangBridgeFind(c&&c.sourceLayerId!==undefined?c.sourceLayerId:c&&c.layerId);if(!sourceLayer)throw Error('原图片图层已不存在，请重新识别');
  var lines=c&&c.lines instanceof Array?c.lines:[];if(!lines.length)throw Error('没有可生成的 OCR 文字');if(lines.length>500)throw Error('单次最多生成 500 行文字，请拆分图片后重试');
  var parent=sourceLayer.parent,root=null,target=parent,created=[],fonts={},i,line,textLayer,x,y,w,h,size,requestedFont,color,item;
  if(lines.length>1){try{root=parent.layerSets.add();}catch(ignoreNestedOcrGroup){root=document.layerSets.add();}root.name=String(c.groupName||('OCR文字_'+xinyangBridgeOcrTextName(sourceLayer.name,'图片')));try{root.move(sourceLayer,ElementPlacement.PLACEBEFORE);}catch(ignoreMoveOcrGroup){}target=root;}
  for(i=0;i<lines.length;i++){
    line=lines[i]||{};textLayer=target.artLayers.add();textLayer.kind=LayerKind.TEXT;textLayer.name=('0'+(i+1)).slice(-2)+'_'+xinyangBridgeOcrTextName(line.text,'识别文字');
    item=textLayer.textItem;item.kind=TextType.POINTTEXT;item.contents=String(line.text||'');requestedFont=xinyangBridgeOcrResolveFont(line,c||{});if(requestedFont)try{item.font=requestedFont;fonts[requestedFont]=true;}catch(ignoreOcrFontWrite){}
    x=Number(line.x);y=Number(line.y);if(!isFinite(x)&&line.box)x=Number(line.box.x);if(!isFinite(y)&&line.box)y=Number(line.box.y);if(!isFinite(x))x=0;if(!isFinite(y))y=0;
    w=Number(line.width);h=Number(line.height);if(line.box){if(!(w>0))w=Number(line.box.width);if(!(h>0))h=Number(line.box.height);}if(!(h>0))h=18;if(!(w>0))w=Math.max(1,h*String(line.text||'').length*0.75);
    size=Number(line.fontSize||line.size);if(!(size>0))size=h*1.12;item.size=UnitValue(Math.max(1,Math.min(1296,size)),'px');
    color=line.color||c.color||'#111111';try{item.color=xinyangBridgeColor(color);}catch(ignoreOcrColor){item.color=xinyangBridgeColor('#111111');}
    try{item.horizontalScale=100;item.verticalScale=100;item.tracking=Number(line.tracking||0);}catch(ignoreOcrStyle){}
    item.position=[UnitValue(x,'px'),UnitValue(y+h,'px')];if(Number(line.angle))try{textLayer.rotate(Number(line.angle),AnchorPosition.MIDDLECENTER);}catch(ignoreOcrRotate){}
    if(line.fauxBold!==undefined)try{item.fauxBold=!!line.fauxBold;}catch(ignoreOcrBold){}
    if(line.fauxItalic!==undefined)try{item.fauxItalic=!!line.fauxItalic;}catch(ignoreOcrItalic){}
    if(lines.length===1)try{textLayer.move(sourceLayer,ElementPlacement.PLACEBEFORE);}catch(ignoreMoveOcrText){}
    created.push(xinyangBridgeLayerInfo(textLayer));
  }
  if(!created.length)throw Error('没有可生成的 OCR 文字行');
  try{document.activeLayer=lines.length>1?root:xinyangBridgeFind(created[created.length-1].id);}catch(ignoreOcrActiveLayer){}
  var fontNames=[];for(requestedFont in fonts)if(fonts.hasOwnProperty(requestedFont))fontNames.push(requestedFont);
  return {ok:true,documentId:Number(document.id),sourceLayerId:Number(sourceLayer.id),groups:lines.length>1?1:0,layers:created.length,created:created,singleLine:lines.length===1,fontSummary:fontNames.join('、')||'Photoshop 默认字体'};
}
function xinyangBridgeSave(c){if(!c.confirm)throw Error('保存操作需要 confirm:true');var d=app.activeDocument;if(c.path){d.saveAs(File(c.path))}else d.save();return {ok:true};}
function xinyangBridgeDuplicate(c){var d=app.activeDocument,l=xinyangBridgeFind(c.layerId||d.activeLayer.id),n=l.duplicate();if(c.name)n.name=c.name;return {ok:true,layer:xinyangBridgeLayerInfo(n)};}
function xinyangBridgeCropSelection(c){var d=app.activeDocument,l=xinyangBridgeFind(c.layerId);d.activeLayer=l;d.selection.invert();d.selection.clear();d.selection.deselect();return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeRect(c){var d=app.activeDocument,l=d.artLayers.add();l.name=c.name||'Codex Rectangle';d.selection.select([[c.x,c.y],[c.x+c.width,c.y],[c.x+c.width,c.y+c.height],[c.x,c.y+c.height]],SelectionType.REPLACE,0,false);d.selection.fill(xinyangBridgeColor(c.color||'#000000'),ColorBlendMode.NORMAL,c.opacity===undefined?100:c.opacity,false);d.selection.deselect();return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeMoveTop(c){var d=app.activeDocument,l=xinyangBridgeFind(c.layerId);l.move(d,ElementPlacement.PLACEATBEGINNING);return {ok:true,layer:xinyangBridgeLayerInfo(l)};}
function xinyangBridgeEffects(c){var d=app.activeDocument,ref=new ActionReference(),setd=new ActionDescriptor(),fx=new ActionDescriptor(),ds=new ActionDescriptor(),fr=new ActionDescriptor(),col=new ActionDescriptor();
ref.putIdentifier(charIDToTypeID('Lyr '),c.layerId);
setd.putReference(charIDToTypeID('null'),ref);
if(c.shadow!==false){ds.putBoolean(stringIDToTypeID('enabled'),true);
ds.putBoolean(stringIDToTypeID('present'),true);
ds.putBoolean(stringIDToTypeID('showInDialog'),true);
ds.putUnitDouble(stringIDToTypeID('opacity'),charIDToTypeID('#Prc'),c.shadowOpacity===undefined?65:c.shadowOpacity);
ds.putUnitDouble(stringIDToTypeID('angle'),charIDToTypeID('#Ang'),c.angle===undefined?120:c.angle);
ds.putUnitDouble(stringIDToTypeID('distance'),charIDToTypeID('#Pxl'),c.distance===undefined?6:c.distance);
ds.putUnitDouble(stringIDToTypeID('chokeMatte'),charIDToTypeID('#Prc'),0);
ds.putUnitDouble(stringIDToTypeID('blur'),charIDToTypeID('#Pxl'),c.blur===undefined?8:c.blur);
col.putDouble(charIDToTypeID('Rd  '),20);
col.putDouble(charIDToTypeID('Grn '),35);
col.putDouble(charIDToTypeID('Bl  '),20);
ds.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),col);
ds.putEnumerated(charIDToTypeID('Md  '),charIDToTypeID('BlnM'),charIDToTypeID('Mltp'));
fx.putObject(charIDToTypeID('DrSh'),charIDToTypeID('DrSh'),ds);
}if(c.stroke){fr.putBoolean(stringIDToTypeID('enabled'),true);
fr.putBoolean(stringIDToTypeID('present'),true);
fr.putUnitDouble(stringIDToTypeID('size'),charIDToTypeID('#Pxl'),c.strokeSize||2);
fr.putUnitDouble(stringIDToTypeID('opacity'),charIDToTypeID('#Prc'),100);
fr.putEnumerated(stringIDToTypeID('style'),stringIDToTypeID('FrFl'),stringIDToTypeID('OutF'));
fr.putEnumerated(stringIDToTypeID('paintType'),stringIDToTypeID('PntT'),stringIDToTypeID('SClr'));
col=new ActionDescriptor();
col.putDouble(charIDToTypeID('Rd  '),c.strokeColor?parseInt(c.strokeColor.substr(1,2),16):255);
col.putDouble(charIDToTypeID('Grn '),c.strokeColor?parseInt(c.strokeColor.substr(3,2),16):220);
col.putDouble(charIDToTypeID('Bl  '),c.strokeColor?parseInt(c.strokeColor.substr(5,2),16):120);
fr.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),col);
fx.putObject(charIDToTypeID('FrFX'),charIDToTypeID('FrFX'),fr);
}setd.putObject(charIDToTypeID('T   '),charIDToTypeID('Lefx'),fx);
executeAction(charIDToTypeID('setd'),setd,DialogModes.NO);
return {ok:true,layer:xinyangBridgeLayerInfo(xinyangBridgeFind(c.layerId))};
}
function xinyangBridgeShapeStroke(shape,c){var s=c&&c.stroke;
if(!s||s.readStatus!=='ok')return;
var info=new ActionDescriptor(),content=new ActionDescriptor(),rgb=new ActionDescriptor(),dash=new ActionList(),col=s.color||{r:0,g:0,b:0};
info.putInteger(stringIDToTypeID('strokeStyleVersion'),2);
info.putBoolean(stringIDToTypeID('strokeEnabled'),s.enabled!==false);
info.putBoolean(stringIDToTypeID('fillEnabled'),true);
info.putUnitDouble(stringIDToTypeID('strokeStyleLineWidth'),charIDToTypeID('#Pxl'),Number(s.width||1));
info.putUnitDouble(stringIDToTypeID('strokeStyleLineDashOffset'),charIDToTypeID('#Pnt'),0);
info.putDouble(stringIDToTypeID('strokeStyleMiterLimit'),100);
info.putEnumerated(stringIDToTypeID('strokeStyleLineCapType'),stringIDToTypeID('strokeStyleLineCapType'),stringIDToTypeID('strokeStyleButtCap'));
info.putEnumerated(stringIDToTypeID('strokeStyleLineJoinType'),stringIDToTypeID('strokeStyleLineJoinType'),stringIDToTypeID('strokeStyleMiterJoin'));
info.putEnumerated(stringIDToTypeID('strokeStyleLineAlignment'),stringIDToTypeID('strokeStyleLineAlignment'),stringIDToTypeID(s.position||'strokeStyleAlignCenter'));
info.putBoolean(stringIDToTypeID('strokeStyleScaleLock'),false);
info.putBoolean(stringIDToTypeID('strokeStyleStrokeAdjust'),false);
info.putList(stringIDToTypeID('strokeStyleLineDashSet'),dash);
info.putEnumerated(stringIDToTypeID('strokeStyleBlendMode'),stringIDToTypeID('blendMode'),stringIDToTypeID(s.blendMode||'normal'));
info.putUnitDouble(stringIDToTypeID('strokeStyleOpacity'),charIDToTypeID('#Prc'),Number(s.opacity===undefined?100:s.opacity));
rgb.putDouble(charIDToTypeID('Rd  '),Number(col.r||0));
rgb.putDouble(charIDToTypeID('Grn '),Number(col.g||0));
rgb.putDouble(charIDToTypeID('Bl  '),Number(col.b||0));
content.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),rgb);
info.putObject(stringIDToTypeID('strokeStyleContent'),stringIDToTypeID('solidColorLayer'),content);
info.putDouble(stringIDToTypeID('strokeStyleResolution'),72);
shape.putObject(stringIDToTypeID('AGMStrokeStyleInfo'),stringIDToTypeID('strokeStyle'),info);
}
function xinyangBridgeShapeRect(c){var d=new ActionDescriptor(),ref=new ActionReference(),u=new ActionDescriptor(),fill=new ActionDescriptor(),rgb=new ActionDescriptor(),shape=new ActionDescriptor(),r=xinyangBridgeColor(c.fill||'#000000'),q=c.radius||0,k=c.corners||{};
ref.putClass(stringIDToTypeID('contentLayer'));
d.putReference(charIDToTypeID('null'),ref);
rgb.putDouble(charIDToTypeID('Rd  '),r.rgb.red);
rgb.putDouble(charIDToTypeID('Grn '),r.rgb.green);
rgb.putDouble(charIDToTypeID('Bl  '),r.rgb.blue);
fill.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),rgb);
u.putObject(charIDToTypeID('Type'),stringIDToTypeID('solidColorLayer'),fill);
shape.putInteger(stringIDToTypeID('unitValueQuadVersion'),1);
shape.putUnitDouble(charIDToTypeID('Top '),charIDToTypeID('#Pxl'),c.y);
shape.putUnitDouble(charIDToTypeID('Left'),charIDToTypeID('#Pxl'),c.x);
shape.putUnitDouble(charIDToTypeID('Btom'),charIDToTypeID('#Pxl'),c.y+c.height);
shape.putUnitDouble(charIDToTypeID('Rght'),charIDToTypeID('#Pxl'),c.x+c.width);
shape.putUnitDouble(stringIDToTypeID('topLeft'),charIDToTypeID('#Pxl'),k.topLeft===undefined?q:k.topLeft);
shape.putUnitDouble(stringIDToTypeID('topRight'),charIDToTypeID('#Pxl'),k.topRight===undefined?q:k.topRight);
shape.putUnitDouble(stringIDToTypeID('bottomLeft'),charIDToTypeID('#Pxl'),k.bottomLeft===undefined?q:k.bottomLeft);
shape.putUnitDouble(stringIDToTypeID('bottomRight'),charIDToTypeID('#Pxl'),k.bottomRight===undefined?q:k.bottomRight);
xinyangBridgeShapeStroke(shape,c);
u.putObject(charIDToTypeID('Shp '),charIDToTypeID('Rctn'),shape);
d.putObject(charIDToTypeID('Usng'),stringIDToTypeID('contentLayer'),u);
executeAction(charIDToTypeID('Mk  '),d,DialogModes.NO);
var l=app.activeDocument.activeLayer;
if(c.name)l.name=c.name;
if(c.opacity!==undefined)l.opacity=c.opacity;
return {ok:true,layer:xinyangBridgeLayerInfo(l)};
}
function xinyangBridgeShapeEllipse(c){var d=new ActionDescriptor(),ref=new ActionReference(),u=new ActionDescriptor(),fill=new ActionDescriptor(),rgb=new ActionDescriptor(),shape=new ActionDescriptor(),r=xinyangBridgeColor(c.fill||'#000000'),x=Number(c.x),y=Number(c.y),w=Number(c.width),h=Number(c.height);
function make(left,top,width,height){var desc=new ActionDescriptor(),aref=new ActionReference(),au=new ActionDescriptor(),afill=new ActionDescriptor(),argb=new ActionDescriptor(),ashape=new ActionDescriptor();
aref.putClass(stringIDToTypeID('contentLayer'));
desc.putReference(charIDToTypeID('null'),aref);
argb.putDouble(charIDToTypeID('Rd  '),r.rgb.red);
argb.putDouble(charIDToTypeID('Grn '),r.rgb.green);
argb.putDouble(charIDToTypeID('Bl  '),r.rgb.blue);
afill.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),argb);
au.putObject(charIDToTypeID('Type'),stringIDToTypeID('solidColorLayer'),afill);
ashape.putInteger(stringIDToTypeID('unitValueQuadVersion'),1);
ashape.putUnitDouble(charIDToTypeID('Top '),charIDToTypeID('#Pxl'),top);
ashape.putUnitDouble(charIDToTypeID('Left'),charIDToTypeID('#Pxl'),left);
ashape.putUnitDouble(charIDToTypeID('Btom'),charIDToTypeID('#Pxl'),top+height);
ashape.putUnitDouble(charIDToTypeID('Rght'),charIDToTypeID('#Pxl'),left+width);
xinyangBridgeShapeStroke(ashape,c);
au.putObject(charIDToTypeID('Shp '),charIDToTypeID('Elps'),ashape);
desc.putObject(charIDToTypeID('Usng'),stringIDToTypeID('contentLayer'),au);
executeAction(charIDToTypeID('Mk '),desc,DialogModes.NO);
return app.activeDocument.activeLayer;
}try{if(w>=10&&h>=10){var direct=make(x,y,w,h);
if(c.name)direct.name=c.name;
return {ok:true,layer:xinyangBridgeLayerInfo(direct)};
}}catch(directError){}var docW=Math.max(Number(app.activeDocument.width),w,20),docH=Math.max(Number(app.activeDocument.height),h,20),base=make(0,0,docW,docH);
base.resize(100*w/docW,100*h/docH,AnchorPosition.MIDDLECENTER);
base.translate(UnitValue(x+w/2-docW/2,'px'),UnitValue(y+h/2-docH/2,'px'));
if(c.name)base.name=c.name;
return {ok:true,layer:xinyangBridgeLayerInfo(base)};
}
// Test-only fixture. It creates native parameterized shapes; production callers should use existing actions.
function xinyangBridgeCreateShapeGeometryFixture(c){var d=app.documents.add(800,600,72,'shape-geometry',NewDocumentMode.RGB,DocumentFill.WHITE),out={ok:true,layers:{}};
out.layers.rectangle=xinyangBridgeShapeRect({name:'Fixture Rectangle',x:40,y:40,width:180,height:100,fill:'#E54B4B'}).layer;
out.layers.roundedRectangle=xinyangBridgeShapeRect({name:'Fixture Rounded Rectangle',x:300,y:40,width:180,height:100,radius:24,fill:'#4B8FE5'}).layer;
out.layers.independentRadius=xinyangBridgeShapeRect({name:'Fixture Independent Radius',x:40,y:230,width:180,height:120,corners:{topLeft:8,topRight:16,bottomRight:24,bottomLeft:32},fill:'#5AAF67'}).layer;
out.layers.ellipse=xinyangBridgeShapeEllipse({name:'Fixture Ellipse',x:300,y:230,width:180,height:120,fill:'#B55AE5'}).layer;
xinyangBridgeCreatePath({name:'Fixture Custom Path',subpaths:[{closed:true,points:[{anchor:[580,230]},{anchor:[720,280]},{anchor:[650,380]},{anchor:[560,340]}]}]});
if(c&&c.path){var f=File(c.path),o=new PhotoshopSaveOptions();
if(!f.parent.exists)f.parent.create();
d.saveAs(f,o,true,Extension.LOWERCASE);
out.path=f.fsName;
}return out;
}
// Test-only Smart Object fixture; it exercises the existing place/transform execution path.
function xinyangBridgeCreateSmartObjectTransformFixture(c){if(!c||!c.sourcePath||!c.path)throw Error('sourcePath and path are required');
var d=app.documents.add(1600,1000,72,'smart-object-transform',NewDocumentMode.RGB,DocumentFill.WHITE),out={ok:true,layers:{},linked:{readStatus:'not_present'}},phase='start';
function add(key,name,x,y,sx,sy,rot,flip){phase=key+'.place';
var l=xinyangBridgePlace(c.sourcePath,name);
phase=key+'.transform';
l=xinyangBridgeTransform({layerId:l.id,x:x,y:y,scaleX:sx,scaleY:sy,rotate:rot,anchor:'center'}).layer;
if(flip){phase=key+'.flip';
xinyangBridgeSelect(l.id);
app.activeDocument.activeLayer.resize(-100,100,AnchorPosition.MIDDLECENTER);
l=xinyangBridgeLayerInfo(app.activeDocument.activeLayer);
}out.layers[key]=l;
}try{add('embeddedIdentity','Fixture Embedded Identity',60,60,100,100,0,false);
add('scale50','Fixture Scale 50',450,60,50,50,0,false);
add('nonUniform','Fixture Non Uniform',800,60,70,40,0,false);
add('rotate30','Fixture Rotate 30',60,500,100,100,30,false);
add('flipHorizontal','Fixture Flip Horizontal',500,500,100,100,0,true);
add('rotateScale','Fixture Rotate Scale',900,500,65,65,30,false);
}catch(e){throw Error('SMART_OBJECT_FIXTURE_FAILED at '+phase+': '+e);
}try{phase='linked.place';
out.layers.linked=xinyangBridgePlaceLinked(c.sourcePath,'Fixture Linked');
phase='linked.transform';
xinyangBridgeTransform({layerId:out.layers.linked.id,x:1200,y:500,scaleX:50,scaleY:50,rotate:0,anchor:'center'});
out.layers.linked=xinyangBridgeLayerInfo(app.activeDocument.activeLayer);
out.linked={readStatus:'ok'};
}catch(linkError){out.linked={readStatus:'unsupported',error:{code:'PHOTOSHOP_LINKED_PLACE_UNAVAILABLE',message:String(linkError)}};
}phase='save';
var f=File(c.path),o=new PhotoshopSaveOptions();
if(!f.parent.exists)f.parent.create();
d.saveAs(f,o,true,Extension.LOWERCASE);
out.path=f.fsName;
return out;
}
// Text V2 discovery fixture. Multi-style/paragraph AM cases are added only after descriptor fields are confirmed.
function xinyangBridgeCreateTextInspectorFixture(c){if(!c||!c.path)throw Error('path is required');
var d=app.documents.add(1200,800,72,'text-inspector',NewDocumentMode.RGB,DocumentFill.WHITE),out={ok:true,layers:{}};
out.layers.basic=xinyangBridgeText({name:'Fixture Basic Text',text:'厂家供应',x:80,y:120,size:48,color:'#202020',tracking:0}).layer;
out.layers.tracking=xinyangBridgeText({name:'Fixture Tracking Text',text:'支持来图定制',x:80,y:240,size:48,color:'#2050A0',tracking:100}).layer;
out.layers.leading=xinyangBridgeText({name:'Fixture Leading Text',text:'厂家供应\r支持定制',x:80,y:380,size:48,color:'#6020A0',leading:60}).layer;
out.layers.transform=xinyangBridgeText({name:'Fixture Transform Text',text:'TRANSFORM 100',x:80,y:600,size:100,color:'#A02020',tracking:0}).layer;
xinyangBridgeTransform({layerId:out.layers.transform.id,scaleX:20,scaleY:20,anchor:'center'});
out.layers.transform=xinyangBridgeLayerInfo(app.activeDocument.activeLayer);
var f=File(c.path),o=new PhotoshopSaveOptions();
if(!f.parent.exists)f.parent.create();
d.saveAs(f,o,true,Extension.LOWERCASE);
out.path=f.fsName;
return out;
}
// Test-only minimal Round Trip source fixture. It deliberately uses only currently writable primitives.
function xinyangBridgeCreateBasicRoundTripFixture(c){if(!c||!c.sourcePath||!c.path)throw Error('sourcePath and path are required');
var d=app.documents.add(1000,1000,72,'basic-round-trip',NewDocumentMode.RGB,DocumentFill.WHITE),out={ok:true,layers:{}};
out.layers.background=xinyangBridgeShapeRect({name:'BG_RECT',x:0,y:0,width:1000,height:1000,fill:'#F2F2F2'}).layer;
out.layers.product=xinyangBridgePlace(c.sourcePath,'PRODUCT');
xinyangBridgeTransform({layerId:out.layers.product.id,x:320,y:260,scaleX:35,scaleY:35,rotate:15,anchor:'center'});
out.layers.product=xinyangBridgeLayerInfo(app.activeDocument.activeLayer);
out.layers.title=xinyangBridgeText({name:'TITLE',text:'测试主标题',x:420,y:120,size:80,color:'#202020',tracking:20}).layer;
out.layers.subtitle=xinyangBridgeText({name:'SUBTITLE',text:'厂家供应 支持定制',x:420,y:240,size:36,color:'#505050',tracking:0}).layer;
out.layers.buttonBg=xinyangBridgeShapeRect({name:'BUTTON_BG',x:420,y:700,width:300,height:90,fill:'#D64545'}).layer;
out.layers.buttonText=xinyangBridgeText({name:'BUTTON_TEXT',text:'立即咨询',x:505,y:755,size:32,color:'#FFFFFF',tracking:0}).layer;
var g=d.layerSets.add();
g.name='00_ROOT';
var ids=[out.layers.background.id,out.layers.product.id,out.layers.title.id,out.layers.subtitle.id,out.layers.buttonBg.id,out.layers.buttonText.id];
for(var i=0;i<ids.length;i++)xinyangBridgeFind(ids[i]).move(g,ElementPlacement.INSIDE);
var f=File(c.path),o=new PhotoshopSaveOptions();
if(!f.parent.exists)f.parent.create();
d.saveAs(f,o,true,Extension.LOWERCASE);
out.group=xinyangBridgeLayerInfo(g);
out.path=f.fsName;
return out;
}
var xinyangBridgeBatchContext=null;
var xinyangBridgeBatchResult=null;
var xinyangBridgeBatchError=null;
var xinyangBridgeBatchLayerIndex=null;

function xinyangBridgeBatchOperationInner(op){
  var type=String(op&&op.type||''),style=op&&op.style||{},layerId=op&&op.layerId;
  if(type==='text.replaceAndStyle'){
    return xinyangBridgeText({layerId:layerId,text:op.text,font:style.fontFamily||style.font,size:style.fontSize,leading:style.leading,tracking:style.tracking,color:style.color,justification:style.align||style.justification,x:op.x,y:op.y,boxWidth:style.boxWidth,boxHeight:style.boxHeight,horizontalScale:style.horizontalScale,verticalScale:style.verticalScale,fauxBold:style.fauxBold,fauxItalic:style.fauxItalic});
  }
  if(type==='text.replace') return xinyangBridgeText({layerId:layerId,text:op.text});
  if(type==='text.update') return xinyangBridgeText({layerId:layerId,text:op.text});
  if(type==='text.font'||type==='text.size'||type==='text.leading'||type==='text.tracking'||type==='text.color'||type==='text.alignment') return xinyangBridgeText({layerId:layerId,font:op.fontFamily||op.font,size:op.fontSize,leading:op.leading,tracking:op.tracking,color:op.color,justification:op.align||op.justification});
  if(type==='text.style') return xinyangBridgeText({layerId:layerId,font:op.fontFamily||op.font,size:op.fontSize,leading:op.leading,tracking:op.tracking,color:op.color,justification:op.align||op.justification,boxWidth:op.boxWidth,boxHeight:op.boxHeight});
  if(type==='text.position') return xinyangBridgeText({layerId:layerId,x:op.x,y:op.y});
  if(type==='text.boxSize') return xinyangBridgeText({layerId:layerId,boxWidth:op.width===undefined?op.boxWidth:op.width,boxHeight:op.height===undefined?op.boxHeight:op.height});
  if(type==='text.box') return xinyangBridgeText({layerId:layerId,boxWidth:op.width===undefined?op.boxWidth:op.width,boxHeight:op.height===undefined?op.boxHeight:op.height});
  if(type==='layer.move'){
    if(op.x!==undefined||op.y!==undefined) return xinyangBridgeTransform({layerId:layerId,x:op.x,y:op.y,anchor:op.anchor});
    return xinyangBridgeMoveLayerByDelta({layerId:layerId,dx:op.dx||0,dy:op.dy||0});
  }
  if(type==='layer.resize') return xinyangBridgeTransform({layerId:layerId,scaleX:op.scaleX,scaleY:op.scaleY,anchor:op.anchor});
  if(type==='layer.rotate') return xinyangBridgeTransform({layerId:layerId,rotate:op.rotate,anchor:op.anchor});
  if(type==='layer.opacity') return xinyangBridgeSetLayer({layerId:layerId,opacity:op.opacity});
  if(type==='layer.visibility') return xinyangBridgeSetLayer({layerId:layerId,visible:op.visible});
  if(type==='layer.rename') return xinyangBridgeSetLayer({layerId:layerId,name:op.name});
  if(type==='layer.set') return xinyangBridgeSetLayer(op);
  if(type==='layer.delete') return xinyangBridgeDeleteLayer({layerId:layerId});
  if(type==='layer.duplicate') return xinyangBridgeDuplicate({layerId:layerId,name:op.name});
  if(type==='layer.reorder') return xinyangBridgeMoveTop({layerId:layerId});
  if(type==='smartObject.replace') return xinyangBridgeReplaceSmart(layerId,op.path||op.assetPath);
  if(type==='smartObject.scale'||type==='smartObject.position') return xinyangBridgeTransform({layerId:layerId,x:op.x,y:op.y,scaleX:op.scaleX,scaleY:op.scaleY,rotate:op.rotate,anchor:op.anchor});
  if(type==='smartObject.transform') return xinyangBridgeTransform({layerId:layerId,x:op.x,y:op.y,scaleX:op.scaleX,scaleY:op.scaleY,rotate:op.rotate,anchor:op.anchor});
  if(type==='smartObject.quad') return xinyangBridgeSetSmartObjectQuad({layerId:layerId,quad:op.quad});
  if(type==='shape.fill') return xinyangBridgeShape({layerId:layerId,fill:op.fill,opacity:op.opacity});
  if(type==='shape.style') return xinyangBridgeShape({layerId:layerId,fill:op.fill,opacity:op.opacity,name:op.name,visible:op.visible});
  if(type==='group.create') return xinyangBridgeGroup({mode:'create',name:op.name,layerIds:op.layerIds});
  if(type==='group.add') return xinyangBridgeGroup({mode:'add',groupId:op.groupId,layerIds:op.layerIds});
  if(type==='group.remove') return xinyangBridgeGroup({mode:'remove',layerId:layerId});
  if(type==='group.duplicate') return xinyangBridgeDuplicate({layerId:op.groupId,name:op.name});
  if(type==='group.move'){var groupId=op.groupId===undefined?layerId:op.groupId;if(op.x!==undefined||op.y!==undefined)return xinyangBridgeTransform({layerId:groupId,x:op.x,y:op.y,anchor:op.anchor});return xinyangBridgeMoveLayerByDelta({layerId:groupId,dx:op.dx||0,dy:op.dy||0});}
  if(type==='group.reorder') return xinyangBridgeMoveTop({layerId:op.groupId===undefined?layerId:op.groupId});
  if(type==='group.visibility') return xinyangBridgeSetLayer({layerId:op.groupId===undefined?layerId:op.groupId,visible:op.visible});
  if(type==='group.rename') return xinyangBridgeSetLayer({layerId:op.groupId===undefined?layerId:op.groupId,name:op.name});
  if(type==='shape.stroke') return xinyangBridgeEffects({layerId:layerId,stroke:true,strokeSize:op.width===undefined?op.strokeSize:op.width,strokeColor:op.color||op.strokeColor});
  if(type==='shape.opacity') return xinyangBridgeShape({layerId:layerId,opacity:op.opacity});
  if(type==='shape.create'){var strokeOptions=null;
if(op.stroke||op.strokeColor||op.strokeSize){var strokeColor=op.strokeColor?xinyangBridgeColor(op.strokeColor).rgb:{r:0,g:0,b:0};
strokeOptions={readStatus:'ok',enabled:true,width:op.strokeSize||1,color:strokeColor,opacity:op.strokeOpacity===undefined?100:op.strokeOpacity};
}return xinyangBridgeShapeRect({name:op.name,x:op.x,y:op.y,width:op.width,height:op.height,radius:op.radius,corners:op.corners,fill:op.fill,stroke:strokeOptions,opacity:op.opacity});
}
  if(type==='shape.gradient') return xinyangBridgeCreateFill({type:'gradient',name:op.name,values:op.values,opacity:op.opacity});
  if(type==='document.save') return xinyangBridgeSaveDocument({documentId:op.documentId,path:op.path});
  throw Error('Unsupported batch operation: '+type);
}

function xinyangBridgeBatchOperation(op){var type=String(op&&op.type||'');try{return xinyangBridgeBatchOperationInner(op);}finally{if(type==='layer.delete'||type==='layer.duplicate'||type==='group.create'||type==='group.add'||type==='group.remove'||type==='group.duplicate'||type==='shape.create')xinyangBridgeInvalidateBatchLayerIndex();}}function xinyangBridgeRunBatchOperations(c){
  if(!c||!c.operations||!c.operations.length)throw Error('operations must contain at least one operation');
  var out=[],i,op,result,operationStarted;
  for(i=0;i<c.operations.length;i++){
    op=c.operations[i];
    try{
      operationStarted=new Date().getTime();
      result=xinyangBridgeBatchOperation(op);
      out.push({operationIndex:i,type:String(op.type||''),layerId:op.layerId===undefined?null:op.layerId,durationMs:new Date().getTime()-operationStarted,result:result});
    }catch(e){
      e.batchDetails={failedOperation:i,layerId:op&&op.layerId===undefined?null:op&&op.layerId,errorCode:e.code||'BATCH_OPERATION_FAILED',message:String(e)};
      throw e;
    }
  }
  return {ok:true,status:'committed',operationCount:out.length,operations:out};
}

function xinyangBridgeExecuteBatchBody(){
  try{
    $.global.xinyangBridgeBatchResult=xinyangBridgeRunBatchOperations($.global.xinyangBridgeBatchContext);
    $.global.xinyangBridgeBatchError=null;
  }catch(e){
    $.global.xinyangBridgeBatchError=e;
    $.global.xinyangBridgeBatchResult=null;
  }
}

function xinyangBridgeExecuteBatch(c){
  if(!app.documents.length)throw Error('Photoshop 中没有打开的文档');
  var d=app.activeDocument,transactionId=c.transactionId||('tx_'+new Date().getTime()),beforeHistory=null,result,rollback=false,rollbackStatus='not_required',errorDetails,currentFingerprint=xinyangBridgeHistoryFingerprint(d),visibilityBefore=[],visibilitySeen={},visibilityIndex,visibilityOp,visibilityId,visibilityLayer;
  try{beforeHistory=d.activeHistoryState;}catch(ignore){}
  if(c.expectedHistoryFingerprint&&!xinyangBridgeFingerprintMatches(c.expectedHistoryFingerprint,currentFingerprint))return {ok:false,status:'failed',transactionId:transactionId,failedOperation:null,layerId:null,error:{code:'EXTERNAL_REVISION_CONFLICT',message:'Photoshop 文档在 Batch 执行前已发生外部修改',expected:c.expectedHistoryFingerprint,actual:currentFingerprint},rollback:false,rollbackStatus:'not_started'};
  try{
    xinyangBridgeBatchLayerIndex=xinyangBridgeBuildLayerIndex(d,{});
    // Photoshop may exclude visibility from history. Restore it explicitly on failure.
    for(visibilityIndex=0;visibilityIndex<c.operations.length;visibilityIndex++) {
      visibilityOp=c.operations[visibilityIndex];
      if(visibilityOp.visible!==undefined && (visibilityOp.type==='layer.visibility'||visibilityOp.type==='group.visibility'||visibilityOp.type==='layer.set'||visibilityOp.type==='shape.style')) {
        visibilityId=visibilityOp.groupId===undefined?visibilityOp.layerId:visibilityOp.groupId;
        if(!visibilitySeen[String(visibilityId)]) {
          visibilityLayer=xinyangBridgeFind(visibilityId);
          visibilityBefore.push({id:visibilityId,visible:visibilityLayer.visible});
          visibilitySeen[String(visibilityId)]=true;
        }
      }
    }
    $.global.xinyangBridgeBatchContext=c;
    $.global.xinyangBridgeBatchResult=null;
    $.global.xinyangBridgeBatchError=null;
    if(c.history!==false&&d.suspendHistory){
      d.suspendHistory('Codex Batch '+transactionId,'$.global.XinyangBridgeBatchBody()');
      if($.global.xinyangBridgeBatchError)throw $.global.xinyangBridgeBatchError;
      result=$.global.xinyangBridgeBatchResult;
    }else{
      result=xinyangBridgeRunBatchOperations(c);
    }
    if(!result)throw Error('BATCH_RESULT_MISSING');
    result.transactionId=transactionId;
    result.historyState='single';
    result.refresh=c.refresh===true;
    if(result.refresh){try{if(app.refresh)app.refresh();}catch(ignoreRefresh){}}
    result.ui={refreshRequested:result.refresh,suppressUIRefresh:c.suppressUIRefresh!==false,headlessLikeMode:c.headlessLikeMode!==false,refreshCount:result.refresh?1:0};
    result.historyFingerprint=xinyangBridgeHistoryFingerprint(d);
    return result;
  }catch(e){
    errorDetails=e.batchDetails||{};
    try{if(beforeHistory)d.activeHistoryState=beforeHistory;rollback=true;rollbackStatus='restored_history_state';}catch(rollbackError){rollbackStatus='rollback_failed:'+String(rollbackError);}
    xinyangBridgeBatchLayerIndex=null;
    for(visibilityIndex=0;visibilityIndex<visibilityBefore.length;visibilityIndex++) {
      try{xinyangBridgeFind(visibilityBefore[visibilityIndex].id).visible=visibilityBefore[visibilityIndex].visible;}
      catch(visibilityRollbackError){rollback=false;rollbackStatus='visibility_rollback_failed:'+String(visibilityRollbackError);}
    }
    return {ok:false,status:'failed',transactionId:transactionId,failedOperation:errorDetails.failedOperation===undefined?null:errorDetails.failedOperation,layerId:errorDetails.layerId===undefined?null:errorDetails.layerId,error:{code:errorDetails.errorCode||e.code||'BATCH_EXECUTION_FAILED',message:errorDetails.message||String(e)},rollback:rollback,rollbackStatus:rollbackStatus};
  }finally{
    $.global.xinyangBridgeBatchContext=null;
    $.global.xinyangBridgeBatchResult=null;
    $.global.xinyangBridgeBatchError=null;
    xinyangBridgeBatchLayerIndex=null;
  }
}

function xinyangBridgeRenderPreview(c){
  if(!app.documents.length)throw Error('Photoshop 中没有打开的文档');
  if(!c||!c.path)throw Error('Preview path is required');
  var source=app.activeDocument,copy=null,scale=Number(c.scale===undefined?0.5:c.scale),width,height,result,region=c&&c.region,left,top,right,bottom;
  if(c.fullResolution!==true&&!(region&&Number(region.width)>0&&Number(region.height)>0)){if(scale<0.25)scale=0.25;if(scale>0.5)scale=0.5;}
  try{
    copy=source.duplicate();
    app.activeDocument=copy;
    if(region&&Number(region.width)>0&&Number(region.height)>0){
      left=Math.max(0,Number(region.x)||0);top=Math.max(0,Number(region.y)||0);
      right=Math.min(Number(copy.width),left+Number(region.width));bottom=Math.min(Number(copy.height),top+Number(region.height));
      if(right>left&&bottom>top)copy.crop([UnitValue(left,'px'),UnitValue(top,'px'),UnitValue(right,'px'),UnitValue(bottom,'px')]);
    }
    if(c.fullResolution!==true){
      width=Math.max(1,Math.round(Number(copy.width)*scale));
      height=Math.max(1,Math.round(Number(copy.height)*scale));
      copy.resizeImage(UnitValue(width,'px'),UnitValue(height,'px'),copy.resolution,ResampleMethod.BICUBIC);
    }else{width=Number(copy.width);height=Number(copy.height);}
    result=xinyangBridgeExport({path:c.path,format:c.format||'jpg',quality:c.quality||70});
    result.preview={width:width,height:height,scale:region&&right>left&&bottom>top?1:scale,stage:c.stage||'visual',fullResolution:c.fullResolution===true,region:region&&right>left&&bottom>top?{x:left,y:top,width:right-left,height:bottom-top}:null};
    return result;
  }finally{
    if(copy)try{copy.close(SaveOptions.DONOTSAVECHANGES);}catch(ignoreClose){}
    try{app.activeDocument=source;}catch(ignoreActive){}
  }
}

function xinyangBridgeBridge(raw){
  try{
    var c=xinyangBridgeJSONParse(raw);
    xinyangBridgeActivateDocumentForCommand(c);
    if (/^(set_layer_properties_many|get_layer_details_many|select_layers|find_layers_many)$/.test(c.action)) xinyangBridgeBatchLayerIndex=xinyangBridgeBuildLayerIndex(app.activeDocument,{});
    var r;
    if(c.action==='runtime_probe') r=xinyangBridgeRuntimeProbe();
    else if(c.action==='execute_batch') r=xinyangBridgeExecuteBatch(c);
    else if(c.action==='render_preview') r=xinyangBridgeRenderPreview(c);
    else if(c.action==='memory_cleanup') r=xinyangBridgeMemoryCleanup(c);
    else if(c.action==='ocr_export_image') r=xinyangBridgeOcrExportImage(c);
    else if(c.action==='ocr_create_text_layers') r=xinyangBridgeOcrCreateTextLayers(c);
    else if(c.action==='document_info') r=xinyangBridgeDocumentInfo();
    else if(c.action==='inspect_document_v2'){if(typeof $.global.xinyangBridgeInspectDocumentV2!=='function')throw Error('PHOTOSHOP_INSPECT_MODULE_NOT_LOADED');r=$.global.xinyangBridgeInspectDocumentV2();}
    else if(c.action==='inspect_psd_canonical'){if(typeof $.global.xinyangBridgeInspectPsdCanonical!=='function')throw Error('PHOTOSHOP_INSPECT_MODULE_NOT_LOADED');r=$.global.xinyangBridgeInspectPsdCanonical(c);}
    else if(c.action==='inspect_psd_canonical_to_file') r=xinyangBridgeInspectPsdCanonicalToFile(c);
    else if(c.action==='debug_dump_layer_descriptor'){if(typeof $.global.xinyangBridgeDumpLayerDescriptor!=='function')throw Error('PHOTOSHOP_INSPECT_MODULE_NOT_LOADED');r=$.global.xinyangBridgeDumpLayerDescriptor(c.layerId);}
    else if(c.action==='debug_dump_psd_layer_descriptor'){if(typeof $.global.xinyangBridgeDumpPsdLayerDescriptor!=='function')throw Error('PHOTOSHOP_INSPECT_MODULE_NOT_LOADED');r=$.global.xinyangBridgeDumpPsdLayerDescriptor(c);}
    else if(c.action==='place_image') r={ok:true,layer:xinyangBridgePlace(c.path,c.name)};
    else if(c.action==='place_images') r=xinyangBridgePlaceMany(c.items);
    else if(c.action==='replace_smart_object') r=xinyangBridgeReplaceSmart(c.layerId,c.path);
    else if(c.action==='upsert_text') r=xinyangBridgeText(c);
    else if(c.action==='set_text_style_ranges') r=xinyangBridgeSetTextStyleRanges(c);
    else if(c.action==='apply_text_ranges_to_psd') r=xinyangBridgeApplyTextRangesToPsd(c);
    else if(c.action==='set_text_style_ranges_v2') r=xinyangBridgeSetTextStyleRangesV2(c);
    else if(c.action==='apply_text_ranges_to_psd_v2') r=xinyangBridgeApplyTextRangesToPsdV2(c);
    else if(c.action==='apply_text_ranges_to_psd_v3') r=xinyangBridgeApplyTextRangesToPsdV3(c);
    else if(c.action==='apply_text_ranges_to_psd_v4') r=xinyangBridgeApplyTextRangesToPsdV4(c);
    else if(c.action==='apply_text_ranges_to_psd_v5') r=xinyangBridgeApplyTextRangesToPsdV5(c);
    else if(c.action==='set_text_style_ranges_v5') r=xinyangBridgeSetTextStyleRangesV5(c);
    else if(c.action==='set_text_transform_matrix') r=xinyangBridgeSetTextTransformMatrix(c);
    else if(c.action==='apply_text_transform_to_psd') r=xinyangBridgeApplyTextTransformToPsd(c);
    else if(c.action==='apply_text_transform_to_psd_v2') r=xinyangBridgeApplyTextTransformToPsdV2(c);
    else if(c.action==='apply_text_transform_to_psd_v3') r=xinyangBridgeApplyTextTransformToPsdV3(c);
    else if(c.action==='set_smart_object_quad') r=xinyangBridgeSetSmartObjectQuad(c);
    else if(c.action==='apply_smart_object_quad_to_psd') r=xinyangBridgeApplySmartObjectQuadToPsd(c);
    else if(c.action==='snapshot_layer_descriptor') r=xinyangBridgeDescriptorSnapshot(c);
    else if(c.action==='snapshot_layer_descriptor_psd') r=xinyangBridgeSnapshotLayerDescriptorPsd(c);
    else if(c.action==='transform_layer_psd') r=xinyangBridgeTransformLayerPsd(c);
    else if(c.action==='move_layer_by_delta') r=xinyangBridgeMoveLayerByDelta(c);
    else if(c.action==='move_layer_by_delta_psd') r=xinyangBridgeMoveLayerByDeltaPsd(c);
    else if(c.action==='open_document_session') r=xinyangBridgeOpenDocumentSession(c);
    else if(c.action==='close_document_session') r=xinyangBridgeCloseDocumentSession(c);
    else if(c.action==='close_document') r=xinyangBridgeCloseDocument(c);
    else if(c.action==='delete_layer') r=xinyangBridgeDeleteLayer(c);
    else if(c.action==='create_empty_document') r=xinyangBridgeCreateEmptyDocument(c);
    else if(c.action==='save_document') r=xinyangBridgeSaveDocument(c);
    else if(c.action==='get_layer_details') r=xinyangBridgeLayerDetails(c);
    else if(c.action==='get_layer_details_many') r=xinyangBridgeLayerDetailsMany(c);
    else if(c.action==='set_layer_properties') r=xinyangBridgeSetLayer(c);
    else if(c.action==='set_layer_properties_many') r=xinyangBridgeSetManyLayers(c);
    else if(c.action==='set_shape_style') r=xinyangBridgeShape(c);
    else if(c.action==='apply_layer_style') r=xinyangBridgeApplyStyle(c);
    else if(c.action==='create_adjustment_layer') r=xinyangBridgeCreateAdjustment(c);
    else if(c.action==='set_adjustment_values') r=xinyangBridgeSetAdjustment(c);
    else if(c.action==='apply_filter') r=xinyangBridgeApplyFilter(c);
    else if(c.action==='select_tool') r=xinyangBridgeSelectTool(c);
    else if(c.action==='set_selection') r=xinyangBridgeSelection(c);
    else if(c.action==='stroke_selection') r=xinyangBridgeStrokeSelection(c);
    else if(c.action==='create_path') r=xinyangBridgeCreatePath(c);
    else if(c.action==='upsert_path') r=xinyangBridgeUpsertPath(c);
    else if(c.action==='stroke_path') r=xinyangBridgeStrokePath(c);
    else if(c.action==='create_fill_layer') r=xinyangBridgeCreateFill(c);
    else if(c.action==='manage_group') r=xinyangBridgeGroup(c);
    else if(c.action==='manage_layer_mask') r=xinyangBridgeLayerMask(c);
    else if(c.action==='set_layer_style') r=xinyangBridgeSetLayerStyle(c);
    else if(c.action==='set_clipping_mask') r=xinyangBridgeClippingMask(c);
    else if(c.action==='load_layer_selection') r=xinyangBridgeLoadSelection(c);
    else if(c.action==='flip') r=xinyangBridgeFlip(c);
    else if(c.action==='transform_layer') r=xinyangBridgeTransform(c);
    else if(c.action==='copy_text_style') r=xinyangBridgeCopyStyle(c.fromLayerId,c.toLayerId);
    else if(c.action==='align_layers') r=xinyangBridgeAlign(c.layerIds,c.align);
    else if(c.action==='select_layers') r=xinyangBridgeSelectMany(c);
    else if(c.action==='find_layers_many') r=xinyangBridgeFindMany(c);
    else if(c.action==='export_many') r=xinyangBridgeExportMany(c);
    else if(c.action==='export') r=xinyangBridgeExport(c);
    else if(c.action==='export_layer') r=xinyangBridgeExportLayer(c);
    else if(c.action==='save') r=xinyangBridgeSave(c);
    else if(c.action==='duplicate_layer') r=xinyangBridgeDuplicate(c);
    else if(c.action==='crop_layer_to_selection') r=xinyangBridgeCropSelection(c);
    else if(c.action==='create_rectangle') r=xinyangBridgeRect(c);
    else if(c.action==='move_layer_top') r=xinyangBridgeMoveTop(c);
    else if(c.action==='resize_canvas') r=xinyangBridgeResizeCanvas(c);
    else if(c.action==='native_layer_effects') r=xinyangBridgeEffects(c);
    else if(c.action==='create_shape_rectangle') r=xinyangBridgeShapeRect(c);
    else if(c.action==='create_shape_ellipse') r=xinyangBridgeShapeEllipse(c);
    else if(c.action==='create_shape_geometry_fixture') r=xinyangBridgeCreateShapeGeometryFixture(c);
    else if(c.action==='create_smart_object_transform_fixture') r=xinyangBridgeCreateSmartObjectTransformFixture(c);
    else if(c.action==='create_text_inspector_fixture') r=xinyangBridgeCreateTextInspectorFixture(c);
    else if(c.action==='create_basic_round_trip_fixture') r=xinyangBridgeCreateBasicRoundTripFixture(c);
    else throw Error('Unsupported action: '+c.action);
    return xinyangBridgeJSONStringify(r);
  }catch(e){
    return xinyangBridgeError(e);
  }finally{
    xinyangBridgeBatchLayerIndex=null;
  }
}

// Bounded bulk interfaces preserve existing single-operation behavior.
function xinyangBridgeSelectMany(c) {
    var ids=c.layerIds, unique=[], seen={}, i, key;
    if (!ids || !ids.length || ids.length>100) throw Error('layerIds must contain 1..100 ids');
    for(i=0;i<ids.length;i++) {
        key=String(Number(ids[i]));
        xinyangBridgeFind(ids[i]); // Validate every target before changing selection.
        if(!seen[key]) {seen[key]=true;unique.push(Number(ids[i]));}
    }
    for(i=0;i<unique.length;i++) xinyangBridgeActionSelect(unique[i],i>0);
    return {ok:true,layerIds:unique,selectedCount:unique.length};
}
function xinyangBridgeFindMany(c) {
    var queries=c.queries, results=[], i, j, key, nameKey, layer, query, matches, names={}, ids={}, item, candidates;
    if(!queries || !queries.length || queries.length>100) throw Error('queries must contain 1..100 entries');
    for(key in xinyangBridgeBatchLayerIndex) if(xinyangBridgeBatchLayerIndex.hasOwnProperty(key)) {
        layer=xinyangBridgeBatchLayerIndex[key];
        item={id:Number(layer.id),name:String(layer.name),isGroup:layer.typename==='LayerSet'};
        ids[key]=item;nameKey='name:'+item.name;
        if(!names[nameKey])names[nameKey]=[];
        names[nameKey].push(item);
    }
    for(i=0;i<queries.length;i++) {
        query=queries[i];matches=[];
        if(!query || (query.id===undefined && query.name===undefined)) throw Error('Each query requires id or exact name');
        candidates=[];
        if(query.id===undefined) {
            nameKey='name:'+String(query.name);
            if(names.hasOwnProperty(nameKey))candidates=names[nameKey];
        }else {
            key=String(Number(query.id));
            if(ids.hasOwnProperty(key))candidates.push(ids[key]);
        }
        for(j=0;j<candidates.length;j++) {
            item=candidates[j];
            if(item && (query.name===undefined || item.name===String(query.name)))matches.push(item);
        }
        results.push({queryIndex:i,matches:matches});
    }
    return {ok:true,results:results};
}
function xinyangBridgeExportMany(c) {
    var items=c.items, files={}, results=[], i, item, file, key, result;
    if(!items || !items.length || items.length>10) throw Error('items must contain 1..10 exports');
    // Preflight the complete list before writing; files cannot use history rollback.
    for(i=0;i<items.length;i++) {
        item=items[i];
        if(!item || !item.path || (item.format!=='jpg' && item.format!=='png')) throw Error('Each export requires path and jpg/png format');
        file=File(item.path);key=String(file.fsName).toLowerCase();
        if(file.exists || files[key]) throw Error('Export target already exists or is duplicated: '+file.fsName);
        files[key]=true;
        if(item.layerId!==undefined) xinyangBridgeFind(item.layerId);
    }
    for(i=0;i<items.length;i++) {
        item=items[i];
        try {
            result=item.layerId===undefined ? xinyangBridgeExport(item) : xinyangBridgeExportLayer(item);
            file=File(result.path);
            if(!file.exists || file.length<=0) throw Error('Export file missing or empty');
            results.push({index:i,path:result.path,bytes:file.length});
        }catch(error){return {ok:false,error:'Export stopped at item '+i+': '+String(error),failedIndex:i,completed:results};}
    }
    return {ok:true,completed:results,exportCount:results.length};
}

function xinyangBridgeResizeCanvas(c){var d=app.activeDocument,w=Number(c.width),h=Number(c.height);if(!(w>0&&h>0))throw Error('width and height must be positive');d.resizeCanvas(UnitValue(w,'px'),UnitValue(h,'px'),AnchorPosition.TOPLEFT);return {ok:true,width:w,height:h};}

// Make the entry point visible to CEP after $.evalFile() reloads this file.


// Photoshop accepts AGMStrokeStyleInfo on the layer descriptor after a shape
// is created.  Supplying it only inside the create-shape payload is silently
// dropped on this host build, so apply the same canonical descriptor in a
// second setd step while preserving the existing creation path.
function xinyangBridgeBuildShapeStrokeInfo(c){var s=c&&c.stroke;
if(!s||s.readStatus!=='ok')return null;
var info=new ActionDescriptor(),content=new ActionDescriptor(),rgb=new ActionDescriptor(),dash=new ActionList(),col=s.color||{r:0,g:0,b:0};
info.putInteger(stringIDToTypeID('strokeStyleVersion'),2);
info.putBoolean(stringIDToTypeID('strokeEnabled'),s.enabled!==false);
info.putBoolean(stringIDToTypeID('fillEnabled'),true);
info.putUnitDouble(stringIDToTypeID('strokeStyleLineWidth'),charIDToTypeID('#Pxl'),Number(s.width||1));
info.putUnitDouble(stringIDToTypeID('strokeStyleLineDashOffset'),charIDToTypeID('#Pnt'),0);
info.putDouble(stringIDToTypeID('strokeStyleMiterLimit'),100);
info.putEnumerated(stringIDToTypeID('strokeStyleLineCapType'),stringIDToTypeID('strokeStyleLineCapType'),stringIDToTypeID('strokeStyleButtCap'));
info.putEnumerated(stringIDToTypeID('strokeStyleLineJoinType'),stringIDToTypeID('strokeStyleLineJoinType'),stringIDToTypeID('strokeStyleMiterJoin'));
info.putEnumerated(stringIDToTypeID('strokeStyleLineAlignment'),stringIDToTypeID('strokeStyleLineAlignment'),stringIDToTypeID(s.position||'strokeStyleAlignCenter'));
info.putBoolean(stringIDToTypeID('strokeStyleScaleLock'),false);
info.putBoolean(stringIDToTypeID('strokeStyleStrokeAdjust'),false);
info.putList(stringIDToTypeID('strokeStyleLineDashSet'),dash);
info.putEnumerated(stringIDToTypeID('strokeStyleBlendMode'),stringIDToTypeID('blendMode'),stringIDToTypeID(s.blendMode||'normal'));
info.putUnitDouble(stringIDToTypeID('strokeStyleOpacity'),charIDToTypeID('#Prc'),Number(s.opacity===undefined?100:s.opacity));
rgb.putDouble(charIDToTypeID('Rd  '),Number(col.r||0));
rgb.putDouble(charIDToTypeID('Grn '),Number(col.g||0));
rgb.putDouble(charIDToTypeID('Bl  '),Number(col.b||0));
content.putObject(charIDToTypeID('Clr '),charIDToTypeID('RGBC'),rgb);
info.putObject(stringIDToTypeID('strokeStyleContent'),stringIDToTypeID('solidColorLayer'),content);
info.putDouble(stringIDToTypeID('strokeStyleResolution'),72);
return info;
}
function xinyangBridgeApplyShapeStrokeAfterCreate(layer,c){var info=xinyangBridgeBuildShapeStrokeInfo(c);
if(!info)return;
var ref=new ActionReference(),shapeStyle=new ActionDescriptor(),setd=new ActionDescriptor();
ref.putEnumerated(stringIDToTypeID('contentLayer'),stringIDToTypeID('ordinal'),stringIDToTypeID('targetEnum'));
shapeStyle.putObject(stringIDToTypeID('strokeStyle'),stringIDToTypeID('strokeStyle'),info);
setd.putReference(stringIDToTypeID('null'),ref);
setd.putObject(stringIDToTypeID('to'),stringIDToTypeID('shapeStyle'),shapeStyle);
executeAction(stringIDToTypeID('set'),setd,DialogModes.NO);
}
var xinyangBridgeShapeRectWithoutStrokePatch=xinyangBridgeShapeRect;
xinyangBridgeShapeRect=function(c){var result=xinyangBridgeShapeRectWithoutStrokePatch(c);if(c&&c.stroke&&c.stroke.readStatus==='ok')xinyangBridgeApplyShapeStrokeAfterCreate(xinyangBridgeFind(result.layer.id),c);return result;};
var xinyangBridgeShapeEllipseWithoutStrokePatch=xinyangBridgeShapeEllipse;
xinyangBridgeShapeEllipse=function(c){var result=xinyangBridgeShapeEllipseWithoutStrokePatch(c);if(c&&c.stroke&&c.stroke.readStatus==='ok')xinyangBridgeApplyShapeStrokeAfterCreate(xinyangBridgeFind(result.layer.id),c);return result;};

// Read-only inspection module: tested CEP-compatible IIFE + $.global export.
(function(){
function n(v){return Number(v);}
function rect(b){var l=n(b[0]),t=n(b[1]),r=n(b[2]),d=n(b[3]);return {left:l,top:t,right:r,bottom:d,x:l,y:t,width:r-l,height:d-t};}
function layerType(l){if(l.typename==='LayerSet')return 'group';if(l.kind===LayerKind.TEXT)return 'text';if(l.kind===LayerKind.SOLIDFILL)return 'shape';if(l.kind===LayerKind.SMARTOBJECT)return 'smartObject';if(l.kind===LayerKind.NORMAL)return 'pixel';return String(l.kind);}
function textInfo(l){var t=l.textItem,c=null;
try{c=t.color.rgb;
}catch(e){}return {content:(function(){try{return t.contents;}catch(e){return null;}})(),font:(function(){try{return t.font;}catch(e){return null;}})(),fontSize:(function(){try{return n(t.size);}catch(e){return null;}})(),fontStyle:(function(){try{return t.fontStyleName;}catch(e){return null;}})(),color:c?{r:Math.round(c.red),g:Math.round(c.green),b:Math.round(c.blue)}:null,leading:(function(){try{return n(t.leading);}catch(e){return null;}})(),tracking:(function(){try{return t.tracking;}catch(e){return null;}})(),alignment:(function(){try{return String(t.justification);}catch(e){return null;}})(),textBounds:rect(l.bounds),textStyleRanges:[]};
}
function descString(d,k){try{return d.getString(stringIDToTypeID(k));}catch(e){return null;}}
function descNumber(d,k){try{return d.getDouble(stringIDToTypeID(k));}catch(e){try{return d.getInteger(stringIDToTypeID(k));}catch(x){return null;}}}
function descUnit(d,k){try{return d.getUnitDoubleValue(stringIDToTypeID(k));}catch(e){return null;}}
function descBool(d,k){try{return d.getBoolean(stringIDToTypeID(k));}catch(e){return null;}}
function descEnum(d,k){try{return typeIDToStringID(d.getEnumerationValue(stringIDToTypeID(k)));}catch(e){return null;}}
function textColor(d){try{return rgbFromDescriptor(d.getObjectValue(stringIDToTypeID('color')));}catch(e){return null;}}
function textStyleRangeInfo(list){var out=[],i,r,s;
try{for(i=0;i<list.count;i++){r=list.getObjectValue(i);
s=r.getObjectValue(stringIDToTypeID('textStyle'));
out.push({from:r.getInteger(charIDToTypeID('From')),to:r.getInteger(charIDToTypeID('T   ')),sourceIndexType:'photoshop',fontFamily:descString(s,'fontName'),fontPostScriptName:descString(s,'fontPostScriptName'),fontStyle:descString(s,'fontStyleName'),fontWeight:null,fontSize:descUnit(s,'size'),color:textColor(s),leading:descUnit(s,'leading'),tracking:descNumber(s,'tracking'),kerning:descNumber(s,'kerning'),horizontalScale:descNumber(s,'horizontalScale'),verticalScale:descNumber(s,'verticalScale'),baselineShift:descUnit(s,'baselineShift'),fauxBold:descBool(s,'syntheticBold'),fauxItalic:descBool(s,'syntheticItalic'),underline:descEnum(s,'underline'),strikethrough:descEnum(s,'strikethrough')});
}return {readStatus:'ok',items:out};
}catch(e){return {readStatus:'failed',items:[],error:{code:'PHOTOSHOP_TEXT_STYLE_RANGE_READ_FAILED',message:String(e)}};
}}
function paragraphRangeInfo(list){var out=[],i,r,p;
try{for(i=0;i<list.count;i++){r=list.getObjectValue(i);
p=r.getObjectValue(stringIDToTypeID('paragraphStyle'));
out.push({from:r.getInteger(charIDToTypeID('From')),to:r.getInteger(charIDToTypeID('T   ')),sourceIndexType:'photoshop',justification:descEnum(p,'align'),firstLineIndent:descUnit(p,'firstLineIndent'),leftIndent:descUnit(p,'startIndent'),rightIndent:descUnit(p,'endIndent'),spaceBefore:descUnit(p,'spaceBefore'),spaceAfter:descUnit(p,'spaceAfter'),leadingType:descEnum(p,'leadingType'),autoLeadingPercentage:descNumber(p,'autoLeadingPercentage')});
}return {readStatus:'ok',items:out};
}catch(e){return {readStatus:'failed',items:[],error:{code:'PHOTOSHOP_PARAGRAPH_STYLE_RANGE_READ_FAILED',message:String(e)}};
}}
function textAdvancedInfo(l,basic){var d,t,m,shape,warp;
try{d=shapeLayerDescriptor(l.id);
t=d.getObjectValue(stringIDToTypeID('textKey'));
try{basic.textStyleRanges=textStyleRangeInfo(t.getList(stringIDToTypeID('textStyleRange')));
}catch(e){basic.textStyleRanges={readStatus:'not_present',items:[]};
}try{basic.paragraphStyleRanges=paragraphRangeInfo(t.getList(stringIDToTypeID('paragraphStyleRange')));
}catch(e){basic.paragraphStyleRanges={readStatus:'not_present',items:[]};
}try{m=t.getObjectValue(stringIDToTypeID('transform'));
basic.textTransform={readStatus:'ok',authoritative:{xx:descNumber(m,'xx'),xy:descNumber(m,'xy'),yx:descNumber(m,'yx'),yy:descNumber(m,'yy'),tx:descNumber(m,'tx'),ty:descNumber(m,'ty')},derived:{scaleX:null,scaleY:null,rotation:null}};
}catch(e){basic.textTransform={readStatus:'not_present'};
}try{shape=t.getList(stringIDToTypeID('textShape')).getObjectValue(0);
basic.textShape={readStatus:'ok',type:'unknown',rawDomKind:(function(){try{return String(l.textItem.kind);}catch(x){return null;}})(),bounds:null};
}catch(e){basic.textShape={readStatus:'unsupported'};
}try{warp=t.getObjectValue(stringIDToTypeID('warp'));
var ws=descEnum(warp,'warpStyle');
basic.warp={readStatus:'ok',present:ws!==null&&ws!=='warpNone',style:ws};
}catch(e){basic.warp={readStatus:'not_present'};
}basic.readStatus='partial';
return basic;
}catch(e){basic.textStyleRanges={readStatus:'failed',items:[],error:{code:'PHOTOSHOP_TEXT_DESCRIPTOR_READ_FAILED',message:String(e)}};
basic.paragraphStyleRanges={readStatus:'unsupported',items:[]};
basic.textTransform={readStatus:'unsupported'};
basic.textShape={readStatus:'unsupported'};
basic.warp={readStatus:'unsupported'};
basic.readStatus='partial';
return basic;
}}
function shapeLayerDescriptor(id){var ref=new ActionReference();ref.putIdentifier(charIDToTypeID('Lyr '),id);return executeActionGet(ref);}
function hasKey(d,id){try{return d.hasKey(id);}catch(e){return false;}}
function rgbFromDescriptor(d){try{return {r:Math.round(d.getDouble(charIDToTypeID('Rd  '))),g:Math.round(d.getDouble(charIDToTypeID('Grn '))),b:Math.round(d.getDouble(charIDToTypeID('Bl  ')))};}catch(e){return null;}}
function objectColor(d,key){try{return rgbFromDescriptor(d.getObjectValue(key));}catch(e){return null;}}
function originShapeInfo(d){var origin,originType,radii,keyType=stringIDToTypeID('keyOriginType'),keyRadii=stringIDToTypeID('keyOriginRRectRadii'),typeId=stringIDToTypeID('keyOriginType');
try{origin=d.getList(keyType).getObjectValue(0);
originType=origin.getInteger(typeId);
if(originType===1)return {shapeType:{readStatus:'ok',value:'rectangle'},cornerRadius:{readStatus:'ok',topLeft:0,topRight:0,bottomRight:0,bottomLeft:0}};
if(originType===2){radii=origin.getObjectValue(keyRadii);
return {shapeType:{readStatus:'ok',value:'roundedRectangle'},cornerRadius:{readStatus:'ok',topLeft:radii.getUnitDoubleValue(stringIDToTypeID('topLeft')),topRight:radii.getUnitDoubleValue(stringIDToTypeID('topRight')),bottomRight:radii.getUnitDoubleValue(stringIDToTypeID('bottomRight')),bottomLeft:radii.getUnitDoubleValue(stringIDToTypeID('bottomLeft'))}};
}if(originType===5)return {shapeType:{readStatus:'ok',value:'ellipse'},cornerRadius:{readStatus:'not_applicable'}};
return {shapeType:{readStatus:'unsupported',value:null},cornerRadius:{readStatus:'unsupported'}};
}catch(e){return {shapeType:{readStatus:'unsupported',value:null},cornerRadius:{readStatus:'unsupported'}};
}}
function smartObjectInfo(l){var d,so,more,list,size,quad=[],i;
try{d=shapeLayerDescriptor(l.id);
so=d.getObjectValue(stringIDToTypeID('smartObject'));
more=d.getObjectValue(stringIDToTypeID('smartObjectMore'));
list=more.getList(stringIDToTypeID('transform'));
for(i=0;i<list.count;i++)quad.push(list.getDouble(i));
size=more.getObjectValue(stringIDToTypeID('size'));
return {readStatus:'ok',source:{readStatus:'ok',fileReference:(function(){try{return so.getString(stringIDToTypeID('fileReference'));}catch(e){return null;}})(),documentId:(function(){try{return so.getString(stringIDToTypeID('documentID'));}catch(e){return null;}})()},linked:(function(){try{return so.getBoolean(stringIDToTypeID('linked'));}catch(e){return null;}})(),embedded:(function(){try{return !so.getBoolean(stringIDToTypeID('linked'));}catch(e){return null;}})(),originalWidth:size.getDouble(stringIDToTypeID('width')),originalHeight:size.getDouble(stringIDToTypeID('height')),transform:{readStatus:'ok',quad:quad,scaleX:null,scaleY:null,rotation:null,flipX:null,flipY:null}};
}catch(e){return {readStatus:'failed',error:{code:'PHOTOSHOP_SMART_OBJECT_READ_FAILED',message:String(e)}};
}}
function shapeInfo(l){var d,fill={readStatus:'unsupported'},stroke={readStatus:'unsupported'},geometry={readStatus:'unsupported'},originInfo,adjs,first,c,s,path,inner;
try{d=shapeLayerDescriptor(l.id);
originInfo=originShapeInfo(d);
try{adjs=d.getList(stringIDToTypeID('adjustment'));
first=adjs.getObjectValue(0);
c=objectColor(first,charIDToTypeID('Clr '));
if(c)fill={readStatus:'ok',type:'solid',color:c};
else fill={readStatus:'unsupported',type:'unknown'};
}catch(fillError){fill={readStatus:'failed',error:{code:'PHOTOSHOP_SHAPE_FILL_READ_FAILED',message:String(fillError)}};
}try{s=d.getObjectValue(stringIDToTypeID('AGMStrokeStyleInfo'));
stroke={readStatus:'ok',enabled:s.getBoolean(stringIDToTypeID('strokeEnabled')),width:s.getUnitDoubleValue(stringIDToTypeID('strokeStyleLineWidth')),position:(function(){try{return typeIDToStringID(s.getEnumerationValue(stringIDToTypeID('strokeStyleLineAlignment')));}catch(e){return null;}})(),opacity:s.getUnitDoubleValue(stringIDToTypeID('strokeStyleOpacity')),blendMode:(function(){try{return typeIDToStringID(s.getEnumerationValue(stringIDToTypeID('strokeStyleBlendMode')));}catch(e){return null;}})(),color:objectColor(s.getObjectValue(stringIDToTypeID('strokeStyleContent')),charIDToTypeID('Clr '))};
}catch(strokeError){stroke={readStatus:'not_present'};
}try{path=d.getObjectValue(stringIDToTypeID('pathBounds'));
inner=path.getObjectValue(stringIDToTypeID('pathBounds'));
geometry={readStatus:'ok',left:inner.getDouble(charIDToTypeID('Left')),top:inner.getDouble(charIDToTypeID('Top ')),right:inner.getDouble(charIDToTypeID('Rght')),bottom:inner.getDouble(charIDToTypeID('Btom'))};
}catch(geometryError){geometry={readStatus:'unsupported'};
}return {readStatus:'partial',shapeType:originInfo.shapeType,fill:fill,stroke:stroke,geometry:geometry,cornerRadius:originInfo.cornerRadius,vectorPath:{readStatus:'unsupported'},rawDescriptor:{readStatus:'available_via_debug_dump'}};
}catch(e){return {readStatus:'failed',error:{code:'PHOTOSHOP_SHAPE_DESCRIPTOR_FAILED',message:String(e)}};
}}
function descriptorKey(id){var out={typeId:id,stringId:null,charId:null};try{out.stringId=typeIDToStringID(id);}catch(e){}try{out.charId=typeIDToCharID(id);}catch(e){}return out;}
function descriptorValue(d,key,type,depth){if(depth>12)return {readStatus:'truncated'};
try{if(type===DescValueType.BOOLEANTYPE)return d.getBoolean(key);
if(type===DescValueType.STRINGTYPE)return d.getString(key);
if(type===DescValueType.INTEGERTYPE)return d.getInteger(key);
if(type===DescValueType.DOUBLETYPE)return d.getDouble(key);
if(type===DescValueType.UNITDOUBLE)return {unit:descriptorKey(d.getUnitDoubleType(key)),value:d.getUnitDoubleValue(key)};
if(type===DescValueType.ENUMERATEDTYPE)return {enumType:descriptorKey(d.getEnumerationType(key)),value:descriptorKey(d.getEnumerationValue(key))};
if(type===DescValueType.OBJECTTYPE)return {objectType:descriptorKey(d.getObjectType(key)),value:serializeDescriptor(d.getObjectValue(key),depth+1)};
if(type===DescValueType.LISTTYPE)return serializeList(d.getList(key),depth+1);
if(type===DescValueType.ALIASTYPE){var f=d.getPath(key);
return {path:f?f.fsName:null};
}if(type===DescValueType.RAWTYPE)return {rawLength:d.getData(key).length};
if(type===DescValueType.REFERENCETYPE)return {readStatus:'unsupported',type:'reference'};
return {readStatus:'unsupported',descriptorType:String(type)};
}catch(e){return {readStatus:'failed',error:String(e)};
}}
function serializeList(list,depth){var out=[];
for(var i=0;i<list.count;i++){var type=list.getType(i);
try{if(type===DescValueType.OBJECTTYPE)out.push({type:'object',value:serializeDescriptor(list.getObjectValue(i),depth+1)});
else if(type===DescValueType.STRINGTYPE)out.push({type:'string',value:list.getString(i)});
else if(type===DescValueType.INTEGERTYPE)out.push({type:'integer',value:list.getInteger(i)});
else if(type===DescValueType.DOUBLETYPE)out.push({type:'double',value:list.getDouble(i)});
else if(type===DescValueType.UNITDOUBLE)out.push({type:'unitDouble',unit:descriptorKey(list.getUnitDoubleType(i)),value:list.getUnitDoubleValue(i)});
else out.push({type:String(type),readStatus:'unsupported'});
}catch(e){out.push({readStatus:'failed',error:String(e)});
}}return out;
}
function serializeDescriptor(d,depth){var out={entries:[]};for(var i=0;i<d.count;i++){var key=d.getKey(i),type=d.getType(key);out.entries.push({key:descriptorKey(key),type:String(type),value:descriptorValue(d,key,type,depth||0)});}return out;}
$.global.xinyangBridgeDumpLayerDescriptor=function(layerId){var ref=new ActionReference();ref.putIdentifier(charIDToTypeID('Lyr '),layerId);return {ok:true,layerId:layerId,descriptor:serializeDescriptor(executeActionGet(ref),0)};};
$.global.xinyangBridgeDumpPsdLayerDescriptor=function(c){if(!c||!c.path||c.layerId===undefined)throw Error('INVALID_ARGUMENT: path and layerId are required');
var f=File(c.path),before=null,opened=null,out=null,fail=null;
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
opened=app.open(f);
out=$.global.xinyangBridgeDumpLayerDescriptor(c.layerId);
out.source={type:'photoshop',method:'debug_dump_psd_layer_descriptor',path:f.fsName};
}catch(e){fail=Error('PHOTOSHOP_DESCRIPTOR_DUMP_FAILED: '+e);
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){if(!fail)fail=Error('PHOTOSHOP_CLOSE_FAILED: '+e);
}if(before)try{app.activeDocument=before;
}catch(e){if(!fail)fail=Error('PHOTOSHOP_RESTORE_FAILED: '+e);
}}if(fail)throw fail;
return out;
};
function inspectLayer(l,parent,index,count,w,h){var group=l.typename==='LayerSet',type=layerType(l),b=group?null:rect(l.bounds),x={id:l.id,name:l.name,type:type,parentId:parent,children:[],visible:l.visible,opacity:l.opacity,fillOpacity:null,blendMode:String(l.blendMode),locked:l.allLocked,zIndex:count-index-1,bounds:b,boundsNoEffects:null,relativeX:b?b.x/w:null,relativeY:b?b.y/h:null,relativeWidth:b?b.width/w:null,relativeHeight:b?b.height/h:null,effects:{readStatus:'unsupported'},mask:{layerMask:{readStatus:'unsupported'},vectorMask:{readStatus:'unsupported'},clippingMask:{readStatus:'unsupported'}}};
if(type==='shape')x.shape=shapeInfo(l);
if(type==='LayerKind.GRADIENTFILL')x.gradient={readStatus:'unsupported'};
if(type==='LayerKind.COLORBALANCE')x.adjustment={readStatus:'unsupported',type:'colorBalance'};
if(!group&&l.kind===LayerKind.TEXT)x.text=textAdvancedInfo(l,textInfo(l));
if(!group&&l.kind===LayerKind.SMARTOBJECT)x.smartObject=smartObjectInfo(l);
if(group)for(var i=0;i<l.layers.length;i++)x.children.push(inspectLayer(l.layers[i],l.id,i,l.layers.length,w,h));
return x;
}
$.global.xinyangBridgeInspectDocumentV2=function(){if(!app.documents.length)throw Error('PHOTOSHOP_NO_DOCUMENT');
var d=app.activeDocument,w=n(d.width),h=n(d.height),out=[];
for(var i=0;i<d.layers.length;i++)try{out.push(inspectLayer(d.layers[i],null,i,d.layers.length,w,h));
}catch(e){var f=d.layers[i];
out.push({id:(function(){try{return f.id;}catch(x){return null;}})(),name:(function(){try{return f.name;}catch(x){return null;}})(),type:'uninspectable',hostType:(function(){try{return f.typename;}catch(x){return null;}})(),children:[],zIndex:d.layers.length-i-1,inspectionError:{code:'PHOTOSHOP_LAYER_INSPECT_FAILED',message:String(e),topLevelIndex:i}});
}return {ok:true,documentId:Number(d.id),historyFingerprint:(typeof xinyangBridgeHistoryFingerprint==='function'?xinyangBridgeHistoryFingerprint(d):null),version:'2.0.0-draft',source:{type:'photoshop',method:'inspect_document_v2',confidence:1.0},document:{name:d.name,path:null,width:w,height:h,resolution:d.resolution,mode:String(d.mode),bitDepth:String(d.bitsPerChannel)},layers:out};
};
$.global.xinyangBridgeInspectPsdCanonical=function(c){if(!c||!c.path)throw Error('INVALID_ARGUMENT: path is required');
var f=File(c.path),before=null,opened=null,result=null,fail=null,phase='validate';
if(!f.exists)throw Error('PHOTOSHOP_FILE_NOT_FOUND: '+c.path);
try{if(app.documents.length)before=app.activeDocument;
phase='open';
opened=app.open(f);
phase='inspect';
app.activeDocument=opened;
result=$.global.xinyangBridgeInspectDocumentV2();
result.source={type:'photoshop',method:'inspect_psd_canonical',confidence:1.0,path:f.fsName};
if(c.previewPath){phase='preview';
try{var previewFile=File(c.previewPath);
if(!previewFile.parent.exists)previewFile.parent.create();
result.sourcePreview={readStatus:'ok',path:xinyangBridgeExport({path:c.previewPath,format:c.previewFormat||'png'}).path};
}catch(previewError){result.sourcePreview={readStatus:'failed',error:{code:'PHOTOSHOP_SOURCE_PREVIEW_FAILED',message:String(previewError)}};
}}}catch(e){fail=Error('PHOTOSHOP_CANONICAL_'+phase.toUpperCase()+'_FAILED: '+e);
}finally{if(opened)try{opened.close(SaveOptions.DONOTSAVECHANGES);
}catch(e){if(!fail)fail=Error('PHOTOSHOP_CANONICAL_CLOSE_FAILED: '+e);
}if(before)try{app.activeDocument=before;
}catch(e){if(!fail)fail=Error('PHOTOSHOP_CANONICAL_RESTORE_FAILED: '+e);
}}if(fail)throw fail;
return result;
};
}());

         $.global.XinyangBridgeBatchBody = xinyangBridgeExecuteBatchBody;
         return { toolsBridgeExecute: function (command) {
             var previousDialogs = app.displayDialogs;
             try {
                 app.displayDialogs = DialogModes.NO;
                 /* runtime_probe is the bridge bootstrap health check.  Return its
                  * plain ExtendScript object directly so startup never needs to
                  * round-trip a Photoshop collection through eval(). */
                 if (command && command.action === 'runtime_probe') return xinyangBridgeRuntimeProbe();
                 return eval('(' + xinyangBridgeBridge(xinyangBridgeJSONStringify(command || {})) + ')');
             } finally { app.displayDialogs = previousDialogs; }
         }};
    };
}());
