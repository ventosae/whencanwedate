// Fits the parametric torso to a photo. Everything runs in the browser:
// MediaPipe Pose finds shoulders and hips, its segmentation mask gives the
// silhouette for the waist, and skin-coloured pixels give the skin tone.
import { BODY_RANGES } from './body.js';

const LOCAL_MODEL = './models/pose_landmarker_lite.task';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

let landmarkerPromise;

async function getLandmarker() {
  landmarkerPromise ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('./wasm');
    const local = await fetch(LOCAL_MODEL, { method: 'HEAD' }).then(
      (r) => r.ok && !(r.headers.get('content-type') || '').includes('text/html'),
      () => false,
    );
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: local ? LOCAL_MODEL : REMOTE_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
      outputSegmentationMasks: true,
    });
  })();
  landmarkerPromise.catch(() => (landmarkerPromise = undefined));
  return landmarkerPromise;
}

const clampTo = (key, v) => Math.min(BODY_RANGES[key][1], Math.max(BODY_RANGES[key][0], v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function isSkin(r, g, b) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return y > 50 && cb > 77 && cb < 127 && cr > 133 && cr < 175;
}

function sampleSkin(ctx, W, H, boxes) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (const [x0, y0, x1, y1] of boxes) {
    const x = Math.max(0, Math.floor(x0));
    const y = Math.max(0, Math.floor(y0));
    const w = Math.min(W, Math.ceil(x1)) - x;
    const h = Math.min(H, Math.ceil(y1)) - y;
    if (w < 2 || h < 2) continue;
    const d = ctx.getImageData(x, y, w, h).data;
    const step = 4 * Math.max(1, Math.floor((w * h) / 6000));
    for (let i = 0; i < d.length; i += step) {
      if (isSkin(d[i], d[i + 1], d[i + 2])) {
        rs.push(d[i]);
        gs.push(d[i + 1]);
        bs.push(d[i + 2]);
      }
    }
  }
  if (rs.length < 80) return null;
  // Upper-middle of the distribution: skips ink and shadow.
  const pick = (a) => a.sort((p, q) => p - q)[Math.floor(a.length * 0.6)];
  const hex = (v) => v.toString(16).padStart(2, '0');
  return `#${hex(pick(rs))}${hex(pick(gs))}${hex(pick(bs))}`;
}

/** Width of the silhouette at row y, walking out from the centre line. */
function silhouetteHalfWidths(mask, mw, mh, cx, y) {
  const row = Math.round(y);
  if (row < 0 || row >= mh) return null;
  const at = (x) => mask[row * mw + x] > 0.5;
  const c = Math.round(cx);
  if (c < 0 || c >= mw || !at(c)) return null;
  let l = c;
  let r = c;
  while (l > 0 && at(l - 1)) l--;
  while (r < mw - 1 && at(r + 1)) r++;
  return [c - l, r - c];
}

/**
 * @param {HTMLCanvasElement} canvas the uploaded photo
 * @returns {Promise<{params: object, crop: HTMLCanvasElement|null, cropWidth: number, notes: string[]}>}
 */
