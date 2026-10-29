// Looks for AI provenance markers in the first few hundred KB of an image file.
// Everything we look for is plain text inside the file's metadata: C2PA manifests
// (CBOR strings), XMP, EXIF, PNG tEXt/iTXt chunks. No pixels are analysed.
/* exported SlopMeta */

var SlopMeta = (() => {
  // IPTC digital source types. C2PA "c2pa.actions" and XMP both use these URIs.
  const GENERATED = /(?:^|[^A-Za-z])trainedAlgorithmicMedia/;
  const EDITED = /compositeWithTrainedAlgorithmicMedia/;

  // Tool names that only show up in metadata when that tool made the file.
  const GENERATORS = [
    [/Midjourney/i, 'Midjourney'],
    [/DALL[·\-. ]?E/, 'DALL·E'],
    [/OpenAI|ChatGPT|gpt-image|GPT-4o/, 'OpenAI / ChatGPT'],
    [/Stable[ _-]?Diffusion|\bSDXL\b|DreamStudio/i, 'Stable Diffusion'],
    [/Adobe[ _]Firefly/i, 'Adobe Firefly'],
    [/Leonardo\.?Ai/i, 'Leonardo.Ai'],
    [/Ideogram/i, 'Ideogram'],
    [/NovelAI/, 'NovelAI'],
    [/NightCafe/i, 'NightCafe'],
    [/Bing Image Creator|Image Creator from Microsoft|Microsoft Designer/i, 'Microsoft Designer'],
    [/Imagined with AI|Meta AI/, 'Meta AI'],
    [/black-forest-labs|FLUX\.1/i, 'FLUX'],
    [/Playground ?AI|Craiyon|Recraft/i, 'AI image tool'],
  ];

  // Settings dumps that image generators write into the file.
  const PARAMS = [
    [/Steps: \d+, Sampler: /, 'Stable Diffusion settings'],
    [/"class_type"\s*:\s*"/, 'ComfyUI workflow'],
    [/invokeai_metadata|sd-metadata/, 'InvokeAI settings'],
    [/Job ID: [0-9a-f]{8}-[0-9a-f]{4}-/, 'Midjourney job'],
    // China's mandatory AIGC label (GB 45438-2025): AIGC {"Label":"1", ...}
    [/AIGC[\s\S]{0,40}?["']?Label["']?\s*[:=]\s*["']?1/, 'AIGC label'],
  ];

  function toText(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return s;
  }

  function scan(bytes) {
    const s = toText(bytes);
    if (EDITED.test(s)) return { ai: false, edited: true, reason: 'Image metadata says AI-edited' };
    if (GENERATED.test(s)) return { ai: true, edited: false, reason: 'Image metadata says AI-generated (C2PA/IPTC)' };
    for (const [re, name] of PARAMS) {
      if (re.test(s)) return { ai: true, edited: false, reason: `Image contains ${name}` };
    }
    for (const [re, name] of GENERATORS) {
      if (re.test(s)) return { ai: true, edited: false, reason: `Image metadata names ${name}` };
    }
    return { ai: false, edited: false, reason: '' };
  }

  function scanDataUrl(url, limit) {
    const comma = url.indexOf(',');
    if (comma < 0 || !url.slice(0, comma).includes(';base64')) return null;
    const b64 = url.slice(comma + 1, comma + 1 + Math.floor((limit * 4) / 3 / 4) * 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return scan(bytes);
  }

  return { scan, scanDataUrl };
})();
