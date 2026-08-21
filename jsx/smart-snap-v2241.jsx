/* 独立磁吸入口：绕过长期驻留 LongStitchCEP 方法表。 */
var XinyangSmartSnapV2241 = $.global.XinyangSmartSnapV2241 = (function () {
  function json(v) { if (v === null || v === undefined) return "null"; if (typeof v === "number") return isFinite(v) ? String(v) : "null"; if (typeof v === "boolean") return v ? "true" : "false"; if (typeof v === "string") return '"' + v.replace(/\\/g,"\\\\").replace(/"/g,'\\"') + '"'; var a=[],k; for(k in v) if(v.hasOwnProperty(k)) a.push(json(k)+":"+json(v[k])); return "{"+a.join(",")+"}"; }
  function px(v) { try { return Number(v.as("px")); } catch(e) { return Number(v)||0; } }
  function ids() { var r=[],p=stringIDToTypeID("targetLayersIDs"),ref=new ActionReference(); try { ref.putProperty(stringIDToTypeID("property"),p); ref.putEnumerated(stringIDToTypeID("document"),stringIDToTypeID("ordinal"),stringIDToTypeID("targetEnum")); var l=executeActionGet(ref).getList(p),i; for(i=0;i<l.count;i++)r.push(l.getReference(i).getIdentifier(charIDToTypeID("Lyr "))); }catch(e){} if(!r.length){try{var a=new ActionReference();a.putProperty(charIDToTypeID("Prpr"),charIDToTypeID("LyrI"));a.putEnumerated(charIDToTypeID("Lyr "),charIDToTypeID("Ordn"),charIDToTypeID("Trgt"));r.push(executeActionGet(a).getInteger(charIDToTypeID("LyrI")));}catch(x){}} return r; }
  function find(c,id) { var i,l; for(i=0;i<c.layers.length;i++){l=c.layers[i];if(Number(l.id)===Number(id))return l;if(l.typename==="LayerSet"){var x=find(l,id);if(x)return x;}}return null; }
  function box(ls) { var r={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity},i,b;for(i=0;i<ls.length;i++){b=ls[i].bounds;r.left=Math.min(r.left,px(b[0]));r.top=Math.min(r.top,px(b[1]));r.right=Math.max(r.right,px(b[2]));r.bottom=Math.max(r.bottom,px(b[3]));}return r; }
  function options(raw) { var out={},items=String(raw||"").split("&"),i,p; for(i=0;i<items.length;i++){p=items[i].split("=");out[p[0]]=p[1]==="1";} out.distance=Number(out.distance)||20; return out; }
  function invoke(raw) {
    try {
      var o=options(raw),d=Number(o.distance)||20,doc=app.activeDocument,is=ids(),sel=[],i; if(!app.documents.length||!is.length)throw new Error("请先选择要吸附的图层"); for(i=0;i<is.length;i++)sel.push(find(doc,is[i])); var m=box(sel),all=[];
      function has(l){for(var j=0;j<sel.length;j++)if(sel[j]===l)return true;return false;}
      function collect(c){for(var j=0;j<c.layers.length;j++){var l=c.layers[j];if(l.visible&&!l.allLocked&&!has(l))all.push(l);if(l.typename==="LayerSet")collect(l);}}
      collect(doc); var bx=null,by=null;
      function hit(axis,v,name){if(Math.abs(v)>d)return;var b=axis==="x"?bx:by;if(!b||Math.abs(v)<Math.abs(b.v)){if(axis==="x")bx={v:v,n:name};else by={v:v,n:name};}}
      function compare(t,n){if(o.layerEdges){hit("x",t.left-m.left,n+"左边缘");hit("x",t.right-m.right,n+"右边缘");hit("x",t.left-m.right,n+"左边缘");hit("x",t.right-m.left,n+"右边缘");hit("y",t.top-m.top,n+"上边缘");hit("y",t.bottom-m.bottom,n+"下边缘");hit("y",t.top-m.bottom,n+"上边缘");hit("y",t.bottom-m.top,n+"下边缘");}if(o.centers){hit("x",(t.left+t.right-m.left-m.right)/2,n+"水平中心");hit("y",(t.top+t.bottom-m.top-m.bottom)/2,n+"垂直中心");}}
      for(i=0;i<all.length;i++)compare(box([all[i]]),"图层"); if(o.canvasEdges)compare({left:0,top:0,right:px(doc.width),bottom:px(doc.height)},"画布"); if(o.guides)for(i=0;i<doc.guides.length;i++){var g=doc.guides[i],c=px(g.coordinate);if(g.direction===Direction.VERTICAL){hit("x",c-m.left,"垂直参考线");hit("x",c-m.right,"垂直参考线");}else{hit("y",c-m.top,"水平参考线");hit("y",c-m.bottom,"水平参考线");}}
      if(!bx&&!by)return "__XY_SMART_OK__0|未找到水平目标|未找到垂直目标"; for(i=0;i<sel.length;i++)sel[i].translate(UnitValue(bx?bx.v:0,"px"),UnitValue(by?by.v:0,"px")); return "__XY_SMART_OK__"+sel.length+"|"+(bx?bx.n:"未命中水平目标")+"|"+(by?by.n:"未命中垂直目标");
    } catch(e) { return "__XY_SMART_ERROR__"+String(e&&e.message?e.message:e); }
  }
  return { invoke: invoke };
}());
