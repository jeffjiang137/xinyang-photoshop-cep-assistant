const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const code = fs.readFileSync('jsx/slice-export-v2193.jsx', 'utf8');
new vm.Script(code);
new vm.Script(fs.readFileSync('jsx/modules/stitch/stitch-slice.jsx', 'utf8'));
const exportFunction = code.slice(code.indexOf('    function exportAssets('), code.indexOf('    function invoke('));
function run(boards, slices, width, height) {
  const saved = [];
  const source = { name: 'source', width, height, artboards: boards.length, rect: [0, 0, width, height] };
  const app = { documents: [source], activeDocument: source, displayDialogs: 'yes', preferences: { rulerUnits: 'old' } };
  let guides = 0;
  const context = {
    exportNativeArtboards: (doc, folder, quality, singleSquare) => {
      assert.strictEqual(doc, source);
      assert.strictEqual(quality, 82);
      boards.forEach(board => saved.push({name: board.name + '.jpg', rect: [board.left, board.top, board.right, board.bottom]}));
      return saved.map(x => x.name);
    },
    app, pixels: Number, selectedLayerIds: () => [7], selectLayersByIds: () => {},
    Folder: function(path) { this.fsName = path; this.exists = path === 'out'; this.create = () => true; },
    collectDocumentArtboards: () => boards, collectDocumentSlices: () => slices,
    makeExportSlicesFromGuides: () => { guides++; return { generated: true, guides: 2 }; },
    removeCanvasSliceWhenExportingMultiple: x => x, sliceIsOnlyAutomaticCanvasSlice: () => false,
    sliceSafeFileName: x => x, sliceUniqueOutputFile: (folder, name) => ({ name: name + '.jpg' }),
    DialogModes: { NO: 'no' }, Units: { PIXELS: 'pixels' }, DocumentMode: { RGB: 'rgb' },
    BitsPerChannelType: { EIGHT: 8 }, ChangeMode: { RGB: 'rgb' }, Intent: { RELATIVECOLORIMETRIC: 0 },
    SaveOptions: { DONOTSAVECHANGES: 0 }, UnitValue: value => value,
    clearAllDocumentSlices: () => { assert.notStrictEqual(app.activeDocument, source); },
    fillDocumentWhite: doc => { assert.notStrictEqual(doc, source); doc.artboards = 0; },
    duplicateForSliceExport: doc => ({ ...doc, crop(rect) {
      assert.strictEqual(this.artboards, 0, 'crop must not retain artboard containers');
      this.rect = rect;
    }, close() {}, convertProfile() {} }),
    sliceSaveForWebJpeg: (doc, file) => saved.push({ name: file.name, rect: doc.rect })
  };
  vm.createContext(context);
  vm.runInContext(exportFunction, context);
  const result = context.exportAssets({ folder: 'out' });
  assert.strictEqual(app.activeDocument, source);
  assert.strictEqual(source.artboards, boards.length);
  assert.strictEqual(app.preferences.rulerUnits, 'old');
  assert.strictEqual(app.displayDialogs, 'yes');
  return { result, saved, guides };
}
const boards = [
  {name:'A', left:0, top:0, right:100, bottom:100},
  {name:'B', left:120, top:0, right:220, bottom:100}
];
const multi = run(boards, [], 220, 100);
assert.strictEqual(multi.result.mode, 'artboards');
assert.strictEqual(multi.guides, 0);
assert.deepStrictEqual(multi.saved.map(x => x.name), ['A.jpg', 'B.jpg']);
assert.deepStrictEqual(Array.from(multi.saved[1].rect), [120, 0, 220, 100]);
const canvas = run([], [], 800, 800);
assert.strictEqual(canvas.result.mode, 'canvas');
assert.strictEqual(canvas.saved[0].name, '主图.jpg');
const sliced = run([], [{left:0, top:0, right:790, bottom:500}, {left:0, top:500, right:790, bottom:1000}], 790, 1000);
assert.strictEqual(sliced.result.mode, 'slices');
assert.strictEqual(sliced.saved.length, 2);
assert.strictEqual(sliced.guides, 1);
console.log('PASS: native artboard dispatch, source/state preservation, square canvas and guide slices; JSX syntax');
