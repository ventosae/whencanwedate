import * as THREE from 'three';
import { Studio } from './studio.js';
import { BODY_DEFAULTS, BODY_RANGES, BODY_PRESETS } from './body.js';
import { fileToCanvas, hasTransparency, canvasToDataURL, dataURLToCanvas } from './imaging.js';
import { loadSession, saveSession, clearSession } from './store.js';
import { SAMPLES } from './samples.js';

const $ = (id) => document.getElementById(id);
const body = { ...BODY_DEFAULTS };
const studio = new Studio($('viewport'), body);
let photoCrop = null; // { canvas, width } from the last fitted photo

// ---- small UI helpers ------------------------------------------------------

function slider(parent, { label, min, max, step, value, format, onInput }) {
  const row = document.createElement('label');
  row.className = 'slider';
  const name = document.createElement('span');
  name.textContent = label;
  const out = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min, max, step, value });
  const show = () => (out.textContent = format(+input.value));
  input.addEventListener('input', () => {
    show();
    onInput(+input.value);
  });
  show();
  row.append(name, out, input);
  parent.append(row);
  return {
    set(v) {
      input.value = v;
      show();
    },
  };
}

let busyCount = 0;
function busy(text) {
  busyCount++;
  $('busy-text').textContent = text;
  $('busy').hidden = false;
  return () => {
    if (--busyCount === 0) $('busy').hidden = true;
  };
}

let hintTimer;
function hint(text, ms = 6000) {
  const el = $('hint');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(hintTimer);
  if (ms) hintTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- persistence -----------------------------------------------------------

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const layers = studio.layers.map((l) => {
      l.srcURL ??= canvasToDataURL(l.source);
      const { id, source, processed, texture, material, mesh, alpha, point, normal, srcURL, ...rest } = l;
      return { ...rest, src: srcURL, point: point.toArray(), normal: normal.toArray() };
    });
    await saveSession({ v: 1, body, layers });
  }, 700);
}

// ---- body controls ---------------------------------------------------------

const cm = (v) => `${Math.round(v * 200)} cm`;
const pct = (v) => `${Math.round(v * 100)}%`;
const BODY_FIELDS = [
  ['shoulders', 'Shoulders', cm],
  ['chest', 'Chest', cm],
  ['waist', 'Waist', cm],
  ['hips', 'Hips', cm],
  ['height', 'Torso length', (v) => `${Math.round(v * 100)} cm`],
  ['depth', 'Thickness', pct],
  ['chestVolume', 'Chest volume', pct],
  ['definition', 'Muscle definition', pct],
];
const bodySliders = {};

let bodyQueued = false;
function applyBody() {
  if (bodyQueued) return;
  bodyQueued = true;
  requestAnimationFrame(() => {
    bodyQueued = false;
    studio.setBody(body);
  });
  scheduleSave();
}

function syncBodyUI() {
  for (const [key] of BODY_FIELDS) bodySliders[key].set(body[key]);
  $('skin').value = body.skin;
}

for (const [key, label, format] of BODY_FIELDS) {
  const [min, max] = BODY_RANGES[key];
  bodySliders[key] = slider($('body-sliders'), {
    label,
    min,
    max,
    step: (max - min) / 200,
    value: body[key],
    format,
    onInput(v) {
      body[key] = v;
      applyBody();
    },
  });
}

for (const [name, preset] of Object.entries(BODY_PRESETS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => {
    Object.assign(body, preset);
    syncBodyUI();
    applyBody();
  });
  $('presets').append(b);
}

for (const tone of ['#f3d3bd', '#e3b596', '#c99676', '#a97653', '#7f5236', '#55361f']) {
  const b = document.createElement('button');
  b.style.background = tone;
  b.setAttribute('aria-label', `Skin tone ${tone}`);
  b.addEventListener('click', () => setSkin(tone));
  $('swatches').append(b);
}
function setSkin(tone) {
  body.skin = tone;
  $('skin').value = tone;
  studio.setSkin(tone);
  scheduleSave();
}
$('skin').addEventListener('input', (e) => setSkin(e.target.value));

$('body-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const done = busy('Reading your photo…');
  try {
    const canvas = await fileToCanvas(file, 1280);
    const { fitBodyFromPhoto } = await import('./photofit.js');
    const fit = await fitBodyFromPhoto(canvas);
    Object.assign(body, fit.params);
    syncBodyUI();
    studio.setBody(body);
    $('fit-notes').replaceChildren(
      ...fit.notes.map((n) => Object.assign(document.createElement('li'), { textContent: n })),
    );
    $('fit-notes').hidden = false;
    // Replace any previous wrapped photo.
    studio.layers.filter((l) => l.group === 'photo').forEach((l) => studio.removeLayer(l));
    photoCrop = fit.crop ? { canvas: fit.crop, width: fit.cropWidth } : null;
    $('wrap-row').hidden = !photoCrop;
    $('wrap').checked = false;
    studio.setView('front');
    scheduleSave();
  } catch (err) {
    console.error(err);
    $('fit-notes').replaceChildren(
      Object.assign(document.createElement('li'), {
        textContent: `Could not analyse that photo (${err.message}). You can still shape the body with the sliders.`,
      }),
    );
    $('fit-notes').hidden = false;
  } finally {
    done();
  }
});

