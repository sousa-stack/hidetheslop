// Writes the IPTC "made by AI" note (DigitalSourceType trainedAlgorithmicMedia) into
// WebP files, the way AI tools mark their own output. The demo's two flyers really are
// AI-made, and optimize_images.py strips every note, so without this a fresh install
// with your robot off would leave them alone. With it, the extension hides them by
// "the hidden note AI tools leave inside the file", the same as it would anywhere.
//
// The pixels aren't touched: the note goes in as an XMP chunk in the WebP container.
// Run from the repo root: node site/tools/mark-ai.mjs site/public/images/robot-rock.webp ...
import { readFileSync, writeFileSync } from 'node:fs';

const XMP = Buffer.from(
  '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
    'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>' +
    '</rdf:RDF></x:xmpmeta><?xpacket end="r"?>',
);

function chunk(id, data) {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function readChunks(file) {
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WEBP') throw new Error('not a WebP file');
  const chunks = [];
  for (let at = 12; at + 8 <= file.length; ) {
    const id = file.toString('ascii', at, at + 4);
    const size = file.readUInt32LE(at + 4);
    chunks.push({ id, data: file.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  return chunks;
}

// The canvas size a VP8X chunk needs, read from the image data itself.
function size({ id, data }) {
  if (id === 'VP8 ') return [data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff];
  if (id === 'VP8L') {
    const bits = data.readUInt32LE(1);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  throw new Error(`can't read the size from a ${id} chunk`);
}

for (const path of process.argv.slice(2)) {
  let chunks = readChunks(readFileSync(path)).filter((c) => c.id !== 'XMP ');
  let vp8x = chunks.find((c) => c.id === 'VP8X');
  if (!vp8x) {
    const [w, h] = size(chunks[0]);
    const data = Buffer.alloc(10);
    data.writeUIntLE(w - 1, 4, 3);
    data.writeUIntLE(h - 1, 7, 3);
    vp8x = { id: 'VP8X', data };
    chunks = [vp8x, ...chunks];
  }
  vp8x.data = Buffer.from(vp8x.data);
  vp8x.data[0] |= 0x04; // the XMP flag
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks.map((c) => chunk(c.id, c.data)), chunk('XMP ', XMP)]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  writeFileSync(path, Buffer.concat([head, body]));
  console.log(`marked ${path}`);
}
