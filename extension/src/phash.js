// The perceptual hash behind the crowd ratings (hashVersion 1 in docs/CROWD-API.md).
// Hashes within 3 bits count as one picture, so two browsers have to land that close
// on the same file or its votes never merge. Browsers don't agree on scaling, so all
// they do here is decode. Every later step is our own arithmetic, and changing any of
// it after votes exist means a new hashVersion and splitting the data.
//
// Only runs for a rating you're sharing (SlopVision.hash). fromPixels is pure so it runs
// in Node. fromBlob and fromBitmap need a page with OffscreenCanvas.
/* exported SlopHash */

var SlopHash = (() => {
  const SIZE = 32;
  const KEEP = 8;
  const MAX_PIXELS = 40e6;
  const STRIP_PIXELS = 1e6;
  // How far apart the largest and smallest of the 63 values must be. Under this they're
  // mostly noise, and noise would decide the bits. Noise on a flat page measured under
  // 40 and the flattest real picture 6800, so this sits well clear of both. A canvas
  // that came out blank is 0.
  const MIN_SPREAD = 1000;

  // Asking for these, not trusting the defaults, because they all move pixels.
  const DECODE = { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' };
  const CANVAS = { colorSpace: 'srgb', willReadFrequently: true };

  // cos((2x + 1) * u * PI / 64) for u in 0..7 and x in 0..31. Literals, because
  // Math.cos differs between engines in the last digit, and on a flat flyer that's
  // enough to decide a bit.
  // prettier-ignore
  const COS = [
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    0.9987954562051724, 0.989176509964781, 0.970031253194544, 0.9415440651830208,
    0.9039892931234433, 0.8577286100002721, 0.8032075314806449, 0.7409511253549591,
    0.6715589548470184, 0.5956993044924334, 0.5141027441932218, 0.4275550934302821,
    0.33688985339222005, 0.2429801799032639, 0.14673047445536175, 0.049067674327418015,
    -0.049067674327418015, -0.14673047445536175, -0.2429801799032639, -0.33688985339222005,
    -0.4275550934302821, -0.5141027441932218, -0.5956993044924334, -0.6715589548470184,
    -0.7409511253549591, -0.8032075314806449, -0.8577286100002721, -0.9039892931234433,
    -0.9415440651830208, -0.970031253194544, -0.989176509964781, -0.9987954562051724,
    0.9951847266721969, 0.9569403357322088, 0.881921264348355, 0.773010453362737,
    0.6343932841636455, 0.47139673682599764, 0.2902846772544624, 0.0980171403295606,
    -0.0980171403295606, -0.2902846772544624, -0.47139673682599764, -0.6343932841636455,
    -0.773010453362737, -0.881921264348355, -0.9569403357322088, -0.9951847266721969,
    -0.9951847266721969, -0.9569403357322088, -0.881921264348355, -0.773010453362737,
    -0.6343932841636455, -0.47139673682599764, -0.2902846772544624, -0.0980171403295606,
    0.0980171403295606, 0.2902846772544624, 0.47139673682599764, 0.6343932841636455,
    0.773010453362737, 0.881921264348355, 0.9569403357322088, 0.9951847266721969,
    0.989176509964781, 0.9039892931234433, 0.7409511253549591, 0.5141027441932218,
    0.2429801799032639, -0.049067674327418015, -0.33688985339222005, -0.5956993044924334,
    -0.8032075314806449, -0.9415440651830208, -0.9987954562051724, -0.970031253194544,
    -0.8577286100002721, -0.6715589548470184, -0.4275550934302821, -0.14673047445536175,
    0.14673047445536175, 0.4275550934302821, 0.6715589548470184, 0.8577286100002721,
    0.970031253194544, 0.9987954562051724, 0.9415440651830208, 0.8032075314806449,
    0.5956993044924334, 0.33688985339222005, 0.049067674327418015, -0.2429801799032639,
    -0.5141027441932218, -0.7409511253549591, -0.9039892931234433, -0.989176509964781,
    0.9807852804032304, 0.8314696123025452, 0.5555702330196022, 0.19509032201612828,
    -0.19509032201612828, -0.5555702330196022, -0.8314696123025452, -0.9807852804032304,
    -0.9807852804032304, -0.8314696123025452, -0.5555702330196022, -0.19509032201612828,
    0.19509032201612828, 0.5555702330196022, 0.8314696123025452, 0.9807852804032304,
    0.9807852804032304, 0.8314696123025452, 0.5555702330196022, 0.19509032201612828,
    -0.19509032201612828, -0.5555702330196022, -0.8314696123025452, -0.9807852804032304,
    -0.9807852804032304, -0.8314696123025452, -0.5555702330196022, -0.19509032201612828,
    0.19509032201612828, 0.5555702330196022, 0.8314696123025452, 0.9807852804032304,
    0.970031253194544, 0.7409511253549591, 0.33688985339222005, -0.14673047445536175,
    -0.5956993044924334, -0.9039892931234433, -0.9987954562051724, -0.8577286100002721,
    -0.5141027441932218, -0.049067674327418015, 0.4275550934302821, 0.8032075314806449,
    0.989176509964781, 0.9415440651830208, 0.6715589548470184, 0.2429801799032639,
    -0.2429801799032639, -0.6715589548470184, -0.9415440651830208, -0.989176509964781,
    -0.8032075314806449, -0.4275550934302821, 0.049067674327418015, 0.5141027441932218,
    0.8577286100002721, 0.9987954562051724, 0.9039892931234433, 0.5956993044924334,
    0.14673047445536175, -0.33688985339222005, -0.7409511253549591, -0.970031253194544,
    0.9569403357322088, 0.6343932841636455, 0.0980171403295606, -0.47139673682599764,
    -0.881921264348355, -0.9951847266721969, -0.773010453362737, -0.2902846772544624,
    0.2902846772544624, 0.773010453362737, 0.9951847266721969, 0.881921264348355,
    0.47139673682599764, -0.0980171403295606, -0.6343932841636455, -0.9569403357322088,
    -0.9569403357322088, -0.6343932841636455, -0.0980171403295606, 0.47139673682599764,
    0.881921264348355, 0.9951847266721969, 0.773010453362737, 0.2902846772544624,
    -0.2902846772544624, -0.773010453362737, -0.9951847266721969, -0.881921264348355,
    -0.47139673682599764, 0.0980171403295606, 0.6343932841636455, 0.9569403357322088,
    0.9415440651830208, 0.5141027441932218, -0.14673047445536175, -0.7409511253549591,
    -0.9987954562051724, -0.8032075314806449, -0.2429801799032639, 0.4275550934302821,
    0.9039892931234433, 0.970031253194544, 0.5956993044924334, -0.049067674327418015,
    -0.6715589548470184, -0.989176509964781, -0.8577286100002721, -0.33688985339222005,
    0.33688985339222005, 0.8577286100002721, 0.989176509964781, 0.6715589548470184,
    0.049067674327418015, -0.5956993044924334, -0.970031253194544, -0.9039892931234433,
    -0.4275550934302821, 0.2429801799032639, 0.8032075314806449, 0.9987954562051724,
    0.7409511253549591, 0.14673047445536175, -0.5141027441932218, -0.9415440651830208,
  ];

  // The box filter, fed a strip at a time. Positions are scaled by 32, so a source
  // pixel is 32 units wide, a cell is `width` units wide, and every overlap is a whole
  // number. Pictures are at least 32 wide, so a pixel touches two cells at most.
  function shrinker(width, height) {
    const cellOf = new Int32Array(width);
    const share = new Int32Array(width); // units in cellOf[x]; the rest go in the next cell
    for (let x = 0; x < width; x++) {
      cellOf[x] = Math.floor((x * SIZE) / width);
      share[x] = Math.min(SIZE, (cellOf[x] + 1) * width - x * SIZE);
    }
    const cells = new Float64Array(SIZE * SIZE);
    const row = new Float64Array(SIZE + 1);
    let y = 0;

    function add(rgba, rows) {
      for (let r = 0; r < rows; r++, y++) {
        row.fill(0);
        for (let x = 0, i = r * width * 4; x < width; x++, i += 4) {
          let gray = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          const a = rgba[i + 3];
          if (a < 255) gray = (gray * a) / 255 + 255 - a; // what the white canvas does
          row[cellOf[x]] += gray * share[x];
          row[cellOf[x] + 1] += gray * (SIZE - share[x]);
        }
        const cy = Math.floor((y * SIZE) / height);
        const part = Math.min(SIZE, (cy + 1) * height - y * SIZE);
        for (let i = 0; i < SIZE; i++) {
          cells[cy * SIZE + i] += row[i] * part;
          if (part < SIZE) cells[(cy + 1) * SIZE + i] += row[i] * (SIZE - part);
        }
      }
    }

    // Each cell has collected width × height units.
    return { add, cells: () => cells.map((v) => v / (width * height)) };
  }

  // The top-left 8 × 8 of the 2-D DCT-II, without scale factors, in row-major order, so
  // rows are vertical frequency. Without the first value that's 63. They're rounded to
  // 1e-6, as whole millionths, so values that are equal on paper are equal here.
  function coefficients(cells) {
    const across = new Float64Array(SIZE * KEEP);
    for (let y = 0; y < SIZE; y++) {
      for (let u = 0; u < KEEP; u++) {
        let sum = 0;
        for (let x = 0; x < SIZE; x++) sum += cells[y * SIZE + x] * COS[u * SIZE + x];
        across[y * KEEP + u] = sum;
      }
    }
    const values = new Float64Array(KEEP * KEEP - 1);
    for (let v = 0; v < KEEP; v++) {
      for (let u = 0; u < KEEP; u++) {
        if (!v && !u) continue;
        let sum = 0;
        for (let y = 0; y < SIZE; y++) sum += across[y * KEEP + u] * COS[v * SIZE + y];
        values[v * KEEP + u - 1] = Math.round(sum * 1e6);
      }
    }
    return values;
  }

  function fromCells(cells) {
    const values = coefficients(cells);
    const sorted = values.slice().sort();
    const spread = (sorted[sorted.length - 1] - sorted[0]) / 1e6;
    if (spread < MIN_SPREAD) return { phash: null, why: 'flat', spread };
    const median = sorted[31];
    // Two 32-bit halves, because 63 bits don't fit in a double. The first value is bit
    // 62 and the last bit 0, so the top bit stays 0.
    let hi = 0;
    let lo = 0;
    values.forEach((value, i) => {
      if (value <= median) return;
      const bit = 62 - i;
      if (bit >= 32) hi += 2 ** (bit - 32);
      else lo += 2 ** bit;
    });
    const hex = (n) => n.toString(16).padStart(8, '0');
    return { phash: hex(hi) + hex(lo), why: '', spread };
  }

  function wrongSize(width, height) {
    if (width < SIZE || height < SIZE) return { phash: null, why: 'small', spread: 0 };
    if (width * height > MAX_PIXELS) return { phash: null, why: 'large', spread: 0 };
    return null;
  }

  // All the results are { phash, why, spread }: 16 lowercase hex digits and '', or null
  // and why not (small, large, flat, animated, undecodable). `rgba` is width × height
  // × 4 bytes, and anything see-through lands on white.
  function fromPixels(rgba, width, height) {
    const bad = wrongSize(width, height);
    if (bad) return bad;
    const box = shrinker(width, height);
    box.add(rgba, height);
    return fromCells(box.cells());
  }

  // Draws at 1:1 onto white, one strip of about a megapixel at a time, so a big picture
  // never needs a canvas near a browser's limit. A canvas over that limit can go blank
  // without saying so, which comes out as flat.
  function fromBitmap(bitmap) {
    const { width, height } = bitmap;
    const bad = wrongSize(width, height);
    if (bad) return bad;
    const rows = Math.min(height, Math.max(1, Math.floor(STRIP_PIXELS / width)));
    const canvas = new OffscreenCanvas(width, rows);
    const ctx = canvas.getContext('2d', CANVAS);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff';
    const box = shrinker(width, height);
    for (let y = 0; y < height; y += rows) {
      const n = Math.min(rows, height - y);
      ctx.fillRect(0, 0, width, n);
      ctx.drawImage(bitmap, 0, -y);
      box.add(ctx.getImageData(0, 0, width, n).data, n);
    }
    canvas.width = canvas.height = 0;
    return fromCells(box.cells());
  }

  // Browsers don't promise which frame createImageBitmap gives you, so an animation
  // gets no hash. A GIF with one frame is a still picture.
  function isAnimated(bytes) {
    const is = (at, text) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
    if (is(0, 'GIF8')) return gifHasFrames(bytes, 2);
    if (is(0, 'RIFF') && is(8, 'WEBP')) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 12; i + 8 <= bytes.length; ) {
        if (is(i, 'ANIM')) return true;
        const size = view.getUint32(i + 4, true);
        i += 8 + size + (size & 1);
      }
    } else if (is(0, '\x89PNG')) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 8; i + 8 <= bytes.length; i += 12 + view.getUint32(i)) {
        if (is(i + 4, 'acTL')) return true;
        if (is(i + 4, 'IDAT')) return false; // acTL has to come first
      }
    }
    return false;
  }

  function gifHasFrames(bytes, wanted) {
    const colorTable = (flags) => (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
    const afterBlocks = (from) => {
      let i = from;
      while (i < bytes.length && bytes[i]) i += bytes[i] + 1;
      return i + 1;
    };
    let frames = 0;
    let i = 13 + colorTable(bytes[10]);
    while (i < bytes.length) {
      if (bytes[i] === 0x21) {
        i = afterBlocks(i + 2);
      } else if (bytes[i] === 0x2c) {
        if (++frames >= wanted) return true;
        i = afterBlocks(i + 11 + colorTable(bytes[i + 9]));
      } else {
        break;
      }
    }
    return false;
  }

  async function fromBlob(blob) {
    if (isAnimated(new Uint8Array(await blob.arrayBuffer()))) return { phash: null, why: 'animated', spread: 0 };
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob, DECODE);
    } catch {
      return { phash: null, why: 'undecodable', spread: 0 };
    }
    try {
      return fromBitmap(bitmap);
    } finally {
      bitmap.close();
    }
  }

  return { fromPixels, fromBitmap, fromBlob, isAnimated };
})();
