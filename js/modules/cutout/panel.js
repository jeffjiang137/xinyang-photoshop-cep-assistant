(function () {
  "use strict";
  var busy = false;
  var outputMode = "transparent";
  var qualityMode = "fast";
  function setQuality(value) {
    qualityMode = value === "high" ? "high" : "fast";
    Array.prototype.forEach.call(document.querySelectorAll("[data-cutout-quality]"), function (button) {
      var active = button.getAttribute("data-cutout-quality") === qualityMode;
      button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active));
    });
    try { localStorage.setItem("longStitch.cutoutQuality", qualityMode); } catch (ignoreQualityStorage) {}
  }
  function el(id) { return document.getElementById(id); }
  function status(text, kind) {
    el('cutout-status').textContent = text;
    var feedback = el('cutout-feedback');
    if (feedback) feedback.setAttribute('data-state', kind || (busy ? 'working' : 'idle'));
  }
  function setMode(mode) {
    outputMode = mode === 'mask' ? 'mask' : 'transparent';
    Array.prototype.forEach.call(document.querySelectorAll('[data-cutout-mode]'), function (button) {
      var active = button.getAttribute('data-cutout-mode') === outputMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    el('cutout-mode-description').textContent = outputMode === 'mask' ? '生成可编辑蒙版，保留原图' : '生成透明图层，保留原图';
    try { localStorage.setItem('longStitch.cutoutMode', outputMode); } catch (ignoreStorage) {}
  }
  function modules() {
    var req = window.require || (window.cep_node && window.cep_node.require);
    if (!req) throw new Error('请在 Photoshop 插件内使用');
    return {fs:req('fs'),http:req('http'),os:req('os'),path:req('path')};
  }
  function base() {
    var url = el('cutout-url').value.trim().replace(/\/$/, '');
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('请输入本机 HTTP 地址，例如 http://127.0.0.1:8868');
    localStorage.setItem('longStitch.cutoutUrl', url);
    return url;
  }
  function request(route, bytes, options) {
    return new Promise(function (resolve, reject) {
      var m, url;
      try { m = modules(); url = new URL(base() + route); } catch (e) { reject(e); return; }
      var boundary = 'XinyangCutout' + Date.now(), body;
      var fields = [];
      if (bytes && options && options.mode) {
        if (options.mode !== 'fast' && options.mode !== 'high') { reject(new Error('抠图模式无效')); return; }
        fields.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="mode"\r\n\r\n'+options.mode+'\r\n'));
      }
      if (bytes) body = Buffer.concat(fields.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]));
      var req = m.http.request({hostname:url.hostname,port:url.port,path:url.pathname,method:body?'POST':'GET',headers:body?{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length}:{}},function(res){
        var chunks=[], size=0;
        res.on('data',function(c){ size+=c.length; if(size>200*1024*1024){req.destroy(new Error('返回图片过大'));return;} chunks.push(c); });
        res.on('error',reject);
        res.on('end',function(){
          var data=Buffer.concat(chunks);
          if(res.statusCode!==200){var message=data.toString('utf8');try{message=JSON.parse(message).error||message;}catch(ignoreJson){} reject(new Error((res.statusCode === 429 ? '服务正忙，请稍后重试。' : '')+'HTTP '+res.statusCode+'：'+message.slice(0,240)));return;}
          if(!bytes){try{resolve(JSON.parse(data.toString('utf8')));}catch(e){reject(new Error('服务状态无效'));}return;}
          if(data.length<8 || data.slice(0,8).toString('hex')!=='89504e470d0a1a0a'){reject(new Error('服务没有返回有效 PNG'));return;}
          resolve(data);
        });
      });
      req.setTimeout(bytes?300000:5000,function(){req.destroy(new Error('服务响应超时；首次加载模型可能较慢'));});
      req.on('error',reject); req.end(body);
    });
  }
  // Remove near-transparent haze without eroding the model's soft contour.
  function refineAlpha(data) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          var ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (var i = 3; i < pixels.data.length; i += 4) {
            var alpha = pixels.data[i];
            pixels.data[i] = Math.max(0, Math.min(255, Math.round((alpha - 4) * 255 / 247)));
          }
          ctx.putImageData(pixels, 0, 0);
          resolve(Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64'));
        } catch (error) { reject(error); }
      };
      image.onerror = function () { reject(new Error('抠图结果解码失败')); };
      image.src = 'data:image/png;base64,' + data.toString('base64');
    });
  }
  function host(method,payload) { return window.XinyangRuntime.hostInvoke(method,payload||{}); }
  function run(task) {
    if(busy)return; busy=true;
    el('cutout-panel').setAttribute('aria-busy', 'true');
    el('cutout-start').textContent = '处理中…';
    Array.prototype.forEach.call(el('cutout-panel').querySelectorAll('button,input,select'),function(n){n.disabled=true;});
    Promise.resolve().then(task).catch(function(e){status((qualityMode === 'high' ? '精细抠图失败（未切换为快速模式）：' : '失败：')+e.message+(/LongStitchCEP|不是函数|is not a function/.test(e.message)?'。请重载插件面板；仍失败时重启 Photoshop。':/ECONNREFUSED|ETIMEDOUT|服务响应超时/.test(e.message)?'。请检查桌面软件中的 RMBG 服务状态。':''), 'error');}).then(function(){busy=false;
      el('cutout-panel').setAttribute('aria-busy', 'false');
      el('cutout-start').textContent = '开始抠图';
      var feedback = el('cutout-feedback');
      if (feedback && feedback.getAttribute('data-state') === 'working') feedback.setAttribute('data-state', 'success');Array.prototype.forEach.call(el('cutout-panel').querySelectorAll('button,input,select'),function(n){n.disabled=false;});});
  }
  function checkCapabilities(result, mode) {
    if (!result || !result.ok) throw new Error('服务不可用');
    if (result.modelAvailable === false) throw new Error('RMBG 模型未安装');
    if (mode === 'high') {
      if (!Array.isArray(result.modes) || result.modes.indexOf('high') < 0) {
        throw new Error('当前服务版本不支持精细抠图，请更新桌面服务');
      }
      if (result.vitmatteAvailable !== true) {
        throw new Error('精细抠图模型未安装或不可用，请在桌面软件中检查 ViTMatte 模型');
      }
    }
    return result;
  }
  function health() {
    status('正在连接本机服务…');
    return request('/health').then(function (result) {
      checkCapabilities(result, qualityMode);
      status(qualityMode === 'high' ? '精细抠图服务可用；首次处理会加载模型' : '快速抠图服务可用；首次处理会加载模型');
      return result;
    });
  }
  function current() {
    var m=modules(), source, output;
    return health().then(function(){status('正在准备当前图片…');return host('exportSelectedLayerForOCR');}).then(function(s){
      source=s;status('正在抠图，请等待模型处理…');return request('/remove-background',m.fs.readFileSync(s.tempPath), {mode:qualityMode}).then(function (data) { return qualityMode === 'high' ? data : refineAlpha(data); });
    }).then(function(data){
      output=m.path.join(m.os.tmpdir(),'xinyang_cutout_'+Date.now()+'.png');m.fs.writeFileSync(output,data);
      return host('toolsApplyCutout',{source:source,path:output,mask:outputMode==='mask'});
    }).then(function(){status('抠图完成，结果已添加到原图上方，原图保留。');}).then(clean, function(e){clean();throw e;});
    function clean(){[source&&source.tempPath,output].forEach(function(f){if(f)try{m.fs.unlinkSync(f);}catch(ignoreCleanup){}});}
  }
  function batch() {
    var picked=window.cep.fs.showOpenDialog(true,false,'选择待抠图图片','',['png','jpg','jpeg','webp']);
    if(picked.err||!picked.data.length)return;
    var folder=window.cep.fs.showOpenDialog(false,true,'选择输出文件夹');
    if(folder.err||!folder.data.length)return;
    var m=modules(), failures=[], done=0, stamp=Date.now();
    return health().then(function(){return picked.data.reduce(function(chain,file,index){return chain.then(function(){
      status('正在处理 '+(index+1)+' / '+picked.data.length);
      return Promise.resolve().then(function(){return request('/remove-background',m.fs.readFileSync(file), {mode:qualityMode}).then(function (data) { return qualityMode === 'high' ? data : refineAlpha(data); });}).then(function(data){
        var name=m.path.basename(file,m.path.extname(file))+'_抠图_'+stamp+'_'+index+'.png';
        m.fs.writeFileSync(m.path.join(folder.data[0],name),data,{flag:'wx'});done++;
      }).catch(function(e){failures.push(m.path.basename(file)+'：'+e.message);});
    });},Promise.resolve());}).then(function(){status('批量完成：成功 '+done+'，失败 '+failures.length+(failures.length?'\n'+failures.join('\n'):''), failures.length ? 'error' : 'success');});
  }
  function init(){
    var savedQuality;
    try { savedQuality = localStorage.getItem('longStitch.cutoutQuality'); } catch (ignoreQuality) {}
    setQuality(savedQuality);
    Array.prototype.forEach.call(document.querySelectorAll('[data-cutout-quality]'), function (button) {
      button.onclick = function () { if (!busy) setQuality(button.getAttribute('data-cutout-quality')); };
    });
    var savedMode;
    try { savedMode = localStorage.getItem('longStitch.cutoutMode'); } catch (ignoreMode) {}
    setMode(savedMode);
    Array.prototype.forEach.call(document.querySelectorAll('[data-cutout-mode]'), function (button) {
      button.onclick = function () { if (!busy) setMode(button.getAttribute('data-cutout-mode')); };
    });
    el('cutout-url').value=localStorage.getItem('longStitch.cutoutUrl')||'http://127.0.0.1:8868';
    el('cutout-test').onclick=function(){run(health);};el('cutout-start').onclick=function(){run(current);};el('cutout-batch').onclick=function(){run(batch);};
  }
  window.XinyangCutout={request:request,checkCapabilities:checkCapabilities};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
}());