$('wrap').addEventListener('change', (e) => {
  studio.layers.filter((l) => l.group === 'photo').forEach((l) => studio.removeLayer(l));
  if (!e.target.checked || !photoCrop) return scheduleSave();
  const y = (0.5 - 0.52) * body.height + 0.02;
  studio.addLayer(photoCrop.canvas, {
    name: 'My photo',
    group: 'photo',
    size: photoCrop.width,
    opacity: 1,
    locked: true,
    point: new THREE.Vector3(0, y, 0.12 * body.depth),
    normal: new THREE.Vector3(0, 0, 1),
  });
  // Move it to the bottom of the list so tattoos paint over it.
  const photo = studio.layers.pop();
  studio.layers.unshift(photo);
  studio.reorder();
  studio.emit('layers');
  hint('Your photo is wrapped on the front. Unlock it in the list to move or resize it.');
});

// ---- tattoos ---------------------------------------------------------------

async function addTattooFiles(files, group) {
  const done = busy('Adding tattoos…');
  let last = null;
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const canvas = await fileToCanvas(file);
      const transparent = hasTransparency(canvas);
      last = studio.addLayer(canvas, {
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'Tattoo',
        group,
        cutout: !transparent,
        // Photos of healed tattoos sit on skin; flash usually sits on white paper.
        strength: group === 'mine' ? 0.4 : 0.3,
      });
    }
  } catch (err) {
    hint(err.message);
  } finally {
    done();
  }
  if (last) {
    studio.select(last);
    hint('Drag the tattoo to move it. Scroll over it to resize, Shift + scroll to rotate.');
  }
}

$('mine-file').addEventListener('change', (e) => {
  addTattooFiles([...e.target.files], 'mine');
  e.target.value = '';
});
$('idea-file').addEventListener('change', (e) => {
  addTattooFiles([...e.target.files], 'idea');
  e.target.value = '';
});

for (const sample of SAMPLES) {
  const b = document.createElement('button');
  b.textContent = sample.name;
  b.addEventListener('click', () => {
    const layer = studio.addLayer(sample.make(), { name: sample.name, group: 'idea', size: sample.size });
    studio.select(layer);
    hint('Drag the tattoo to move it. Scroll over it to resize, Shift + scroll to rotate.');
  });
  $('samples').append(b);
}

// Drag & drop onto the stage adds ideas.
const stage = $('stage');
let dragDepth = 0;
stage.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('dropzone').hidden = false;
});
stage.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('dropzone').hidden = true;
  }
});
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropzone').hidden = true;
  addTattooFiles([...e.dataTransfer.files], 'idea');
});

// ---- layer list ------------------------------------------------------------

const GROUP_LABEL = { photo: 'Photo', mine: 'Have', idea: 'Idea' };

function iconButton(text, title, onClick, pressed) {
  const b = document.createElement('button');
  b.className = 'icon';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  if (pressed !== undefined) b.setAttribute('aria-pressed', pressed);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function renderLayers() {
  const list = $('layers');
  list.replaceChildren();
  // Top of the list = painted last.
  for (const layer of [...studio.layers].reverse()) {
    const li = document.createElement('li');
    li.className = `layer ${layer === studio.selected ? 'selected' : ''} ${layer.visible ? '' : 'off'}`;
    li.tabIndex = 0;
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 72;
    const k = Math.min(72 / layer.processed.width, 72 / layer.processed.height);
    const w = layer.processed.width * k;
    const h = layer.processed.height * k;
    thumb.getContext('2d').drawImage(layer.processed, (72 - w) / 2, (72 - h) / 2, w, h);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = layer.name;
    const tag = document.createElement('span');
    tag.className = `tag ${layer.group}`;
    tag.textContent = GROUP_LABEL[layer.group];
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      iconButton('↑', 'Bring forward', () => studio.moveLayer(layer, 1)),
      iconButton('↓', 'Send backward', () => studio.moveLayer(layer, -1)),
      iconButton(layer.locked ? '🔒' : '🔓', layer.locked ? 'Unlock (allow dragging)' : 'Lock in place', () => {
        layer.locked = !layer.locked;
        renderLayers();
        scheduleSave();
      }, layer.locked),
      iconButton(layer.visible ? '●' : '○', layer.visible ? 'Hide' : 'Show', () => {
        layer.visible = !layer.visible;
        studio.update(layer);
        renderLayers();
      }, !layer.visible),
    );
    li.append(thumb, name, tag, actions);
    const pick = () => studio.select(layer);
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => {
      if (e.target === li && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        pick();
      }
    });
    list.append(li);
  }
  $('layers-empty').hidden = studio.layers.length > 0;
  $('wrap').checked = studio.layers.some((l) => l.group === 'photo');
}

// ---- inspector -------------------------------------------------------------

const edit = (fn, image = false) => (v) => {
  const l = studio.selected;
  if (!l) return;
  fn(l, v);
  studio.update(l, { image });
  if (image) renderLayers();
};

