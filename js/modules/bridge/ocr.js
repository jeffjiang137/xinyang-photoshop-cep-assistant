'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),https=require('https'),child=require('child_process');
exports.create=function(invokeRaw){
  function ocrNormalizeBox(value){
    if(!value)return null;
    if(Array.isArray(value)){
      if(value.length>=4&&!Array.isArray(value[0])&&value.every(function(item){return isFinite(Number(item));})){
        var ax=Number(value[0]),ay=Number(value[1]),a3=Number(value[2]),a4=Number(value[3]);
        return {x:ax,y:ay,width:a3>ax?a3-ax:a3,height:a4>ay?a4-ay:a4};
      }
      if(value.length>=3&&Array.isArray(value[0])){
        var xs=[],ys=[];value.forEach(function(point){if(point&&point.length>=2){xs.push(Number(point[0]));ys.push(Number(point[1]));}});
        if(xs.length){var left=Math.min.apply(Math,xs),top=Math.min.apply(Math,ys);return {x:left,y:top,width:Math.max.apply(Math,xs)-left,height:Math.max.apply(Math,ys)-top};}
      }
      return null;
    }
    var x=Number(value.x!=null?value.x:value.left!=null?value.left:value.x0!=null?value.x0:value.x1||0);
    var y=Number(value.y!=null?value.y:value.top!=null?value.top:value.y0!=null?value.y0:value.y1||0);
    var width=Number(value.width!=null?value.width:value.w);
    var height=Number(value.height!=null?value.height:value.h);
    if(!isFinite(width))width=Number(value.right!=null?value.right:value.x2!=null?value.x2:value.x1)-x;
    if(!isFinite(height))height=Number(value.bottom!=null?value.bottom:value.y2!=null?value.y2:value.y1)-y;
    return width>0&&height>0?{x:x,y:y,width:width,height:height}:null;
  }
  function ocrNormalizeResponse(data){
    var root=data&&(data.data||data.result)||data||{};if(root.result&&!root.lines&&!root.items)root=root.result;
    var candidates=Array.isArray(root)?root:(root.lines||root.items||root.words||root.results||[]);
    if((!Array.isArray(candidates)||!candidates.length)&&Array.isArray(root.rec_texts))candidates=root.rec_texts.map(function(text,index){return {text:text,score:root.rec_scores&&root.rec_scores[index],box:(root.rec_polys&&root.rec_polys[index])||(root.dt_polys&&root.dt_polys[index])};});
    if(!Array.isArray(candidates))candidates=[];
    var lines=[];
    candidates.forEach(function(item){
      var pair=Array.isArray(item)&&item.length>=2&&Array.isArray(item[0])?item:null,recognition=pair&&Array.isArray(pair[1])?pair[1]:null;
      var text=String(recognition?recognition[0]:item&&(item.text!=null?item.text:item.word!=null?item.word:item.content)||'').trim();
      var box=ocrNormalizeBox(pair?pair[0]:item&&(item.box||item.bbox||item.boundingBox||item.rect||item.polygon||item.poly||item));
      if(!text||!box||!(box.width>0&&box.height>0))return;
      var style=item&&item.style&&typeof item.style==='object'?item.style:{},score=Number(recognition?recognition[1]:item.score!=null?item.score:item.confidence!=null?item.confidence:1);
      lines.push({text:text,x:box.x,y:box.y,width:box.width,height:box.height,box:box,score:Math.max(0,Math.min(1,isFinite(score)?score:0)),color:item.color||item.textColor||style.color||style.textColor||'',fontFamily:String(item.font_family||item.fontFamily||style.font_family||style.fontFamily||'').trim(),fontSize:Number(item.font_size||item.fontSize||style.font_size||style.fontSize||0)||0,angle:Number(item.angle||item.rotation||style.angle||style.rotation||0)||0,weight:item.weight||item.font_weight||style.weight||style.fontWeight||'regular'});
    });
    if(!lines.length)throw Error('未识别到带坐标的文字');
    return {ok:true,engine:String(root.engine||(data&&data.engine)||'OCR'),text:String(root.text||(data&&data.text)||lines.map(function(line){return line.text;}).join('\n')),elapsedMs:Number(root.elapsed_ms||root.elapsedMs||(data&&data.elapsed_ms)||0)||0,lines:lines};
  }
  function ocrHttpRequest(options){
    return new Promise(function(resolve,reject){
      var parsed;try{parsed=require('url').parse(String(options.url));}catch(error){reject(error);return;}
      fs.readFile(options.imagePath,function(readError,image){
        if(readError){reject(new Error('无法读取 OCR 图片：'+readError.message));return;}
        var local=options.local===true,boundary='----CodexOCR'+Date.now()+Math.floor(Math.random()*100000),body,headers={'Accept':'application/json'};
        if(local){
          var pre=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="image"; filename="'+path.basename(options.imagePath)+'"\r\nContent-Type: image/png\r\n\r\n','utf8'),post=Buffer.from('\r\n--'+boundary+'--\r\n','utf8');body=Buffer.concat([pre,image,post]);headers['Content-Type']='multipart/form-data; boundary='+boundary;
        }else{
          body=Buffer.from(JSON.stringify({image_base64:image.toString('base64'),filename:path.basename(options.imagePath),group:false}),'utf8');headers['Content-Type']='application/json;charset=UTF-8';
        }
        headers['Content-Length']=body.length;if(options.apiKey)headers.Authorization='Bearer '+String(options.apiKey);
        var transport=parsed.protocol==='https:'?https:http,request=transport.request({protocol:parsed.protocol,hostname:parsed.hostname,port:parsed.port,path:parsed.path||'/',method:'POST',headers:headers},function(response){
          var chunks=[];response.on('data',function(chunk){chunks.push(chunk);});response.on('end',function(){var raw=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');if(response.statusCode<200||response.statusCode>=300){reject(new Error('OCR 服务返回 '+response.statusCode+(raw?'：'+raw.slice(0,180):'')));return;}try{var parsedResponse=raw?JSON.parse(raw):{};if(parsedResponse&&parsedResponse.ok===false)throw Error(parsedResponse.error||parsedResponse.message||'OCR 服务识别失败');resolve(parsedResponse);}catch(error){reject(error&&error.message?error:new Error('OCR 服务返回的不是有效 JSON'));}});
        });
        request.setTimeout(Number(options.timeout)||180000,function(){request.destroy(new Error('OCR 服务响应超时'));});
        request.on('error',reject);request.end(body);
      });
    });
  }
  function ocrExecFile(executable,args,timeout){
    return new Promise(function(resolve,reject){child.execFile(executable,args,{timeout:Number(timeout)||180000,maxBuffer:4*1024*1024,windowsHide:true},function(error,stdout,stderr){if(error){reject(new Error(String(stderr||stdout||error.message||error)));return;}resolve({stdout:String(stdout||''),stderr:String(stderr||'')});});});
  }
  function ocrOutputPath(){
    var tempRoot=process.env.TEMP||process.env.TMP||__dirname;return path.join(tempRoot,'codex_ps_ocr_result_'+Date.now()+'_'+Math.floor(Math.random()*100000)+'.json');
  }
  function ocrReadOutput(filePath){
    var text=fs.readFileSync(filePath,'utf8').replace(/^\uFEFF/,'');if(!text.trim())throw Error('OCR 引擎没有返回识别结果');return JSON.parse(text);
  }
  function ocrRunProcess(imagePath,command){
    var outputPath=ocrOutputPath(),engine=String(command.engine||'auto').toLowerCase(),timeout=Number(command.timeoutMs)||180000,script,candidates,selectedModel,i;
    function runWindows(){script=path.join(__dirname,'ocr_windows.ps1');return ocrExecFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ImagePath',imagePath,'-OutputPath',outputPath],timeout).then(function(){return {data:ocrReadOutput(outputPath),engine:'windows'};});}
    function runTesseract(){candidates=[command.modelPath,path.join(__dirname,'chi_sim.traineddata.gz')];selectedModel='';for(i=0;i<candidates.length;i++)if(candidates[i]&&fs.existsSync(candidates[i])){selectedModel=candidates[i];break;}if(!selectedModel)return Promise.reject(new Error('未找到 Tesseract 中文模型，请传入 modelPath 或放置 chi_sim.traineddata.gz'));script=path.join(__dirname,'ocr_tesseract_blocks.js');return ocrExecFile(process.execPath,[script,imagePath,outputPath,selectedModel],timeout).then(function(){return {data:ocrReadOutput(outputPath),engine:'tesseract'};});}
    function runHttp(url,local){return ocrHttpRequest({url:url,imagePath:imagePath,apiKey:command.apiKey,local:local,timeout:timeout}).then(function(data){return {data:data,engine:local?'local-http':'http'};});}
    function cleanupOutput(){try{if(fs.existsSync(outputPath))fs.unlinkSync(outputPath);}catch(ignoreOcrOutputCleanup){} }
    var configured=String(command.ocrUrl||command.serviceUrl||'').trim(),localUrl=configured||'http://127.0.0.1:8866/ocr',run;
    if(engine==='http')run=runHttp(localUrl,/127\.0\.0\.1(?::|$)/.test(localUrl));
    else if(engine==='windows')run=runWindows();
    else if(engine==='tesseract')run=runTesseract();
    else if(configured)run=runHttp(configured,/127\.0\.0\.1(?::|$)/.test(configured)).catch(function(){return runWindows();}).catch(function(){return runTesseract();});
    else run=runHttp(localUrl,/127\.0\.0\.1(?::|$)/.test(localUrl)).catch(function(){return runWindows();}).catch(function(){return runTesseract();});
    return run.then(function(result){cleanupOutput();return result;},function(error){cleanupOutput();throw error;});
  }
  function ocrRunWorkflow(command,ctx){
    var sourcePromise,generatedSource=null;
    if(command.imagePath){
      sourcePromise=Promise.resolve({documentId:command.documentId||null,layerId:command.sourceLayerId||null,layerName:'外部图片',scope:'file',originX:Number(command.originX)||0,originY:Number(command.originY)||0,width:Number(command.width)||0,height:Number(command.height)||0,tempPath:command.imagePath,fileName:path.basename(command.imagePath),generated:false});
    }else{
      sourcePromise=invokeRaw({action:'ocr_export_image',documentId:command.documentId,layerId:command.sourceLayerId});
    }
    return sourcePromise.then(function(source){
      generatedSource=source;
      if(ctx&&ctx.checkCancellation)ctx.checkCancellation('after-ocr-export');
      return ocrRunProcess(source.tempPath,command).then(function(engineResult){
        if(ctx&&ctx.checkCancellation)ctx.checkCancellation('after-ocr-recognize');
        var normalized=ocrNormalizeResponse(engineResult.data),originX=Number(source.originX)||0,originY=Number(source.originY)||0;
        var canvasLines=normalized.lines.map(function(line){var copy={};for(var key in line)if(line.hasOwnProperty(key))copy[key]=line[key];copy.x=line.x+originX;copy.y=line.y+originY;copy.box={x:copy.x,y:copy.y,width:line.width,height:line.height};return copy;});
        var createPromise=command.createTextLayers===false||!source.layerId?Promise.resolve(null):invokeRaw({action:'ocr_create_text_layers',documentId:source.documentId,sourceLayerId:source.layerId,sourceLayerName:source.layerName,groupName:command.groupName,font:command.font,color:command.color,lines:canvasLines});
        return createPromise.then(function(created){return {ok:true,engine:engineResult.engine,source:source,text:normalized.text,lines:normalized.lines,canvasLines:canvasLines,lineCount:normalized.lines.length,created:created,elapsedMs:normalized.elapsedMs};});
      });
    }).then(function(result){if(generatedSource&&generatedSource.generated!==false&&!command.keepTemp&&generatedSource.tempPath)try{fs.unlinkSync(generatedSource.tempPath);result.tempCleaned=true;}catch(ignoreOcrCleanup){}return result;},function(error){if(generatedSource&&generatedSource.generated!==false&&!command.keepTemp&&generatedSource.tempPath)try{fs.unlinkSync(generatedSource.tempPath);}catch(ignoreOcrCleanup){}throw error;});
  }


return ocrRunWorkflow;
};
