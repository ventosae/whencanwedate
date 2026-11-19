// Parametric torso: a lofted mannequin-style bust with upper arms, driven by a
// handful of proportions so it can be fitted to a photo or tuned by hand.
import * as THREE from 'three';

export const BODY_DEFAULTS = {
  height: 0.6, // hips to neck base
  shoulders: 0.21, // half width at the shoulders (incl. deltoids)
  chest: 0.165, // half width of the rib cage
  waist: 0.135,
  hips: 0.165,
  depth: 1, // front-to-back thickness multiplier
  chestVolume: 0.35, // pecs / bust
  definition: 0.35, // muscle grooves
  skin: '#c99676',
};

export const BODY_RANGES = {
  height: [0.5, 0.72],
  shoulders: [0.16, 0.27],
  chest: [0.125, 0.215],
  waist: [0.1, 0.21],
  hips: [0.125, 0.22],
  depth: [0.8, 1.35],
  chestVolume: [0, 1],
  definition: [0, 1],
};

export const BODY_PRESETS = {
  Slim: { shoulders: 0.19, chest: 0.145, waist: 0.118, hips: 0.148, depth: 0.88, chestVolume: 0.15, definition: 0.2 },
  Athletic: { shoulders: 0.225, chest: 0.172, waist: 0.13, hips: 0.158, depth: 1, chestVolume: 0.5, definition: 0.75 },
  Broad: { shoulders: 0.25, chest: 0.2, waist: 0.185, hips: 0.19, depth: 1.25, chestVolume: 0.45, definition: 0.1 },
  Curvy: { shoulders: 0.19, chest: 0.155, waist: 0.122, hips: 0.19, depth: 1, chestVolume: 0.85, definition: 0.05 },
};

const ARM_R = 0.05;

// Hermite interpolation through (t, value) keys with finite-difference tangents.
function curve(keys) {
  return (t) => {
    const n = keys.length;
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    const slope = (a, b) => (keys[b][1] - keys[a][1]) / (keys[b][0] - keys[a][0]);
    const m0 = i > 0 ? slope(i - 1, i + 1) : slope(i, i + 1);
    const m1 = i + 2 < n ? slope(i, i + 2) : slope(i, i + 1);
    const h = t1 - t0;
    const s = (t - t0) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1
    );
  };
}

const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function loft(rings, segs, ringFn) {
  const pos = new Float32Array(rings * segs * 3 + 6);
  const idx = [];
  let p = 0;
  const first = new THREE.Vector3();
  const last = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let r = 0; r < rings; r++) {
    const c = new THREE.Vector3();
    for (let s = 0; s < segs; s++) {
      ringFn(r / (rings - 1), (s / segs) * Math.PI * 2, v);
      pos[p++] = v.x;
      pos[p++] = v.y;
      pos[p++] = v.z;
      c.add(v);
    }
    c.multiplyScalar(1 / segs);
    if (r === 0) first.copy(c);
    if (r === rings - 1) last.copy(c);
  }
  const capA = rings * segs;
  const capB = capA + 1;
  first.toArray(pos, capA * 3);
  last.toArray(pos, capB * 3);
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * segs + s;
      const b = r * segs + ((s + 1) % segs);
      const c = a + segs;
      const d = b + segs;
      idx.push(a, d, b, a, c, d);
    }
  }
  for (let s = 0; s < segs; s++) {
    const n = (s + 1) % segs;
    idx.push(capA, s, n);
    idx.push(capB, (rings - 1) * segs + n, (rings - 1) * segs + s);
  }
  return { pos, idx };
}