export async function fitBodyFromPhoto(canvas) {
  const landmarker = await getLandmarker();
  const result = landmarker.detect(canvas);
  const lm = result.landmarks?.[0];
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const notes = [];

  const px = (i) => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? 1 });
  const usable = lm && [11, 12, 23, 24].every((i) => (lm[i].visibility ?? 1) > 0.35);
  if (!usable) {
    result.segmentationMasks?.forEach((m) => m.close());
    const skin = sampleSkin(ctx, W, H, [[W * 0.25, H * 0.25, W * 0.75, H * 0.75]]);
    return {
      params: skin ? { skin } : {},
      crop: null,
      cropWidth: 0,
      notes: [
        'Could not find shoulders and hips in this photo, so proportions were left as they are.',
        skin ? 'Skin tone was sampled from the middle of the photo.' : 'Adjust the sliders to match your build.',
      ],
    };
  }

  const ls = px(11);
  const rs = px(12);
  const lh = px(23);
  const rh = px(24);
  const S = dist(ls, rs);
  const Hp = dist(lh, rh);
  const midS = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const midH = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const L = dist(midS, midH);

  // Model-space references: shoulder joints sit ~4.5 cm inside the deltoid
  // edge; hip joints at ~55% of the hip half-width; joints span 0.82 of height.
  const params = {};
  const height = 0.6;
  const jointSpan = 0.82 * height;
  const ratioLS = Math.min(1.9, Math.max(1.0, L / S));
  const shoulderJoint = jointSpan / ratioLS / 2;
  params.height = height;
  params.shoulders = clampTo('shoulders', shoulderJoint + 0.045);
  const ratioSH = Math.min(2.4, Math.max(1.2, S / Hp));
  params.hips = clampTo('hips', (shoulderJoint * 2) / ratioSH / 2 / 0.55);
  params.chest = clampTo('chest', params.shoulders * 0.79 + (params.hips - 0.165) * 0.25);
  params.waist = clampTo('waist', Math.min(params.chest, params.hips) * 0.84);

  // Waist and hips from the silhouette, when the arms are clear of the body.
  const maskObj = result.segmentationMasks?.[0];
  let mask = null;
  let mw = 0;
  let mh = 0;
  if (maskObj) {
    mw = maskObj.width;
    mh = maskObj.height;
    mask = maskObj.getAsFloat32Array().slice();
    const sx = mw / W;
    const sy = mh / H;
    const armLimit = Math.min(...[13, 14, 15, 16].map((i) => Math.abs(px(i).x - midH.x))) * 0.92;
    const measure = (f) => {
      const y = midS.y + (midH.y - midS.y) * f;
      const cx = midS.x + (midH.x - midS.x) * f;
      const hw = silhouetteHalfWidths(mask, mw, mh, cx * sx, y * sy);
      if (!hw) return null;
      const half = Math.min(hw[0], hw[1]) / sx; // the narrower side is less likely to include an arm
      return half < armLimit ? half : null;
    };
    const metersPerPx = (shoulderJoint * 2) / S;
    // Only trust a silhouette width that is plausible next to the joint-based
    // estimate; a turned or twisted torso gives a much narrower outline.
    const plausible = (v, est) => v > est * 0.82 && v < est * 1.25;
    const waistM = [0.5, 0.58, 0.66].map(measure).filter(Boolean).map((v) => v * metersPerPx);
    const waist = waistM.length ? Math.min(...waistM) : null;
    if (waist && plausible(waist, params.waist)) {
      params.waist = clampTo('waist', waist);
      notes.push('Waist measured from your silhouette.');
    } else {
      notes.push('The waist is an estimate: face the camera with arms slightly away from your sides for a closer fit.');
    }
    const hipPx = measure(0.98);
    if (hipPx && plausible(hipPx * metersPerPx, params.hips)) params.hips = clampTo('hips', (params.hips + hipPx * metersPerPx) / 2);
    const chestPx = measure(0.3);
    if (chestPx && plausible(chestPx * metersPerPx, params.chest)) params.chest = clampTo('chest', chestPx * metersPerPx);
    maskObj.close();
  }
  result.segmentationMasks?.slice(1).forEach((m) => m.close());

  // Skin tone from the torso, upper arms and face.
  const nose = px(0);
  const box = (a, b, pad) => [Math.min(a.x, b.x) - pad, Math.min(a.y, b.y) - pad, Math.max(a.x, b.x) + pad, Math.max(a.y, b.y) + pad];
  const skin = sampleSkin(ctx, W, H, [
    [Math.min(ls.x, rs.x) + S * 0.15, midS.y + L * 0.1, Math.max(ls.x, rs.x) - S * 0.15, midH.y - L * 0.1],
    box(ls, px(13), S * 0.08),
    box(rs, px(14), S * 0.08),
    [nose.x - S * 0.12, nose.y - S * 0.12, nose.x + S * 0.12, nose.y + S * 0.12],
  ]);
  if (skin) params.skin = skin;
  else notes.push('Not enough visible skin to sample a tone. Pick one with the colour control.');

  // Feathered crop of the torso that can be wrapped onto the model's front.
  const x0 = Math.max(0, Math.round(midS.x - S * 0.72));
  const x1 = Math.min(W, Math.round(midS.x + S * 0.72));
  const y0 = Math.max(0, Math.round(midS.y - L * 0.16));
  const y1 = Math.min(H, Math.round(midH.y + L * 0.06));
  let crop = null;
  if (x1 - x0 > 16 && y1 - y0 > 16) {
    crop = document.createElement('canvas');
    crop.width = x1 - x0;
    crop.height = y1 - y0;
    const cctx = crop.getContext('2d');
    cctx.drawImage(canvas, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const img = cctx.getImageData(0, 0, crop.width, crop.height);
    const d = img.data;
    const fx = crop.width * 0.14;
    const fy = crop.height * 0.1;
    for (let y = 0; y < crop.height; y++) {
      for (let x = 0; x < crop.width; x++) {
        let a = Math.min(1, x / fx, (crop.width - 1 - x) / fx) * Math.min(1, y / fy, (crop.height - 1 - y) / fy);
        if (mask) {
          const mx = Math.min(mw - 1, Math.floor(((x + x0) / W) * mw));
          const my = Math.min(mh - 1, Math.floor(((y + y0) / H) * mh));
          a *= Math.min(1, Math.max(0, (mask[my * mw + mx] - 0.3) / 0.4));
        }
        d[(y * crop.width + x) * 4 + 3] *= a;
      }
    }
    cctx.putImageData(img, 0, 0);
  }

  notes.unshift('Proportions fitted from your shoulders and hips.');
  return { params, crop, cropWidth: ((x1 - x0) / S) * shoulderJoint * 2, notes };
}
