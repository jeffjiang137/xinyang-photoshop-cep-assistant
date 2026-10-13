const fs = require('fs'), vm = require('vm'), assert = require('assert');
const nativeFixture = `
var jpegIndex = 1;
if (!strTitle || !strMessage || running !== 'abToFiles' || !ScriptFilePath) throw Error('missing Adobe entry context');
function getABLayerInfo() { return { all: fixture.boards, visible: fixture.boards }; }
function setEnabled() { if (app.activeDocument === fixture.source) throw Error('source modified'); }
function cleanUnseenAB() {}
function unArtBoard(boards) { if(fixture.fail === 'split') return false; return boards; }
function selectAbByOldID(id) { fixture.current = fixture.boards.filter(function(b){return b.AMid === id;})[0]; }
function cropFromMask() {
 app.activeDocument.width = {as:function(){return fixture.current.right-fixture.current.left;}};
 app.activeDocument.height = {as:function(){return fixture.current.bottom-fixture.current.top;}};
}
function removeEmptyLayers() {}
function cleanFilename(name) { return name.replace(/[:]/g, '_'); }
function saveFileNow(doc, name, options) {
 if (fixture.fail === 'save') throw Error('disk failure');
 fixture.saved.push({name:name,quality:options.jpegQuality,fileType:options.fileType});
 fixture.disk[options.destination+'/'+name+'.jpg'] = true;
 fixture.telemetry = strTitle + ' file type exported: jpg';
}
`;
function run(fail, boards) {
 const fixture = { boards: boards || [
  {AMid:1,name:'same',left:-120,top:-20,right:-20,bottom:80},
  {AMid:2,name:'same',left:50,top:40,right:250,bottom:140}
 ], saved:[], disk:{}, fail, closed:0 };
 const source = {duplicate() { return {mode:'rgb',close(){fixture.closed++;}};}};
 fixture.source = source;
 const app = {activeDocument:source,path:{fsName:'PS'},displayDialogs:'all',playbackDisplayDialogs:'all',preferences:{rulerUnits:'inches'}};
 function File(path) {
  if (!(this instanceof File)) return new File(path);
  this.name = path.split('/').pop();
  this.parent = {fsName:path.slice(0,path.lastIndexOf('/'))};
  Object.defineProperty(this,'exists',{get:()=>path.endsWith('ArtboardExport.inc') || !!fixture.disk[path]});
  this.length = 100;
  this.open = () => true; this.close = () => {}; this.read = () => nativeFixture;
 }
 const context = {localize: text => text.split("=").pop(),app,fixture,File,$:{global:{}},DialogModes:{NO:0},Units:{PIXELS:0},DocumentMode:{RGB:'rgb'},SaveOptions:{DONOTSAVECHANGES:0}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('jsx/modules/stitch/native-artboard-export.jsx','utf8'),context);
 const adapter = context.$.global.XinyangHostModules.nativeArtboardExport();
 if (fail) assert.throws(()=>adapter.exportJpeg(source,{fsName:'out'},82,false),fail==='split'?/拆分失败/:/disk failure/);
 else {
  const files = adapter.exportJpeg(source,{fsName:'out'},82,false);
  assert.deepStrictEqual(Array.from(files), ['same.jpg','same_2.jpg']);
  assert.strictEqual(fixture.saved[0].quality,10);
  assert.strictEqual(fixture.saved[0].fileType,1);
  assert.strictEqual(fixture.telemetry, 'Artboards To Files file type exported: jpg');
 }
 assert.strictEqual(app.activeDocument,source);
 assert.strictEqual(app.preferences.rulerUnits,'inches');
 assert.strictEqual(app.displayDialogs,'all');
 assert.strictEqual(app.playbackDisplayDialogs,'all');
 assert.strictEqual(fixture.closed,fail?1:2);
 assert.strictEqual(context.getABLayerInfo,undefined,'native helper declarations must stay local');
}
run(); run('save'); run('split');
console.log('PASS: native adapter naming, JPG quality, negative coordinates, failure cleanup and local scope');
