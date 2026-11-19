// The 3D scene: torso mesh, tattoo decals projected onto it, and the
// drag-to-move interaction.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { buildBodyGeometry } from './body.js';
import { processTattoo } from './imaging.js';

let nextId = 1;

export class Studio extends EventTarget {
  constructor(container, bodyParams) {
    super();
    this.container = container;
    this.layers = [];
    this.selected = null;
    this.hidden = new Set(); // hidden groups

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
    this.camera.position.set(0, 0.05, 1.75);

    this.scene.add(new THREE.HemisphereLight(0xfff4e8, 0x2a2430, 0.85));
    const key = new THREE.DirectionalLight(0xfff1e0, 3.1);
    key.position.set(1.6, 1.8, 1.6);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
    fill.position.set(-2, 0.4, 1);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(0, 1.2, -2.5);
    // Lights follow the camera so the side you look at is always lit.
    this.rig = new THREE.Group();
    this.rig.add(key, fill, rim);
    this.scene.add(this.rig);

    this.skin = new THREE.MeshPhysicalMaterial({ color: bodyParams.skin, roughness: 0.62, sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0xffd8c8 });
    this.body = new THREE.Mesh(buildBodyGeometry(bodyParams), this.skin);
    this.scene.add(this.body);

    // Selection outline.
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(
      [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0)),
    );
    this.outline = new THREE.LineLoop(outlineGeo, new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.85, depthTest: false }));
    this.outline.renderOrder = 9999;
    this.outline.visible = false;
    this.scene.add(this.outline);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 3.2;
    this.controls.target.set(0, 0.02, 0);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    this.viewTween = null;
    this.dirty = new Set();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false, capture: true });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the whole torso in frame on tall, narrow screens.
    this.camera.fov = w / h < 0.8 ? 44 : 32;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    if (this.viewTween) {
      const t = this.viewTween;
      t.k = Math.min(1, t.k + 0.07);
      const e = 1 - (1 - t.k) ** 3;
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(t.from.radius, t.to.radius, e),
        THREE.MathUtils.lerp(t.from.phi, t.to.phi, e),
        t.from.theta + t.delta * e,
      );
      this.camera.position.setFromSpherical(sph).add(this.controls.target);
      if (t.k >= 1) this.viewTween = null;
    }
    this.controls.update();
    this.rig.quaternion.copy(this.camera.quaternion);
    if (this.dirty.size) {
      for (const layer of this.dirty) this.rebuildDecal(layer);
      this.dirty.clear();
      this.updateOutline();
    }
    // The outline ignores depth, so hide it when its tattoo faces away.
    const sel = this.selected;
    if (sel && !this.capturing && this.isShown(sel)) {
      this.outline.visible = sel.normal.dot(this.camera.position.clone().sub(sel.point)) > 0;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ---- body -------------------------------------------------------------

  setBody(params) {
    this.body.geometry.dispose();
    this.body.geometry = buildBodyGeometry(params);
    this.skin.color.set(params.skin);
    this.body.updateMatrixWorld(true);
    // Re-anchor every tattoo on the new surface.
    for (const layer of this.layers) {
      const origin = layer.point.clone().addScaledVector(layer.normal, 0.4);
      this.raycaster.set(origin, layer.normal.clone().negate());
      const hit = this.raycaster.intersectObject(this.body)[0];
      if (hit) this.anchor(layer, hit);
      this.dirty.add(layer);
    }
  }

  setSkin(color) {
    this.skin.color.set(color);
  }

  // ---- layers -----------------------------------------------------------

  /** @param {HTMLCanvasElement} source */
  addLayer(source, opts = {}) {
    const layer = {
      id: nextId++,
      name: 'Tattoo',
      group: 'idea',
      source,
      processed: document.createElement('canvas'),
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      size: 0.12,
      angle: 0,
      opacity: 0.92,
      flip: false,
      cutout: false,
      strength: 0.45,
      inkOnly: false,
      visible: true,
      locked: false,
      ...opts,
    };
    layer.texture = new THREE.CanvasTexture(layer.processed);
    layer.texture.colorSpace = THREE.SRGBColorSpace;
    layer.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    layer.material = new THREE.MeshStandardMaterial({
      map: layer.texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.62,
    });
    layer.mesh = new THREE.Mesh(new THREE.BufferGeometry(), layer.material);
    layer.mesh.userData.layer = layer;
    this.scene.add(layer.mesh);
    this.layers.push(layer);
    this.reprocess(layer);

    if (!opts.point) {
      // Drop it where the user is looking, or on the chest as a fallback.
      const hit = this.castFromScreen(0, 0.12) || this.castFromScreen(0, 0);
      if (hit) this.anchor(layer, hit);
      else layer.point.set(0, 0.1, 0.12);
    }
    this.dirty.add(layer);
    this.reorder();
    this.emit('layers');
    return layer;
  }

  removeLayer(layer) {
    this.layers = this.layers.filter((l) => l !== layer);
    this.scene.remove(layer.mesh);
    layer.mesh.geometry.dispose();
    layer.material.dispose();
    layer.texture.dispose();
    this.dirty.delete(layer);
    if (this.selected === layer) this.select(null);
    this.emit('layers');
  }

  duplicateLayer(layer) {
    const { id, processed, texture, material, mesh, ...rest } = layer;
    const copy = this.addLayer(layer.source, {
      ...rest,
      name: `${layer.name} copy`,
      point: layer.point.clone().add(new THREE.Vector3(0, -0.04, 0)),
      normal: layer.normal.clone(),
    });
    const origin = copy.point.clone().addScaledVector(copy.normal, 0.4);
    this.raycaster.set(origin, copy.normal.clone().negate());
    const hit = this.raycaster.intersectObject(this.body)[0];
    if (hit) this.anchor(copy, hit);
    this.select(copy);
    return copy;
  }

  moveLayer(layer, dir) {
    const i = this.layers.indexOf(layer);
    const j = i + dir;
    if (j < 0 || j >= this.layers.length) return;
    [this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]];
    this.reorder();
    this.emit('layers');
  }

  reorder() {
    // Wrapped photo sits under everything; otherwise list order is paint order.
    let n = 10;
    for (const l of this.layers) l.mesh.renderOrder = l.group === 'photo' ? 1 : n++;
  }

  /** Call after changing any layer property. */
  update(layer, { image = false } = {}) {
    if (image) this.reprocess(layer);
    this.dirty.add(layer);
    this.emit('change', layer);
  }

  reprocess(layer) {
    processTattoo(layer.source, layer.processed, layer);
    layer.alpha = null;
    layer.texture.needsUpdate = true;
  }

  setGroupHidden(group, hidden) {
    if (hidden) this.hidden.add(group);
    else this.hidden.delete(group);
    for (const l of this.layers) this.dirty.add(l);
  }

  isShown(layer) {
    return layer.visible && !this.hidden.has(layer.group);
  }

  select(layer) {
    if (this.selected === layer) return;
    this.selected = layer;
    this.updateOutline();
    this.emit('select', layer);
  }

  anchor(layer, hit) {
    layer.point.copy(hit.point);
    const n = (hit.normal || hit.face.normal).clone();
    layer.normal.copy(n.transformDirection(this.body.matrixWorld));
  }

  orientation(layer, target = new THREE.Object3D()) {
    target.position.copy(layer.point);
    target.up.set(0, 1, 0);
    target.lookAt(layer.point.clone().add(layer.normal));
    target.rotateZ(THREE.MathUtils.degToRad(-layer.angle));
    return target;
  }

  rebuildDecal(layer) {
    const shown = this.isShown(layer);
    layer.mesh.visible = shown;
    layer.material.opacity = layer.opacity;
    if (!shown) return;
    const aspect = layer.source.height / layer.source.width;
    const w = layer.size;
    const h = layer.size * aspect;
    const depth = THREE.MathUtils.clamp(Math.max(w, h) * 0.7, 0.06, 0.3);
    const o = this.orientation(layer);
    const geo = new DecalGeometry(this.body, layer.point, o.rotation, new THREE.Vector3(w, h, depth));

    // Drop triangles facing away from the projector so ink never bleeds
    // through to the far side of an arm or the back.
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const keepP = [];
    const keepN = [];
    const keepU = [];
    const n = layer.normal;
    for (let i = 0; i < pos.count; i += 3) {
      const facing =
        (nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2)) * n.x +
        (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) * n.y +
        (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2)) * n.z;
      if (facing < 0.25) continue;
      for (let k = i; k < i + 3; k++) {
        keepP.push(pos.getX(k), pos.getY(k), pos.getZ(k));
        keepN.push(nor.getX(k), nor.getY(k), nor.getZ(k));
        keepU.push(uv.getX(k), uv.getY(k));
      }
    }
    geo.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(keepU, 2));
    layer.mesh.geometry.dispose();
    layer.mesh.geometry = out;
  }

  updateOutline() {
    const l = this.selected;
    if (!l || !this.isShown(l) || this.capturing) {
      this.outline.visible = false;
      return;
    }
    this.orientation(l, this.outline);
    this.outline.position.addScaledVector(l.normal, 0.012);
    this.outline.scale.set(l.size, (l.size * l.source.height) / l.source.width, 1);
    this.outline.visible = true;
  }

  // ---- interaction ------------------------------------------------------

  setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  castFromScreen(x, y) {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    return this.raycaster.intersectObject(this.body)[0];
  }

  /** Topmost unlocked tattoo under the pointer, ignoring transparent pixels. */
  pickLayer() {
    const meshes = this.layers.filter((l) => this.isShown(l) && !l.locked).map((l) => l.mesh);
    const hits = this.raycaster.intersectObjects(meshes);
    if (!hits.length) return null;
    const nearest = hits[0].distance;
    const candidates = hits
      .filter((h) => h.distance < nearest + 0.05 && this.opaqueAt(h.object.userData.layer, h.uv))
      .sort((a, b) => b.object.renderOrder - a.object.renderOrder);
    return candidates[0]?.object.userData.layer ?? null;
  }

  opaqueAt(layer, uv) {
    if (!uv) return true;
    const c = layer.processed;
    layer.alpha ??= c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    // Be generous: look at a small neighbourhood so thin lines are grabbable.
    const cx = Math.round(uv.x * (c.width - 1));
    const cy = Math.round((1 - uv.y) * (c.height - 1));
    const r = Math.max(2, Math.round(c.width * 0.03));
    for (let y = cy - r; y <= cy + r; y += r) {
      for (let x = cx - r; x <= cx + r; x += r) {
        if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
        if (layer.alpha[(y * c.width + x) * 4 + 3] > 24) return true;
      }
    }
    return false;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    this.setPointer(e);
    const layer = this.pickLayer();
    if (!layer) return;
    this.select(layer);
    // Remember where on the tattoo it was grabbed (in screen space) so it
    // doesn't jump to the cursor.
    const centre = layer.point.clone().project(this.camera);
    this.drag = { layer, offset: new THREE.Vector2(centre.x - this.pointer.x, centre.y - this.pointer.y), moved: false };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  onPointerMove(e) {
    this.setPointer(e);
    if (!this.drag) {
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        this.renderer.domElement.style.cursor = this.pickLayer() ? 'grab' : '';
      }
      return;
    }
    const { layer, offset } = this.drag;
    this.raycaster.setFromCamera(this.pointer.clone().add(offset), this.camera);
    const hit = this.raycaster.intersectObject(this.body)[0];
    if (!hit) return;
    this.drag.moved = true;
    this.anchor(layer, hit);
    this.dirty.add(layer);
  }

  onPointerUp(e) {
    if (!this.drag) return;
    const { layer, moved } = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = '';
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (moved) this.emit('change', layer);
  }

  onWheel(e) {
    // Scroll over the selected tattoo resizes it (shift = rotate); elsewhere it zooms.
    this.setPointer(e);
    const layer = this.pickLayer();
    if (!layer || layer !== this.selected) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) layer.angle = ((layer.angle + Math.sign(e.deltaY || e.deltaX) * 5 + 540) % 360) - 180;
    else layer.size = THREE.MathUtils.clamp(layer.size * (e.deltaY > 0 ? 0.94 : 1.06), 0.02, 0.6);
    this.update(layer);
  }

  // ---- camera & export --------------------------------------------------

  setView(name) {
    const theta = { front: 0, left: Math.PI / 2, back: Math.PI, right: -Math.PI / 2 }[name] ?? 0;
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    let delta = theta - from.theta;
    delta = ((delta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.viewTween = { from, to: { radius: 1.75, phi: Math.PI / 2 - 0.03 }, delta, k: 0 };
  }

  snapshot() {
    this.capturing = true;
    this.updateOutline();
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    const g = ctx.createRadialGradient(out.width / 2, out.height * 0.4, 0, out.width / 2, out.height * 0.4, Math.max(out.width, out.height) * 0.75);
    g.addColorStop(0, '#3a3440');
    g.addColorStop(1, '#141217');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    this.capturing = false;
    this.updateOutline();
    return out;
  }
}