export function buildBodyGeometry(p) {
  const H = p.height;
  const D = p.depth;
  const neck = 0.05;
  const torsoShoulder = Math.max(p.shoulders - ARM_R * 0.55, p.chest * 0.95);

  // t = 0 at the bottom cut (hips), 1 at the neck base.
  const width = curve([
    [-0.06, p.hips * 0.7],
    [-0.035, p.hips * 0.93],
    [0.08, p.hips],
    [0.2, (p.hips + p.waist) / 2],
    [0.38, p.waist],
    [0.58, p.chest * 0.96],
    [0.74, p.chest],
    [0.84, (p.chest + torsoShoulder) / 2],
    [0.895, torsoShoulder],
    [0.925, torsoShoulder * 0.9],
    [0.955, torsoShoulder * 0.55],
    [0.985, neck * 1.55],
    [1.02, neck * 1.08],
    [1.07, neck],
    [1.17, neck * 1.02],
    [1.19, neck * 0.75],
  ]);
  const depth = curve([
    [-0.06, 0.075 * D],
    [-0.035, 0.103 * D],
    [0.08, 0.112 * D],
    [0.38, 0.094 * D],
    [0.58, 0.108 * D],
    [0.74, 0.118 * D],
    [0.86, 0.1 * D],
    [0.925, 0.072 * D],
    [0.955, 0.06 * D],
    [0.985, 0.062],
    [1.07, 0.056],
    [1.17, 0.056],
    [1.19, 0.04],
  ]);
  // Slight S-curve of the spine: centre of each ring shifts in z.
  const zShift = curve([
    [0, 0.004],
    [0.3, 0.012],
    [0.7, -0.004],
    [0.95, -0.01],
    [1.0, -0.006],
    [1.19, -0.002],
  ]);

  const RINGS = 96;
  const SEGS = 96;
  const torso = loft(RINGS, SEGS, (u, ang, out) => {
    const t = -0.06 + u * 1.25;
    const w = width(t);
    const d = depth(t);
    const n = 2.5 - 0.5 * smooth(0.88, 0.98, t); // boxier torso, round neck
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let x = w * Math.sign(c) * Math.abs(c) ** (2 / n);
    let z = d * Math.sign(s) * Math.abs(s) ** (2 / n);
    const xn = x / w; // -1..1 across the body
    let bump = 0;
    if (z > 0) {
      // Chest: pecs when small, fuller and lower as the volume goes up.
      const cv = p.chestVolume;
      const cy = 0.735 - 0.035 * cv;
      const chest = gauss(Math.abs(xn), 0.46, 0.33) * gauss(t, cy, 0.085 + 0.02 * cv);
      bump += chest * (0.008 + 0.045 * cv);
      // Abs: centre line and three horizontal grooves.
      const def = p.definition;
      const absZone = smooth(0.12, 0.2, t) * (1 - smooth(0.56, 0.64, t));
      bump -= (0.002 + def * 0.007) * gauss(xn, 0, 0.07) * smooth(0.1, 0.25, t) * (1 - smooth(0.66, 0.78, t));
      let grooves = 0;
      for (const gy of [0.3, 0.4, 0.5]) grooves += gauss(t, gy, 0.014);
      bump -= def * 0.005 * grooves * absZone * (1 - smooth(0.3, 0.5, Math.abs(xn)));
      bump += def * 0.005 * absZone * gauss(Math.abs(xn), 0.2, 0.16);
      // Collarbones.
      bump += 0.005 * gauss(t, 0.9 + 0.02 * Math.abs(xn), 0.012) * smooth(0.08, 0.2, Math.abs(xn));
    } else {
      const def = p.definition;
      // Spine groove and shoulder blades.
      bump -= (0.006 + 0.006 * def) * gauss(xn, 0, 0.08) * smooth(0.05, 0.2, t) * (1 - smooth(0.85, 0.95, t));
      bump += (0.01 + 0.008 * def) * gauss(Math.abs(xn), 0.48, 0.24) * gauss(t, 0.74, 0.09);
      // Glutes hint at the very bottom.
      bump += 0.01 * gauss(Math.abs(xn), 0.45, 0.3) * gauss(t, 0.02, 0.07);
    }
    const len = Math.hypot(x, z) || 1;
    x += (x / len) * bump;
    z += (z / len) * bump;
    out.set(x, t * H, z + zShift(t));
  });

  // Upper arms: tubes from the shoulder down to mid-biceps, angled slightly out.
  const parts = [torso];
  const armLen = H * 0.5;
  const armRadius = curve([
    [0, 0.01],
    [0.025, ARM_R * 0.62],
    [0.07, ARM_R * 0.92],
    [0.16, ARM_R * 1.08],
    [0.3, ARM_R * (1.02 + 0.06 * p.definition)],
    [0.55, ARM_R * 0.9],
    [0.8, ARM_R * (0.92 + 0.08 * p.definition)],
    [0.97, ARM_R * 0.84],
    [1, ARM_R * 0.5],
  ]);
  for (const side of [-1, 1]) {
    const top = new THREE.Vector3(side * (p.shoulders - ARM_R * 1.0), H * 0.925, zShift(0.9) - 0.004);
    const dir = new THREE.Vector3(side * 0.13, -1, 0.04).normalize();
    const ax = new THREE.Vector3(0, 0, 1);
    const bx = new THREE.Vector3().crossVectors(dir, ax).normalize();
    ax.crossVectors(bx, dir).normalize();
    const arm = loft(48, 40, (u, ang, out) => {
      const r = armRadius(u);
      out
        .copy(top)
        .addScaledVector(dir, u * armLen - ARM_R * 0.45)
        .addScaledVector(bx, Math.cos(ang) * r * side)
        .addScaledVector(ax, Math.sin(ang) * r * 1.08);
    });
    if (side === -1) {
      // rings run downward here, so flip the winding to face outward
      for (let i = 0; i < arm.idx.length; i += 3) [arm.idx[i + 1], arm.idx[i + 2]] = [arm.idx[i + 2], arm.idx[i + 1]];
    }
    parts.push(arm);
  }

  const total = parts.reduce((n, q) => n + q.pos.length, 0);
  const pos = new Float32Array(total);
  const idx = [];
  let off = 0;
  for (const q of parts) {
    pos.set(q.pos, off);
    const base = off / 3;
    for (const i of q.idx) idx.push(i + base);
    off += q.pos.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Centre vertically so the camera can orbit around the middle of the torso.
  geo.translate(0, -H * 0.52, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
