const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createWorker } = require('tesseract.js');
const imagePath = process.argv[2];
const outputPath = process.argv[3];
const modelGz = process.argv[4];
const workDir = path.dirname(modelGz);
const modelPath = path.join(workDir, 'chi_sim.traineddata');
if (!fs.existsSync(modelPath)) fs.writeFileSync(modelPath, zlib.gunzipSync(fs.readFileSync(modelGz)));
(async () => {
  const worker = await createWorker('chi_sim', 1, { langPath: workDir, gzip: false, cachePath: workDir, logger: m => { if (m.status === 'recognizing text' && m.progress != null) process.stderr.write(`\\rOCR ${Math.round(m.progress * 100)}%`); } });
  const result = await worker.recognize(imagePath, {}, { blocks: true, tsv: true, hocr: true });
  await worker.terminate();
  process.stderr.write('\\n');
  fs.writeFileSync(outputPath, JSON.stringify(result.data, null, 2), 'utf8');
  console.log(outputPath);
})();