const layerSliders = {
  size: slider($('layer-sliders'), {
    label: 'Size', min: 0.02, max: 0.6, step: 0.002, value: 0.12,
    format: (v) => `${Math.round(v * 100)} cm`,
    onInput: edit((l, v) => (l.size = v)),
  }),
  angle: slider($('layer-sliders'), {
    label: 'Rotation', min: -180, max: 180, step: 1, value: 0,
    format: (v) => `${v}°`,
    onInput: edit((l, v) => (l.angle = v)),
  }),
  opacity: slider($('layer-sliders'), {
    label: 'Ink strength', min: 0.1, max: 1, step: 0.01, value: 0.9,
    format: pct,
    onInput: edit((l, v) => (l.opacity = v)),
  }),
  strength: slider($('cutout-sliders'), {
    label: 'Background removal', min: 0, max: 1, step: 0.01, value: 0.45,
    format: pct,
    onInput: edit((l, v) => (l.strength = v), true),
  }),
};

$('l-cutout').addEventListener('change', (e) => {
  edit((l, v) => (l.cutout = v), true)(e.target.checked);
  $('cutout-sliders').hidden = !e.target.checked;
});
$('l-ink').addEventListener('change', (e) => edit((l, v) => (l.inkOnly = v), true)(e.target.checked));
$('l-flip').addEventListener('change', (e) => edit((l, v) => (l.flip = v), true)(e.target.checked));
$('l-del').addEventListener('click', () => studio.selected && studio.removeLayer(studio.selected));
$('l-dup').addEventListener('click', () => studio.selected && studio.duplicateLayer(studio.selected));
$('l-group').addEventListener('click', () => {
  const l = studio.selected;
  if (!l || l.group === 'photo') return;
  l.group = l.group === 'mine' ? 'idea' : 'mine';
  studio.update(l);
  renderLayers();
  syncInspector();
});

function syncInspector() {
  const l = studio.selected;
  $('inspector').hidden = !l;
  if (!l) return;
  $('insp-name').textContent = l.name;
  layerSliders.size.set(l.size);
  layerSliders.angle.set(Math.round(l.angle));
  layerSliders.opacity.set(l.opacity);
  layerSliders.strength.set(l.strength);
  $('l-cutout').checked = l.cutout;
  $('cutout-sliders').hidden = !l.cutout;
  $('l-ink').checked = l.inkOnly;
  $('l-flip').checked = l.flip;
  $('l-group').hidden = l.group === 'photo';
  $('l-group').textContent = l.group === 'mine' ? 'Mark as idea' : 'Mark as one I have';
}

studio.addEventListener('layers', () => {
  renderLayers();
  scheduleSave();
});
studio.addEventListener('select', () => {
  renderLayers();
  syncInspector();
});
studio.addEventListener('change', (e) => {
  if (e.detail === studio.selected) syncInspector();
  scheduleSave();
});

// ---- stage controls --------------------------------------------------------

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => studio.setView(b.dataset.view)));

$('compare').addEventListener('click', (e) => {
  const hide = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', hide);
  e.currentTarget.textContent = hide ? 'Show ideas' : 'Hide ideas';
  studio.setGroupHidden('idea', hide);
});

$('snapshot').addEventListener('click', () => {
  studio.snapshot().toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tattoo-preview.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Remove all tattoos and reset the body?')) return;
  clearTimeout(saveTimer);
  await clearSession();
  location.reload();
});

window.addEventListener('keydown', (e) => {
  const l = studio.selected;
  if (!l || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') studio.removeLayer(l);
  else if (e.key === 'Escape') studio.select(null);
  else if (e.key === '[' || e.key === ']') {
    l.angle = ((l.angle + (e.key === ']' ? 5 : -5) + 540) % 360) - 180;
    studio.update(l);
  } else if (e.key === '-' || e.key === '=' || e.key === '+') {
    l.size = Math.min(0.6, Math.max(0.02, l.size * (e.key === '-' ? 0.94 : 1.06)));
    studio.update(l);
  }
});

// ---- boot ------------------------------------------------------------------

(async () => {
  const saved = await loadSession();
  if (saved?.body) {
    Object.assign(body, saved.body);
    studio.setBody(body);
  }
  syncBodyUI();
  for (const s of saved?.layers ?? []) {
    try {
      const { src, point, normal, ...rest } = s;
      const layer = studio.addLayer(await dataURLToCanvas(src), {
        ...rest,
        point: new THREE.Vector3().fromArray(point),
        normal: new THREE.Vector3().fromArray(normal),
      });
      layer.srcURL = src;
    } catch (err) {
      console.warn('Skipped a saved tattoo that could not be restored', err);
    }
  }
  renderLayers();
  syncInspector();
  hint(
    studio.layers.length
      ? 'Welcome back. Drag the body to turn it, drag a tattoo to move it.'
      : 'Drag to turn the body. Upload a photo to fit it to you, or add a tattoo to start.',
    9000,
  );
  window.studio = studio; // handy for debugging in the console
})();
