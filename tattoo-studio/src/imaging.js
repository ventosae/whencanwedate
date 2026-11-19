// Image helpers: loading, downscaling, and turning a tattoo photo into a
// transparent "ink only" cut-out.

const MAX_SIDE = 1024;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = src;
  });
}

export async function fileToCanvas(file, maxSide = MAX_SIDE) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return drawScaled(img, maxSide);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function drawScaled(source, maxSide = MAX_SIDE) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1] ?? 0;
}

export function hasTransparency(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  let clear = 0;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 200) clear++;
  return clear > data.length / 16 / 50;
}

/**
 * Render a layer's source into `out`, optionally removing the background.
 * The background colour is estimated from the image border (skin or paper),
 * and each pixel's alpha comes from how far it is from that colour.
 * `strength` 0..1 controls how aggressively the background is removed.
 */
export function processTattoo(source, out, { cutout, strength = 0.5, flip = false, inkOnly = false }) {
  const w = source.width;
  const h = source.height;
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.save();
  if (flip) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  if (!cutout && !inkOnly) return out;

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  if (cutout) {
    const rs = [];
    const gs = [];
    const bs = [];
    const step = Math.max(1, Math.round(Math.max(w, h) / 200));
    const sample = (x, y) => {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) return;
      rs.push(d[i]);
      gs.push(d[i + 1]);
      bs.push(d[i + 2]);
    };
    const m = Math.max(1, Math.round(Math.min(w, h) * 0.02));
    for (let x = 0; x < w; x += step) {
      sample(x, m);
      sample(x, h - 1 - m);
    }
    for (let y = 0; y < h; y += step) {
      sample(m, y);
      sample(w - 1 - m, y);
    }
    const bg = [median(rs), median(gs), median(bs)];
    // Distance below `lo` is background, above `hi` fully opaque.
    const lo = 18 + strength * 110;
    const hi = lo + 60;
    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - bg[0];
      const dg = d[i + 1] - bg[1];
      const db = d[i + 2] - bg[2];
      const dist = Math.sqrt(dr * dr * 0.6 + dg * dg + db * db * 0.6) * 1.15;
      let a = (dist - lo) / (hi - lo);
      a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
      d[i + 3] = Math.round(d[i + 3] * a);
    }
  }
  if (inkOnly) {
    // Collapse colours to a healed-blackwork tone, keeping darkness as alpha.
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      d[i] = 22;
      d[i + 1] = 26;
      d[i + 2] = 32;
      d[i + 3] = Math.round(d[i + 3] * Math.min(1, (1 - lum) * 1.35));
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

export function canvasToDataURL(canvas) {
  return canvas.toDataURL('image/png');
}

export async function dataURLToCanvas(url) {
  return drawScaled(await loadImage(url), MAX_SIDE);
}
